> **HISTORICAL/SUPERSEDED (2026-08-09):** pre-internal-generation Dashboard notes. `docs/SSOT_CURRENT.md` and `docs/ARCHITECTURE.md` override lifecycle/creation statements below.

# Migrace a rollback Dashboardu

## Dopředná migrace

`004_dashboard_topology.sql` je aditivní. Vytváří tabulky vizuálních uzlů, workspace layoutu, PULSE edges, suspendací a idempotentních deregistračních requestů. Existující komponenty a nevyužité integrační tokeny bezpečně seeduje do vizuálních uzlů.

## Nasazení

1. Záloha databáze a ověření volného místa.
2. Nasazení serveru a UI ze stejného commitu.
3. `corepack pnpm run db:migrate`.
4. Ověření počtu uzlů vůči aktivním komponentám a předregistračním tokenům.
5. OWNER smoke test topologie, layoutu, Secret grantu, PULSE grant/revoke a SSE.

## Rollback

Aplikační rollback na předchozí build je možný bez okamžitého mazání nových tabulek; starší build je ignoruje. Databázové DROP operace nejsou automatizovány, protože by odstranily auditovatelný stav. Případné fyzické odstranění tabulek musí být samostatná schválená forward migrace po exportu důkazů.
