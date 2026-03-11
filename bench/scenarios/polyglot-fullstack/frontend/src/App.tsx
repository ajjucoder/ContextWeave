import React from "react";
import TaskList from "./components/TaskList";
import CreateTask from "./components/CreateTask";

export default function App() {
  const handleTaskCreated = (title: string) => {
    console.log("Task created:", title);
  };

  return (
    <div className="app">
      <h1>Task Manager</h1>
      <CreateTask onCreated={handleTaskCreated} />
      <TaskList />
    </div>
  );
}
