import { readFile } from "node:fs/promises";

export interface User {
  id: string;
  name: string;
  email: string;
}

export type UserRole = "admin" | "user" | "guest";

export function validateEmail(email: string): boolean {
  return email.includes("@") && email.includes(".");
}

export async function loadUser(id: string): Promise<User | null> {
  const data = await readFile(`users/${id}.json`, "utf-8");
  return JSON.parse(data) as User;
}

export class UserService {
  private users: Map<string, User> = new Map();

  add(user: User): void {
    if (!validateEmail(user.email)) {
      throw new Error("Invalid email");
    }
    this.users.set(user.id, user);
  }

  get(id: string): User | undefined {
    return this.users.get(id);
  }

  async loadAndAdd(id: string): Promise<void> {
    const user = await loadUser(id);
    if (user) {
      this.add(user);
    }
  }
}

const DEFAULT_ROLE: UserRole = "user";

export const getDefaultRole = (): UserRole => DEFAULT_ROLE;
