import React from "react";
import type { TaskPayload } from "../lib/tauri";

interface Props {
  task: TaskPayload;
  onComplete: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function TaskItem({ task, onComplete, onDelete }: Props) {
  return (
    <li style={{ opacity: task.done ? 0.5 : 1 }}>
      <span>{task.title}</span>
      <button onClick={() => onComplete(task.id)} disabled={task.done}>
        Done
      </button>
      <button onClick={() => onDelete(task.id)}>Delete</button>
    </li>
  );
}
