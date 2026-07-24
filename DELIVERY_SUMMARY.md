# DELIVERY SUMMARY — KájovoCML Dashboard Revize 2, propracované pokračování

## 1. Vstupy

- Repo ZIP: `KajovoCML-dashboard-revize2-updated(1).zip`
- Zadání: pokračovat až k propracované implementaci aktivního Dashboardu, zejména dokončit pravdivé animace, runtime lifecycle, externí systémy, kontraktní detail, release stopu, migrace, testy a dokumentaci.
- Git metadata: vstupní ZIP neobsahoval `.git`; výstup je proto kompletní nový ZIP, nikoli commit.

## 2. Forenzní průchod

Přečteny a respektovány zejména:

- `AGENTS.md` a `components/AGENTS.md`;
- `README.md`, `docs/SSOT_CURRENT.md`, `docs/PROJECT_PHASE.md`;
- stávající Dashboard backend, UI, migrace, onboarding, Secret Manager, komponentová autorizace a release skripty;
- předchozí `DELIVERY_SUMMARY.md` a evidence dokumentace.

Toolchain: pnpm monorepo, Node 24+, TypeScript, React/Vite, Fastify, PostgreSQL, Vitest a shellové release/deployment kontroly.

## 3. Hlavní dokončené změny

### Autoritativní Dashboard a databáze

- Doplněny migrace `005_dashboard_operational_views.sql`, `006_dashboard_identity_delete_guards.sql` a `007_component_pulse_idempotency.sql`.
- Pozice externích boundary uzlů se ukládají v PostgreSQL stejně jako pozice komponent.
- Delete guardy bezpečně uzavírají visual node při fyzickém smazání tokenu, komponenty nebo principalu.
- Historický integrační token po handoffu neodstraní registrovaný prvek.
- Migrační upgrade test nyní kontroluje všech sedm dopředných migrací a jejich checksumy.

### Pravdivý PULSE runtime lifecycle

- Opraveno směrové mapování OUTGOING/INCOMING PULSE evidence.
- Outgoing PULSE nyní vytváří persistovaný `STARTED` operation lease před skutečným doručením.
- Úspěch nebo chyba dokončí stejný lease a vytvoří konečnou operation event evidence.
- Chyba nastaví pravdivý provozní/monitorovací stav komponenty.
- Policy epoch se invaliduje také při odebrání posledního odvozeného oprávnění.
- Retry a souběh stejného PULSE correlation ID jsou databázově idempotentní: nevznikne druhý lease ani duplicitní operation event; dokončený výsledek se bezpečně replayuje a probíhající duplicita skončí konfliktem.

### Živý stream a propracované animace

- SSE stream používá persistované `component_operation_lease`, `component_operation_event` a `component_external_gateway_call`.
- Podporuje reconnect, compound replay cursor, deterministické řazení, heartbeat a ochranu proti překryvu souběžných poll cyklů.
- Zobrazuje samostatné fáze `STARTED`, `COMPLETED`, `FAILED` a `BLOCKED`.
- Více skutečných operací může být animováno souběžně.
- Zahájení a dokončení stejné operace se párují podle correlation ID; finální stav správně ukončí běžící impuls.
- Běžící impuls má směr, cílový výsledek, úspěch/chybu a současný proces uvnitř uzlu.
- Při odpojení SSE se animace zastaví a UI výslovně zobrazuje poslední potvrzený stav.
- `prefers-reduced-motion` zachová směr a výsledek statickým symbolem bez pohybu.

### Externí systémy

- Externí cíle jsou skutečné boundary nodes s uloženou pozicí.
- Zobrazují status, circuit breaker, autorizaci, route/scope, statistiky, blokovaná a selhaná volání.
- Externí runtime komunikace používá stejný STARTED/FINAL model a korelovanou timeline.

### Porty, kompatibilita a ovládání plátna

- Každý vstupní i výstupní port má samostatný autoritativní detail:
  - aktivní revizi a canonical digest;
  - protokol, transport a autentizační režim;
  - route a scope;
  - request/response JSON Schema;
  - úplný uložený kontrakt bez domýšlení chybějících popisů.
- Kompatibilita zůstává na portech, účinná autorizace na vlákně a runtime výsledek v krátkodobé provozní vrstvě.
- Doplněno pan plátna prostředním tlačítkem nebo `Alt + tažení`, zoom, uložený layout a přístupná seznamová alternativa.
- Keyboard/touch cesta a oddělené grant/revoke/disconnect operace zůstávají zachované.
- Při tažení odchozího konektoru se kreslí skutečný náhled kabelu; cílová zásuvka dostává asynchronní serverové compatibility preview se stavy loading/compatible/incompatible/forbidden.
- Browserové `alert`, `confirm` a `prompt` byly z Dashboardu odstraněny. Operace používají přístupné dialogy s dopadem, důvodem, klávesovou obsluhou a autoritativním výsledkem.

