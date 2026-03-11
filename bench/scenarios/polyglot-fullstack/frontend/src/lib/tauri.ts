import { invoke } from "@tauri-apps/api/tauri";

export interface TaskPayload {
  id: string;
  title: string;
  done: boolean;
}

export async function fetchTasks(): Promise<TaskPayload[]> {
  return invoke<TaskPayload[]>("get_tasks");
}

export async function completeTask(id: string): Promise<void> {
  return invoke<void>("complete_task", { id });
}

export async function createTask(title: string): Promise<TaskPayload> {
  return invoke<TaskPayload>("create_task", { title });
}
