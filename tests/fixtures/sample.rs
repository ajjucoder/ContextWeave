use std::fmt;

macro_rules! make_service {
    ($name:expr) => {
        UserService { name: String::from($name) }
    };
}

struct UserService {
    name: String,
}

impl UserService {
    fn greet(&self) {
        println!("{}", self.name);
    }
}

fn new_service(name: &str) -> UserService {
    let make = || make_service!(name);
    let svc = make();
    svc.greet();
    svc
}
