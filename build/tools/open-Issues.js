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
    // Tool 6: Konkretes Attachment über issues/:issue/attachments/:attachment herunterladen
    server.registerTool("ec_issue_attachment_get", {
        title: "EquipmentCloud: Issue-Attachment (direkter Pfad) herunterladen",
        description: "Lädt eine Datei über /openissues/v1/issues/:issue/attachments/:attachment. Mit 'mode' steuerst du die Ausgabe: 'file' (lokal speichern, Pfad zurückgeben), 'uri' (nur Link), 'inline' (data:-URI).",
        inputSchema: {
            issue: z.number().int().positive().describe("Issue-ID (ident)"),
            attachment: z.number().int().positive().describe("Attachment-ID (ident)"),
            max_inline_size: z.number().int().positive().optional().describe("Maximale Inline-Größe in Bytes (Default 10 MB)"),
            mode: z.enum(["file", "uri", "inline"]).optional().describe("Ausgabemodus: file (Default) | uri | inline"),
            // optional: Zielordner fürs Speichern bei mode=file
            save_dir: z.string().optional().describe("Zielordner; Default ist OS-Temp"),
        },
    }, async ({ issue, attachment, max_inline_size, mode = "file", save_dir }, _extra) => {
        const missing = ensureConfig();
        if (missing.length) {
            return { content: asTextContent({ error: "Konfiguration unvollständig", missing }), isError: true };
        }
        const base = EC_CLOUD_BASE_URL.replace(/\/+$/, "");
        const target = `${base}/openissues/v1/issues/${issue}/attachments/${attachment}`;
        try {
            const res = await fetch(target, {
                headers: {
                    Authorization: buildBasicAuth(),
                    Accept: "*/*",
                    lang: EC_LANG,
                },
                signal: _extra.signal,
            });
            if (!res.ok) {
                let api = null;
                try {
                    api = await res.clone().json();
                }
                catch { }
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
            const mime = res.headers.get("content-type") ?? "application/octet-stream";
            const cd = res.headers.get("content-disposition") ?? "";
            const sizeHeader = res.headers.get("content-length");
            const sizeFromHeader = sizeHeader ? Number(sizeHeader) : undefined;
            let fileName;
            {
                const m = /filename\*?=(?:UTF-8'')?("?)([^";]+)\1/i.exec(cd);
                if (m)
                    fileName = decodeURIComponent(m[2]);
            }
            if (!fileName) {
                // Fallback-Dateiname
                const ext = mime.split("/")[1]?.split(";")[0] ?? "bin";
                fileName = `issue_${issue}_att_${attachment}.${ext}`;
            }
            // --- Modus "uri": nur Link zurückgeben
            if (mode === "uri") {
                return {
                    content: asTextContent({
                        mode,
                        url: target,
                        file_name: fileName,
                        mimeType: mime,
                        size_bytes: sizeFromHeader ?? null,
                        note: "Nur Link ausgegeben (kein Blob, keine Datei gespeichert).",
                    }),
                };
            }
            // Datei laden
            const buf = Buffer.from(await res.arrayBuffer());
            // --- Modus "inline": data:-URI zurückgeben (ohne window.fs)
            if (mode === "inline") {
                const limit = max_inline_size ?? 10 * 1024 * 1024;
                if (buf.length > limit) {
                    return {
                        content: asTextContent({
                            error: "Zu groß für inline",
                            size_bytes: buf.length,
                            limit,
                            hint: "Nutze mode='file' oder mode='uri'.",
                        }),
                        isError: true,
                    };
                }
                const b64 = buf.toString("base64");
                const dataUri = `data:${mime};base64,${b64}`;
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({ mode, file_name: fileName, mimeType: mime, size_bytes: buf.length }, null, 2),
                        },
                        {
                            type: "resource",
                            resource: {
                                uri: dataUri,
                                mimeType: mime,
                                text: fileName,
                            },
                        },
                    ],
                };
            }
            // --- Default: "file" → lokal speichern und Pfad zurückgeben
            const os = await import("node:os");
            const path = await import("node:path");
            const fs = await import("node:fs/promises");
            const safe = fileName.replace(/[\\/:*?"<>|]/g, "_");
            const dir = save_dir && save_dir.trim().length ? save_dir : path.join(os.tmpdir(), "mcp-eqc");
            await fs.mkdir(dir, { recursive: true });
            const fullPath = path.join(dir, safe);
            await fs.writeFile(fullPath, buf);
            return {
                content: asTextContent({
                    mode: "file",
                    saved_to: fullPath,
                    file_name: fileName,
                    mimeType: mime,
                    size_bytes: buf.length,
                    note: "Datei wurde lokal vom MCP-Server gespeichert. In Claude kann der Pfad manuell geöffnet werden.",
                }),
            };
        }
        catch (e) {
            return { content: asTextContent({ error: "Download-Fehler", message: String(e), url: target }), isError: true };
        }
    });
    // Tool 6: Diskussionseinträge eines Issues laden
    server.registerTool("ec_issue_discussion", {
        title: "EquipmentCloud: Issue-Diskussion laden",
        description: "Lädt die Diskussionseinträge eines Issues über /openissues/v1/issues/:issue/discussion.",
        inputSchema: {
            issue: z.number().int().positive().describe("Issue-ID (ident), z. B. 55"),
            // optional: welches Textfeld bevorzugen (nur zur Info im Output)
            prefer: z
                .enum(["comment_value", "comment_value_simple_html", "comment_value_complete"])
                .optional()
                .describe("Bevorzugtes Textfeld (nur Hinweis im Output)"),
            // optional: Anzahl Einträge begrenzen (clientseitig)
            limit: z.number().int().positive().max(500).optional().describe("Max. Anzahl zurückgegebener Einträge"),
        },
    }, async ({ issue, prefer = "comment_value", limit }, _extra) => {
        const missing = ensureConfig();
        if (missing.length) {
            return {
                content: asTextContent({ error: "Konfiguration unvollständig", missing }),
                isError: true,
            };
        }
        const base = EC_CLOUD_BASE_URL.replace(/\/+$/, "");
        const url = `${base}/openissues/v1/issues/${issue}/discussion`;
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
        const items = Array.isArray(r.data?.items) ? r.data.items : [];
        // schlanke Projektion + optional limit
        const mapped = items.map((d) => ({
            ident: d?.ident,
            visibility_level: d?.visibility_level ?? null,
            app_user: d?.app_user ?? null,
            created_on: d?.created_on ?? null,
            updated_on: d?.updated_on ?? null,
            // alle drei Varianten mitgeben, damit der Client (Claude) wählen kann:
            comment_value: d?.comment_value ?? null,
            comment_value_simple_html: d?.comment_value_simple_html ?? null,
            comment_value_complete: d?.comment_value_complete ?? null,
            attachments_idents: Array.isArray(d?.attachments_idents) ? d.attachments_idents : [],
        }));
        const out = typeof limit === "number" ? mapped.slice(0, limit) : mapped;
        return {
            content: asTextContent({
                issue,
                prefer, // Info, welches Feld der Aufrufer bevorzugt
                total_found: mapped.length,
                returned: out.length,
                items: out,
                note: "Felder: 'comment_value' (Plain), 'comment_value_simple_html' (~3900 Zeichen, HTML), 'comment_value_complete' (vollständig, HTML).",
            }),
        };
    });
    // Tool 7: Historie eines Issues laden
    server.registerTool("ec_issue_history", {
        title: "EquipmentCloud: Issue-Historie laden",
        description: "Lädt die Änderungshistorie eines Issues über /openissues/v1/issues/:issue/history.",
        inputSchema: {
            issue: z.number().int().positive().describe("Issue-ID (ident), z. B. 55"),
            // optional: nur bestimmte Spaltennamen zurückgeben (serverseitig liefert alles; wir filtern clientseitig)
            columns: z
                .array(z.enum([
                "ATTACHMENT",
                "CATEGORY",
                "COMPLETENESS",
                "CURRENT_WORK",
                "DESCRIPTION",
                "DETECTED_ON",
                "DOMAIN_ATTRIBUTE_LEVEL",
                "DUE_DATE",
                "LINK",
                "MAPPED_TO",
                "PLANNED_WORK",
                "PRIORITY",
                "RESPONSIBLE",
                "STATUS",
                "TITLE",
            ]))
                .optional()
                .describe("Optional: Liste von Feldnamen zum Filtern, z. B. [\"STATUS\",\"PRIORITY\"]"),
            // optional: Anzahl Einträge begrenzen (nach Sortierung)
            limit: z.number().int().positive().max(1000).optional().describe("Max. Einträge (Default: alle)"),
            // optional: Sortierung; Default: updated_on DESC
            sort: z
                .enum(["updated_on_asc", "updated_on_desc"])
                .optional()
                .describe("Sortierung der Ergebnisse (Default: updated_on_desc)"),
        },
    }, async ({ issue, columns, limit, sort = "updated_on_desc" }, _extra) => {
        const missing = ensureConfig();
        if (missing.length) {
            return { content: asTextContent({ error: "Konfiguration unvollständig", missing }), isError: true };
        }
        const base = EC_CLOUD_BASE_URL.replace(/\/+$/, "");
        const url = `${base}/openissues/v1/issues/${issue}/history`;
        const r = await fetchJson(url, { signal: _extra.signal });
        if (!r.ok) {
            return {
                content: asTextContent({ error: "HTTP", status: r.status, statusText: r.statusText, api: r.data }),
                isError: true,
            };
        }
        const items = Array.isArray(r.data?.items) ? r.data.items : [];
        // optional: Spalten-Filter anwenden
        let filtered = Array.isArray(columns) && columns.length
            ? items.filter((h) => columns.includes(h?.column_name))
            : items;
        // Sortierung
        filtered = filtered.sort((a, b) => {
            const ta = Date.parse(a?.updated_on ?? 0);
            const tb = Date.parse(b?.updated_on ?? 0);
            return sort === "updated_on_asc" ? ta - tb : tb - ta;
        });
        // optionale Begrenzung
        const out = typeof limit === "number" ? filtered.slice(0, limit) : filtered;
        // schlanke Projektion der Felder, wie in der Doku
        const mapped = out.map((h) => ({
            updated_on: h?.updated_on ?? null,
            updated_by: h?.updated_by ?? null,
            update_substantiation: h?.update_substantiation ?? null,
            column_name: h?.column_name ?? null,
            old_value: h?.old_value ?? null,
            new_value: h?.new_value ?? null,
        }));
        return {
            content: asTextContent({
                issue,
                total_found: items.length,
                filtered_count: filtered.length,
                returned: mapped.length,
                sort,
                columns: columns ?? null,
                items: mapped,
            }),
        };
    });
}
