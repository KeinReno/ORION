fn main() {
    // Third-party overlays (observed: GamePP IPC overlay on developer machines)
    // inject into every GUI process; when their named-object IPC is denied they
    // retry through a deep hook chain that overflows the 1 MB default stack of
    // the main thread in unoptimized (dev) builds. 16 MB leaves ample headroom.
    // Scoped to this crate only — dependencies are not rebuilt.
    if std::env::var("CARGO_CFG_WINDOWS").is_ok() {
        println!("cargo:rustc-link-arg=/STACK:16777216");
    }
    tauri_build::build()
}
