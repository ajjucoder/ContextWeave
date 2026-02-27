package main

import "fmt"

type Reader interface {
	Read(p []byte) (n int, err error)
}

type Closer interface {
	Close() error
}

type ReadCloser interface {
	Reader
	Closer
}

type UserService struct {
	Name string
}

func (s *UserService) Greet(user string) {
	fmt.Println(user)
}

func NewUserService(name string) *UserService {
	svc := &UserService{Name: name}
	svc.Greet(name)
	return svc
}
