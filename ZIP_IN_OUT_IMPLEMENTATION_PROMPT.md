# IMPLEMENTAČNÍ PROMPT — KajovoCML internal AI generation

Dostáváš ZIP kompletního repozitáře KajovoCML. Tvým úkolem je provést **forenzní zip-in / zip-out implementaci** nového cílového stavu definovaného v `docs/SSOT_CURRENT.md` a vrátit celý upravený repozitář jako nový ZIP.

## 0. Autorita zadání

- Nejprve přečti celé `docs/SSOT_CURRENT.md`. Je to závazná vůle vlastníka pro cílový stav.
- Potom forenzně projdi skutečný zdrojový kód, migrace, `AGENTS.md`, `README.md`, package skripty, server, admin UI, deploy/runtime skripty, `components/**`, onboarding, auth, Secret Manager, Dashboard, monitoring a audit.
- Pro **aktuální stav** věř zdrojovému kódu, ne starým dokumentům.
- Pro **cílový stav** věř novému `docs/SSOT_CURRENT.md`. Když starý `AGENTS.md`, README, katalog, test nebo workflow odporuje novému SSOT, je zastaralý a musí být v rámci této změny upraven nebo odstraněn. Neohýbej nový SSOT podle starého onboardingového řešení.
- Projekt je `PRE_PRODUCTION_TESTING`; vlastník výslovně schvaluje breaking přechod ze starého externího onboardingového modelu na nový interní generation model.
- Nezmenšuj scope, nevytvářej demo, mock, placeholder ani paralelní polofunkční cestu.

## 1. Cíl

Přestav KajovoCML tak, aby OWNER mohl ve webovém rozhraní zadat **volný lidský text** typu:

> „Chci přijímat zprávy z WhatsApp čísla X, z mého kontextu připravovat odpovědi a podle pravidel je odesílat.“

KajovoCML musí samo:

1. pochopit záměr;
2. navrhnout minimální rozklad na samostatné MCP servery/funkce a případné AI agenty;
3. laicky si vyžádat pouze skutečně chybějící údaje/credentials;
4. po potvrzení autonomně provést technický výzkum, implementaci a konfiguraci;
5. podle potřeby použít web search a Chromium/browser automation k nastavení externích providerů;
6. funkci skutečně ověřit a opravovat do funkčního stavu;
7. začlenit všechny vytvořené prvky do existujícího CML standardu;
8. lokálně je aktivovat;
9. ukázat OWNERovi průběh a konečný výsledek.

Neimplementuj zatím hlasové UI. Serverová generation funkce však musí být navržena tak, aby ji později mohl hlasový chat vyvolat stejným API/function call.

## 2. Architektonické pravidlo: žádný druhý control plane

Nepřidávej nový paralelní systém pro identitu, secrets, monitoring, oprávnění nebo audit.

Preferuj jako kanonické již existující mechanismy:

- `component` / `principal` a jejich permission model;
- component control queue/worker;
- heartbeat, state query, monitoring/watchdog;
- readiness/E2E evidence;
- Secret Manager + Secret API + grants;
- OWNER Dashboard topology;
- audit chain + component audit stream.

Generation vrstva je pouze výrobní/orchestrační vrstva nad těmito mechanismy.

Pokud legacy `mcp_server` a generic `component` dnes představují dvě překrývající se lifecycle autority, forenzně je konsoliduj. Pro nově generované prvky nesmí vzniknout třetí lifecycle model. Pokud musí legacy `mcp_server` zůstat kvůli kompatibilnímu UI/protokolu, udělej z něj odvozený/adapterový pohled nad kanonickou komponentou, nikoli nezávislou autoritu.

## 3. Odstraň externí onboardingový produktový model

Současný kód má externí handoff založený na integration tokenu, source upload/revizích, GitHub PR/CI, OCI/GHCR a následném access-token handoffu. Tento tok je cílově zrušen.

Pro interně generované prvky:

- žádný OWNERem vytvářený onboarding/integration token;
- žádný handoff externímu programátorovi;
- žádné čekání na PR/CI/merge;
- žádný povinný GHCR/OCI build/provenance flow;
- žádné „integration token → onboarding → nový access token“ jako uživatelský lifecycle.

Nahraď ho interním **generation job** lifecycle.

Staré integrační/onboarding API, UI, worker, katalogy, configy, workflow a deployment části, které po přechodu nemají žádnou platnou cestu použití, odstraň nebo explicitně retire. Nenechávej mrtvou dvojkolejnost „nový interní model + starý externí model“, pokud SSOT nevyžaduje opak.

## 4. Jedna runtime identita/token na vytvořený prvek

