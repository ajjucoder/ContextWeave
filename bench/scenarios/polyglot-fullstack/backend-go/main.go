package main

import (
	"context"
	"fmt"
	"log"

	"example.com/taskapp/service"
)

func main() {
	srv := service.NewServer()
	ctx := context.Background()

	task, err := srv.CreateTask(ctx, "Build polyglot fixture")
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Created: %s\n", task.ID)

	if err := srv.CompleteTask(ctx, task.ID); err != nil {
		log.Fatal(err)
	}
	fmt.Println("Done")
}
