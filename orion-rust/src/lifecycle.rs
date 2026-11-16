//! Rust-owned packaged startup for PostgreSQL and the Nest API.

use crate::runtime_compat::{prepare_postgres_binaries, resolve_runtime_paths};
use crate::rust_api_supervisor::{ApiCommand, SupervisorOutcome, SystemApiBackend};
use crate::rust_payload_supervisor::PayloadSupervisorAdapter;
use crate::supervisor::{ProcessSpec, Supervisor};
use crate::Profile;
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

#[cfg(test)]
const PROVISION_JS: &str = r#"
const { createRequire } = require("node:module");
const apiRequire = createRequire(process.env.ORION_API_PACKAGE_JSON);
const { PrismaClient } = apiRequire("@prisma/client");
const sql = (value) => `'${String(value).replaceAll("'", "''")}'`;
async function main() {
  const admin = new PrismaClient({ datasources: { db: { url: process.env.ORION_ADMIN_URL } } });
  try {
    const found = await admin.$queryRawUnsafe("SELECT 1 FROM pg_database WHERE datname = $1", "orion");
    if (!found.length) await admin.$executeRawUnsafe("CREATE DATABASE orion");
  } finally { await admin.$disconnect(); }
  const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  try {
    const app = await db.$queryRawUnsafe("SELECT 1 FROM pg_roles WHERE rolname = 'orion_app'");
    if (!app.length) await db.$executeRawUnsafe(`CREATE ROLE orion_app LOGIN PASSWORD ${sql(process.env.ORION_APP_PASSWORD)} NOSUPERUSER NOBYPASSRLS`);
    else await db.$executeRawUnsafe(`ALTER ROLE orion_app WITH LOGIN PASSWORD ${sql(process.env.ORION_APP_PASSWORD)} NOSUPERUSER NOBYPASSRLS`);
    const system = await db.$queryRawUnsafe("SELECT 1 FROM pg_roles WHERE rolname = 'orion_system'");
    if (!system.length) await db.$executeRawUnsafe("CREATE ROLE orion_system NOLOGIN NOSUPERUSER BYPASSRLS");
    else await db.$executeRawUnsafe("ALTER ROLE orion_system WITH NOLOGIN NOSUPERUSER BYPASSRLS");
    await db.$executeRawUnsafe("GRANT orion_system TO orion_app");
    await db.$executeRawUnsafe("GRANT USAGE ON SCHEMA public TO orion_app, orion_system");
    await db.$executeRawUnsafe("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO orion_app, orion_system");
    await db.$executeRawUnsafe("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO orion_app, orion_system");
    await db.$executeRawUnsafe("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO orion_app, orion_system");
    await db.$executeRawUnsafe("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO orion_app, orion_system");
  } finally { await db.$disconnect(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
"#;

#[cfg(test)]
const IDENTITY_JS: &str = r#"
const { createRequire } = require("node:module");
const apiRequire = createRequire(process.env.ORION_API_PACKAGE_JSON);
const { PrismaClient } = apiRequire("@prisma/client");
const fs = require("node:fs");
const path = require("node:path");
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const canonical = value => path.resolve(fs.realpathSync(value)).replace(/[\\/]+$/, "").toLowerCase();
async function main() {
  try {
    const rows = await db.$queryRawUnsafe("SELECT current_setting('data_directory') AS data_directory, current_setting('port')::int AS port");
    if (rows.length !== 1 || Number(rows[0].port) !== Number(process.env.ORION_EXPECTED_PG_PORT) || canonical(rows[0].data_directory) !== canonical(process.env.ORION_EXPECTED_PG_CLUSTER)) {
      throw new Error("Подключённый PostgreSQL не совпадает с ожидаемым кластером и портом");
    }
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
"#;

// One Node boot for the two pre-migration database steps: read-only cluster
// identity proof, then idempotent database/role provisioning. Splitting them
// cost a full Prisma Client cold start (~2-5 s) on every launch.
const PG_SETUP_JS: &str = r#"
const { createRequire } = require("node:module");
const apiRequire = createRequire(process.env.ORION_API_PACKAGE_JSON);
const { PrismaClient } = apiRequire("@prisma/client");
const fs = require("node:fs");
const path = require("node:path");
const sql = (value) => `'${String(value).replaceAll("'", "''")}'`;
const canonical = value => path.resolve(fs.realpathSync(value)).replace(/[\\/]+$/, "").toLowerCase();
async function main() {
  // 1. Never provision merely because a server answered on the port: prove
  //    the authenticated endpoint is the expected cluster (read-only).
  const probe = new PrismaClient({ datasources: { db: { url: process.env.ORION_ADMIN_URL } } });
  try {
    const rows = await probe.$queryRawUnsafe("SELECT current_setting('data_directory') AS data_directory, current_setting('port')::int AS port");
    if (rows.length !== 1 || Number(rows[0].port) !== Number(process.env.ORION_EXPECTED_PG_PORT) || canonical(rows[0].data_directory) !== canonical(process.env.ORION_EXPECTED_PG_CLUSTER)) {
      throw new Error("Подключённый PostgreSQL не совпадает с ожидаемым кластером и портом");
    }
  } finally { await probe.$disconnect(); }
  // 2. Database + roles, idempotent; repairs partial provisioning from an
  //    interrupted earlier launch before migrations run.
  const admin = new PrismaClient({ datasources: { db: { url: process.env.ORION_ADMIN_URL } } });
  try {
    const found = await admin.$queryRawUnsafe("SELECT 1 FROM pg_database WHERE datname = $1", "orion");
    if (!found.length) await admin.$executeRawUnsafe("CREATE DATABASE orion");
  } finally { await admin.$disconnect(); }
  const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  try {
    const app = await db.$queryRawUnsafe("SELECT 1 FROM pg_roles WHERE rolname = 'orion_app'");
    if (!app.length) await db.$executeRawUnsafe(`CREATE ROLE orion_app LOGIN PASSWORD ${sql(process.env.ORION_APP_PASSWORD)} NOSUPERUSER NOBYPASSRLS`);
    else await db.$executeRawUnsafe(`ALTER ROLE orion_app WITH LOGIN PASSWORD ${sql(process.env.ORION_APP_PASSWORD)} NOSUPERUSER NOBYPASSRLS`);
    const system = await db.$queryRawUnsafe("SELECT 1 FROM pg_roles WHERE rolname = 'orion_system'");
    if (!system.length) await db.$executeRawUnsafe("CREATE ROLE orion_system NOLOGIN NOSUPERUSER BYPASSRLS");
    else await db.$executeRawUnsafe("ALTER ROLE orion_system WITH NOLOGIN NOSUPERUSER BYPASSRLS");
    await db.$executeRawUnsafe("GRANT orion_system TO orion_app");
    await db.$executeRawUnsafe("GRANT USAGE ON SCHEMA public TO orion_app, orion_system");
    await db.$executeRawUnsafe("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO orion_app, orion_system");
    await db.$executeRawUnsafe("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO orion_app, orion_system");
    await db.$executeRawUnsafe("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO orion_app, orion_system");
    await db.$executeRawUnsafe("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO orion_app, orion_system");
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
"#;

#[derive(PartialEq, Eq)]
struct Secrets {
    admin_password: String,
    app_password: String,
    jwt_secret: String,
    sync_secret: String,
}

struct Layout {
    node: PathBuf,
    initdb: PathBuf,
    pg_ctl: PathBuf,
    api: PathBuf,
    prisma: PathBuf,
    schema: PathBuf,
    main_js: PathBuf,
}

pub fn supervise_direct(profile: &Profile) -> Result<(), String> {
    supervise_direct_experimental(profile)
}

fn supervise_direct_experimental(profile: &Profile) -> Result<(), String> {
    let requested_data = crate::resolve_existing_ancestor(&profile.data_dir)?;
    let root = runtime_root()?;
    let program_data = std::env::var_os("ProgramData")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"));
    let user_identity = windows_user_identity()?;
    let app_version =
        package_version(&root.join("api/package.json")).unwrap_or_else(|| "dev".to_owned());
    let paths = resolve_runtime_paths(
        &requested_data,
        &root,
        &app_version,
        &program_data,
        &user_identity,
    )?;
    validate_profile_paths(profile, &requested_data, &paths.effective_data_dir)?;

    // ProgramData is used only when PostgreSQL cannot consume the requested path.
    // Validate or create a private root before copying executable files there.
    if paths.mirror_pg || paths.effective_data_dir != requested_data {
        ensure_private_dir(&paths.fallback_root)?;
    }
    if paths.effective_data_dir != requested_data {
        ensure_private_dir(&paths.effective_data_dir)?;
    }
    let effective_profile = Profile {
        data_dir: paths.effective_data_dir.clone(),
        ..profile.clone()
    };
    validate_profile(&effective_profile)?;
    let pg_root = prepare_postgres_binaries(&paths, &app_version)?;
    let base_layout = layout(&root, &pg_root, &root)?;
    let cluster = paths.effective_data_dir.join("postgres");
    let resolved_cluster = crate::resolve_existing_ancestor(&cluster)?;
    if normalized_path(&resolved_cluster) != normalized_path(&cluster) {
        return Err("Каталог PostgreSQL является ссылкой/junction; данные не изменялись.".into());
    }
    preflight_config(
        &paths.effective_data_dir.join("local-runtime.json"),
        &cluster,
    )?;
    ensure_private_dir(&paths.effective_data_dir)?;
    let secrets = load_or_create_secrets(&paths.effective_data_dir.join("local-runtime.json"))?;
    ensure_private_dir(&cluster)?;
    let admin_url = postgres_url(
        "orion",
        &secrets.admin_password,
        effective_profile.pg_port,
        "postgres",
    );
    let database_url = postgres_url(
        "orion",
        &secrets.admin_password,
        effective_profile.pg_port,
        "orion",
    );
    let mut owned = Supervisor::new().map_err(|error| error.to_string())?;

    // Selection is performed before PostgreSQL or schema work. The update
    // adapter verifies the signed payload and returns a complete app command.
    startup_phase(&requested_data, "preparing")?;
    let mut api_template = api_template(
        &base_layout,
        &effective_profile,
        &secrets,
        &root,
        &app_version,
    )?;
    let key_path = root.join("update-public-key.pem");
    let public_key = match fs::read(&key_path) {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(format!("Не удалось прочитать ключ обновлений: {error}")),
    };
    let mut payload =
        PayloadSupervisorAdapter::new(&root, &paths.effective_data_dir, public_key, 0);
    api_template = payload
        .select_application(&api_template)
        .map_err(|error| format!("Не удалось выбрать приложение: {error}"))?;
    write_app_runtime(&requested_data, &api_template)?;
    let shutdown = Arc::new(AtomicBool::new(false));
    if std::env::var("ORION_SHUTDOWN_ON_STDIN_EOF").ok().as_deref() == Some("1") {
        let shutdown_flag = Arc::clone(&shutdown);
        std::thread::Builder::new()
            .name("orion-runtime-shutdown".into())
            .spawn(move || {
                use std::io::Read;
                let mut input = std::io::stdin();
                let mut byte = [0_u8; 1];
                loop {
                    match input.read(&mut byte) {
                        Ok(0) | Err(_) => {
                            shutdown_flag.store(true, Ordering::Release);
                            break;
                        }
                        Ok(_) => {}
                    }
                }
            })
            .map_err(|error| {
                format!("Не удалось запустить контроль штатного завершения: {error}")
            })?;
    }
    let selected_app_root = api_template
        .cwd
        .parent()
        .ok_or("Выбранный API каталог не имеет корня приложения")?;
    let mut selected_layout = match layout(&root, &pg_root, selected_app_root) {
        Ok(layout) => layout,
        Err(candidate_error) if api_template.trial => {
            payload.settle_trial(false).map_err(|rollback| {
                format!("{candidate_error}; не удалось откатить обновление: {rollback}")
            })?;
            api_template = payload
                .select_application(&api_template)
                .map_err(|selection| {
                    format!("{candidate_error}; не удалось выбрать прежнюю версию: {selection}")
                })?;
            write_app_runtime(&requested_data, &api_template)?;
            let fallback_root = api_template
                .cwd
                .parent()
                .ok_or("Выбранный API каталог не имеет корня приложения")?;
            layout(&root, &pg_root, fallback_root).map_err(|fallback_error| {
                format!("{candidate_error}; прежняя версия выбрана, но runtime неполон: {fallback_error}")
            })?
        }
        Err(error) => return Err(error),
    };
    let mut started_postgres = false;

    // Enclose initialization and `pg_ctl start` in the same cleanup scope as
    // provisioning and API supervision. `pg_ctl start` can fail after it has
    // launched postmaster, so we must still inspect and stop our cluster.
    let result = (|| -> Result<(), String> {
        if shutdown.load(Ordering::Acquire) {
            if api_template.trial {
                payload
                    .settle_trial(false)
                    .map_err(|error| error.to_string())?;
            }
            return Ok(());
        }
        startup_phase(&requested_data, "database")?;
        if !cluster.join("PG_VERSION").is_file() {
            let password_file = paths.effective_data_dir.join("initdb-password.tmp");
            let mut password_file_created = false;
            let init_result = (|| -> Result<(), String> {
                let mut password = private_new_file(&password_file)?;
                password_file_created = true;
                password
                    .write_all(format!("{}\n", secrets.admin_password).as_bytes())
                    .and_then(|_| password.sync_all())
                    .map_err(|error| {
                        format!("Не удалось записать временный пароль initdb: {error}")
                    })?;
                drop(password);
                let init = contained(ProcessSpec::new(&base_layout.initdb).current_dir(&root))
                    .arg(format!("--pgdata={}", cluster.display()))
                    .arg("--auth=scram-sha-256")
                    .arg("--username=orion")
                    .arg(format!("--pwfile={}", password_file.display()))
                    .arg("--encoding=UTF8")
                    .arg("--locale=C");
                run_to_exit(&mut owned, init)
            })();
            let remove_result = if password_file_created {
                fs::remove_file(&password_file)
            } else {
                Ok(())
            };
            if let Err(error) = remove_result {
                return Err(format!(
                    "Не удалось удалить временный пароль initdb: {error}"
                ));
            }
            init_result?;
        }
        if shutdown.load(Ordering::Acquire) {
            if api_template.trial {
                payload
                    .settle_trial(false)
                    .map_err(|error| error.to_string())?;
            }
            return Ok(());
        }

        // `pg_ctl start` is not idempotent. Check the cluster first and only treat a
        // failed status as "stopped" after confirming the target cluster is valid.
        let postgres_status_started = Instant::now();
        let already_running = postgres_running(&mut owned, &base_layout.pg_ctl, &root, &cluster)?;
        log_startup_elapsed("postgres-status", postgres_status_started);
        if !already_running {
            let postgres_start_started = Instant::now();
            let start = contained(ProcessSpec::new(&base_layout.pg_ctl).current_dir(&root))
                .arg("start")
                .arg("-w")
                // Recovery can need longer than pg_ctl's 60-second default on
                // slower office disks. Let PostgreSQL finish recovery instead
                // of treating a still-starting postmaster as a failed launch.
                .arg("-t")
                .arg("180")
                .arg("-D")
                .arg(cluster.clone())
                .arg("-l")
                .arg(paths.effective_data_dir.join("postgres.log"))
                .arg("-o")
                .arg(format!("-p {} -h 127.0.0.1", effective_profile.pg_port));
            match run_to_exit(&mut owned, start) {
                Ok(()) => {
                    started_postgres = true;
                    log_startup_elapsed("postgres-start", postgres_start_started);
                }
                Err(start_error) => {
                    // A timeout/non-zero pg_ctl result does not prove that the
                    // detached postmaster failed to start. Only stop it if the
                    // cluster status confirms that this attempt left it running.
                    started_postgres =
                        postgres_running(&mut owned, &base_layout.pg_ctl, &root, &cluster)
                            .unwrap_or(false);
                    log_startup_elapsed("postgres-start-failed", postgres_start_started);
                    return Err(start_error);
                }
            }
        }
        if shutdown.load(Ordering::Acquire) {
            if api_template.trial {
                payload
                    .settle_trial(false)
                    .map_err(|error| error.to_string())?;
            }
            return Ok(());
        }

        // Never provision or migrate merely because a server answered on the port.
        // The combined script first proves (read-only) that the authenticated
        // endpoint is this exact cluster, then provisions database and roles.
        let setup_started = Instant::now();
        with_private_script(
            &paths.effective_data_dir,
            "orion-pg-setup",
            PG_SETUP_JS,
            |setup| {
                run_to_exit(
                    &mut owned,
                    contained(
                        ProcessSpec::new(&base_layout.node)
                            .current_dir(&selected_layout.api)
                            .arg(setup),
                    )
                    .env("ORION_ADMIN_URL", &admin_url)
                    .env("DATABASE_URL", &database_url)
                    .env(
                        "ORION_API_PACKAGE_JSON",
                        selected_layout
                            .api
                            .join("package.json")
                            .display()
                            .to_string(),
                    )
                    .env("ORION_APP_PASSWORD", &secrets.app_password)
                    .env(
                        "ORION_EXPECTED_PG_PORT",
                        effective_profile.pg_port.to_string(),
                    )
                    .env("ORION_EXPECTED_PG_CLUSTER", cluster.display().to_string()),
                )
            },
        )?;
        log_startup_elapsed("postgres-identity+provisioning", setup_started);
        if shutdown.load(Ordering::Acquire) {
            if api_template.trial {
                payload
                    .settle_trial(false)
                    .map_err(|error| error.to_string())?;
            }
            return Ok(());
        }

        startup_phase(&requested_data, "migrations")?;
        let migration_started = Instant::now();
        let migration = run_to_exit(
            &mut owned,
            contained(
                ProcessSpec::new(&base_layout.node)
                    .current_dir(&selected_layout.api)
                    .arg(&selected_layout.prisma)
                    .arg("migrate")
                    .arg("deploy")
                    .arg(format!("--schema={}", selected_layout.schema.display())),
            )
            .env("DATABASE_URL", &database_url)
            .env(
                "ORION_API_PACKAGE_JSON",
                selected_layout
                    .api
                    .join("package.json")
                    .display()
                    .to_string(),
            ),
        );
        log_startup_elapsed("prisma-migrate", migration_started);
        if let Err(migration_error) = migration {
            if !api_template.trial {
                return Err(migration_error);
            }

            // A pending payload is already marked as a trial before migrations
            // run. Match launcher.cjs startup recovery: reject the candidate,
            // select the previous verified app, and apply its migrations before
            // exposing the API. Keep the database and all payload directories.
            payload.settle_trial(false).map_err(|rollback| {
                format!("{migration_error}; не удалось откатить обновление: {rollback}")
            })?;
            api_template = payload
                .select_application(&api_template)
                .map_err(|selection| {
                    format!("{migration_error}; не удалось выбрать прежнюю версию: {selection}")
                })?;
            let fallback_root = api_template
                .cwd
                .parent()
                .ok_or("Выбранный API каталог не имеет корня приложения")?;
            selected_layout = layout(&root, &pg_root, fallback_root)?;
            write_app_runtime(&requested_data, &api_template)?;
            if shutdown.load(Ordering::Acquire) {
                return Ok(());
            }
            startup_phase(&requested_data, "migrations")?;
            run_to_exit(
                &mut owned,
                contained(
                    ProcessSpec::new(&base_layout.node)
                        .current_dir(&selected_layout.api)
                        .arg(&selected_layout.prisma)
                        .arg("migrate")
                        .arg("deploy")
                        .arg(format!("--schema={}", selected_layout.schema.display())),
                )
                .env("DATABASE_URL", &database_url)
                .env(
                    "ORION_API_PACKAGE_JSON",
                    selected_layout
                        .api
                        .join("package.json")
                        .display()
                        .to_string(),
                ),
            )
            .map_err(|fallback_error| {
                format!("{migration_error}; откат выполнен, но миграции прежней версии не прошли: {fallback_error}")
            })?;
        }
        if shutdown.load(Ordering::Acquire) {
            if api_template.trial {
                payload
                    .settle_trial(false)
                    .map_err(|error| error.to_string())?;
            }
            return Ok(());
        }
        startup_phase(&requested_data, "server")?;
        let mut backend = SystemApiBackend::new(paths.effective_data_dir.join("lan-node.json"));
        backend = backend
            .with_payload_adapter(payload)
            .with_shutdown_flag(Arc::clone(&shutdown));
        let node = base_layout.node.clone();
        let api_database_url = database_url.clone();
        let app_runtime_path = requested_data.join("app-runtime.json");
        backend = backend.with_prepare_application(move |command| {
            write_app_runtime(
                app_runtime_path
                    .parent()
                    .ok_or("app-runtime.json has no parent")?,
                command,
            )?;
            let api_dir = command.cwd.clone();
            let prisma = api_dir.join("node_modules/prisma/build/index.js");
            let schema = api_dir.join("prisma/schema.prisma");
            if !prisma.is_file() || !schema.is_file() {
                return Err("Выбранная версия не содержит Prisma migration runtime".into());
            }
            let mut migration_job = Supervisor::new().map_err(|error| error.to_string())?;
            let migration_started = Instant::now();
            let migration = run_to_exit(
                &mut migration_job,
                contained(
                    ProcessSpec::new(&node)
                        .current_dir(&api_dir)
                        .arg(prisma)
                        .arg("migrate")
                        .arg("deploy")
                        .arg(format!("--schema={}", schema.display())),
                )
                .env("DATABASE_URL", &api_database_url)
                .env(
                    "ORION_API_PACKAGE_JSON",
                    api_dir.join("package.json").display().to_string(),
                ),
            );
            log_startup_elapsed("prisma-migrate-fallback", migration_started);
            migration?;
            Ok(())
        });
        match crate::rust_api_supervisor::supervise_api(&mut backend, api_template)? {
            SupervisorOutcome::Shutdown => Ok(()),
            SupervisorOutcome::Exited { code: 0, .. } => {
                Err("API завершился без запроса штатного закрытия".into())
            }
            SupervisorOutcome::Exited { code, .. } => Err(format!("API завершился с кодом {code}")),
        }
    })();

    // Keep a single cleanup path for every failure after starting PostgreSQL,
    // including provisioning, migrations, API spawn and API wait errors.
    let stop_result = if started_postgres {
        stop_postgres(&mut owned, &base_layout.pg_ctl, &root, &cluster)
    } else {
        Ok(())
    };
    let terminate_result = owned.terminate_all().map_err(|error| error.to_string());
    match (result, stop_result, terminate_result) {
        (Ok(()), Ok(()), Ok(())) => {
            if started_postgres {
                write_shutdown_marker_from_env(&requested_data)?;
            }
            Ok(())
        }
        (Err(error), stop, terminate) => Err(format_cleanup(error, stop, terminate)),
        (Ok(()), Err(error), terminate) => Err(format_cleanup(
            "Runtime exited without an error, but PostgreSQL cleanup failed".to_owned(),
            Err(error),
            terminate,
        )),
        (Ok(()), Ok(()), Err(error)) => Err(error),
    }
}

fn format_cleanup(
    primary: String,
    stop: Result<(), String>,
    terminate: Result<(), String>,
) -> String {
    let mut parts = vec![primary];
    if let Err(error) = stop {
        parts.push(format!("PostgreSQL stop failed: {error}"));
    }
    if let Err(error) = terminate {
        parts.push(format!("Job cleanup failed: {error}"));
    }
    parts.join("; ")
}

fn log_startup_elapsed(stage: &str, started: Instant) {
    eprintln!(
        "[orion-runtime] startup-stage={stage} elapsed-ms={}",
        started.elapsed().as_millis()
    );
}

fn write_shutdown_marker_from_env(requested_data: &Path) -> Result<(), String> {
    let Some(marker) = std::env::var_os("ORION_SHUTDOWN_MARKER") else {
        return Ok(());
    };
    write_shutdown_marker(requested_data, &PathBuf::from(marker))
}

fn write_shutdown_marker(requested_data: &Path, marker: &Path) -> Result<(), String> {
    let file_name = marker
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("shutdown marker must have a plain filename")?;
    if !marker.is_absolute()
        || marker
            .parent()
            .is_none_or(|parent| normalized_path(parent) != normalized_path(requested_data))
        || !file_name.starts_with("runtime-stopped-")
        || !file_name.ends_with(".marker")
    {
        return Err("shutdown marker path is outside the requested profile".into());
    }
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(marker)
        .map_err(|error| format!("could not create shutdown marker: {error}"))?;
    file.write_all(b"orion-runtime-stopped-v1")
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("could not persist shutdown marker: {error}"))
}

fn postgres_running(
    supervisor: &mut Supervisor,
    pg_ctl: &Path,
    root: &Path,
    cluster: &Path,
) -> Result<bool, String> {
    let pid = supervisor
        .spawn(contained(
            ProcessSpec::new(pg_ctl)
                .current_dir(root)
                .arg("status")
                .arg("-D")
                .arg(cluster),
        ))
        .map_err(|error| error.to_string())?;
    match supervisor
        .wait_for_exit(pid, Duration::from_secs(30))
        .map_err(|error| error.to_string())?
    {
        Some(code) => classify_pg_status(code),
        None => Err("Проверка состояния PostgreSQL превысила 30 секунд".to_owned()),
    }
}

fn classify_pg_status(code: u32) -> Result<bool, String> {
    match code {
        0 => Ok(true),
        // pg_ctl documents exit status 3 for a server that is not running.
        // Every other non-zero result is an error, never evidence of "stopped".
        3 => Ok(false),
        value => Err(format!(
            "Не удалось проверить состояние PostgreSQL (код {value})"
        )),
    }
}

fn stop_postgres(
    supervisor: &mut Supervisor,
    pg_ctl: &Path,
    root: &Path,
    cluster: &Path,
) -> Result<(), String> {
    let started = Instant::now();
    let pid = supervisor
        .spawn(contained(
            ProcessSpec::new(pg_ctl)
                .current_dir(root)
                .arg("stop")
                .arg("-m")
                .arg("fast")
                .arg("-w")
                .arg("-t")
                .arg("180")
                .arg("-D")
                .arg(cluster),
        ))
        .map_err(|error| error.to_string())?;
    // Keep the runtime and its Job alive for the entire shutdown checkpoint.
    // Tauri waits up to 540 seconds for the runtime, so this bound leaves room
    // for pg_ctl's 180-second wait plus a further 340 seconds for postmaster.
    let mut stop_code = None;
    let result = wait_for_stop_observation(
        || {
            if stop_code.is_none() {
                let Some(code) = supervisor
                    .wait_for_exit(pid, Duration::ZERO)
                    .map_err(|error| error.to_string())?
                else {
                    return Ok(StopObservation::StillRunning);
                };
                if code == 0 {
                    return Ok(StopObservation::CommandSucceeded);
                }
                stop_code = Some(code);
            }
            if !postgres_running(supervisor, pg_ctl, root, cluster)? {
                return Ok(StopObservation::ClusterStopped(
                    stop_code.expect("set above"),
                ));
            }
            Ok(StopObservation::StopCommandFailed(
                stop_code.expect("set above"),
            ))
        },
        Duration::from_secs(520),
        Duration::from_secs(1),
    );
    log_startup_elapsed("postgres-stop", started);
    result
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum StopObservation {
    CommandSucceeded,
    ClusterStopped(u32),
    StillRunning,
    StopCommandFailed(u32),
}

fn wait_for_stop_observation<F>(
    mut observe: F,
    timeout: Duration,
    interval: Duration,
) -> Result<(), String>
where
    F: FnMut() -> Result<StopObservation, String>,
{
    let deadline = Instant::now() + timeout;
    let mut stop_error = None;
    loop {
        match observe()? {
            StopObservation::CommandSucceeded => return Ok(()),
            StopObservation::ClusterStopped(code) => {
                return Err(format!(
                    "pg_ctl stop завершился с кодом {code}; сервер уже остановлен, но чистый shutdown не подтверждён"
                ));
            }
            StopObservation::StillRunning => {}
            StopObservation::StopCommandFailed(code) => stop_error = Some(code),
        }
        if Instant::now() >= deadline {
            return Err(match stop_error {
                Some(code) => format!(
                    "pg_ctl stop завершился с кодом {code}; PostgreSQL всё ещё выполняет shutdown checkpoint"
                ),
                None => "pg_ctl stop не завершил shutdown PostgreSQL за отведённое время".into(),
            });
        }
        std::thread::sleep(interval);
    }
}

#[cfg(test)]
#[test]
fn stop_timeout_is_bounded_and_read_only() {
    use std::sync::atomic::{AtomicUsize, Ordering};

    let probes = AtomicUsize::new(0);
    let result = wait_for_stop_observation(
        || {
            probes.fetch_add(1, Ordering::Relaxed);
            Ok(StopObservation::StopCommandFailed(5))
        },
        Duration::from_millis(8),
        Duration::from_millis(1),
    );
    assert!(result
        .as_ref()
        .is_err_and(|error| error.contains("кодом 5")));
    assert!(probes.load(Ordering::Relaxed) > 1);
}

fn runtime_root() -> Result<PathBuf, String> {
    let value =
        std::env::var("ORION_RUNTIME_ROOT").map_err(|_| "Задайте ORION_RUNTIME_ROOT".to_owned())?;
    let root = PathBuf::from(value);
    if !root.is_absolute() {
        return Err("ORION_RUNTIME_ROOT должен быть абсолютным".to_owned());
    }
    let resolved = crate::resolve_existing_ancestor(&root)?;
    Ok(resolved)
}

fn layout(root: &Path, pg_root: &Path, app_root: &Path) -> Result<Layout, String> {
    let layout = Layout {
        node: root.join("node.exe"),
        initdb: pg_root.join("bin").join("initdb.exe"),
        pg_ctl: pg_root.join("bin").join("pg_ctl.exe"),
        api: app_root.join("api"),
        prisma: app_root
            .join("api")
            .join("node_modules")
            .join("prisma")
            .join("build")
            .join("index.js"),
        schema: app_root.join("api").join("prisma").join("schema.prisma"),
        main_js: app_root.join("api").join("dist").join("main.js"),
    };
    for file in [
        &layout.node,
        &layout.initdb,
        &layout.pg_ctl,
        &layout.prisma,
        &layout.schema,
        &layout.main_js,
    ] {
        if !file.is_file() {
            return Err(format!("В каталоге runtime нет {}", file.display()));
        }
        if file == &layout.initdb || file == &layout.pg_ctl {
            ensure_ascii_path(file, "путь PostgreSQL")?;
        }
    }
    Ok(layout)
}

fn validate_profile(profile: &Profile) -> Result<(), String> {
    let edition = crate::edition()?;
    let data = crate::resolve_existing_ancestor(&profile.data_dir)?;
    let mut canonical_profile = profile.clone();
    canonical_profile.data_dir = data;
    let local = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("USERPROFILE")
                .map(|value| PathBuf::from(value).join("AppData").join("Local"))
        })
        .ok_or("Не удалось определить LOCALAPPDATA для проверки изоляции Classic.")?;
    for classic in [
        local.join("ORION"),
        local.join("com.orion.desktop"),
        std::env::var_os("ProgramData")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("C:\\ProgramData"))
            .join("ORION"),
    ] {
        crate::assert_isolated(
            &canonical_profile,
            &classic,
            edition.forbidden_api_port,
            edition.forbidden_pg_port,
        )?;
    }
    let ports = [profile.api_port, profile.pg_port, profile.runtime_port];
    if ports.contains(&0)
        || ports[0] == ports[1]
        || ports[0] == ports[2]
        || ports[1] == ports[2]
        || ports.iter().any(|port| {
            *port == edition.forbidden_api_port
                || *port == edition.forbidden_pg_port
                || *port == 5433
        })
    {
        return Err("Порты API, PostgreSQL и диагностики должны быть различными и изолированными от Classic.".to_owned());
    }
    Ok(())
}

fn validate_profile_paths(
    profile: &Profile,
    requested: &Path,
    effective: &Path,
) -> Result<(), String> {
    let edition = crate::edition()?;
    for data_dir in [requested, effective] {
        let mut candidate = profile.clone();
        candidate.data_dir = data_dir.to_path_buf();
        validate_profile(&candidate)?;
    }
    if requested == effective {
        return Ok(());
    }
    let requested_root = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(|v| PathBuf::from(v).join("AppData/Local")))
        .ok_or("Не удалось определить LOCALAPPDATA для проверки профиля")?;
    crate::assert_isolated(
        &Profile {
            data_dir: requested.to_path_buf(),
            ..profile.clone()
        },
        &requested_root.join("ORION"),
        edition.forbidden_api_port,
        edition.forbidden_pg_port,
    )
}

fn ensure_ascii_path(path: &Path, label: &str) -> Result<(), String> {
    let ordinary = path.to_string_lossy().replace("\\\\?\\", "");
    if !ordinary.is_ascii() {
        return Err(format!(
            "{label} содержит не-ASCII символы; PostgreSQL lifecycle отказал без изменения данных."
        ));
    }
    Ok(())
}

#[derive(serde::Deserialize)]
struct PackageJson {
    version: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuildInfo {
    tag: Option<String>,
    commit: Option<String>,
    built_at: Option<String>,
}

fn package_version(path: &Path) -> Option<String> {
    let package: PackageJson = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    package.version
}

fn api_template(
    layout: &Layout,
    profile: &Profile,
    secrets: &Secrets,
    runtime: &Path,
    app_version: &str,
) -> Result<ApiCommand, String> {
    let build_path = runtime.join("build.json");
    let build: BuildInfo = fs::read(&build_path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or(BuildInfo {
            tag: None,
            commit: None,
            built_at: None,
        });
    let base_tag = build.tag.clone().unwrap_or_default();
    let mut command = ApiCommand::new(
        &layout.node,
        &layout.api,
        &profile.data_dir,
        profile.api_port,
    );
    command.args.push(layout.main_js.clone().into_os_string());
    command.build_tag = base_tag.clone();
    command.web_dist = Some(runtime.join("web"));
    command.hostname = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "localhost".to_owned());
    command.lan_address = primary_lan_ipv4();
    command.base_env = [
        ("NODE_ENV", "production".to_owned()),
        ("APP_VERSION", app_version.to_owned()),
        ("PORT", profile.api_port.to_string()),
        (
            "DATABASE_URL",
            postgres_url("orion", &secrets.admin_password, profile.pg_port, "orion"),
        ),
        (
            "APP_DATABASE_URL",
            postgres_url("orion_app", &secrets.app_password, profile.pg_port, "orion"),
        ),
        ("JWT_SECRET", secrets.jwt_secret.clone()),
        ("SYNC_SECRET", secrets.sync_secret.clone()),
        ("STORAGE_DRIVER", "local".to_owned()),
        (
            "STORAGE_DIR",
            profile.data_dir.join("documents").display().to_string(),
        ),
        ("ORION_NODE_DIR", profile.data_dir.display().to_string()),
        ("ORION_SUPERVISED", "1".to_owned()),
        ("ORION_EDITION", "rust".to_owned()),
        ("ORION_BUILD_TAG", base_tag.clone()),
        ("ORION_BUILD_COMMIT", build.commit.unwrap_or_default()),
        ("ORION_BUILD_TIME", build.built_at.unwrap_or_default()),
        (
            "ORION_INSTALL_DIR",
            runtime.parent().unwrap_or(runtime).display().to_string(),
        ),
        ("ORION_WEB_DIST", runtime.join("web").display().to_string()),
        ("ORION_SHELL_RUNTIME", runtime.display().to_string()),
        ("ORION_SHELL_BASE_TAG", base_tag),
        ("ORION_PG_CTL", layout.pg_ctl.display().to_string()),
        (
            "ORION_PG_CLUSTER",
            profile.data_dir.join("postgres").display().to_string(),
        ),
        (
            "ORION_API_PACKAGE_JSON",
            layout.api.join("package.json").display().to_string(),
        ),
    ]
    .into_iter()
    .map(|(key, value)| (OsString::from(key), OsString::from(value)))
    .collect::<BTreeMap<_, _>>();
    command.trial = false;
    Ok(command)
}

fn write_app_runtime(requested_data: &Path, command: &ApiCommand) -> Result<(), String> {
    write_json_atomic(
        &requested_data.join("app-runtime.json"),
        &serde_json::json!({"web": command.web_dist, "tag": command.build_tag}),
    )
}

fn startup_phase(requested_data: &Path, phase: &str) -> Result<(), String> {
    write_json_atomic(
        &requested_data.join("startup-state.json"),
        &serde_json::json!({"phase":phase}),
    )
}

fn write_json_atomic(path: &Path, value: &serde_json::Value) -> Result<(), String> {
    let parent = path.parent().ok_or("runtime status file has no parent")?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Не удалось создать каталог статуса: {error}"))?;
    let temporary = parent.join(format!(
        ".orion-status-{}-{}.tmp",
        std::process::id(),
        hex_secret(8)?
    ));
    let bytes = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    let result = (|| {
        let mut file = private_new_file(&temporary)?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|error| format!("Не удалось записать статус запуска: {error}"))?;
        drop(file);
        fs::rename(&temporary, path)
            .map_err(|error| format!("Не удалось обновить статус запуска: {error}"))?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

fn windows_user_identity() -> Result<String, String> {
    let domain = std::env::var("USERDOMAIN").unwrap_or_default();
    let username = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .map_err(|_| {
            "Не удалось определить пользователя Windows для каталога PostgreSQL".to_owned()
        })?;
    let identity = format!("{domain}/{username}");
    if domain.is_empty() && username.is_empty() {
        Err("Не удалось определить пользователя Windows".into())
    } else {
        Ok(identity)
    }
}

fn primary_lan_ipv4() -> Option<String> {
    use std::net::{SocketAddrV4, UdpSocket};
    // Ask the OS routing table which local IPv4 address reaches the default
    // route. This gives peers a concrete address when a real LAN adapter exists;
    // otherwise the API supervisor falls back to the computer hostname.
    let socket = UdpSocket::bind(SocketAddrV4::new(std::net::Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket
        .connect(SocketAddrV4::new(std::net::Ipv4Addr::new(192, 0, 2, 1), 9))
        .ok()?;
    let address = match socket.local_addr().ok()?.ip() {
        std::net::IpAddr::V4(value) => value,
        _ => return None,
    };
    if address.is_loopback() || address.is_link_local() || address.is_unspecified() {
        return None;
    }
    Some(address.to_string())
}

fn normalized_path(path: &Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .trim_start_matches("\\\\?\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}

fn ensure_private_dir(path: &Path) -> Result<(), String> {
    let created = match fs::create_dir(path) {
        Ok(()) => true,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => false,
        Err(error) => {
            return Err(format!(
                "Не удалось создать каталог {}: {error}",
                path.display()
            ))
        }
    };
    if !fs::metadata(path)
        .map_err(|error| format!("Не удалось проверить каталог {}: {error}", path.display()))?
        .is_dir()
    {
        return Err(format!("Ожидался каталог данных: {}", path.display()));
    }
    #[cfg(windows)]
    {
        let system_root = std::env::var_os("SystemRoot")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("C:\\Windows"));
        let whoami = system_root.join("System32").join("whoami.exe");
        let icacls = system_root.join("System32").join("icacls.exe");
        let sid_output = std::process::Command::new(whoami)
            .args(["/user", "/fo", "csv", "/nh"])
            .output()
            .map_err(|error| {
                if created {
                    let _ = fs::remove_dir(path);
                }
                format!("Не удалось определить владельца каталога данных: {error}")
            })?;
        if !sid_output.status.success() {
            if created {
                let _ = fs::remove_dir(path);
            }
            return Err(
                "Не удалось определить SID текущего пользователя для защиты каталога данных."
                    .into(),
            );
        }
        let sid_line = String::from_utf8_lossy(&sid_output.stdout);
        let sid = match sid_line
            .split(',')
            .nth(1)
            .map(|part| part.trim().trim_matches('"'))
            .filter(|value| value.starts_with("S-1-"))
        {
            Some(sid) => sid,
            None => {
                if created {
                    let _ = fs::remove_dir(path);
                }
                return Err("Не удалось прочитать SID текущего пользователя.".into());
            }
        };
        if created {
            let acl = std::process::Command::new(icacls)
                .arg(path)
                .args(["/inheritance:r", "/grant:r"])
                .arg(format!("*{sid}:(OI)(CI)F"))
                .args([
                    "/grant",
                    "*S-1-5-18:(OI)(CI)F",
                    "/grant",
                    "*S-1-5-32-544:(OI)(CI)F",
                ])
                .output();
            let acl = match acl {
                Ok(acl) => acl,
                Err(error) => {
                    let _ = fs::remove_dir(path);
                    return Err(format!(
                        "Не удалось защитить новый каталог данных ACL: {error}"
                    ));
                }
            };
            if !acl.status.success() {
                let _ = fs::remove_dir(path);
                return Err(format!(
                    "Не удалось применить приватный ACL к новому каталогу (код {:?}).",
                    acl.status.code()
                ));
            }
        } else {
            verify_existing_acl(path, sid, &system_root)?;
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if created {
            fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|error| {
                let _ = fs::remove_dir(path);
                format!("Не удалось ограничить доступ к новому каталогу данных: {error}")
            })?;
        } else {
            let mode = fs::metadata(path)
                .map_err(|error| error.to_string())?
                .permissions()
                .mode();
            if mode & 0o077 != 0 {
                return Err("Существующий каталог данных доступен группе или другим пользователям; отказ без изменения ACL.".into());
            }
        }
    }
    Ok(())
}

#[cfg(windows)]
fn verify_existing_acl(path: &Path, sid: &str, system_root: &Path) -> Result<(), String> {
    let powershell = system_root
        .join("System32")
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe");
    let output = std::process::Command::new(powershell)
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$ErrorActionPreference = 'Stop'; Import-Module (Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop; (Get-Acl -LiteralPath $env:ORION_ACL_PATH).Sddl",
        ])
        .env("ORION_ACL_PATH", path)
        .output()
        .map_err(|error| {
            format!(
                "Не удалось прочитать ACL каталога {}: {error}",
                path.display()
            )
        })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(format!(
            "Не удалось прочитать ACL существующего каталога (PowerShell exit {:?}): {}; отказ без изменения ACL.",
            output.status.code(),
            detail.chars().take(1200).collect::<String>()
        ));
    }
    let sddl = String::from_utf8_lossy(&output.stdout).to_ascii_uppercase();
    let entries: Vec<&str> = sddl
        .split('(')
        .skip(1)
        .filter_map(|ace| ace.split(')').next())
        .collect();
    for ace in &entries {
        let fields: Vec<&str> = ace.split(';').collect();
        if fields.len() >= 6 && fields[0] == "A" && broad_acl_principal(fields[5]) {
            return Err(
                "Существующий каталог имеет разрешение для общей группы; отказ без изменения ACL."
                    .into(),
            );
        }
    }
    let user = sid.to_ascii_uppercase();
    let has_full_user_access = entries.iter().any(|ace| {
        let fields: Vec<&str> = ace.split(';').collect();
        fields.len() >= 6
            && fields[0] == "A"
            && fields[5] == user
            && (fields[2] == "FA" || fields[2] == "0X1F01FF")
    });
    if !has_full_user_access {
        return Err("Не подтверждён полный доступ текущего пользователя к существующему каталогу; отказ без изменения ACL.".into());
    }
    Ok(())
}

#[cfg(windows)]
fn broad_acl_principal(principal: &str) -> bool {
    [
        "S-1-1-0",
        "S-1-5-11",
        "S-1-5-32-545",
        "S-1-15-2-1",
        "S-1-15-2-2",
        // SDDL commonly abbreviates these well-known SIDs.
        "WD", // Everyone
        "AU", // Authenticated Users
        "BU", // Builtin Users
        "AC", // All Application Packages
    ]
    .contains(&principal)
}

fn private_new_file(path: &Path) -> Result<fs::File, String> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path).map_err(|error| {
        format!(
            "Не удалось создать закрытый файл {}: {error}",
            path.display()
        )
    })
}

fn write_private_script(directory: &Path, prefix: &str, contents: &str) -> Result<PathBuf, String> {
    let path = directory.join(format!(
        "{prefix}-{}-{}.cjs",
        std::process::id(),
        hex_secret(12)?
    ));
    let mut file = private_new_file(&path)?;
    let write = file
        .write_all(contents.as_bytes())
        .and_then(|_| file.sync_all());
    drop(file);
    if let Err(error) = write {
        let _ = fs::remove_file(&path);
        return Err(format!("Не удалось записать временный script: {error}"));
    }
    Ok(path)
}

fn with_private_script<T>(
    directory: &Path,
    prefix: &str,
    contents: &str,
    run: impl FnOnce(&Path) -> Result<T, String>,
) -> Result<T, String> {
    let path = write_private_script(directory, prefix, contents)?;
    let result = run(&path);
    let cleanup = fs::remove_file(&path)
        .map_err(|error| format!("Не удалось удалить временный script: {error}"));
    match (result, cleanup) {
        (Ok(value), Ok(())) => Ok(value),
        (Err(error), Ok(())) => Err(error),
        (Ok(_), Err(cleanup)) => Err(cleanup),
        (Err(error), Err(cleanup)) => Err(format!("{error}; {cleanup}")),
    }
}

fn contained(spec: ProcessSpec) -> ProcessSpec {
    spec.isolated_environment()
        .allow_env("SystemRoot")
        .allow_env("WINDIR")
        .allow_env("PATH")
        .allow_env("PATHEXT")
        .allow_env("SystemDrive")
        .allow_env("TEMP")
        .allow_env("TMP")
        .allow_env("USERPROFILE")
        .allow_env("APPDATA")
        .allow_env("LOCALAPPDATA")
        .allow_env("ProgramData")
}

fn run_to_exit(supervisor: &mut Supervisor, spec: ProcessSpec) -> Result<(), String> {
    let pid = supervisor.spawn(spec).map_err(|error| error.to_string())?;
    for _ in 0..20 {
        match supervisor
            .wait_for_exit(pid, Duration::from_secs(30))
            .map_err(|error| error.to_string())?
        {
            Some(0) => return Ok(()),
            Some(code) => {
                return Err(format!("шаг запуска завершился с кодом {code}"));
            }
            None => continue,
        }
    }
    Err(format_step_timeout(
        supervisor
            .terminate_all()
            .map_err(|error| error.to_string()),
    ))
}

fn format_step_timeout(cleanup: Result<(), String>) -> String {
    let primary = "шаг запуска не завершился за 10 минут";
    match cleanup {
        Ok(()) => primary.to_owned(),
        Err(error) => format!("{primary}; Job cleanup failed: {error}"),
    }
}

fn load_or_create_secrets(path: &Path) -> Result<Secrets, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(
                    "local-runtime.json должен быть обычным файлом; данные не изменялись.".into(),
                );
            }
            return read_secrets(path);
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("Не удалось проверить local-runtime.json: {error}")),
    }
    if path
        .parent()
        .and_then(|parent| {
            parent
                .join("postgres")
                .join("PG_VERSION")
                .is_file()
                .then_some(())
        })
        .is_some()
    {
        return Err(
            "Каталог PostgreSQL уже есть, а local-runtime.json нет. Данные не изменялись."
                .to_owned(),
        );
    }
    let secrets = Secrets {
        admin_password: hex_secret(24)?,
        app_password: hex_secret(24)?,
        jwt_secret: base64_secret(48)?,
        sync_secret: base64_secret(32)?,
    };
    let body = serde_json::json!({
        "adminPassword": secrets.admin_password,
        "appPassword": secrets.app_password,
        "jwtSecret": secrets.jwt_secret,
        "syncSecret": secrets.sync_secret,
    });
    let bytes = format!(
        "{}\n",
        serde_json::to_string_pretty(&body).map_err(|error| error.to_string())?
    );
    let nonce = hex_secret(8)?;
    let temporary =
        path.with_file_name(format!("local-runtime-{}-{nonce}.tmp", std::process::id()));
    let result = (|| -> Result<(), String> {
        let mut file = private_new_file(&temporary)?;
        file.write_all(bytes.as_bytes())
            .and_then(|_| file.sync_all())
            .map_err(|error| format!("Не удалось записать local-runtime.json: {error}"))?;
        drop(file);
        match fs::hard_link(&temporary, path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
            Err(error) => Err(format!(
                "Не удалось атомарно создать local-runtime.json: {error}"
            )),
        }
    })();
    let remove = match fs::remove_file(&temporary) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Не удалось удалить временный файл конфигурации: {error}"
        )),
    };
    result?;
    remove?;
    // A concurrent creator wins atomically. Read its complete configuration so
    // initdb and provisioning always use the persisted credentials.
    read_secrets(path)
}