Výsledný CML prvek má jednu normální komponentní/principal identitu a jeden dlouhodobý runtime access token/credential spravovaný KajovoCML.

- Vydání proběhne interně v generation/activation toku.
- OWNER nemusí token ručně přenášet mezi systémy.
- Token/identita musí být zobrazitelná/spravovatelná v administraci identit a oprávnění v rozsahu podporovaném cílovým modelem.
- Zachovej revoke/rotate a permission management.
- Secret granty váž přímo na výslednou komponentní identitu.
- Technický generation worker může mít vlastní interní service identity, ale nevytvářej z ní produktový tokenový lifecycle pro OWNERa.

Navrhni a proveď potřebnou PostgreSQL migraci. Protože jde o pre-production breaking změnu, smíš odstranit nebo transformovat testovací onboardingové tabulky/enum hodnoty, pokud tím vznikne čistší kanonická baseline a zachováš relevantní CML runtime data.

## 5. Nové UI: jedna A4, minimum interakce

Přidej do levé navigace OWNER UI jednu novou sekci, např. `Generování` nebo `Nový MCP / agent`.

UI musí být záměrně jednoduché:

### Vstup
- jedno velké čisté textarea/editor pole;
- tlačítko `Odeslat` / `Navrhnout`;
- žádné povinné technické formuláře.

### Návrh
Po analýze ukaž krátce:
- co systém pochopil;
- jaké prvky navrhuje vytvořit;
- vazby mezi nimi;
- co bude výsledkem.

Jedno jednoduché potvrzení stačí.

### Doplňující údaje
Pokud něco skutečně chybí, zobraz laické otázky/fields typu:
- telefonní číslo;
- účet/e-mail;
- URL;
- heslo;
- API klíč;
- pravidlo chování.

Neptej se OWNERa na technologii, deployment, OAuth flow, webhook implementaci, API variantu, porty, CI, Docker, token lifecycle apod., pokud si to systém umí zjistit sám.

### Progress
Zobraz přehlednou kaskádu/progress, například:
- Analýza zadání
- Návrh řešení
- Čekám na údaj
- Technický výzkum
- Implementace
- Integrace
- Ověření
- CML začlenění
- Aktivace
- Hotovo

Nezobrazuj chain-of-thought ani interní prompty modelů.

## 6. Backend generation job

Implementuj persistentní generation job model se serverovým API a workerem. Stavový model má být jednoduchý, robustní a restartovatelný. Může obsahovat např.:

`CREATED -> ANALYZING -> NEEDS_INPUT -> PLAN_READY -> IMPLEMENTING -> INTEGRATING -> VALIDATING -> CML_CONFORMANCE -> ACTIVATING -> COMPLETED`

a jasné `FAILED/BLOCKED/CANCELLED` větve.

Po restartu serveru se job nesmí ztratit. Ukládej:
- originální owner prompt;
- strukturovaný plán;
- potřebné vstupy a jejich stav;
- vytvořené component IDs/revisions;
- aktuální fázi;
- srozumitelný progress log;
- odkazy na pracovní kopii/revision point;
- blocker/result summary.

Nepersistuj interní model chain-of-thought.

## 7. AI orchestrace

Implementuj **jeden zaměřený generation orchestrator**, nikoli obecnou multi-agent platformu.

Interně může používat několik modelových kroků/rolí, ale architektura má zůstat malá a účelová:

1. intent/spec normalizer;
2. architecture planner;
3. missing-input extractor;
4. integration researcher;
5. implementer;
6. validator/remediator.

Pro modelovou integraci použij aktuální podporované OpenAI API podle aktuální oficiální dokumentace dostupné v době implementace. Nepoužívej zastaralé API jen proto, že je zmíněné ve starším příkladu. API key ulož přes existující KajovoCML Secret Manager a načítej jej runtime grantem; nevytvářej nový vault.

Model musí dostat nástroje pouze potřebné pro práci, ale tyto nástroje mají být praktické a hluboce integrované:

- čtení a zápis pracovní kopie repozitáře;
- lokální shell/build/test příkazy;
- web search / HTTP fetch;
- Chromium/Playwright browser automation;
- práce se Secret Managerem;
- lokální CML administrační/generation API;
- čtení runtime/log/monitoring evidence;
- lokální deployment/rollback nástroje.

AI může autonomně iterovat nad chybou, dokud existuje technická cesta k opravě. Na OWNERa se obrací jen při skutečně chybějícím credentialu, oprávnění, obchodním pravidle nebo externím kroku, který nelze automatizovat.

## 8. Práce s plaintext secrets

OWNER zóna je důvěryhodná.

