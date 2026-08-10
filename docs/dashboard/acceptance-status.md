> **HISTORICAL/SUPERSEDED (2026-08-09):** pre-internal-generation Dashboard notes. `docs/SSOT_CURRENT.md` and `docs/ARCHITECTURE.md` override lifecycle/creation statements below.

# Stav akceptace revize Dashboard UI

## Implementováno v repozitáři

- stabilní visual node od integration tokenu po component principal;
- atomický onboarding handoff včetně Secret grantů;
- persistentní layout a PULSE edge;
- serverový compatibility evaluator;
- oddělené grant/revoke oprávnění a disconnect;
- reverzibilní suspendace v autorizaci i Secret resolve;
- Secret knihovna, drag grant, manuální výběr identity, bulk grant, revoke a MFA reveal;
- OWNER Dashboard, alarmy, runtime timeline, SSE replay a reduced motion;
- impact preview a MFA deregistration;
- samostatný přehled registrovaných prvků s provozními metrikami a redigovaným per-prvek runtime logem;
- dopředná migrace, cílené unit/UI testy a parity checker.

## Částečně pokryto

- Dashboard odkazuje na stávající přesné sekce, ale nepřenáší inline úplně všechny historické administrativní formuláře;
- sekce „Tokeny a identity“ sjednocuje navigaci a lifecycle pomocí dvou přesných záložek, ale neslučuje bezpečnostně rozdílné databázové credential modely;
- per-prvek debug log je dostupný v samostatném přehledu registrovaných prvků, ale zatím nemá plnou sadu filtrů subsystem/severity, explicitní retenční správu a dlouhodobý live-tail backend mimo persistované runtime události;
- externí systémy nejsou zatím vykresleny jako boundary nodes;
- detail portu obsahuje kontraktní metadata a compatibility evidence, nikoli úplný nový schema explorer všech historických kontraktů;
- migrace automaticky nevytváří portové edges pro každé historické `component_permission`, aby bez jednoznačné vazby nevymýšlela kompatibilitu.

## Externě blokováno

- instalace balíčků v tomto prostředí byla blokována DNS přístupem k npm registry;
- nebyla dostupná disposable PostgreSQL, GitHub Actions, produkční deploy ani OWNER produkční session;
- proto nejsou deklarovány zelené úplné CI, databázové testy, release, deploy, post-deploy smoke test ani produkční screenshot evidence.

Tato dodávka je implementační ZIP k dalšímu CI/deploy ověření, nikoli nepravdivé prohlášení úplného produkčního dokončení.
