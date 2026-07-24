# Fotografická důkazní matice Dashboardu

Verze: `2026.07.24-dashboard.1`  
Stav: **PENDING_DEPLOYMENT**

Zdrojová implementace a statické důkazy jsou připraveny; produkční screenshoty vyžadují nasazený build, OWNER session a bezpečná testovací data.

| Evidence ID | Akceptační kritérium | Stav |
|---|---|---|
| `DASH-NODE-PREREG` | Předregistrační prvek po vydání integračního tokenu | PENDING_DEPLOYMENT |
| `DASH-SECRET-PREREG` | Připnutí Secretu na předregistrační prvek | PENDING_DEPLOYMENT |
| `DASH-HANDOFF-STABLE` | Stejný stable node a pozice před a po handoffu | PENDING_DEPLOYMENT |
| `DASH-SECRET-TRANSFER` | Atomický přenos Secret grantů při handoffu | PENDING_DEPLOYMENT |
| `DASH-SECRET-LIBRARY` | Secret kartička zůstane po dropu v knihovně | PENDING_DEPLOYMENT |
| `DASH-SECRET-MULTI` | Prvek s více připnutými Secrets | PENDING_DEPLOYMENT |
| `DASH-SECRET-BULK-PREVIEW` | Bulk grant impact preview | PENDING_DEPLOYMENT |
| `DASH-SECRET-BULK-RESULT` | Bulk grant per-target výsledek | PENDING_DEPLOYMENT |
| `DASH-SECRET-REVEAL-MFA` | MFA reveal z Dashboardu | PENDING_DEPLOYMENT |
| `DASH-SECRET-REVEAL-HIDE` | Automatické skrytí hodnoty Secretu | PENDING_DEPLOYMENT |
| `DASH-COMPAT-AUTH-SPLIT` | Zelené porty a červené vlákno | PENDING_DEPLOYMENT |
| `DASH-INCOMPAT-AUTH` | Červené porty a zelené vlákno | PENDING_DEPLOYMENT |
| `DASH-EDGE-GRANT` | Udělení oprávnění bez nového edge | PENDING_DEPLOYMENT |
| `DASH-EDGE-REVOKE` | Odebrání oprávnění bez rozpojení | PENDING_DEPLOYMENT |
| `DASH-EDGE-DISCONNECT` | Samostatné rozpojení | PENDING_DEPLOYMENT |
| `DASH-SUSPENSION` | Suspendovaný prvek se zachovanými edges | PENDING_DEPLOYMENT |
| `DASH-RESUME` | Obnovení identity bez obnovení ručně odebraných práv | PENDING_DEPLOYMENT |
| `DASH-DEREG-PREVIEW` | Impact preview deregistrace | PENDING_DEPLOYMENT |
| `DASH-DEREG-CLEANUP` | Cleanup izolovaného registrovaného prvku | PENDING_DEPLOYMENT |
| `DASH-TOKEN-DELETE-PRE` | Smazání integračního tokenu před handoffem | PENDING_DEPLOYMENT |
| `DASH-TOKEN-DELETE-POST` | Zachování registrovaného prvku po smazání historického tokenu | PENDING_DEPLOYMENT |
| `DASH-HEALTHY-DESKTOP` | Zdravý Dashboard na desktopu | PENDING_DEPLOYMENT |
| `DASH-TABLET` | Dashboard na tabletu | PENDING_DEPLOYMENT |
| `DASH-MOBILE` | Dashboard na mobilu | PENDING_DEPLOYMENT |
| `DASH-LOADING` | Loading stav | PENDING_DEPLOYMENT |
| `DASH-EMPTY` | Empty stav | PENDING_DEPLOYMENT |
| `DASH-ERROR` | Error stav | PENDING_DEPLOYMENT |
| `DASH-DISABLED` | Disabled stav | PENDING_DEPLOYMENT |
| `DASH-STALE` | Stale stav | PENDING_DEPLOYMENT |
| `DASH-LIVE-DISCONNECTED` | Odpojený live stream bez pokračující animace | PENDING_DEPLOYMENT |
| `DASH-CRITICAL-ALARM` | CRITICAL alarm s dopadem a doporučením | PENDING_DEPLOYMENT |
| `DASH-PULSE-STARTED` | Skutečná STARTED PULSE komunikace | PENDING_DEPLOYMENT |
| `DASH-PULSE-SUCCESS` | Úspěšné dokončení PULSE | PENDING_DEPLOYMENT |
| `DASH-PULSE-FAILURE` | Chybové dokončení PULSE | PENDING_DEPLOYMENT |
| `DASH-PULSE-CONCURRENT` | Více souběžných PULSE událostí | PENDING_DEPLOYMENT |
| `DASH-PROCESS-ACTIVE` | Aktivní proces uvnitř komponenty | PENDING_DEPLOYMENT |
| `DASH-EXTERNAL-NODE` | Externí boundary node | PENDING_DEPLOYMENT |
| `DASH-EXTERNAL-STARTED` | Probíhající externí volání | PENDING_DEPLOYMENT |
| `DASH-EXTERNAL-SUCCESS` | Úspěšné externí volání | PENDING_DEPLOYMENT |
| `DASH-EXTERNAL-BLOCKED` | Blokované externí volání | PENDING_DEPLOYMENT |
| `DASH-EXTERNAL-FAILED` | Selhané externí volání | PENDING_DEPLOYMENT |
| `DASH-REDUCED-MOTION` | Reduced-motion se statickým směrem a výsledkem | PENDING_DEPLOYMENT |
| `DASH-PORT-DETAIL` | Detail portu a kontraktní evidence | PENDING_DEPLOYMENT |
| `DASH-KEYBOARD-CONNECT` | Klávesnicové vytvoření spojení | PENDING_DEPLOYMENT |
| `DASH-KEYBOARD-CONTEXT` | Shift+F10 kontext spojení | PENDING_DEPLOYMENT |
| `DASH-TOUCH-ACTION` | Dotyková alternativa akcí | PENDING_DEPLOYMENT |
| `DASH-LONG-CZECH` | Dlouhé české názvy bez překrytí | PENDING_DEPLOYMENT |
| `DASH-MANY-PORTS` | Velký počet portů | PENDING_DEPLOYMENT |
| `DASH-EXTERNAL-LAYOUT` | Uložená pozice externího systému | PENDING_DEPLOYMENT |
