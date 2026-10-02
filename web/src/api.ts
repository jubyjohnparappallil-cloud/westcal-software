import type { Session } from "./types";

let token: string | null = null;
try {
  token = localStorage.getItem("token") || sessionStorage.getItem("token");
} catch {
  // storage blocked; start signed out
}

let trainingCache: { text: string; at: number; token: string | null } | null = null;
const TRAINING_CACHE_MS = 60000;

export function setApiToken(next: string | null): void {
  token = next;
  try {
    if (next) {
      localStorage.setItem("token", next);
    } else {
      localStorage.removeItem("token");
      sessionStorage.removeItem("token");
    }
  } catch {
    // storage blocked (private mode); the in-memory token still works
  }
  trainingCache = null;
}

export function getApiToken(): string | null {
  return token;
}

export function hasValidToken(): boolean {
  return !!token;
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const cacheable = method === "GET" && path === "/api/training";
  if (method !== "GET") trainingCache = null;
  if (cacheable && trainingCache && trainingCache.token === token && Date.now() - trainingCache.at < TRAINING_CACHE_MS) {
    return JSON.parse(trainingCache.text);
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = "Bearer " + token;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text().catch(() => "");
  let data: any = {};
  try {
    data = JSON.parse(text);
  } catch {}
  if (method !== "GET") trainingCache = null;
  if (!res.ok) throw new Error(data.message || "Request failed");
  if (cacheable) trainingCache = { text, at: Date.now(), token };
  return data;
}

/** Downloads an authenticated file. Alerts on failure, like the classic UI. */
export async function downloadFile(
  path: string,
  filename: string,
  opts: { failMessage?: string; noStore?: boolean; useServerName?: boolean } = {},
): Promise<void> {
  try {
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = "Bearer " + token;
    if (opts.noStore) headers["Cache-Control"] = "no-store";
    const res = await fetch(path, { headers });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.message || opts.failMessage || "PDF download failed");
    }
    const named = opts.useServerName ? (res.headers.get("Content-Disposition") || "").match(/filename="([^"]+)"/) : null;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = named ? named[1] : filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    alert((err as Error).message);
  }
}

export function signIn(identifier: string, credential: string): Promise<Session> {
  return api<Session>("POST", "/api/sign-in", { identifier, credential });
}
