# DELIVERY SUMMARY — SSOT / implementation prompt update

## Scope

Forenzní průchod ZIPu `Archiv(2).zip` a pracovního vlákna; bez změny executable source code. Vstupní ZIP obsahoval repozitář přímo v rootu archivu (bez jednoho obalového kořenového adresáře); pracovní kořen byl proto určen na root archivu. Výstupem je nový normativní SSOT a technický prompt pro následný zip-in/zip-out implementační běh.

## Forenzní nálezy ze zdrojového kódu

- Kanonický dokument byl `docs/SSOT_CURRENT.md`, ale jeho stav byl zastaralý: popisoval baseline jen do OWNER Dashboardu a neobsahoval migrace 006–008 ani novější component control/watchdog/E2E stav.
- Repozitář je Node/TypeScript/pnpm monorepo se serverem Fastify, React OWNER UI a PostgreSQL.
- Skutečný runtime obsahuje generic `component`/`principal` model, permission systém, component control queue, heartbeat/state, monitoring/watchdog, E2E/readiness evidence, Secret Manager, Dashboard topology a auditní stream.
- Aktuální onboarding je stále navržen jako externí handoff: integration token, source/revision upload, GitHub PR/CI, OCI/GHCR, readiness a následný access-token handoff.
- `components/mail-vectorizace` potvrzuje současný in-repository component vzor, ale jeho manifest je svázaný s GitHub workflow/GHCR a používá UDS runtime transport.
- Admin UI obsahuje samostatné řízení komponent, monitoring, identit/tokenů, secrets, oprávnění a audit; komponenty lze enable/disable a lifecycle řídit.
- Secret Manager podporuje create/rotate/delete/status/restore/grants/revoke/reveal a runtime resolve.
- Zdroj obsahuje migrace `001` až `008`; `006` opravuje durable component-control queue default, `007` watchdog/policy epoch interakci a `008` retenci immutable E2E evidence.

## Owner invariants převzaté z pracovního vlákna

1. KajovoCML je jeden uzavřený OWNER svět; cílem není výroba agentů pro třetí strany.
2. Nové schopnosti vznikají interně z lidského zadání, nikoli primárně externím onboarding handoffem.
3. AI je překladač záměru a autonomní systémový integrátor; nesmí přepisovat CML invarianty.
4. Každý výsledek musí být normální plně řízený CML prvek.
5. CML standard je povinný; mimo něj se prvek nesmí aktivovat.
6. Nepřidávat nový paralelní security/secret/monitoring/audit control plane.
7. UI má být jedna jednoduchá A4/textová plocha; technické detaily si řeší systém.
8. Systém se doptává jen na skutečně chybějící laické údaje/credentials.
9. AI má umět web research, Chromium/browser konfiguraci, technickou integraci, reálné ověření a opravu ve smyčce.
10. MCP server je pro OWNERa samostatná funkce/schopnost a musí zůstat samostatně ovladatelným serverovým prvkem.
11. Nově generovaný prvek má vlastní CML identitu, monitoring, heartbeat/state, audit, enable/disable, oprávnění a Secret grants.
12. CML-facing hranice generovaných prvků má být samostatná HTTPS identita/hostname.
13. Externí API/webhooky/služby jsou legitimní; nejsou totéž jako externí onboarding.
14. AI agent se používá jen tam, kde je skutečně potřeba AI reasoning; deterministic funkce mají zůstat deterministic.
15. Runtime secrets se trvale používají přes existující Secret Manager.
16. OWNER smí předat credential plaintextem; takový vstup nesmí být blokován novým security workflow.
17. Plaintext v trusted OWNER dialogu/logu není completion gate; transparentní redakce nesmí komplikovat tok.
18. Interní onboarding má odstranit produktový lifecycle integration-token → access-token handoff; výsledný prvek má jednu runtime identitu/token spravovanou CML.
19. GitHub/GitHub Actions/PR/externí CI/CD/GHCR nesmí být závislostí generation/deployment toku ani completion gate.
20. Zdroj a pracovní kopie mohou být na serveru; použít jednoduchý lokální snapshot/worktree/rollback.
21. Vlastník akceptuje omezené riziko dočasného rozbití webu; priorita je jednoduchost, nikoli další distribuovaná deployment infrastruktura.
22. Generovaný prvek však nesmí běžnou chybou odebrat možnost CML jej vypnout, diagnostikovat nebo nahradit.
23. Zdrojový kód je faktický zdroj pravdy; nový SSOT je normativní autorita cílového stavu.
24. Voice chat je budoucí front-end stejné generation funkce, není součást první implementační fáze.
25. Žádné mocky, placeholdery, demo náhrady nebo redukce scope vydávané za hotový program.

## Změněné / přidané soubory

- `docs/SSOT_CURRENT.md` — kompletně aktualizovaný cílový SSOT.
- `ZIP_IN_OUT_IMPLEMENTATION_PROMPT.md` — technický implementační prompt pro následný ChatGPT zip-in/zip-out běh.
- `DELIVERY_SUMMARY_SSOT_2026-08-09.md` — tento report.

## Ověření

Spuštěno z kořene repozitáře:

```text
node --version
node scripts/check-capability-parity.mjs
node scripts/generate-mcp-onboarding-catalog.mjs --check
node scripts/generate-repository-component-catalog.mjs --check
node scripts/validate-repository-components.mjs
```

Výsledek:

- Node v pracovním prostředí: `v22.16.0`; repozitář deklaruje Node >=24.
- `pnpm` není v pracovním prostředí dostupný, proto nebyl spuštěn full pnpm build/test.
- Dashboard capability parity: PASS (`24 capabilities`, `15 routes`).
- Onboarding catalog check: PASS.
- Repository component catalog check: PASS.
- Repository component validation: PASS.

Protože tento běh měnil pouze Markdown zadání/report a žádný executable source code, nebyl prováděn full build/CI. Následný implementační prompt naopak vyžaduje lokální build/typecheck/test a skutečné integrační ověření po změně programu.

## Známé implementační konflikty, které má odstranit následný běh

- `AGENTS.md` stále na mnoha místech vyžaduje GitHub CI/deploy a zakazuje owner-trusted plaintext secret chování.
- `README.md`, onboarding katalogy, worker, GitHub/OCI moduly a repository-component deploy flow stále popisují starý externí onboarding.
- současný `components/mail-vectorizace` manifest používá UDS/GHCR workflow, což neodpovídá novému target SSOT pro generované prvky;
- UI stále obsahuje integration-token handoff flow místo interní generation stránky.

Tyto konflikty jsou záměrně ponechány do následného implementačního zip-in/zip-out běhu, protože aktuální úkol byl nejprve uzavřít cílový SSOT a připravit přesný implementační prompt.