- Prompt/follow-up může obsahovat plaintext heslo, token nebo API key.
- Nezaváděj security gate, který takový vstup odmítá.
- Nezaváděj komplikovaný „secret transfer“ proces pro OWNERa.
- Pokud AI potřebuje credential k integraci, může jej použít pro browser/API konfiguraci.
- Pro **trvalé runtime použití** credential vždy převeď do existujícího KajovoCML Secret Manageru a výslednému prvku přiděl existující secret grant.
- OWNER může nadále využít existující reveal/rotate/revoke možnosti.
- Transparentní redakce logu je dovolena, ale nesmí být completion gate ani důvodem komplikovat flow.

Nekopíruj trvalé runtime secret hodnoty do manifestu nebo zdrojového kódu, pokud pro to neexistuje explicitní produktový důvod; normální runtime cesta je stávající Secret Manager.

## 9. Generované MCP prvky a agenti

Výstupem generation jobu může být jeden nebo více prvků.

### MCP prvek
MCP server chápej jako samostatnou schopnost/funkci. Každý generovaný prvek musí:
- mít vlastní CML identity/component record;
- mít vlastní hostname;
- mít CML-facing HTTPS runtime endpoint;
- používat existující authorization model;
- mít heartbeat/state/monitoring;
- mít enable/disable a lifecycle řízení;
- auditovat operace;
- používat Secret Manager grants;
- být vidět v Dashboardu a standardních administračních stránkách.

Interní UDS/socket může být použit za nginx/runtime proxy jako lokální detail, ale CML-visible hranice mezi samostatnými prvky musí být HTTPS.

### AI agent
AI agenta vytvářej jen tehdy, když plán vyžaduje LLM reasoning/generování. Agent má být normální CML prvek a jeho externí modelová volání mají jít přes explicitní CML secret/egress konfiguraci. Nevytvářej zvláštní agentí control plane.

## 10. Externí integrace a browser automation

Externí API, webhooky a služby jsou legitimní součást řešení.

Generation worker musí umět provést integrační práci podobně jako člověk v Codex/Chromium workflow:
- najít správnou aktuální dokumentaci;
- otevřít provider web;
- přihlásit se OWNER credentialem;
- založit/nastavit aplikaci, webhook nebo callback;
- vložit CML HTTPS endpoint;
- přečíst potřebné IDs/keys;
- uložit trvalé secrets do CML Secret Manageru;
- otestovat reálný callback/request;
- opravit konfiguraci, pokud nefunguje.

Browser session a pracovní evidence musí být navázána na generation job a obnovitelná v rozumném rozsahu. Nevytvářej nový enterprise browser orchestration produkt; implementuj nejmenší spolehlivý mechanismus, který tento tok umožní.

## 11. Lokální source/worktree a deployment bez GitHub/CI

Generation musí fungovat i tehdy, když žádný developerský počítač není online.

Implementuj server-side lokální workflow:

1. vytvoř lokální revision point/snapshot před změnou;
2. vytvoř job-specific pracovní kopii/worktree;
3. AI upravuje zdroj;
4. lokálně build/typecheck/targeted test;
5. proveď skutečnou funkční/integration validaci;
6. vytvoř lokální release artefakt;
7. aktivuj novou revizi;
8. při neúspěchu uměj vrátit předchozí lokální revizi.

**GitHub, GitHub Actions, PR, merge, externí CI/CD a GHCR nesmí být součástí tohoto runtime flow ani completion gate.**

Můžeš využít lokální Git pouze jako jednoduchý snapshot/worktree/rollback mechanismus bez remote závislosti.

Forenzně odstraň nebo přepiš staré `AGENTS.md`, README, package scripts, configy, onboarding worker a deploy workflow pravidla, která tvrdí opak a která už po novém modelu nemají účel.

## 12. Lokální runtime pro generované komponenty

Preferuj reutilizaci stávajícího handler/runtime supervisoru a systemd/nginx infrastruktury namísto nové platformy.

Cíl:
- lokální versioned component release directory;
- proces/service spravovaný platformou;
- vlastní KCML hostname;
- nginx/TLS -> lokální runtime;
- CML control/monitor worker umí prvek ovládat a číst heartbeat/state;
- aktivní a předchozí release lze rychle přepnout/rollbacknout.

Odstraň povinnou vazbu na image z GHCR. Pokud OCI image není pro lokální runtime nutný, nepoužívej jej jen kvůli starému kontraktu. Pokud lze existující runtime bezpečně zachovat s lokálním artefaktem, použij nejjednodušší řešení.

## 13. CML conformance je jediná povinná platformní brána

Nevymýšlej nové security/compliance workflow. Před aktivací ale musí prvek prokázat stávající CML vlastnosti:

