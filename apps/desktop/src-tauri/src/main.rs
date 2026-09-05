// ORION desktop shell. Deliberately thin: no business logic here — that
// lives in apps/api. This binary only opens a native window over the same
// Next.js frontend used on the web (see ORION v0 plan, "Tauri — thin
// обёртка").
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .run(tauri::generate_context!())
        .expect("error while running orion desktop shell");
}
