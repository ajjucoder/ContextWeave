import functools
from dataclasses import dataclass


def traced(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        return fn(*args, **kwargs)

    return wrapper


@dataclass
class UserService:
    name: str

    @traced
    def greet(self, user: str) -> str:
        return f"{self.name}:{user}"


def build_service(name: str) -> UserService:
    svc = UserService(name)
    return svc