- validní identity a autorizace;
- funkční HTTPS endpoint;
- functional/E2E scénář;
- heartbeat;
- state;
- monitoring/watchdog;
- audit continuity;
- Secret grants;
- OWNER enable/disable;
- Dashboard/UI visibility.

Pokud stávající CML readiness/evidence mechanismy umí tento důkaz nést, použij je. Odstraň pouze gate, které existují čistě kvůli zrušenému externímu GitHub/OCI onboarding lifecycle.

## 14. Aktualizace dokumentace a agent rules

Po implementaci musíš aktualizovat minimálně:
- `AGENTS.md` a případné podřízené `AGENTS.md`;
- `README.md`;
- `docs/SSOT_CURRENT.md` pouze pokud je potřeba doplnit přesnou implementační referenci, nikoli měnit owner invarianty;
- `docs/current-state-manifest.yaml`;
- lifecycle/project phase dokumenty;
- relevantní runbooky;
- katalog/schema docs, pokud po přechodu zůstávají aktivní.

Odstraň z aktivních instrukcí povinnost GitHub CI/deploy, integration-token handoffu a externího programmer flow.

## 15. Migrace UI

Staré OWNER obrazovky zaměřené na „vygeneruj integrační token a předej podklady programátorovi“ nesmějí zůstat jako primární způsob vytvoření interního prvku.

Uprav navigaci a UI tak, aby:
- `Generování` bylo jasným vstupem pro nové schopnosti;
- `Registrované prvky`, `Katalog komponent`, `Monitoring`, `Tokeny a identity`, `Secrets`, `Oprávnění`, `Audit` zůstaly kontrolními pohledy na výsledek;
- obsolete integration-token handoff UI bylo odstraněno nebo zřetelně retire podle skutečné potřeby kódu.

## 16. Verifikace implementace

Nezastav se u unit testů ani statického UI.

Proveď minimálně:

1. čistý install/build/typecheck podle aktuálního repa v podporovaném Node/pnpm runtime;
2. relevantní testy existujících CML control/secret/monitoring funkcí;
3. test generation job state persistence a restartu workeru;
4. test plaintext secret input -> uložení do Secret Manageru -> grant výsledné komponentě;
5. test, že generation flow nevyžaduje GitHub/CI/GHCR;
6. test vytvoření jednoduchého reálného generovaného MCP prvku z textového promptu;
7. test HTTPS discovery/invocation tohoto prvku;
8. test heartbeat/state/monitoring;
9. test OWNER disable/enable;
10. test revoke/rotate runtime tokenu a permission změny;
11. test rollback předchozí lokální revize;
12. admin UI test nového Generování flow;
13. proveď skutečné browser/render ověření UI, pokud prostředí umožňuje Chromium.

Nepoužívej mock externího produktu jako důkaz celé funkce. Pro generickou platformní validaci můžeš použít skutečný lokální generovaný prvek bez cizích credentials; externí provider-specific integrace se ověří při prvním reálném OWNER jobu.

## 17. Definition of done

Hotovo znamená:

- nový SSOT je implementován v reálném kódu;
- OWNER zadá lidské přání v jedné jednoduché stránce;
- generation pipeline autonomně pokračuje;
- systém se doptá pouze na skutečný blocker/input;
- vytvoří jeden nebo více reálných prvků;
- prvky běží lokálně bez GitHub/CI dependency;
- každý prvek je plně CML-manageable a HTTPS-addressable;
- runtime secrets jsou v existujícím Secret Manageru;
- není potřeba integration-token/programmer handoff;
- monitoring/heartbeat/state/audit/permissions/disable fungují;
- existuje lokální rollback;
- neexistují placeholdery ani druhá paralelní architektura;
- voice chat nebyl přidán jako scope creep.

## 18. Výstup

Vrať:

1. kompletní nový ZIP celého repozitáře;
2. `DELIVERY_SUMMARY.md` s přesným seznamem změn;
3. seznam migrací a zásadních architektonických rozhodnutí;
4. přesné příkazy, které jsi spustil;
5. výsledky všech testů/buildů/integration checks;
6. seznam skutečných blockerů, pokud nějaký zůstal;
7. explicitní potvrzení, že runtime generation/deploy cesta nemá dependency na GitHub/CI/GHCR a že všechny generované prvky podléhají CML standardu.

Pokud narazíš na problém, neopouštěj scope a nenahrazuj cíl jednodušším demo řešením. Opravuj root cause a pokračuj. Zastav pouze na skutečném externím blockeru, který nelze vyřešit ze zdrojového kódu, dostupného prostředí nebo údajů OWNERa.
