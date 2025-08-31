// src/tools/things.ts
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { EC_CLOUD_BASE_URL, ensureConfig } from "../config.js";
import { fetchJson, asTextContent } from "../http.js";

// Minimaltyp für die Felder, die wir brauchen
type ThingItem = {
  id: string;
  name: string;
  hierarchy?: string;
  hierarchy_id?: string;
  equipment_type?: string;
  equipment_type_id?: string;
  updated_on?: string;
  // ... (weitere Felder vorhanden, werden aber nicht strikt typisiert)
};

// robuste Normalisierung (wie bei Hierarchien empfohlen)
const normalize = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[\u00A0]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

const containsNorm = (hay: string, needle: string) =>
  normalize(hay).includes(normalize(needle));

const startsWithNorm = (hay: string, needle: string) =>
  normalize(hay).startsWith(normalize(needle));

export function registerThingsTools(server: McpServer) {
  // A) Alle Things abrufen
  server.registerTool(
    "ec_things_list",
    {
      title: "EquipmentCloud: Things (EquipmentHub) abrufen",
      description: "Liest alle Things aus /equipmenthub/v1/things. Achtung: Kann viele Einträge liefern.",
      inputSchema: {}, // laut Doku keine Query-Parameter
    },
    async (_args, _extra) => {
      const missing = ensureConfig();
      if (missing.length) {
        return { content: asTextContent({ error: "Konfiguration unvollständig", missing }), isError: true };
      }
      const base = EC_CLOUD_BASE_URL.replace(/\/+$/, "");
      const url = `${base}/equipmenthub/v1/things`;

      const r = await fetchJson(url, { signal: _extra.signal });
      if (!r.ok) {
        return {
          content: asTextContent({ error: "HTTP", status: r.status, statusText: r.statusText, api: r.data }),
          isError: true,
        };
      }

      const items: ThingItem[] = Array.isArray(r.data?.items) ? r.data.items : [];
      // um die Ausgabe klein zu halten, nur Kernfelder zeigen
      const out = items.map(t => ({
        id: t.id,
        name: t.name,
        hierarchy: t.hierarchy,
        hierarchy_id: t.hierarchy_id,
        equipment_type: t.equipment_type,
        equipment_type_id: t.equipment_type_id,
        updated_on: t.updated_on,
      }));

      return { content: asTextContent({ count: items.length, items: out }) };
    }
  );

  // B) Thing „Name → ID“ auflösen (exact / icontains / startswith)
  server.registerTool(
    "ec_thing_resolve",
    {
      title: "EquipmentCloud: Thing-Namen auflösen",
      description:
        "Sucht in /equipmenthub/v1/things nach Namen und gibt passende IDs zurück. Unterstützt exakte und partielle Matches.",
      inputSchema: {
        name: z.string().min(1).describe("Name oder Teil des Namens, z. B. 'thing1' oder 'KATEK'"),
        match_mode: z
          .enum(["exact", "icontains", "startswith"])
          .optional()
          .describe("exact = exakte Übereinstimmung; icontains = Teilstring (Default); startswith = beginnt mit"),
        limit: z.number().int().positive().max(200).optional().describe("Max. Anzahl Ergebnisse (Default 50)"),
        // optionaler Zusatzfilter: nach Hierarchie-Name oder -ID (clientseitig)
        hierarchy: z.string().optional().describe("Optionaler Filter: Hierarchie-Name oder -ID (clientseitig)"),
      },
    },
    async ({ name, match_mode = "icontains", limit = 50, hierarchy }, _extra) => {
      const missing = ensureConfig();
      if (missing.length) {
        return { content: asTextContent({ error: "Konfiguration unvollständig", missing }), isError: true };
      }
      const base = EC_CLOUD_BASE_URL.replace(/\/+$/, "");
      const url = `${base}/equipmenthub/v1/things`;

      const r = await fetchJson(url, { signal: _extra.signal });
      if (!r.ok) {
        return {
          content: asTextContent({ error: "HTTP", status: r.status, statusText: r.statusText, api: r.data }),
          isError: true,
        };
      }

      const items: ThingItem[] = Array.isArray(r.data?.items) ? r.data.items : [];
      const needle = name.trim();
      const hNeedle = hierarchy?.trim();

      let results = items.filter((t) => {
        if (!t?.name) return false;

        // Name-Match
        const nameMatch =
          match_mode === "exact"
            ? normalize(t.name) === normalize(needle)
            : match_mode === "startswith"
            ? startsWithNorm(t.name, needle)
            : containsNorm(t.name, needle); // icontains

        if (!nameMatch) return false;

        // optional: Hierarchie-Filter (gegen name ODER id)
        if (hNeedle) {
          const hMatch =
            containsNorm(t.hierarchy ?? "", hNeedle) ||
            containsNorm(t.hierarchy_id ?? "", hNeedle);
          if (!hMatch) return false;
        }

        return true;
      });

      // Exakte Matches priorisieren
      const nNeedle = normalize(needle);
      results.sort((a, b) => {
        const aExact = normalize(a.name) === nNeedle ? 1 : 0;
        const bExact = normalize(b.name) === nNeedle ? 1 : 0;
        return bExact - aExact;
      });

      const out = results.slice(0, limit).map((t) => ({
        id: t.id,
        name: t.name,
        hierarchy: t.hierarchy,
        hierarchy_id: t.hierarchy_id,
        equipment_type: t.equipment_type,
        equipment_type_id: t.equipment_type_id,
      }));

      return {
        content: asTextContent({
          query: { name, match_mode, limit, hierarchy: hNeedle ?? null },
          total_found: results.length,
          returned: out.length,
          matches: out,
          note: "Vergleich ist case-insensitive und toleriert Sonderzeichen/Mehrfachspaces.",
        }),
      };
    }
  );

  // C) Komfort: Open Issues direkt per Thing-Name abrufen
  server.registerTool(
    "ec_open_issues_by_thing_name",
    {
      title: "EquipmentCloud: Open Issues per Thing-Name",
      description:
        "Sucht Thing per Name (exact/icontains/startswith) und lädt anschließend dessen Open Issues (optional mit qp/step).",
      inputSchema: {
        thing_name: z.string().min(1).describe("Name oder Teil des Namens des Things"),
        match_mode: z.enum(["exact", "icontains", "startswith"]).optional(),
        qp: z.record(z.any()).optional().describe('z.B. {"status":"1:2:3"} oder {"responsible":"USER"}'),
        step: z.number().int().positive().optional(),
        // Verhalten bei Mehrdeutigkeit
        take_first: z.boolean().optional().describe("Wenn mehrere Matches, nimm das erste (Default: true)"),
        // optionaler Hierarchie-Filter
        hierarchy: z.string().optional().describe("Optionaler Filter nach Hierarchie-Name oder -ID"),
      },
    },
    async ({ thing_name, match_mode = "icontains", qp, step, take_first = true, hierarchy }, _extra) => {
      const missing = ensureConfig();
      if (missing.length) {
        return { content: asTextContent({ error: "Konfiguration unvollständig", missing }), isError: true };
      }

      // 1) Things holen
      const base = EC_CLOUD_BASE_URL.replace(/\/+$/, "");
      const thingsUrl = `${base}/equipmenthub/v1/things`;
      const tr = await fetchJson(thingsUrl, { signal: _extra.signal });
      if (!tr.ok) {
        return {
          content: asTextContent({ error: "HTTP (things)", status: tr.status, statusText: tr.statusText, api: tr.data }),
          isError: true,
        };
      }
      const items: ThingItem[] = Array.isArray(tr.data?.items) ? tr.data.items : [];

      // 2) matchen wie im Resolver
      const needle = thing_name.trim();
      const hNeedle = hierarchy?.trim();
      let matches = items.filter((t) => {
        if (!t?.name) return false;
        const nameMatch =
          match_mode === "exact"
            ? normalize(t.name) === normalize(needle)
            : match_mode === "startswith"
            ? startsWithNorm(t.name, needle)
            : containsNorm(t.name, needle);
        if (!nameMatch) return false;

        if (hNeedle) {
          const hMatch =
            containsNorm(t.hierarchy ?? "", hNeedle) ||
            containsNorm(t.hierarchy_id ?? "", hNeedle);
          if (!hMatch) return false;
        }
        return true;
      });

      // sortiere exakte Treffer nach oben
      const nNeedle = normalize(needle);
      matches.sort((a, b) => {
        const aExact = normalize(a.name) === nNeedle ? 1 : 0;
        const bExact = normalize(b.name) === nNeedle ? 1 : 0;
        return bExact - aExact;
      });

      if (matches.length === 0) {
        return { content: asTextContent({ error: "Kein Thing gefunden", query: { thing_name, match_mode, hierarchy: hNeedle ?? null } }), isError: true };
      }
      if (!take_first && matches.length > 1) {
        return { content: asTextContent({ warning: "Mehrdeutig", count: matches.length, candidates: matches.slice(0, 10) }) };
      }

      const chosen = matches[0];
      const issuesUrl = new URL(`${base}/openissues/v1/things/${encodeURIComponent(chosen.id)}/issues`);
      if (qp) issuesUrl.searchParams.set("qp", JSON.stringify(qp));
      if (step) issuesUrl.searchParams.set("step", String(step));

      // 3) Issues laden
      const ir = await fetchJson(issuesUrl.toString(), { signal: _extra.signal });
      if (!ir.ok) {
        return {
          content: asTextContent({ error: "HTTP (open issues)", status: ir.status, statusText: ir.statusText, api: ir.data }),
          isError: true,
        };
      }

      return {
        content: asTextContent({
          thing: { id: chosen.id, name: chosen.name, hierarchy: chosen.hierarchy, hierarchy_id: chosen.hierarchy_id },
          items: ir.data?.items ?? [],
          controls: ir.data?.controls ?? [],
        }),
      };
    }
  );
}
