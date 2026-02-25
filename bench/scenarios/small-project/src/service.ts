import type { User, AuthToken, AuthResult, LoginRequest } from "./types.js";
import { hashPassword, verifyPassword, generateToken, isTokenExpired } from "./utils.js";

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export class AuthService {
  private users: Map<string, User> = new Map();
  private tokens: Map<string, AuthToken> = new Map();
  private emailIndex: Map<string, string> = new Map();

  createUser(email: string, password: string): User {
    const id = generateToken().slice(0, 16);
    const user: User = {
      id,
      email,
      passwordHash: hashPassword(password),
      createdAt: Date.now(),
      lastLoginAt: null,
    };
    this.users.set(id, user);
    this.emailIndex.set(email, id);
    return user;
  }

  login(request: LoginRequest): AuthResult {
    const userId = this.emailIndex.get(request.email);
    if (!userId) return { success: false, error: "user not found" };

    const user = this.users.get(userId);
    if (!user) return { success: false, error: "user not found" };

    if (!verifyPassword(request.password, user.passwordHash)) {
      return { success: false, error: "invalid credentials" };
    }

    const authToken: AuthToken = {
      token: generateToken(),
      userId: user.id,
      issuedAt: Date.now(),
      expiresAt: Date.now() + TOKEN_TTL_MS,
    };

    this.tokens.set(authToken.token, authToken);
    user.lastLoginAt = Date.now();

    return { success: true, token: authToken, user };
  }

  validateToken(token: string): AuthToken | null {
    const authToken = this.tokens.get(token);
    if (!authToken) return null;
    if (isTokenExpired(authToken.expiresAt)) {
      this.tokens.delete(token);
      return null;
    }
    return authToken;
  }

  getUserById(id: string): User | null {
    return this.users.get(id) ?? null;
  }

  logout(token: string): void {
    this.tokens.delete(token);
  }
}
