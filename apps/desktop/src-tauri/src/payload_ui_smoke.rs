//! Debug-only native protocol rehearsal. Isolated identifier, fake API, no database or external navigation.
use tauri::{Manager, Webview};
use std::sync::atomic::{AtomicBool, Ordering};
static STARTED: AtomicBool = AtomicBool::new(false);

pub fn enabled() -> bool {
    std::env::var_os("ORION_PAYLOAD_UI_SMOKE_ROOT").is_some()
}

pub fn setup(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    if !enabled() { return Ok(()); }
    if app.config().identifier != "com.orion.payload-smoke" { return Err("Isolated smoke identifier required".into()); }
    let root = std::fs::canonicalize(std::env::var("ORION_PAYLOAD_UI_SMOKE_ROOT")?)?;
    let data = app.path().app_local_data_dir()?;
    std::fs::create_dir_all(&data)?;
    std::fs::write(data.join("app-runtime.json"), serde_json::to_vec(&serde_json::json!({"web": root}))?)?;
    Ok(())
}

pub const FAKE_API: &str = r#"(() => {
  const original = window.fetch.bind(window);
  window.fetch = (url, init) => {
    const target = String(url instanceof Request ? url.url : url);
    if (/^http:\/\/(localhost|127\.0\.0\.1):14000\//.test(target)) {
      const value = target.includes('/system/mode') ? {mode:'server', loginPolicy:'strict'} : target.includes('/updates/ui-ready') ? {accepted:false} : [];
      return Promise.resolve(new Response(JSON.stringify(value), {status:200, headers:{'Content-Type':'application/json'}}));
    }
    return original(url, init);
  };
})()"#;

pub fn loaded(view: &Webview, payload: &tauri::webview::PageLoadPayload<'_>) {
    if !enabled() || view.app_handle().config().identifier != "com.orion.payload-smoke" || view.label() != "main"
        || !matches!(payload.event(), tauri::webview::PageLoadEvent::Finished)
        || STARTED.swap(true, Ordering::SeqCst) { return; }
    let Ok(report) = std::env::var("ORION_PAYLOAD_UI_SMOKE_REPORT") else { return; };
    if !report.starts_with("http://127.0.0.1:") { return; }
    let report = serde_json::to_string(&report).unwrap();
    let js = format!(r#"(async () => {{
      const result = {{origin:location.origin, checks:[]}};
      try {{
        for (let n=0;n<150;n++) {{
          const input=document.querySelector('input');
          if (input && Object.keys(input).some(k=>k.startsWith('__reactProps'))) {{ result.checks.push('React hydration'); break; }}
          await new Promise(r=>setTimeout(r,200));
        }}
        if (!result.checks.length) throw new Error('React did not hydrate');
        const worker=await fetch('/pdf.worker.min.mjs');
        if (!worker.ok || !worker.headers.get('content-type').includes('javascript')) throw new Error('Module MIME');
        result.checks.push('ES module MIME');
        const route=await fetch('/register');
        if (!route.ok || !(await route.text()).includes('<html')) throw new Error('Static route');
        result.checks.push('Static route');
        try {{ await window.__TAURI_INTERNALS__.invoke('browser_control',{{id:'',action:'close',url:null,bounds:null}}); throw new Error('Guard did not reject empty ID'); }}
        catch (e) {{ if (!String(e).includes('Некорректная вкладка')) throw e; }}
        result.checks.push('Trusted native IPC');
        result.ok=true;
      }} catch(e) {{ result.ok=false; result.error=String(e); }}
      await fetch({report},{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify(result)}});
    }})()"#);
    let _ = view.eval(&js);
}
