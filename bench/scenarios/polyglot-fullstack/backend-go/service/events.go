package service

import "fmt"

func (s *Server) processEvents() {
	for event := range s.events {
		switch event.Kind {
		case "created":
			fmt.Printf("Task created: %s\n", event.Task.Title)
			s.updates <- event.Task
		case "deleted":
			fmt.Printf("Task deleted: %s\n", event.Task.ID)
		default:
			fmt.Printf("Unknown event: %s\n", event.Kind)
		}
	}
}

func (s *Server) watchUpdates(done <-chan struct{}) {
	for {
		select {
		case task := <-s.updates:
			fmt.Printf("Task updated: %s done=%v\n", task.ID, task.Done)
		case <-done:
			return
		}
	}
}

func (s *Server) broadcastEvent(kind string, task Task) {
	s.events <- TaskEvent{Kind: kind, Task: task}
}
