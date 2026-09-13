import { publicApi, session } from "./api";
import { Tokens } from "./session";

export interface LoginData {
  email: string;
  password: string;
}

export async function login(data: LoginData) {
  const version = await session.beginLogin();
  const response = await publicApi.post<Tokens>("/auth/login", data);
  await session.save(response.data, version);
}

export async function logout() {
  const accessToken = session.getTokens()?.accessToken;
  // Invalidate locally before network I/O; stale requests cannot revive it.
  await session.clear();
  if (accessToken) {
    await publicApi.post("/auth/logout", undefined, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }
}
