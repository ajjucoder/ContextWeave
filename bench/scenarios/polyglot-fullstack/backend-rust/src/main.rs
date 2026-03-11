mod commands;
mod ipc;

use commands::TaskStore;
use std::sync::Mutex;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .manage(TaskStore(Mutex::new(vec![])))
        .setup(|app| {
            ipc::setup_listeners(&app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_tasks,
            commands::create_task,
            commands::complete_task,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
