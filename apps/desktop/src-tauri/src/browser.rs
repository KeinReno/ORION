//! External pages have their own top-level WebView and persistent profile, never ORION's storage or IPC.
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, Webview, WebviewBuilder, WebviewUrl};

fn page_url(value: &str) -> Result<tauri::Url, String> {
    let url = tauri::Url::parse(value).map_err(|_| "Некорректный адрес сайта")?;
    let host = url.host_str().unwrap_or("").to_ascii_lowercase();
    if !matches!(url.scheme(), "http" | "https")
        || host.is_empty()
        || !url.username().is_empty()
        || url.password().is_some()
        || host == "localhost"
        || host.ends_with(".localhost")
        || host == "[::1]"
        || host == "::1"
        || host.starts_with("127.")
        || host == "0.0.0.0"
        || host == "tauri.localhost"
    {
        return Err("Этот адрес нельзя открыть в браузере ORION".into());
    }
    Ok(url)
}

fn child_label(caller: &Webview, id: &str) -> Result<String, String> {
    let url = caller.url().map_err(|e| e.to_string())?;
    let trusted_origin = (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost"))
        || (cfg!(debug_assertions)
            && url.scheme() == "http"
            && url.host_str() == Some("localhost")
            && caller
                .app_handle()
                .config()
                .build
                .dev_url
                .as_ref()
                .is_some_and(|dev| dev.origin() == url.origin()));
    if caller.label().starts_with("browser-") || !trusted_origin {
        return Err("Управление браузером доступно только интерфейсу ORION".into());
    }
    if id.is_empty() || id.len() > 48 || !id.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err("Некорректная вкладка браузера".into());
    }
    Ok(format!("browser-{}-{id}", caller.label()))
}

#[derive(Clone, Serialize)]
struct PageState {
    id: String,
    url: String,
    loading: bool,
}

#[derive(Deserialize)]
pub struct BrowserBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl BrowserBounds {
    fn valid(&self) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|v| v.is_finite())
            && self.x >= 0.0
            && self.y >= 0.0
            && self.width >= 1.0
            && self.height >= 1.0
            && self.x < 32768.0
            && self.y < 32768.0
            && self.width < 32768.0
            && self.height < 32768.0
    }
}

// Async commands avoid blocking WebView2's UI thread while add_child dispatches to the main thread.
#[tauri::command]
pub async fn browser_open(
    caller: Webview,
    id: String,
    url: String,
    bounds: BrowserBounds,
) -> Result<(), String> {
    let label = child_label(&caller, &id)?;
    let target = page_url(&url)?;
    if !bounds.valid() {
        return Err("Некорректный размер браузера".into());
    }
    let app = caller.app_handle().clone();
    if app.get_webview(&label).is_some() {
        return Err("Вкладка уже открыта".into());
    }
    let profile = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("browser-profile");
    let owner = caller.label().to_string();
    let event_app = app.clone();
    let popup_app = app.clone();
    let popup_label = label.clone();
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(target))
        .data_directory(profile)
        .on_navigation(|url| page_url(url.as_str()).is_ok())
        .on_page_load(move |_view, payload| {
            let _ = event_app.emit_to(
                &owner,
                "orion-browser-page",
                PageState {
                    id: id.clone(),
                    url: payload.url().to_string(),
                    loading: matches!(payload.event(), tauri::webview::PageLoadEvent::Started),
                },
            );
        })
        .on_new_window(move |url, _features| {
            // Search results using target=_blank stay in this browser, without handing pages app capabilities.
            if page_url(url.as_str()).is_ok() {
                if let Some(view) = popup_app.get_webview(&popup_label) {
                    let _ = view.navigate(url);
                }
            }
            tauri::webview::NewWindowResponse::Deny
        });
    caller
        .window()
        .add_child(
            builder,
            tauri::LogicalPosition::new(bounds.x, bounds.y),
            tauri::LogicalSize::new(bounds.width, bounds.height),
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn browser_control(
    caller: Webview,
    id: String,
    action: String,
    url: Option<String>,
    bounds: Option<BrowserBounds>,
) -> Result<(), String> {
    let label = child_label(&caller, &id)?;
    let Some(view) = caller.app_handle().get_webview(&label) else {
        return if action == "close" {
            Ok(())
        } else {
            Err("Вкладка браузера закрыта".into())
        };
    };
    let result = match action.as_str() {
        "close" => view.close(),
        "hide" => view.hide(),
        "show" => {
            let area = bounds
                .filter(BrowserBounds::valid)
                .ok_or("Некорректный размер браузера")?;
            view.set_bounds(tauri::Rect {
                position: tauri::LogicalPosition::new(area.x, area.y).into(),
                size: tauri::LogicalSize::new(area.width, area.height).into(),
            })
            .map_err(|e| e.to_string())?;
            view.show()
        }
        "navigate" => view.navigate(page_url(url.as_deref().ok_or("Не указан адрес")?)?),
        "reload" => view.reload(),
        "back" => view.eval("history.back()"),
        "forward" => view.eval("history.forward()"),
        _ => return Err("Неизвестное действие браузера".into()),
    };
    result.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn external_pages_cannot_enter_app_origins_or_execute_schemes() {
        for url in [
            "javascript:alert(1)",
            "file:///C:/secret",
            "tauri://localhost/",
            "https://localhost/",
            "http://127.0.0.1:4000/",
            "http://[::1]/",
            "https://tauri.localhost/",
            "https://user:pass@example.com/",
        ] {
            assert!(page_url(url).is_err(), "{url}");
        }
        assert!(page_url("https://www.google.com/search?q=orion").is_ok());
        assert!(page_url("https://yandex.ru/search/?text=orion").is_ok());
    }
}
