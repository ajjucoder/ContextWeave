use tauri::{AppHandle, Manager};
use serde::Serialize;

#[derive(Clone, Serialize)]
pub struct TaskEvent {
    pub kind: String,
    pub task_id: String,
}

pub fn emit_task_created(app: &AppHandle, task_id: &str) {
    app.emit_all("task-created", TaskEvent {
        kind: "created".to_string(),
        task_id: task_id.to_string(),
    }).ok();
}

pub fn emit_task_completed(app: &AppHandle, task_id: &str) {
    app.emit_all("task-completed", TaskEvent {
        kind: "completed".to_string(),
        task_id: task_id.to_string(),
    }).ok();
}

pub fn setup_listeners(app: &AppHandle) {
    let handle = app.clone();
    app.listen_global("frontend-ready", move |_event| {
        emit_task_created(&handle, "init");
    });
}
