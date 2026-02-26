#include <iostream>

class UserService {
 public:
  void greet(const char* user) {
    print_name(user);
  }
};

void print_name(const char* name) {
  std::cout << name << std::endl;
}

int main() {
  UserService svc;
  svc.greet("alice");
  return 0;
}
