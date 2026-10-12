import type { Patient, PatientPatch, PatientPayload } from "./patients";

export interface PatientForm { firstName: string; lastName: string; phone: string; email: string; dateOfBirth: string }
export type PatientErrors = Partial<Record<keyof PatientForm, string>>;
const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
function realDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}
export function civilDate(iso: string | null): string {
  if (!iso) return "";
  const match = /^(\d{4}-\d{2}-\d{2})T00:00:00\.000Z$/.exec(iso);
  return match && realDate(match[1]) ? match[1] : "";
}
export function formatCivilDate(iso: string | null): string {
  const date = civilDate(iso);
  if (!date) return "Fecha no disponible";
  const [year, month, day] = date.split("-").map(Number);
  return `${day} de ${months[month - 1]} de ${year}`;
}
const phoneText = (value: string) => value.trim().replace(/[\s()-]/g, "");
export function patientErrors(form: PatientForm, today: string): PatientErrors {
  const errors: PatientErrors = {};
  for (const field of ["firstName", "lastName"] as const)
    if (form[field].trim().length < 2 || form[field].trim().length > 80)
      errors[field] = `${field === "firstName" ? "El nombre" : "Los apellidos"} debe${field === "lastName" ? "n" : ""} tener entre 2 y 80 caracteres.`;
  if (form.phone.trim() && (form.phone.length > 40 || !/^(?:(?:\+|00)?52)?\d{10}(?:(?:ext\.?|x|#)\d+)?$/i.test(phoneText(form.phone))))
    errors.phone = "Ingresa un teléfono mexicano válido; puedes incluir +52.";
  const email = form.email.trim();
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
    errors.email = "Ingresa un correo válido de hasta 254 caracteres.";
  const birth = form.dateOfBirth.trim();
  if (birth && (!realDate(birth) || birth < "1900-01-01" || birth > today))
    errors.dateOfBirth = "Ingresa una fecha real AAAA-MM-DD, desde 1900 y no posterior a hoy.";
  return errors;
}
export function formFromPatient(patient: Patient): PatientForm {
  return { firstName: patient.firstName, lastName: patient.lastName, phone: patient.phone ?? "",
    email: patient.email ?? "", dateOfBirth: civilDate(patient.dateOfBirth) };
}
export function patientPayload(form: PatientForm): PatientPayload {
  return { firstName: form.firstName.trim(), lastName: form.lastName.trim(),
    ...(form.phone.trim() ? { phone: phoneText(form.phone) } : {}),
    ...(form.email.trim() ? { email: form.email.trim() } : {}),
    ...(form.dateOfBirth.trim() ? { dateOfBirth: form.dateOfBirth.trim() } : {}) };
}
export function patientPatch(original: Patient, form: PatientForm): PatientPatch | null {
  const before = patientPayload(formFromPatient(original));
  const after = patientPayload(form);
  const patch: PatientPatch = {};
  for (const field of ["firstName", "lastName"] as const)
    if (before[field] !== after[field]) patch[field] = after[field];
  for (const field of ["phone", "email", "dateOfBirth"] as const)
    if (before[field] !== after[field]) patch[field] = after[field] ?? null;
  return Object.keys(patch).length ? patch : null;
}
export function serverFieldErrors(messages: unknown): { fields: PatientErrors; general: string | null } {
  const fields: PatientErrors = {};
  let unknown = false;
  const hints: Record<keyof PatientForm, string> = {
    firstName: "Revisa el nombre: entre 2 y 80 caracteres.",
    lastName: "Revisa los apellidos: entre 2 y 80 caracteres.",
    phone: "Ingresa un teléfono mexicano válido; puedes incluir +52.",
    email: "Ingresa un correo válido de hasta 254 caracteres.",
    dateOfBirth: "Ingresa una fecha real AAAA-MM-DD, desde 1900 y no posterior a hoy.",
  };
  const list = Array.isArray(messages) ? messages : [messages];
  for (const message of list) {
    const field = typeof message === "string" ? (Object.keys(hints) as (keyof PatientForm)[])
      .find(key => message.startsWith(`${key} `)) : undefined;
    if (field) fields[field] = hints[field];
    else unknown = true;
  }
  return { fields, general: unknown || !list.length ? "No pudimos guardar el paciente. Revisa los datos e intenta de nuevo." : null };
}
