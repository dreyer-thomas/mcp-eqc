// src/http.ts
import { EC_LANG, buildBasicAuth } from "./config.js";
export async function fetchJson(url, init) {
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
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    }
    catch { /* falls kein JSON */ }
    return { ok: res.ok, status: res.status, statusText: res.statusText, data };
}
export function asTextContent(obj) {
    return [
        {
            type: "text",
            text: JSON.stringify(obj, null, 2),
        },
    ];
}
