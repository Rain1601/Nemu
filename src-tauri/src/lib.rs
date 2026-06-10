mod agent_watcher;

use agent_watcher::AgentWatcher;
use std::thread;
use std::time::Duration;
use tauri::{Manager, Window};

#[tauri::command]
fn peek_away(window: Window, seconds: u64) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())?;
    let restore = window.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(seconds.clamp(1, 600)));
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![agent_watcher::list_agents, peek_away])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
