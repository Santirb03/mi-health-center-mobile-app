import axios from "axios";
import { SessionExpiredError } from "./session";

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof SessionExpiredError) return error.message;
  if (!axios.isAxiosError(error)) return fallback;
  if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
    return "La conexión tardó demasiado. Intenta de nuevo.";
  }
  if (!error.response)
    return "No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.";
  if (error.response.status === 401)
    return "Tu sesión terminó. Inicia sesión de nuevo.";
  if (error.response.status === 429)
    return "Hay demasiados intentos. Espera un momento e intenta de nuevo.";
  if (error.response.status >= 500)
    return "El servicio no está disponible por el momento. Intenta más tarde.";
  return fallback;
}
