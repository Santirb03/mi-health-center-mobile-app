import axios from "axios";
import { publicApi } from "./api";

export const RESET_REQUEST_MESSAGE = "Si existe una cuenta con ese correo, recibirás instrucciones para restablecer tu contraseña. Revisa también el correo no deseado.";
export const INVALID_RESET_MESSAGE = "El enlace no es válido, ya se utilizó o expiró. Solicita uno nuevo.";
const resendAt = new Map<string, number>();

export function emailError(email: string): string | undefined {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? undefined : "Ingresa un correo electrónico válido, sin espacios.";
}

export function resetToken(value: string | string[] | undefined): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

export function resetErrors(password: string, confirmation: string) {
  const errors: { password?: string; confirmation?: string } = {};
  if (password.length < 8) errors.password = "Usa al menos 8 caracteres.";
  if (!confirmation || confirmation !== password) errors.confirmation = "Las contraseñas deben coincidir.";
  return errors;
}

export function resendSeconds(email: string, now = Date.now()): number {
  return Math.max(0, Math.ceil(((resendAt.get(email) ?? 0) - now) / 1000));
}

export async function requestPasswordReset(email: string) {
  if (emailError(email)) throw new Error("Invalid email");
  if (resendSeconds(email) > 0) return;
  // Keep the UI cooldown across navigation; the backend remains authoritative.
  resendAt.set(email, Date.now() + 60000);
  try {
    await publicApi.post("/auth/forgot-password", { email });
  } finally {
    // An interrupted request may still have issued a token on the server.
    resendAt.set(email, Date.now() + 60000);
  }
}

export async function submitPasswordReset(token: string, password: string) {
  await publicApi.post("/auth/reset-password", { token, password });
}

export function resetFailure(error: unknown): { invalidToken: boolean; message: string } {
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  if (status === 400) return { invalidToken: true, message: INVALID_RESET_MESSAGE };
  if (status === 429) return { invalidToken: false, message: "Hay demasiados intentos. Espera un minuto e intenta de nuevo." };
  return { invalidToken: false, message: "No pudimos confirmar el cambio. Intenta iniciar sesión con la nueva contraseña; si no funciona, vuelve a intentarlo o solicita otro enlace." };
}
