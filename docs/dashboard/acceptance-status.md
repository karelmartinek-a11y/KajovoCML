# Stav akceptace revize Dashboard UI

## Implementováno ve zdrojovém repozitáři

- stabilní visual node od integračního tokenu po component principal a dopředné delete guardy;
- atomický onboarding handoff včetně Secret grantů;
- persistentní layout komponent i externích systémů;
- persistentní PULSE edge, serverový compatibility evaluator a oddělený stav autorizace;
- grant/revoke oprávnění bez disconnectu, samostatný disconnect a reverzibilní suspendace;
- Secret knihovna, drag grant, manuální výběr identity, bulk grant, revoke a MFA reveal;
- externí boundary nodes, jejich permissions, circuit breaker a statistiky;
- samostatný autoritativní detail vstupního i výstupního portu včetně revize, digestu, route, scope a JSON Schema;
- pan/zoom plátna, uložené pozice komponent i externích uzlů a přístupná seznamová alternativa;
- živý náhled taženého PULSE kabelu a serverově potvrzené compatibility zvýraznění cílové zásuvky;
- přístupné potvrzovací dialogy pro suspendaci, lifecycle změny, bulk grant, connect/disconnect a výsledkové oznámení bez browserových `alert/confirm/prompt`;
- persistovaný runtime stream se samostatnými fázemi STARTED, COMPLETED a BLOCKED pro PULSE, procesy a externí volání;
- databázově vynucená idempotence PULSE lease a operation eventu podle komponenty a correlation ID, včetně bezpečného replay dokončeného výsledku;
- více souběžných runtime indikátorů, výsledkové stavy, reduced-motion alternativa a zastavení při odpojení;
- impact preview a MFA deregistration;
- samostatný přehled registrovaných prvků a redigovaný runtime log;
- migrace 004–007, katalog 1.2, cílené unit/UI testy, parity checker a 49 scénářů fotografické evidence.

## Zbývající ověření mimo ZIP prostředí

Plné `pnpm ci`, databázové integrační testy, produkční deploy, OWNER smoke test a fotografická evidence musejí proběhnout v prostředí s Node 24+, dostupným npm registry, disposable PostgreSQL, GitHub Actions a produkční session. Dokud tyto kroky neproběhnou, stav produkční akceptace zůstává `PENDING_DEPLOYMENT`.
