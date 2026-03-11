use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub done: bool,
}

pub struct TaskStore(pub Mutex<Vec<Task>>);

#[tauri::command]
pub fn get_tasks(store: State<TaskStore>) -> Vec<Task> {
    store.0.lock().unwrap().clone()
}

#[tauri::command]
pub fn create_task(title: String, store: State<TaskStore>) -> Task {
    let mut tasks = store.0.lock().unwrap();
    let task = Task {
        id: format!("t-{}", tasks.len() + 1),
        title,
        done: false,
    };
    tasks.push(task.clone());
    task
}

#[tauri::command]
pub fn complete_task(id: String, store: State<TaskStore>) -> Result<(), String> {
    let mut tasks = store.0.lock().unwrap();
    match tasks.iter_mut().find(|t| t.id == id) {
        Some(task) => {
            task.done = true;
            Ok(())
        }
        None => Err(format!("Task {} not found", id)),
    }
}
