import type { Session } from "../types";

interface FieldWindow {
  Capacitor?: { isNativePlatform?: () => boolean };
  WESTCAL_API_BASE?: string;
}
const w = window as unknown as FieldWindow;

export const NATIVE = !!(w.Capacitor && w.Capacitor.isNativePlatform && w.Capacitor.isNativePlatform());

export function apiBase(): string {
  const saved = localStorage.getItem("westcal.apiBase");
  const configured = w.WESTCAL_API_BASE || "";
  return (saved || configured || "").replace(/\/+$/, "");
}

export function setApiBase(value: string): void {
  const v = (value || "").trim().replace(/\/+$/, "");
  if (v) localStorage.setItem("westcal.apiBase", v);
  else localStorage.removeItem("westcal.apiBase");
}

let session: Session | null = null;
export const setFieldSession = (s: Session | null) => (session = s);

export async function fapi<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (session) headers.Authorization = "Bearer " + session.token;
  let res: Response;
  try {
    res = await fetch(apiBase() + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error("Cannot reach the server. Check your signal and the server address.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Request failed");
  return data;
}

export async function downloadBlob(path: string, filename: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (session) headers.Authorization = "Bearer " + session.token;
  const res = await fetch(apiBase() + path, { headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || "Download failed");
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
