// src/tools/openIssues.ts
import { z } from "zod";
import { EC_CLOUD_BASE_URL, ensureConfig, EC_LANG } from "../config.js";
import { fetchJson, asTextContent } from "../http.js";
import { buildBasicAuth } from "../config.js";
export function registerOpenIssuesTools(server) {
    // Tool 1: Issues holen
    server.registerTool("ec_open_issues", {
        title: "EquipmentCloud: Open Issues auflisten",
        description: "Listet offene Issues einer Hierarchie (things/types/hierarchies/type_hierarchies) mit optionalen Filtern (qp) & Pagination (step).",
        inputSchema: {
            hierarchy_type: z.enum(["things", "types", "hierarchies", "type_hierarchies"]),
            hierarchy_id: z.string().min(1),
            qp: z.record(z.any()).optional(),
            step: z.number().int().positive().optional(),
        },
    }, async ({ hierarchy_type, hierarchy_id, qp, step }, _extra) => {
        const missing = ensureConfig();
        if (missing.length) {
            return {
                content: asTextContent({ error: "Konfiguration unvollständig", missing }),
                isError: true,
            };
        }
        const base = EC_CLOUD_BASE_URL.replace(/\/+$/, "");
        const url = new URL(`${base}/openissues/v1/${hierarchy_type}/${encodeURIComponent(hierarchy_id)}/issues`);
        if (qp)
            url.searchParams.set("qp", JSON.stringify(qp));
        if (step)
            url.searchParams.set("step", String(step));
        const r = await fetchJson(url.toString(), { signal: _extra.signal });
        if (!r.ok) {
            return {
                content: asTextContent({ error: "HTTP", status: r.status, statusText: r.statusText, api: r.data }),
                isError: true,
            };
        }
        return { content: asTextContent({ items: r.data?.items ?? [], controls: r.data?.controls ?? [] }) };
    });
    // Tool 2: Pagination-Follow
    server.registerTool("ec_open_issues_follow", {
        title: "EquipmentCloud: Open Issues – Link aus controls folgen",
        description: "Ruft eine URL aus controls.first/next/prev ab (relativ oder absolut).",
        inputSchema: { url: z.string().min(1) },
    }, async ({ url }, _extra) => {
        const missing = ensureConfig();
        if (missing.length) {
            return {
                content: asTextContent({ error: "Konfiguration unvollständig", missing }),
                isError: true,
            };
        }
        // controls-Links können relativ sein → gegen Base auflösen
        const target = new URL(url, EC_CLOUD_BASE_URL).toString();
        const r = await fetchJson(target, { signal: _extra.signal });
        if (!r.ok) {
            return {
                content: asTextContent({ error: "HTTP", status: r.status, statusText: r.statusText, api: r.data }),
                isError: true,
            };
        }
        return { content: asTextContent({ items: r.data?.items ?? [], controls: r.data?.controls ?? [] }) };
    });
    // Tool 3: Einzelnes Issue (Detail) laden
    server.registerTool("ec_issue_detail", {
        title: "EquipmentCloud: Issue-Details laden",
        description: "Lädt die Details eines Issues über /openissues/v1/issues/:issue.",
        inputSchema: {
            issue: z.number().int().positive().describe("Issue-ID (ident), z. B. 55"),
        },
    }, async ({ issue }, _extra) => {
        const missing = ensureConfig();
        if (missing.length) {
            return {
                content: asTextContent({ error: "Konfiguration unvollständig", missing }),
                isError: true,
            };
        }
        const base = EC_CLOUD_BASE_URL.replace(/\/+$/, "");
        const url = `${base}/openissues/v1/issues/${issue}`;
        const r = await fetchJson(url, { signal: _extra.signal });
        if (!r.ok) {
            return {
                content: asTextContent({
                    error: "HTTP",
                    status: r.status,
                    statusText: r.statusText,
                    api: r.data,
                }),
                isError: true,
            };
        }
        // API liefert laut Doku ein { items: [ {...} ] }
        const item = Array.isArray(r.data?.items) && r.data.items.length > 0
            ? r.data.items[0]
            : null;
        return {
            content: asTextContent({
                issue,
                found: !!item,
                item, // vollständiges Objekt (inkl. description, responsible, counts, ...)
            }),
        };
    });
    // Tool 4: Attachments eines Issues auflisten
    server.registerTool("ec_issue_attachments_list", {
        title: "EquipmentCloud: Issue-Attachments auflisten",
        description: "Liest die Liste der Attachments eines Issues über /openissues/v1/issues/:issue/attachments.",
        inputSchema: {
            issue: z.number().int().positive().describe("Issue-ID (ident)"),
        },
    }, async ({ issue }, _extra) => {
        const missing = ensureConfig();
        if (missing.length) {
            return { content: asTextContent({ error: "Konfiguration unvollständig", missing }), isError: true };
        }
        const base = EC_CLOUD_BASE_URL.replace(/\/+$/, "");
        const url = `${base}/openissues/v1/issues/${issue}/attachments`;
        const r = await fetchJson(url, { signal: _extra.signal });
        if (!r.ok) {
            return {
                content: asTextContent({ error: "HTTP", status: r.status, statusText: r.statusText, api: r.data }),
                isError: true,
            };
        }
        // API: { items: [ { ident, file_name, mime_type, ... } ] }
        const items = Array.isArray(r.data?.items) ? r.data.items : [];
        return { content: asTextContent({ issue, count: items.length, items }) };
    });
    // Tool 5: Konkretes Attachment herunterladen (als MCP-Resource zurückgeben)
    server.registerTool("ec_issue_attachment_download", {
        title: "EquipmentCloud: Issue-Attachment herunterladen",
        description: "Lädt eine Datei eines Issues herunter und gibt sie als 'resource' (Base64-Blob + mimeType) zurück. Entweder issue+attachment_ident angeben (Standardpfad) oder eine vollständige URL übergeben.",
        inputSchema: {
            issue: z.number().int().positive().optional().describe("Issue-ID (ident) – erforderlich, wenn keine URL angegeben ist"),
            attachment_ident: z.number().int().positive().optional().describe("Attachment-ID (ident) – erforderlich mit 'issue', wenn keine URL angegeben ist"),
            url: z.string().min(1).optional().describe("Optional direkte Download-URL, wenn der Endpunkt abweicht"),
        },
    }, async ({ issue, attachment_ident, url }, _extra) => {
        const missing = ensureConfig();
        if (missing.length) {
            return { content: asTextContent({ error: "Konfiguration unvollständig", missing }), isError: true };
        }
        // Eingaben prüfen: entweder URL ODER (issue + attachment_ident)
        let target = null;
        const base = EC_CLOUD_BASE_URL.replace(/\/+$/, "");
        if (url) {
            // direkter Ziel-URL (z. B. wenn euer Endpunkt anders heißt)
            try {
                target = new URL(url, base).toString();
            }
            catch {
                return { content: asTextContent({ error: "Ungültige URL", url }), isError: true };
            }
        }
        else {
            if (!issue || !attachment_ident) {
                return {
                    content: asTextContent({
                        error: "Eingaben unvollständig",
                        hint: "Entweder 'url' angeben ODER 'issue' UND 'attachment_ident'.",
                    }),
                    isError: true,
                };
            }
            // Standard-Downloadpfad (übliches Schema – falls bei euch anders, bitte 'url' verwenden)
            target = `${base}/openissues/v1/issues/${issue}/attachments/${attachment_ident}`;
        }
        // Jetzt den Binary-Download machen
        try {
            const res = await fetch(target, {
                headers: {
                    Authorization: buildBasicAuth(),
                    Accept: "*/*",
                    lang: EC_LANG,
                },
                signal: _extra.signal,
            });
            // Bestmögliche Fehlerdiagnose
            if (!res.ok) {
                // Manche Server liefern JSON-Fehler – versuchen zu parsen
                let api = null;
                try {
                    api = await res.clone().json();
                }
                catch { /* binary oder kein JSON */ }
                return {
                    content: asTextContent({
                        error: "HTTP (download)",
                        status: res.status,
                        statusText: res.statusText,
                        api,
                        url: target,
                    }),
                    isError: true,
                };
            }
            // Binary → Base64
            const buf = Buffer.from(await res.arrayBuffer());
            const b64 = buf.toString("base64");
            const mime = res.headers.get("content-type") ?? "application/octet-stream";
            // Dateiname aus Header (falls vorhanden) extrahieren
            let fileName = undefined;
            const cd = res.headers.get("content-disposition");
            if (cd) {
                const m = /filename\*?=(?:UTF-8'')?("?)([^";]+)\1/i.exec(cd);
                if (m)
                    fileName = decodeURIComponent(m[2]);
            }
            // MCP-Resource zurückgeben (blob + mimeType). URI zur Info dabei lassen.
            return {
                content: [
                    {
                        type: "resource",
                        resource: {
                            uri: target,
                            blob: b64,
                            mimeType: mime,
                            ...(fileName ? { text: fileName } : {}), // 'text' kann als Label/Name dienen
                        },
                    },
                    // Zusätzlich eine Text-Zusammenfassung (hilfreich in UIs ohne Resource-Viewer)
                    {
                        type: "text",
                        text: JSON.stringify({ url: target, mimeType: mime, size_bytes: buf.length, file_name: fileName ?? null }, null, 2),
                    },
                ],
            };
        }
        catch (e) {
            return {
                content: asTextContent({ error: "Download-Fehler", message: String(e), url: target }),
                isError: true,
            };
        }
    });
}
