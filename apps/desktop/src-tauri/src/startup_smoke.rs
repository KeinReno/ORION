//! Native startup rehearsal. No launcher, credentials or database, isolated WebView profile.
use tauri::{Manager, Webview};
pub fn setup(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    if !super::startup::smoke_enabled() { return Ok(()); }
    if app.config().identifier != "com.orion.startup-smoke" { return Err("Isolated startup identifier required".into()); }
    let root = std::fs::canonicalize(std::env::var("ORION_STARTUP_SMOKE_ROOT")?)?;
    let data = app.path().app_local_data_dir()?;
    std::fs::create_dir_all(&data)?;
    std::fs::write(data.join("app-runtime.json"), serde_json::to_vec(&serde_json::json!({"web":root}))?)?;
    Ok(())
}
pub fn loaded(view: &Webview, payload: &tauri::webview::PageLoadPayload<'_>) {
    if !super::startup::smoke_enabled() || view.app_handle().config().identifier != "com.orion.startup-smoke"
        || !matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) || payload.url().path() != super::startup::PATH { return; }
    let Ok(report) = std::env::var("ORION_STARTUP_SMOKE_REPORT") else { return; };
    if !report.starts_with("http://127.0.0.1:") { return; }
    let report = serde_json::to_string(&report).unwrap();
    let _ = view.eval(&format!(r#"(() => {{
        let frames=0,last='';function frame(){{frames++;requestAnimationFrame(frame)}}requestAnimationFrame(frame);
        const timer=setInterval(async()=>{{
            const state=await (await fetch('/__orion_startup/status')).json();
            if(state.phase===last)return;last=state.phase;
            const logo=document.querySelector('img');
            await fetch({report},{{method:'POST',body:JSON.stringify({{phase:state.phase,frames,logo:logo.complete&&logo.naturalWidth>0,title:document.title}})}});
            if(state.phase==='error'){{clearInterval(timer);setTimeout(async()=>{{
                await fetch({report},{{method:'POST',body:JSON.stringify({{done:true,errorVisible:!document.getElementById('error').hidden,retryVisible:!document.getElementById('retry').hidden,busy:document.getElementById('main').getAttribute('aria-busy')}})}});
            }},700)}}
        }},300);
    }})()"#));
}
