# Implementační report Dashboardu 2026.07.24-dashboard.1

## Autoritativní model

Dashboard je projekce skutečných databázových a doménových stavů. Stabilní `dashboard_visual_node` vzniká s integračním tokenem a při úspěšném onboardingu se stejným ID přepne na komponentu a principal. Pozice jsou oddělené od bezpečnostní konfigurace a ukládají se v pracovním prostoru OWNERa.

PULSE spojení je persistentní jednosměrná hrana. Kompatibilita portů, požadované oprávnění, účinná autorizace a runtime výsledek jsou samostatné hodnoty. Odebrání oprávnění ponechá hranu, disconnect hranu odstraní a suspendace ponechá uzly i hrany, ale fail-closed zneúčinní komponentové volání i Secret resolve.

## Runtime a animace

PULSE retry používá unikátní korelační klíče v migraci 007: souběžný duplicitní request neprojde jako druhá operace a dokončený request vrací autoritativní replay. Živá vrstva používá SSE nad persistovanými `component_operation_lease`, `component_operation_event` a `component_external_gateway_call`. Každá operace má autoritativní fázi `STARTED` a konečnou fázi `COMPLETED`, `FAILED` nebo `BLOCKED`. UI podporuje více souběžných událostí, směr, průběh, úspěch, chybu a reduced-motion variantu bez ztráty významu. Po odpojení streamu se pohyb zastaví a zůstane poslední potvrzený stav.

## Kontrakty a externí systémy

Porty se odvozují z aktivních PULSE kontraktů. Při tažení nového spojení se kreslí živý náhled kabelu a cílová zásuvka používá serverové compatibility preview; konečné vytvoření znovu čeká na autoritativní potvrzení. Každý port má samostatný detail revize, digestu, protokolu, transportu, autentizace, route, scope a request/response JSON Schema. Externí cíle jsou samostatné boundary uzly se skutečnými permissions, circuit breakerem, statistikami a persistovanými gateway událostmi.

## Secret lifecycle

Dashboard a Secret Manager používají stejné serverové grant commandy. Kartička nikdy neobsahuje hodnotu Secretu a po dropu zůstává v knihovně. Podporovány jsou grant, revoke, bulk preview/per-target výsledek, onboardingový grant, přenos při handoffu a MFA reveal s auditovaným krátkodobým oprávněním.

## Destruktivní lifecycle

Odregistrace komponenty je samostatný command s impact preview, čerstvým heslem, MFA, typed confirmation a idempotency key. Ukončí credentialy, Secret granty, permissions a incidentní topologii; append-only audit zůstává. Migrace 006 bezpečně uzavírá visual node také při fyzickém odstranění identity a nerozbíjí registrovaný node při odstranění historického onboardingového tokenu.

## Přístupné operační dialogy

Dashboard nepoužívá browserová `alert`, `confirm` ani `prompt` okna. Suspendace, lifecycle změny, bulk Secret grant, connect/disconnect a výsledky operací používají přístupné modální dialogy s přesným dopadem, důvodem, klávesovou obsluhou a serverovou chybou bez optimistic potvrzení.

## Ověření

Reprodukovatelná lokální validační evidence je v `docs/evidence/local-validation/`. Produkční evidence má 49 přesných scénářů v `docs/dashboard/evidence-manifest.json`; zůstává `PENDING_DEPLOYMENT`, dokud neproběhne GitHub CI, databázový upgrade, nasazení, OWNER smoke a screenshoty z nasazeného buildu.
