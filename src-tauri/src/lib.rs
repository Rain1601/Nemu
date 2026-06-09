mod agent_watcher;

use agent_watcher::AgentWatcher;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let watcher = AgentWatcher::spawn(app.handle().clone());
            app.manage(watcher);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![agent_watcher::list_agents])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