fn preflight_config(path: &Path, cluster: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            Err("local-runtime.json должен быть обычным файлом; данные не изменялись.".into())
        }
        Ok(_) => read_secrets(path).map(|_| ()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            if cluster.join("PG_VERSION").is_file() {
                Err(
                    "Каталог PostgreSQL уже есть, а local-runtime.json нет. Данные не изменялись."
                        .into(),
                )
            } else {
                Ok(())
            }
        }
        Err(error) => Err(format!("Не удалось проверить local-runtime.json: {error}")),
    }
}

fn read_secrets(path: &Path) -> Result<Secrets, String> {
    let text = fs::read_to_string(path)
        .map_err(|error| format!("Не удалось прочитать local-runtime.json: {error}"))?;
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|_| "local-runtime.json повреждён".to_owned())?;
    if !value.is_object() {
        return Err("local-runtime.json имеет неверный формат; данные не изменялись.".into());
    }
    Ok(Secrets {
        admin_password: required_secret(&value, "adminPassword")?,
        app_password: required_secret(&value, "appPassword")?,
        jwt_secret: required_secret(&value, "jwtSecret")?,
        sync_secret: required_secret(&value, "syncSecret")?,
    })
}

fn required_secret(value: &serde_json::Value, key: &str) -> Result<String, String> {
    value
        .get(key)
        .and_then(|item| item.as_str())
        .filter(|item| !item.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| format!("В local-runtime.json нет {key}"))
}

