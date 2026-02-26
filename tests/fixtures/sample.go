package main

import "fmt"

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
