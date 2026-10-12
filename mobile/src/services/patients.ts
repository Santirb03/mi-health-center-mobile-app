import type { AxiosRequestConfig } from "axios";
import { api, session } from "./api";

export interface Patient {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  dateOfBirth: string | null;
  createdAt: string;
  updatedAt: string;
  doctorId?: string;
}
export interface PatientPayload {
  firstName: string;
  lastName: string;
  phone?: string | null;
  email?: string | null;
  dateOfBirth?: string | null;
}
export type PatientPatch = Partial<PatientPayload>;
export interface PatientPage { items: Patient[]; nextCursor: string | null }

function config(signal?: AbortSignal): AxiosRequestConfig & { _sessionVersion: number } {
  // Pin the version before Axios schedules its request interceptor.
  return { signal, _sessionVersion: session.getVersion() };
}
export async function getPatientPage(q: string | undefined, cursor: string | null, signal: AbortSignal): Promise<PatientPage> {
  const response = await api.get<PatientPage>("/patients/page", {
    ...config(signal), params: { ...(q ? { q } : {}), ...(cursor ? { cursor } : {}) },
  });
  return response.data;
}
export async function getPatient(id: string, signal: AbortSignal): Promise<Patient> {
  return (await api.get<Patient>(`/patients/${encodeURIComponent(id)}`, config(signal))).data;
}
export async function createPatient(payload: PatientPayload): Promise<Patient> {
  return (await api.post<Patient>("/patients", payload, config())).data;
}
export async function updatePatient(id: string, payload: PatientPatch): Promise<Patient> {
  return (await api.patch<Patient>(`/patients/${encodeURIComponent(id)}`, payload, config())).data;
}
