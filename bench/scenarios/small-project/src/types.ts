export interface User {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface AuthToken {
  token: string;
  userId: string;
  expiresAt: number;
  issuedAt: number;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: Omit<User, "passwordHash">;
}

export type AuthResult =
  | { success: true; token: AuthToken; user: User }
  | { success: false; error: string };
