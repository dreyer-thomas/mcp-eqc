# MCP Extension: EquipmentCloud Tools

Diese Erweiterung stellt **Model Context Protocol (MCP)**-Tools für die [EquipmentCloud®](https://eqcloud.kontron-ais.com) bereit.  
Sie kann mit **Claude Desktop**, dem **Inspector** oder anderen MCP-Hosts verwendet werden.

---

## Features

- **Open Issues**
  - `ec_open_issues` – offene Issues einer Hierarchie abrufen
  - `ec_open_issues_follow` – Pagination-Links aus `controls` folgen
  - `ec_issue_detail` – Detailinformationen zu einem Issue
  - `ec_issue_discussion` – Diskussions­einträge zu einem Issue
  - `ec_issue_history` – Änderungs­historie zu einem Issue
  - `ec_issue_attachments` – Liste von Attachments zu einem Issue
  - `ec_issue_attachment_get` – ein Attachment herunterladen (verschiedene Modi)

- **EquipmentHub**
  - `ec_hierarchy_list` – Hierarchien auflisten / nach Name suchen
  - `ec_things_list` – Things auflisten / nach Name suchen

---

## Installation & Build

### Voraussetzungen
- Node.js ≥ 18
- npm (oder yarn/pnpm)
- TypeScript
- Install dxt packager using: 
```bash
npm install -g @anthropic/dxt
```

### Weitere Schritte
```bash
# 1. Abhängigkeiten installieren
npm install

# 2. TypeScript build
npm run build

# 3. Binary Package for Claude
npm run pack

# 4. Install Package in Claude Desktop App as Extension (Settings - Extensions)