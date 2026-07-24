# Kompatibilita 2026.07.24-dashboard.1

| Oblast | Stav | Poznámka |
|---|---|---|
| Manifest 2026.07.22-compliance.1 | PASS | Beze změny, stále přijímaný. |
| Onboarding Catalog 1.1 | PASS | Historický artefakt zůstává neměnný. |
| Onboarding Catalog 1.2 | PASS | Přidává Dashboard lifecycle a migrační metadata. |
| Aktivní komponenty | MIGRATION REQUIRED | Aplikovat migrace 004–007; data se nemažou. |
| Existující component_permission | PASS | Zůstává účinné; nejednoznačné portové mapování nesmí předstírat kompatibilitu. |
| Access tokeny | PASS | Scope a bearer obsah se nemění tichým SQL updatem. |
| Secret granty | PASS | Principal-based granty a onboarding transfer zůstávají autoritativní. |
| Starší MCP servery | PASS | PULSE a MCP protokol se nemění. |
| Rollback aplikace | PASS | Lze vrátit předchozí aplikaci při ponechání aditivních tabulek; mutace Dashboardu před rollbackem zastavit. |