### Release, katalog a důkazy

- Nová aplikační release: `2026.07.24-dashboard.1`.
- Nový onboardingový katalog: `1.2`.
- Historický manifest a PULSE baseline `2026.07.22-compliance.1` zůstaly nezměněné.
- Release build nyní přibaluje evidence manifest a Dashboard akceptační/motion dokumentaci.
- Doplněn strojový i lidský evidence manifest se 49 přesnými produkčními scénáři.
- Produkční evidence je pravdivě označena `PENDING_DEPLOYMENT`, nikoli simulována.

## 4. Klíčové upravené soubory

- `apps/server/src/domain/component.ts` — PULSE STARTED/final lifecycle a směrová validace.
- `apps/server/src/http/component-routes.ts` — skutečné outgoing doručení svázané s operation lease.
- `apps/server/src/domain/dashboard-topology.ts` — externí uzly, události, layout, permissions a runtime read model.
- `apps/server/src/domain/dashboard-event-stream.ts` — deterministické řazení a replay cursor.
- `apps/server/src/http/dashboard-routes.ts` — SSE replay, heartbeat a souběhová ochrana.
- `apps/server/src/migrations/005_dashboard_operational_views.sql`.
- `apps/server/src/migrations/006_dashboard_identity_delete_guards.sql`.
- `apps/server/src/migrations/007_component_pulse_idempotency.sql`.
- `apps/admin-ui/src/dashboard-page.tsx` — propracované animace, tažený PULSE náhled, přístupné akční dialogy, externí uzly, port detail, pan/zoom a reduced motion.
- `apps/admin-ui/src/styles.css` — runtime, výsledkové, externí a přístupnostní stavy.
- cílené `*.test.ts` a `*.test.tsx` — runtime ordering, směr PULSE, port detail, korelační ukončení animace a externí uzel.
- `docs/onboarding-catalogs/onboarding-1.2.json` a `docs/releases/2026.07.24-dashboard.1/`.
- `docs/dashboard/evidence-manifest.json`, `evidence-manifest.md` a `final-implementation-report.md`.

## 5. Skutečně spuštěné kontroly

### PASS

- parser všech 185 TypeScript/TSX souborů;
- parser všech 26 JSON souborů;
- `bash -n` pro shellové skripty;
- `node --check` pro JavaScript/MJS skripty;
- `node scripts/check-capability-parity.mjs` → `PASS (24 capabilities, 15 routes)`;
- `node scripts/generate-mcp-onboarding-catalog.mjs --check` → PASS;
- `node scripts/generate-repository-component-catalog.mjs --check` → PASS;
- `node scripts/test-repository-component-change-classifier.mjs` → PASS;
- `node scripts/test-repository-component-attestations.mjs` → PASS;
- `bash scripts/test-repository-component-workflows.sh` → PASS;
- `bash scripts/test-repository-component-deploy.sh` → PASS včetně očekávaných negativních health/final-verification scénářů;
- samostatný runtime test pořadí Dashboard stream cursoru → PASS;
- kontrola zachování `.env.example`, migrace 001, katalogu 1.1 a historického manifestu → PASS;
- kontrola běžných private-key/PAT/API-key vzorů → PASS.

Logy jsou uloženy v `docs/evidence/local-validation/`.

### BLOCKED PROSTŘEDÍM, nikoli označeno jako PASS

- `corepack pnpm install --frozen-lockfile` → `EAI_AGAIN registry.npmjs.org`;
- skripty závislé na `ajv`, celý Vitest, Vite build, ESLint a plný TypeScript typecheck nelze spustit bez instalovaných dependencies;
- databázové integrační a migrační testy nelze spustit bez PostgreSQL;
- GitHub CI, release, produkční deploy, OWNER browser smoke a produkční screenshoty nelze provést bez příslušných přístupů a prostředí.

## 6. Přesný stav dokončení

Zdrojová implementace je nyní propracovaná a neobsahuje dekorativní simulaci živého provozu. Runtime animace jsou navázané na persistované, korelované operace a obsahují průběh i konečný výsledek. Nelze však poctivě deklarovat **produkční dokončení**, dokud neproběhne instalace dependencies, plné CI, PostgreSQL upgrade test, deploy a 49 scénářů produkční evidence.

## 7. Povinná následná validační sekvence v cílovém prostředí

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run catalog:check
corepack pnpm run repository-catalog:check
corepack pnpm run repository-components:check
corepack pnpm run ci
corepack pnpm run db:migrate
```

Poté musí následovat GitHub required checks, release/deploy, OWNER lifecycle smoke a vyplnění `docs/dashboard/evidence-manifest.json` skutečnými screenshoty a backendovými důkazy nasazeného buildu.