fn postgres_url(user: &str, password: &str, port: u16, database: &str) -> String {
    format!(
        "postgresql://{user}:{}@127.0.0.1:{port}/{database}",
        url_encode(password)
    )
}

fn url_encode(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn hex_secret(bytes: usize) -> Result<String, String> {
    Ok(random_bytes(bytes)?
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn base64_secret(bytes: usize) -> Result<String, String> {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let data = random_bytes(bytes)?;
    let mut out = String::new();
    for chunk in data.chunks(3) {
        let a = chunk[0];
        let b = chunk.get(1).copied().unwrap_or(0);
        let c = chunk.get(2).copied().unwrap_or(0);
        out.push(TABLE[(a >> 2) as usize] as char);
        out.push(TABLE[(((a & 0x03) << 4) | (b >> 4)) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[(((b & 0x0f) << 2) | (c >> 6)) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(c & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
    }
    Ok(out)
}

fn random_bytes(len: usize) -> Result<Vec<u8>, String> {
    let mut buffer = vec![0u8; len];
    let status =
        unsafe { BCryptGenRandom(std::ptr::null_mut(), buffer.as_mut_ptr(), len as u32, 2) };
    if status != 0 {
        return Err(format!("Не удалось получить случайные байты ({status})"));
    }
    Ok(buffer)
}

#[link(name = "bcrypt")]
extern "system" {
    fn BCryptGenRandom(
        algorithm: *mut std::ffi::c_void,
        buffer: *mut u8,
        length: u32,
        flags: u32,
    ) -> i32;
}

/// Restore a staged backup into an isolated PostgreSQL database.
/// This is the final step in the migration workflow: read staged copy, write to target DB, verify integrity.
pub fn restore_staged_backup(_source_dir: &Path, _profile: &Profile) -> Result<(), String> {
    // TODO: Implement full restoration flow:
    // 1. Start temporary PostgreSQL instance on isolated port
    // 2. Apply Prisma migrations to empty target database (orion_target)
    // 3. Call stage-backup.mjs if source needs staging
    // 4. Call restore-staged.mjs to restore into target database
    // 5. Verify data integrity through SQL queries or health check
    // 6. Clean up temporary resources

    Err("Восстановление пока не реализовано; данные не изменялись".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    struct DisposableTestProfile {
        root: PathBuf,
        nonce: String,
    }

    impl DisposableTestProfile {
        fn create() -> Self {
            let nonce = hex_secret(12).expect("test nonce");
            let root = std::env::temp_dir().join(format!("orion-rust-lifecycle-test-{nonce}"));
            fs::create_dir(&root).expect("new disposable profile");
            fs::write(root.join(".orion-disposable-profile"), &nonce).expect("disposable marker");
            Self { root, nonce }
        }

        fn path(&self, child: &str) -> PathBuf {
            self.root.join(child)
        }
    }

    impl Drop for DisposableTestProfile {
        fn drop(&mut self) {
            let temp = match fs::canonicalize(std::env::temp_dir()) {
                Ok(path) => path,
                Err(_) => return,
            };
            let root = match fs::canonicalize(&self.root) {
                Ok(path) => path,
                Err(_) => return,
            };
            if root.parent() == Some(temp.as_path())
                && root.file_name().is_some_and(|name| {
                    name.to_string_lossy()
                        .starts_with("orion-rust-lifecycle-test-")
                })
                && fs::read_to_string(root.join(".orion-disposable-profile"))
                    .is_ok_and(|value| value == self.nonce)
            {
                let _ = fs::remove_dir_all(root);
            }
        }
    }

    #[test]
    #[cfg(windows)]
    fn acl_rejects_well_known_groups_in_sid_and_sddl_alias_forms() {
        for principal in ["AU", "BU", "WD", "AC", "S-1-5-11", "S-1-1-0"] {
            assert!(broad_acl_principal(principal), "{principal}");
        }
        assert!(!broad_acl_principal("SY"));
        assert!(!broad_acl_principal("BA"));
    }

    #[test]
    fn pg_ctl_status_accepts_only_documented_running_and_stopped_codes() {
        assert!(classify_pg_status(0).expect("running"));
        assert!(!classify_pg_status(3).expect("not running"));
        for code in [1, 2, 4, 255] {
            assert!(
                classify_pg_status(code).is_err(),
                "code {code} must fail closed"
            );
        }
    }

    #[test]
    fn shutdown_marker_is_profile_scoped_create_new_and_versioned() {
        let profile = DisposableTestProfile::create();
        let marker = profile.path("runtime-stopped-123-456.marker");
        write_shutdown_marker(&profile.root, &marker).expect("create owned shutdown marker");
        assert_eq!(
            fs::read(&marker).expect("marker body"),
            b"orion-runtime-stopped-v1"
        );
        assert!(write_shutdown_marker(&profile.root, &marker).is_err());
        assert!(write_shutdown_marker(&profile.root, &profile.root.join("other.marker")).is_err());
    }

    #[test]
    fn secrets_config_is_compatible_persisted_and_reused() {
        let profile = DisposableTestProfile::create();
        let data = profile.path("data");
        ensure_private_dir(&data).expect("private new profile");
        // Exercise the same read-only ACL path used for an existing JavaScript
        // profile; this must never rewrite the directory ACL.
        ensure_private_dir(&data).expect("verify existing profile ACL");
        let config = data.join("local-runtime.json");
        let first = load_or_create_secrets(&config).expect("create config");
        let persisted = fs::read_to_string(&config).expect("persisted config");
        let json: serde_json::Value = serde_json::from_str(&persisted).expect("compatible JSON");
        for key in ["adminPassword", "appPassword", "jwtSecret", "syncSecret"] {
            assert!(
                json[key].as_str().is_some_and(|value| !value.is_empty()),
                "missing {key}"
            );
        }
        assert!(load_or_create_secrets(&config).expect("reuse config") == first);
        assert_eq!(
            fs::read_to_string(&config).expect("config unchanged"),
            persisted
        );
    }

    #[test]
    fn concurrent_secret_creation_uses_one_complete_config() {
        let profile = DisposableTestProfile::create();
        let data = profile.path("data");
        ensure_private_dir(&data).expect("private new profile");
        let config = data.join("local-runtime.json");
        let mut workers = Vec::new();
        for _ in 0..8 {
            let path = config.clone();
            workers.push(std::thread::spawn(move || load_or_create_secrets(&path)));
        }
        let values: Vec<Secrets> = workers
            .into_iter()
            .map(|worker| worker.join().expect("worker panic").expect("atomic config"))
            .collect();
        assert!(values.iter().all(|value| value == &values[0]));
        assert!(fs::read_dir(&data).expect("profile files").all(|entry| {
            entry
                .ok()
                .is_some_and(|entry| !entry.file_name().to_string_lossy().ends_with(".tmp"))
        }));
    }

    #[test]
    fn missing_config_with_existing_cluster_fails_without_modifying_disposable_data() {
        let profile = DisposableTestProfile::create();
        let cluster = profile.path("postgres");
        fs::create_dir(&cluster).expect("disposable cluster");
        fs::write(cluster.join("PG_VERSION"), "17\n").expect("cluster marker");
        let before = fs::read(cluster.join("PG_VERSION")).expect("before");
        let result = preflight_config(&profile.path("local-runtime.json"), &cluster);
        assert!(result.is_err());
        assert!(!profile.path("local-runtime.json").exists());
        assert_eq!(fs::read(cluster.join("PG_VERSION")).expect("after"), before);
    }

    #[test]
    fn malformed_config_fails_without_rewrite() {
        let profile = DisposableTestProfile::create();
        let config = profile.path("local-runtime.json");
        let original = b"{\"adminPassword\": \"\"}\n";
        fs::write(&config, original).expect("malformed disposable config");
        assert!(preflight_config(&config, &profile.path("postgres")).is_err());
        assert_eq!(fs::read(&config).expect("config unchanged"), original);
    }

    #[test]
    fn pg_ctl_status_child_exit_is_classified_and_job_can_be_closed() {
        for (exit, expected) in [(0, Some(true)), (3, Some(false)), (4, None)] {
            let mut supervisor = Supervisor::new().expect("Windows Job");
            let executable = std::env::current_exe().expect("test executable");
            let spec = contained(
                ProcessSpec::new(executable)
                    .arg("--exact")
                    .arg("lifecycle::tests::pg_ctl_test_child")
                    .arg("--nocapture"),
            )
            .env("ORION_TEST_PGCTL_EXIT", exit.to_string());
            let pid = supervisor.spawn(spec).expect("contained test pg_ctl");
            let code = supervisor
                .wait_for_exit(pid, Duration::from_secs(10))
                .expect("wait")
                .expect("test child exits");
            assert_eq!(classify_pg_status(code).ok(), expected);
            supervisor.terminate_all().expect("close Job");
        }
    }

    #[test]
    fn pg_ctl_test_child() {
        if let Ok(value) = std::env::var("ORION_TEST_PGCTL_EXIT") {
            std::process::exit(value.parse::<i32>().expect("test exit code"));
        }
    }

    #[test]
    fn partial_provisioning_repairs_system_role_and_grants_when_app_role_exists() {
        let disposable = DisposableTestProfile::create();
        let root = disposable.root.clone();
        let api = root.join("api");
        let module = api.join("node_modules").join("@prisma").join("client");
        fs::create_dir_all(&module).expect("test module directory");
        fs::write(
            module.join("index.js"),
            r#"
const fs = require("node:fs");
class PrismaClient {
  constructor(options) { this.admin = options.datasources.db.url.endsWith("/postgres"); }
  async $queryRawUnsafe(sql) {
    if (sql.includes("pg_database")) return [{ exists: true }];
    if (sql.includes("rolname = 'orion_app'")) return [{ exists: true }];
    if (sql.includes("rolname = 'orion_system'")) return [];
    throw new Error("Unexpected query: " + sql);
  }
  async $executeRawUnsafe(sql) { fs.appendFileSync(process.env.ORION_TEST_SQL_LOG, sql + "\n"); }
  async $disconnect() {}
}
module.exports = { PrismaClient };
"#,
        )
        .expect("write Prisma mock");
        fs::write(api.join("package.json"), "{}\n").expect("API package anchor");
        let script = root.join("orion-provision.cjs");
        fs::write(&script, PROVISION_JS).expect("write provisioning script");
        let log = root.join("sql.log");
        let result = Command::new("node")
            .arg(&script)
            .current_dir(&api)
            .env(
                "ORION_ADMIN_URL",
                "postgresql://orion:test@127.0.0.1:18101/postgres",
            )
            .env(
                "DATABASE_URL",
                "postgresql://orion:test@127.0.0.1:18101/orion",
            )
            .env("ORION_API_PACKAGE_JSON", api.join("package.json"))
            .env("ORION_APP_PASSWORD", "synthetic-only")
            .env("ORION_TEST_SQL_LOG", &log)
            .output()
            .expect("run provisioning against synthetic Prisma mock");
        let sql = fs::read_to_string(&log).expect("SQL operations");
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        assert!(sql.contains("ALTER ROLE orion_app WITH LOGIN PASSWORD"));
        assert!(sql.contains("CREATE ROLE orion_system NOLOGIN"));
        assert!(sql.contains("GRANT orion_system TO orion_app"));
        assert!(sql.contains("GRANT USAGE ON SCHEMA public"));
        assert!(sql.contains("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES"));
        assert!(sql.contains("GRANT USAGE, SELECT ON ALL SEQUENCES"));
        assert!(sql.contains("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT"));
    }

    #[test]
    #[ignore = "requires explicit opt-in; starts only a disposable packaged PostgreSQL cluster"]
    fn packaged_postgres_provisioning_and_migrations_work_on_disposable_profile() {
        const OPT_IN: &str = "I_ACCEPT_DISPOSABLE_LOCAL_POSTGRES";
        assert_eq!(
            std::env::var("ORION_RUN_POSTGRES_PROVISION_TEST").as_deref(),
            Ok(OPT_IN),
            "explicit opt-in required: set ORION_RUN_POSTGRES_PROVISION_TEST={OPT_IN}"
        );
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let repo = manifest.parent().expect("repository root");
        let runtime = repo.join("apps/desktop/src-tauri/resources/runtime");
        let layout =
            layout(&runtime, &runtime.join("postgres"), &runtime).expect("packaged runtime layout");
        let profile = DisposableTestProfile::create();
        let data = profile.path("data");
        ensure_private_dir(&data).expect("private disposable data");
        let cluster = data.join("postgres");
        ensure_private_dir(&cluster).expect("private disposable PostgreSQL cluster");
        let config = load_or_create_secrets(&data.join("local-runtime.json"))
            .expect("disposable credentials");
        let port = (0..16)
            .find_map(|_| {
                std::net::TcpListener::bind(("127.0.0.1", 0))
                    .ok()
                    .and_then(|listener| listener.local_addr().ok().map(|address| address.port()))
                    .filter(|port| ![4000, 5433, 55432].contains(port))
            })
            .expect("disposable loopback port");
        eprintln!(
            "disposable PostgreSQL profile={} port={port}",
            profile.root.display()
        );
        let admin_url = postgres_url("orion", &config.admin_password, port, "postgres");
        let database_url = postgres_url("orion", &config.admin_password, port, "orion");
        let mut supervisor = Supervisor::new().expect("Windows Job");
        let mut postgres_started = false;
        let result = (|| -> Result<(), String> {
            let password_file = data.join("initdb-password.tmp");
            let mut password = private_new_file(&password_file)?;
            password
                .write_all(format!("{}\n", config.admin_password).as_bytes())
                .and_then(|_| password.sync_all())
                .map_err(|error| error.to_string())?;
            drop(password);
            let init = contained(ProcessSpec::new(&layout.initdb).current_dir(&runtime))
                .arg(format!("--pgdata={}", cluster.display()))
                .arg("--auth=scram-sha-256")
                .arg("--username=orion")
                .arg(format!("--pwfile={}", password_file.display()))
                .arg("--encoding=UTF8")
                .arg("--locale=C");
            let init_result = run_to_exit(&mut supervisor, init);
            let remove_result = fs::remove_file(&password_file).map_err(|error| error.to_string());
            init_result.map_err(|error| format!("initdb: {error}"))?;
            remove_result?;

            let start = contained(ProcessSpec::new(&layout.pg_ctl).current_dir(&runtime))
                .arg("start")
                .arg("-w")
                .arg("-D")
                .arg(cluster.clone())
                .arg("-l")
                .arg(data.join("postgres.log"))
                .arg("-o")
                .arg(format!("-p {port} -h 127.0.0.1"));
            run_to_exit(&mut supervisor, start)
                .map_err(|error| format!("pg_ctl start: {error}"))?;
            postgres_started = true;
            let postmaster_pid = fs::read_to_string(cluster.join("postmaster.pid"))
                .ok()
                .and_then(|text| {
                    text.lines()
                        .next()
                        .and_then(|line| line.parse::<u32>().ok())
                });
            eprintln!("disposable PostgreSQL PID={postmaster_pid:?} port={port}");

            let identity = data.join("orion-pg-identity.cjs");
            fs::write(&identity, IDENTITY_JS).map_err(|error| error.to_string())?;
            run_to_exit(
                &mut supervisor,
                contained(
                    ProcessSpec::new(&layout.node)
                        .current_dir(&layout.api)
                        .arg(&identity),
                )
                .env("DATABASE_URL", &admin_url)
                .env("ORION_API_PACKAGE_JSON", layout.api.join("package.json"))
                .env("ORION_EXPECTED_PG_PORT", port.to_string())
                .env("ORION_EXPECTED_PG_CLUSTER", cluster.display().to_string()),
            )
            .map_err(|error| format!("cluster identity check: {error}"))?;

            let provision = data.join("orion-provision.cjs");
            fs::write(&provision, PROVISION_JS).map_err(|error| error.to_string())?;
            let mut run_provision = || {
                let spec = contained(
                    ProcessSpec::new(&layout.node)
                        .current_dir(&layout.api)
                        .arg(&provision),
                )
                .env("ORION_ADMIN_URL", &admin_url)
                .env("DATABASE_URL", &database_url)
                .env("ORION_API_PACKAGE_JSON", layout.api.join("package.json"))
                .env("ORION_APP_PASSWORD", &config.app_password);
                run_to_exit(&mut supervisor, spec)
            };
            run_provision().map_err(|error| format!("first provisioning pass: {error}"))?;
            run_provision().map_err(|error| format!("idempotent provisioning pass: {error}"))?;

            run_to_exit(
                &mut supervisor,
                contained(
                    ProcessSpec::new(&layout.node)
                        .current_dir(&layout.api)
                        .arg(&layout.prisma)
                        .arg("migrate")
                        .arg("deploy")
                        .arg(format!("--schema={}", layout.schema.display())),
                )
                .env("DATABASE_URL", &database_url),
            )
            .map_err(|error| format!("prisma migrate deploy: {error}"))?;

            let verify_result = data.join(format!(
                "orion-verify-result-{}.json",
                hex_secret(12).map_err(|error| error.to_string())?
            ));
            drop(private_new_file(&verify_result)?);
            let verification = with_private_script(
                &data,
                "orion-verify-provisioning",
                r#"
const { createRequire } = require("node:module");
const fs = require("node:fs");
const apiRequire = createRequire(process.env.ORION_API_PACKAGE_JSON);
const { PrismaClient } = apiRequire("@prisma/client");
async function main() {
  const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  try {
    const rows = await db.$queryRawUnsafe(`
      SELECT
        (SELECT rolsuper = false AND rolbypassrls = false FROM pg_roles WHERE rolname = 'orion_app') AS app_safe,
        (SELECT rolbypassrls = true AND rolcanlogin = false FROM pg_roles WHERE rolname = 'orion_system') AS system_safe,
        (SELECT count(*) > 0 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid JOIN pg_roles u ON u.oid = m.member WHERE r.rolname = 'orion_system' AND u.rolname = 'orion_app') AS member,
        has_schema_privilege('orion_app', 'public', 'USAGE') AS schema_usage,
        (SELECT count(*) = 0 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT has_table_privilege('orion_app', c.oid, 'SELECT')) AS table_access,
        (SELECT count(*) = 0 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'S' AND NOT EXISTS (SELECT 1 FROM aclexplode(c.relacl) acl WHERE acl.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'orion_app') AND acl.privilege_type = 'USAGE')) AS sequence_access
    `);
    fs.writeFileSync(process.env.ORION_VERIFY_RESULT, JSON.stringify(rows[0]));
    if (Object.values(rows[0]).some(value => value !== true)) throw new Error("role/grant verification failed");
  } finally { await db.$disconnect(); }
}
            main().catch(error => {
              fs.writeFileSync(process.env.ORION_VERIFY_RESULT, JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
              console.error(error instanceof Error ? error.message : String(error));
              process.exit(1);
            });
"#,
                |verify| {
                    run_to_exit(
                        &mut supervisor,
                        contained(
                            ProcessSpec::new(&layout.node)
                                .current_dir(&layout.api)
                                .arg(verify),
                        )
                        .env("DATABASE_URL", &database_url)
                        .env("ORION_API_PACKAGE_JSON", layout.api.join("package.json"))
                        .env("ORION_VERIFY_RESULT", &verify_result),
                    )
                },
            );
            let evidence = fs::read_to_string(&verify_result).unwrap_or_default();
            let remove_result = fs::remove_file(&verify_result).map_err(|error| error.to_string());
            verification.map_err(|error| {
                format!("role and grant verification: {error}; result={evidence}")
            })?;
            remove_result?;
            Ok(())
        })();
        let stop_result = if postgres_started {
            stop_postgres(&mut supervisor, &layout.pg_ctl, &runtime, &cluster)
        } else {
            Ok(())
        };
        let terminate_result = supervisor
            .terminate_all()
            .map_err(|error| error.to_string());
        eprintln!(
            "disposable PostgreSQL cleanup port={port} stop={stop_result:?} job={terminate_result:?}"
        );
        assert!(
            result.is_ok(),
            "disposable PG provisioning failed: {result:?}"
        );
        assert!(
            stop_result.is_ok(),
            "disposable PG stop failed: {stop_result:?}"
        );
        assert!(
            terminate_result.is_ok(),
            "disposable PG Job cleanup failed: {terminate_result:?}"
        );
    }

    #[test]
    #[ignore = "requires prepared packaged runtime and Node"]
    fn profile_script_loads_real_packaged_prisma_from_api_anchor() {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let repo = manifest_dir
            .parent()
            .expect("repository root")
            .to_path_buf();
        let api = repo
            .join("apps")
            .join("desktop")
            .join("src-tauri")
            .join("resources")
            .join("runtime")
            .join("api");
        let package = api.join("package.json");
        assert!(
            package.is_file(),
            "expected packaged API at {}",
            api.display()
        );
        let disposable = DisposableTestProfile::create();
        let root = disposable.root.clone();
        let script = root.join("profile-script.cjs");
        fs::write(
            &script,
            r#"
const { createRequire } = require("node:module");
let plainResolution = null;
try { plainResolution = require.resolve("@prisma/client"); } catch {}
const apiRequire = createRequire(process.env.ORION_API_PACKAGE_JSON);
const resolved = apiRequire.resolve("@prisma/client");
const { PrismaClient } = apiRequire("@prisma/client");
if (plainResolution !== null || typeof PrismaClient !== "function") process.exit(4);
process.stdout.write(resolved);
"#,
        )
        .expect("profile-path script");
        let result = Command::new("node")
            .arg(&script)
            .env("ORION_API_PACKAGE_JSON", &package)
            .output()
            .expect("run actual packaged Prisma resolution");
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        let resolved = PathBuf::from(String::from_utf8_lossy(&result.stdout).trim());
        assert!(
            resolved.starts_with(api.join("node_modules")),
            "resolved outside packaged API dependencies: {resolved:?}"
        );
    }

    #[test]
    fn stop_command_failure_is_unconfirmed_even_when_cluster_is_stopped() {
        let disposable = DisposableTestProfile::create();
        let root = disposable.root.clone();
        fs::write(root.join("stop"), "process.exit(5);\n").expect("fake stop command");
        fs::write(root.join("status"), "process.exit(3);\n").expect("fake status command");
        let node = Command::new("node")
            .arg("-p")
            .arg("process.execPath")
            .output()
            .expect("Node runtime");
        assert!(node.status.success());
        let node = PathBuf::from(String::from_utf8_lossy(&node.stdout).trim());
        let cluster = root.join("postgres");
        fs::create_dir_all(&cluster).expect("synthetic cluster directory");
        let mut supervisor = Supervisor::new().expect("Windows Job");
        let stop = stop_postgres(&mut supervisor, &node, &root, &cluster);
        assert!(
            stop.as_ref().is_err_and(|error| {
                error.contains("сервер уже остановлен") && error.contains("кодом 5")
            }),
            "unexpected pg_ctl result: {stop:?}"
        );
        supervisor
            .terminate_all()
            .expect("Job teardown after stopped PostgreSQL");
    }

    #[test]
    fn stop_and_job_failures_are_reported_together() {
        let error = format_cleanup(
            "migration failed".to_owned(),
            Err("pg_ctl stop returned 5".to_owned()),
            Err("Job termination failed".to_owned()),
        );
        assert!(error.contains("migration failed"));
        assert!(error.contains("pg_ctl stop returned 5"));
        assert!(error.contains("Job termination failed"));
    }

    #[test]
    fn step_timeout_preserves_job_cleanup_failure() {
        let timeout = format_step_timeout(Err("synthetic Job termination failure".to_owned()));
        assert!(timeout.contains("шаг запуска не завершился за 10 минут"));
        assert!(timeout.contains("synthetic Job termination failure"));

        assert_eq!(
            format_step_timeout(Ok(())),
            "шаг запуска не завершился за 10 минут"
        );
    }

    #[test]
    fn unfinished_commands_fail_without_creating_a_profile() {
        let directory =
            std::env::temp_dir().join(format!("orion-unfinished-{}", std::process::id()));
        assert!(!directory.exists());
        let profile = Profile {
            edition: "rust".into(),
            product_name: "ORION Rust".into(),
            data_dir: directory.clone(),
            api_port: 18100,
            pg_port: 18101,
            runtime_port: 18102,
        };
        assert!(supervise_direct(&profile).is_err());
        assert!(restore_staged_backup(Path::new("unused"), &profile).is_err());
        assert!(!directory.exists());
    }
}
