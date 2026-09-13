import { createApiClient } from "./api-client";
import { createSession } from "./session";
import * as storage from "./storage";

export const API_URL = process.env.EXPO_PUBLIC_API_URL?.trim().replace(
  /\/+$/,
  "",
);
if (!API_URL || !/^https?:\/\//.test(API_URL)) {
  throw new Error(
    "Configura EXPO_PUBLIC_API_URL en mobile/.env.local antes de iniciar la app.",
  );
}

export const session = createSession(storage);
export const { api, publicApi } = createApiClient(API_URL, session);
