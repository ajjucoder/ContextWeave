package service

import (
	"context"
	"fmt"
)

type Task struct {
	ID    string
	Title string
	Done  bool
}

type Server struct {
	tasks   map[string]*Task
	events  chan TaskEvent
	updates chan Task
}

type TaskEvent struct {
	Kind string
	Task Task
}

func NewServer() *Server {
	s := &Server{
		tasks:   make(map[string]*Task),
		events:  make(chan TaskEvent, 64),
		updates: make(chan Task, 16),
	}
	go s.processEvents()
	return s
}

func (s *Server) GetTask(ctx context.Context, id string) (*Task, error) {
	t, ok := s.tasks[id]
	if !ok {
		return nil, fmt.Errorf("task %s not found", id)
	}
	return t, nil
}

func (s *Server) CreateTask(ctx context.Context, title string) (*Task, error) {
	t := &Task{ID: fmt.Sprintf("t-%d", len(s.tasks)+1), Title: title}
	s.tasks[t.ID] = t
	s.events <- TaskEvent{Kind: "created", Task: *t}
	return t, nil
}

func (s *Server) CompleteTask(ctx context.Context, id string) error {
	t, ok := s.tasks[id]
	if !ok {
		return fmt.Errorf("task %s not found", id)
	}
	t.Done = true
	s.updates <- *t
	return nil
}
