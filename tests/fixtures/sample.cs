using System;
using System.Collections.Generic;

namespace Demo {
  public class UserService {
    public UserService() {}

    public void Greet(string user) {
      Console.WriteLine(user);
    }

    public static UserService Create() {
      var factory = (string name) => new UserService();
      var list = new List<string>();
      list.Add("x");
      return factory("alice");
    }
  }
}
