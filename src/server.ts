// src/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerOpenIssuesTools } from "./tools/open-Issues.js";
import { registerEquipmentHubTools } from "./tools/equipment-Hub.js";
import { registerThingsTools } from "./tools/things.js";

const server = new McpServer({ name: "local-tools", version: "0.2.0" });

// Tools registrieren
registerOpenIssuesTools(server);
registerEquipmentHubTools(server);
registerThingsTools(server);

// Transport verbinden
const transport = new StdioServerTransport();
await server.connect(transport);

// Nur stderr loggen (nie stdout)
console.error("[local-tools] MCP server started (OpenIssues + EquipmentHub aktiv)");
