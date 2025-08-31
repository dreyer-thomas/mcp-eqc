// src/tools/equipmentHub.ts
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { EC_CLOUD_BASE_URL, ensureConfig } from "../config.js";
import { fetchJson, asTextContent } from "../http.js";

type HierItem = {
  id: string;
  name: string;
  parent?: string;
  parent_id?: string;
  path?: string;
  xsize?: number;
  ysize?: number;
  updated_by?: string;
  updated_on?: string;
};

export function registerEquipmentHubTools(server: McpServer) {
  // Tool A: Alle Hierarchien (raw) abrufen
  server.registerTool(
    "ec_hierarchies_list",
    {
      title: "EquipmentCloud: Hierarchien (EquipmentHub) abrufen",
      description:
        "Liest alle Hierarchien aus /equipmenthub/v1/hierarchies. Achtung: Kann viele Einträge liefern.",
      inputSchema: {}, // keine Parameter laut Doku
    },
    async (_args, _extra) => {
      const missing = ensureConfig();
      if (missing.length) {
        return { content: asTextContent({ error: "Konfiguration unvollständig", missing }), isError: true };
      }
      const base = EC_CLOUD_BASE_URL.replace(/\/+$/, "");
      const url = `${base}/equipmenthub/v1/hierarchies`;

      const r = await fetchJson(url, { signal: _extra.signal });
      if (!r.ok) {
        return {
          content: asTextContent({ error: "HTTP", status: r.status, statusText: r.statusText, api: r.data }),
          isError: true,
        };
      }
      const items: HierItem[] = r.data?.items ?? [];
      return { content: asTextContent({ count: items.length, items }) };
    }
  );

  // Tool B: Hierarchie „Name → ID“ auflösen (exakte/teilweise Übereinstimmung)
  server.registerTool(
    "ec_hierarchy_resolve",
    {
      title: "EquipmentCloud: Hierarchie-Namen auflösen",
      description:
        "Sucht in /equipmenthub/v1/hierarchies nach Namen und gibt passende IDs zurück. Unterstützt exakte und partielle Matches.",
      inputSchema: {
        name: z.string().min(1).describe("Name oder Teil des Namens, z. B. 'Germany'"),
        match_mode: z.enum(["exact", "icontains"]).optional().describe("exact = exakte Übereinstimmung; icontains = Teilstring (case-insensitive). Standard: exact"),
        limit: z.number().int().positive().max(200).optional().describe("Max. Anzahl Ergebnisse"),
      },
    },
    async ({ name, match_mode = "exact", limit = 50 }, _extra) => {
      const missing = ensureConfig();
      if (missing.length) {
        return { content: asTextContent({ error: "Konfiguration unvollständig", missing }), isError: true };
      }
      const base = EC_CLOUD_BASE_URL.replace(/\/+$/, "");
      const url = `${base}/equipmenthub/v1/hierarchies`;

      const r = await fetchJson(url, { signal: _extra.signal });
      if (!r.ok) {
        return {
          content: asTextContent({ error: "HTTP", status: r.status, statusText: r.statusText, api: r.data }),
          isError: true,
        };
      }

      const items: HierItem[] = Array.isArray(r.data?.items) ? r.data.items : [];
      const needle = name.trim();
      const results = items.filter((h) => {
        if (!h?.name) return false;
        if (match_mode === "exact") return h.name === needle;
        return h.name.toLowerCase().includes(needle.toLowerCase());
      });

      const out = results.slice(0, limit).map((h) => ({
        id: h.id,
        name: h.name,
        path: h.path,
        parent: h.parent,
        parent_id: h.parent_id,
      }));

      return {
        content: asTextContent({
          query: { name, match_mode, limit },
          total_found: results.length,
          returned: out.length,
          matches: out,
        }),
      };
    }
  );
}
