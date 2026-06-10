mod agent_watcher;

use agent_watcher::AgentWatcher;
use std::thread;
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, Window,
};

fn reveal_main<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn peek_away(window: Window, seconds: u64) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())?;
    if seconds == 0 {
        return Ok(());
    }
    let restore = window.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(seconds.clamp(1, 3600)));
        let _ = restore.show();
        let _ = restore.set_focus();
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let watcher = AgentWatcher::spawn(app.handle().clone());
            app.manage(watcher);

            let show_item = MenuItem::with_id(app, "show", "Show Nemu", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Nemu", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let _tray = TrayIconBuilder::with_id("nemu-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => reveal_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        reveal_main(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![agent_watcher::list_agents, peek_away])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
