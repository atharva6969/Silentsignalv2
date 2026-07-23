import { clearToken, getToken, setToken } from "./api";
import { User } from "../types";

const USER_KEY = "ss_user";

export function saveSession(user: User, token: string): void {
  setToken(token);
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function loadSession(): User | null {
  const token = getToken();
  const raw = sessionStorage.getItem(USER_KEY);
  if (!token || !raw) return null;

  try {
    return JSON.parse(raw) as User;
  } catch {
    clearSession();
    return null;
  }
}

export function clearSession(): void {
  clearToken();
  sessionStorage.removeItem(USER_KEY);
}
