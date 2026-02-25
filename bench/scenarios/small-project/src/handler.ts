import type { LoginRequest, LoginResponse } from "./types.js";
import { AuthService } from "./service.js";

interface HttpRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

interface HttpResponse {
  status: number;
  body: unknown;
}

export class AuthHandler {
  constructor(private readonly service: AuthService) {}

  handle(req: HttpRequest): HttpResponse {
    if (req.method === "POST" && req.path === "/auth/login") {
      return this.handleLogin(req);
    }
    if (req.method === "POST" && req.path === "/auth/logout") {
      return this.handleLogout(req);
    }
    if (req.method === "GET" && req.path === "/auth/me") {
      return this.handleMe(req);
    }
    return { status: 404, body: { error: "not found" } };
  }

  private handleLogin(req: HttpRequest): HttpResponse {
    const body = req.body as LoginRequest;
    if (!body.email || !body.password) {
      return { status: 400, body: { error: "email and password required" } };
    }

    const result = this.service.login(body);
    if (!result.success) {
      return { status: 401, body: { error: result.error } };
    }

    const response: LoginResponse = {
      token: result.token.token,
      user: {
        id: result.user.id,
        email: result.user.email,
        createdAt: result.user.createdAt,
        lastLoginAt: result.user.lastLoginAt,
      },
    };

    return { status: 200, body: response };
  }

  private handleLogout(req: HttpRequest): HttpResponse {
    const auth = req.headers["authorization"] ?? "";
    const token = auth.replace("Bearer ", "");
    if (!token) return { status: 401, body: { error: "unauthorized" } };
    this.service.logout(token);
    return { status: 200, body: { ok: true } };
  }

  private handleMe(req: HttpRequest): HttpResponse {
    const auth = req.headers["authorization"] ?? "";
    const token = auth.replace("Bearer ", "");
    if (!token) return { status: 401, body: { error: "unauthorized" } };

    const authToken = this.service.validateToken(token);
    if (!authToken) return { status: 401, body: { error: "invalid or expired token" } };

    const user = this.service.getUserById(authToken.userId);
    if (!user) return { status: 404, body: { error: "user not found" } };

    return {
      status: 200,
      body: {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
      },
    };
  }
}
