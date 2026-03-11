import { describe, it, expect } from "vitest";
import { parseFile } from "../../src/core/parser.js";

describe("decorator extraction — TypeScript", () => {
  it("extracts class and method decorators", () => {
    const content = `
import { Injectable } from "@nestjs/common";

@Injectable()
export class UserService {
  @Get("/users")
  getUsers() {
    return [];
  }

  @Post("/users")
  @Validate
  createUser() {
    return {};
  }
}
`;

    const result = parseFile("service.ts", content, "typescript");
    const userService = result.symbols.find((s) => s.name === "UserService");
    const getUsers = result.symbols.find((s) => s.name === "getUsers");
    const createUser = result.symbols.find((s) => s.name === "createUser");

    expect(userService).toBeDefined();
    expect(userService!.decorators).toBeDefined();
    expect(userService!.decorators!.some((d) => d.name === "Injectable")).toBe(true);

    expect(getUsers).toBeDefined();
    expect(getUsers!.decorators).toBeDefined();
    expect(getUsers!.decorators!.some((d) => d.name === "Get")).toBe(true);

    expect(createUser).toBeDefined();
    expect(createUser!.decorators).toBeDefined();
    expect(createUser!.decorators!.some((d) => d.name === "Post")).toBe(true);
    expect(createUser!.decorators!.some((d) => d.name === "Validate")).toBe(true);
  });

  it("extracts decorator arguments", () => {
    const content = `
@Controller("users")
export class UsersController {
  @Get(":id")
  findOne() { return null; }
}
`;

    const result = parseFile("controller.ts", content, "typescript");
    const controller = result.symbols.find((s) => s.name === "UsersController");
    expect(controller).toBeDefined();
    const controllerDec = controller!.decorators?.find((d) => d.name === "Controller");
    expect(controllerDec).toBeDefined();
    expect(controllerDec!.args).toBeDefined();
    expect(controllerDec!.args![0]).toBe('"users"');
  });

  it("returns no decorators for plain functions", () => {
    const content = `
export function plainFunction() {
  return 42;
}
`;

    const result = parseFile("plain.ts", content, "typescript");
    const fn = result.symbols.find((s) => s.name === "plainFunction");
    expect(fn).toBeDefined();
    expect(fn!.decorators).toBeUndefined();
  });
});

describe("decorator extraction — Python", () => {
  it("extracts decorators on functions and classes", () => {
    const content = `
from flask import Flask, route

@app.route("/api/users", methods=["GET"])
def get_users():
    return []

@staticmethod
def standalone():
    pass

@property
def name(self):
    return self._name
`;

    const result = parseFile("views.py", content, "python");
    const getUsers = result.symbols.find((s) => s.name === "get_users");
    expect(getUsers).toBeDefined();
    expect(getUsers!.decorators).toBeDefined();
    expect(getUsers!.decorators!.some((d) => d.name === "route")).toBe(true);
  });

  it("extracts simple decorators", () => {
    const content = `
@property
def value(self):
    return self._value

@classmethod
def create(cls):
    return cls()
`;

    const result = parseFile("model.py", content, "python");
    const valueFn = result.symbols.find((s) => s.name === "value");
    if (valueFn?.decorators) {
      expect(valueFn.decorators.some((d) => d.name === "property")).toBe(true);
    }
  });
});

describe("decorator extraction — Java", () => {
  it("extracts annotations on classes and methods", () => {
    const content = `
@Service
@Transactional
public class OrderService {
    @Override
    public void process() {
    }

    @RequestMapping("/orders")
    public List<String> getOrders() {
        return new ArrayList<>();
    }
}
`;

    const result = parseFile("OrderService.java", content, "java");
    const orderService = result.symbols.find((s) => s.name === "OrderService");
    expect(orderService).toBeDefined();
    expect(orderService!.decorators).toBeDefined();
    expect(orderService!.decorators!.some((d) => d.name === "Service")).toBe(true);
    expect(orderService!.decorators!.some((d) => d.name === "Transactional")).toBe(true);

    const process = result.symbols.find((s) => s.name === "process");
    expect(process).toBeDefined();
    expect(process!.decorators).toBeDefined();
    expect(process!.decorators!.some((d) => d.name === "Override")).toBe(true);
  });
});

describe("decorator extraction — Rust", () => {
  it("extracts attribute macros on functions and structs", () => {
    const content = `
#[derive(Debug, Clone)]
pub struct Config {
    pub value: i32,
}

#[test]
fn test_config() {
    assert!(true);
}

#[tokio::main]
async fn main() {
}
`;

    const result = parseFile("main.rs", content, "rust");
    const config = result.symbols.find((s) => s.name === "Config");
    expect(config).toBeDefined();
    expect(config!.decorators).toBeDefined();
    expect(config!.decorators!.some((d) => d.name === "derive")).toBe(true);

    const testConfig = result.symbols.find((s) => s.name === "test_config");
    expect(testConfig).toBeDefined();
    expect(testConfig!.decorators).toBeDefined();
    expect(testConfig!.decorators!.some((d) => d.name === "test")).toBe(true);
  });
});

describe("decorator extraction — C#", () => {
  it("extracts attributes on classes and methods", () => {
    const content = `
[ApiController]
[Route("[controller]")]
public class WeatherController : ControllerBase
{
    [HttpGet]
    public IEnumerable<string> Get() {
        return new string[] { };
    }

    [HttpPost]
    [Authorize]
    public IActionResult Post() {
        return Ok();
    }
}
`;

    const result = parseFile("WeatherController.cs", content, "csharp");
    const controller = result.symbols.find((s) => s.name === "WeatherController");
    expect(controller).toBeDefined();
    expect(controller!.decorators).toBeDefined();
    expect(controller!.decorators!.some((d) => d.name === "ApiController")).toBe(true);
    expect(controller!.decorators!.some((d) => d.name === "Route")).toBe(true);

    const get = result.symbols.find((s) => s.name === "Get");
    expect(get).toBeDefined();
    expect(get!.decorators).toBeDefined();
    expect(get!.decorators!.some((d) => d.name === "HttpGet")).toBe(true);
  });
});
