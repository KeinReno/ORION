const HELP: &str = if cfg!(windows) {
    "Commands: show, serve
Windows commands: supervise, supervise-launcher, supervise-direct, restore (disabled)"
} else {
    "Commands: show, serve"
};

fn main() {
    let command = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "serve".to_owned());
    if matches!(command.as_str(), "help" | "--help" | "-h") {
        println!("{HELP}");
        return;
    }
    let profile = orion_runtime::load_profile().unwrap_or_else(|error| {
        eprintln!("{error}");
        std::process::exit(2);
    });

    match command.as_str() {
        "show" => {
            let body = serde_json::json!({
                "edition": profile.edition,
                "productName": profile.product_name,
                "dataDir": profile.data_dir.to_string_lossy().into_owned(),
                "apiPort": profile.api_port,
                "pgPort": profile.pg_port,
                "runtimePort": profile.runtime_port,
            });
            println!(
                "{}",
                serde_json::to_string_pretty(&body).unwrap_or_default()
            );
        }
        "serve" => {
            let runtime = tokio::runtime::Runtime::new().expect("tokio");
            if let Err(error) = runtime.block_on(orion_runtime::serve(profile)) {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
        #[cfg(windows)]
        "supervise" | "supervise-direct" => {
            if let Err(error) = orion_runtime::supervise_direct(&profile) {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
        #[cfg(windows)]
        "supervise-launcher" => {
            if let Err(error) = orion_runtime::supervise_packaged_runtime(&profile) {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
        #[cfg(windows)]
        "restore" => {
            let source_dir = std::env::args_os().nth(2).unwrap_or_default();
            if let Err(error) =
                orion_runtime::restore_staged_backup(std::path::Path::new(&source_dir), &profile)
            {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
        _ => {
            eprintln!("Unknown command: {command}");
            eprintln!("{HELP}");
            std::process::exit(2);
        }
    }
}
