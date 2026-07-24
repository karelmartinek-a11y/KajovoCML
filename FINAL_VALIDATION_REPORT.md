# Finální validační report – Dashboard revize 2

Datum kontroly: 2026-07-24

## Opravený blocker

- Dopředné migrace byly ve vstupním ZIPu očíslovány `001, 002, 003, 004, 006`.
- Migrační runner `validateMigrationNames()` vyžaduje nepřerušenou číselnou řadu, takže databázový deploy by skončil chybou `non_contiguous_migration_sequence:expected_005` ještě před provedením SQL.
- Soubor byl přejmenován na `005_dashboard_identity_delete_guards.sql`.
- Přidán regresní test `apps/server/src/cli/migrate.test.ts`, který ověřuje kanonickou řadu, mezeru i neplatný název migrace.

## Provedené kontroly s výsledkem PASS

- Dashboard capability parity: 24 capabilities / 15 routes.
- Onboarding katalog – kontrola čisté regenerace.
- Repository component katalog – kontrola čisté regenerace.
- Repository component change classifier.
- Repository component workflow contract checks.
- Repository component deploy script checks.
- TypeScript/TSX syntax všech 185 zdrojových souborů.
- JavaScript/MJS syntax všech skriptů.
- JSON parse všech JSON souborů.
- Bash syntax všech shell skriptů.
- CSS parse administračního UI.
- Existence všech relativních importů.
- Souvislá řada databázových migrací `001` až `005`.

Logy jsou v `docs/evidence/final-validation/` a `docs/evidence/local-validation/`.

## Co nelze v tomto běhovém prostředí pravdivě označit jako PASS

- Instalace `pnpm@11.7.0` a balíčků: prostředí nemá funkční DNS/odchozí přístup k `registry.npmjs.org` (`EAI_AGAIN`).
- Plný `pnpm ci`, Vitest, Vite build a plný TypeScript typecheck: závislosti nebylo možné stáhnout.
- PostgreSQL integrační a migrační běh: v prostředí není PostgreSQL ani dostupný systémový repozitář pro jeho instalaci.
- GitHub Actions: GitHub konektor umožnil čtení, ale zápis nové větve byl uživatelským schvalovacím krokem odmítnut; zápis nebyl obcházen.
- Produkční deploy, OWNER session, post-deploy testy a produkční screenshot evidence.

## GitHub synchronizace

Kanonický `main` repozitáře `karelmartinek-a11y/KajovoCML` je proti původnímu základu dokumentu o 14 commitů napřed. Tento ZIP zůstává pokračováním uživatelem vráceného ZIPu. Před merge je nutné změny rebasovat na aktuální `main` a nechat projít standardní GitHub CI; nesmí se přepsat novější runtime-egress a repository-component opravy.

## Závěr

Zdrojový balík prošel úplným dependency-free kontrolním kolem a nalezený databázový release blocker byl opraven. Bez sítě, PostgreSQL, schváleného GitHub zápisu a produkčních přístupů nelze poctivě tvrdit úplné CI/deploy dokončení. ZIP proto obsahuje kód, regresní test a reprodukovatelné logy, ale nikoli falešné označení produkčního stavu jako hotového.
