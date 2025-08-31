// src/http.ts
import { EC_LANG, buildBasicAuth } from "./config.js";

export type JsonLike = Record<string, unknown> | unknown[] | null;

export async function fetchJson(
  url: string,
  init?: RequestInit & { signal?: AbortSignal }
): Promise<{ ok: boolean; status: number; statusText: string; data: any }> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: buildBasicAuth(),
      Accept: "application/json",
      lang: EC_LANG,
      ...(init?.headers ?? {}),
    },
    signal: init?.signal,
  });

  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* falls kein JSON */ }

  return { ok: res.ok, status: res.status, statusText: res.statusText, data };
}

export function asTextContent(obj: JsonLike) {
  return [
    {
      type: "text" as const,
      text: JSON.stringify(obj, null, 2),
    },
  ];
}
