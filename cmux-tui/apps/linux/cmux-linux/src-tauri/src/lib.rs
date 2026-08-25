mod backend;
mod hooks;

use backend::{BackendConnection, BackendManager};
use hooks::{HookAction, HookProvider, HookResult};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_notification::NotificationExt;

#[tauri::command]
async fn ensure_backend(
    app: AppHandle,
    manager: State<'_, BackendManager>,
) -> Result<BackendConnection, String> {
    manager.ensure(&app).await
}

#[tauri::command]
async fn recover_backend(
    app: AppHandle,
    manager: State<'_, BackendManager>,
) -> Result<BackendConnection, String> {
    manager.recover(&app).await
}

#[tauri::command]
async fn agent_hook(
    app: AppHandle,
    provider: HookProvider,
    action: HookAction,
) -> Result<HookResult, String> {
    hooks::run(&app, provider, action).await
}

#[tauri::command]
fn notify_if_unfocused(app: AppHandle, title: String, body: String) -> Result<(), String> {
    if app.get_webview_window("main").is_some_and(|window| window.is_focused().unwrap_or(false)) {
        return Ok(());
    }
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| format!("cannot show desktop notification: {error}"))
}

#[tauri::command]
async fn stop_sessions_and_exit(app: AppHandle) -> Result<(), String> {
    hooks::stop_managed_session(&app).await?;
    app.exit(0);
    Ok(())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

struct TrayLabels {
    title: &'static str,
    open: &'static str,
    preserve: &'static str,
    stop: &'static str,
}

fn tray_labels() -> TrayLabels {
    let language = std::env::var("LANG").unwrap_or_default().to_lowercase();
    if language.starts_with("tr") {
        TrayLabels {
            title: "Limux — Linux için cmux",
            open: "Aç",
            preserve: "Arayüzden çık — oturumları koru",
            stop: "Oturumları durdur ve çık…",
        }
    } else if language.starts_with("ja") {
        TrayLabels {
            title: "Limux — Linux 向け cmux",
            open: "開く",
            preserve: "UI を終了 — セッションを維持",
            stop: "セッションを停止して終了…",
        }
    } else {
        TrayLabels {
            title: "Limux — cmux for Linux",
            open: "Open",
            preserve: "Exit UI — keep sessions",
            stop: "Stop sessions and exit…",
        }
    }
}

fn install_tray(app: &AppHandle) -> tauri::Result<()> {
    let labels = tray_labels();
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_title(labels.title);
    }
    let open = MenuItem::with_id(app, "open", labels.open, true, None::<&str>)?;
    let preserve = MenuItem::with_id(app, "exit-preserve", labels.preserve, true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop-exit", labels.stop, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &preserve, &stop])?;
    let mut builder = TrayIconBuilder::with_id("cmux-linux")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main_window(app),
            "exit-preserve" => app.exit(0),
            "stop-exit" => {
                show_main_window(app);
                let _ = app.emit("request-stop-sessions", ());
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // The single-instance plugin must be initialized first.
        .plugin(tauri_plugin_single_instance::init(|app, _arguments, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .manage(BackendManager::default())
        .setup(|app| {
            install_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            ensure_backend,
            recover_backend,
            agent_hook,
            notify_if_unfocused,
            stop_sessions_and_exit,
        ])
        .run(tauri::generate_context!())
        .expect("cmux-linux runtime failed");
}
