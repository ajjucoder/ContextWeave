import React, { useEffect, useState } from "react";
import { fetchTasks, completeTask, type TaskPayload } from "../lib/tauri";
import TaskItem from "./TaskItem";

export default function TaskList() {
  const [tasks, setTasks] = useState<TaskPayload[]>([]);

  useEffect(() => {
    fetchTasks().then(setTasks);
  }, []);

  const handleComplete = async (id: string) => {
    await completeTask(id);
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: true } : t)));
  };

  const handleDelete = (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ul>
      {tasks.map((task) => (
        <TaskItem
          key={task.id}
          task={task}
          onComplete={handleComplete}
          onDelete={handleDelete}
        />
      ))}
    </ul>
  );
}
