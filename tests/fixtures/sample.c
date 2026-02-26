#include <stdio.h>

typedef struct UserService {
  int count;
} UserService;

void print_user(const char *name) {
  printf("%s\n", name);
}

int main(void) {
  print_user("alice");
  return 0;
}
