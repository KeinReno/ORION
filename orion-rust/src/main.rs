fn main() {
    let command = std::env::args().nth(1).unwrap_or_else(|| "serve".to_owned());
    let profile = match orion_runtime::load_profile() {
        Ok(profile) => profile,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(2);
        }
    };
    match command.as_str() {
        "show" => {
            let body = serde_json::json!({
                "edition": profile.edition,
                "productName": profile.product_name,
                "dataDir": profile.data_dir,
                "apiPort": profile.api_port,
                "pgPort": profile.pg_port,
                "runtimePort": profile.runtime_port,
            });
            println!("{}", serde_json::to_string_pretty(&body).unwrap_or_default());
        }
        "serve" => {
            let runtime = tokio::runtime::Runtime::new().expect("tokio");
            if let Err(error) = runtime.block_on(orion_runtime::serve(profile)) {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
        other => {
            eprintln!("Команды: show, serve. Неизвестно: {other}");
            std::process::exit(2);
        }
    }
}
