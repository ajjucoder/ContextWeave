use std::fmt;

struct UserService {
    name: String,
}

impl UserService {
    fn greet(&self) {
        println!("{}", self.name);
    }
}

fn new_service(name: &str) -> UserService {
    let make = || UserService { name: String::from(name) };
    let svc = make();
    svc.greet();
    svc
}
