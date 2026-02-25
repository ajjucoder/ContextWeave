import { AuthService } from "./service.js";
import { AuthHandler } from "./handler.js";

export type { User, AuthToken, LoginRequest, LoginResponse, AuthResult } from "./types.js";
export { hashPassword, verifyPassword, generateToken, isTokenExpired } from "./utils.js";
export { AuthService } from "./service.js";
export { AuthHandler } from "./handler.js";

export function createAuthStack(): { service: AuthService; handler: AuthHandler } {
  const service = new AuthService();
  const handler = new AuthHandler(service);
  return { service, handler };
}
