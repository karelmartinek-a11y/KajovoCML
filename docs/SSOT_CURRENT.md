# KajovoCML — SSOT_CURRENT

**Stav dokumentu:** normativní cílový SSOT pro další implementační běh  
**Účinnost:** 2026-08-21  
**Produkt:** `KajovoCML`  
**Technický prefix:** `KCML`  
**Lifecycle:** `PRE_PRODUCTION_TESTING`  
**Vlastník systému:** deployment-managed OWNER `karmar78`

Tento dokument nahrazuje předchozí obsah `docs/SSOT_CURRENT.md`. Je jedinou cílovou autoritou pro implementaci KajovoCML a současně forenzně konsoliduje dosavadní SSOT s novou výrobní specifikací persistentní AI diskuse, interaktivní browserové konfigurace, deterministických webových automatizací a realizační orchestrace.

## A. Autorita, precedence a způsob čtení

1. Skutečný aktuální stav programu se vždy zjišťuje forenzně ze zdrojového kódu a číslovaných PostgreSQL migrací. Testy, komentáře, auditní reporty ani historická dokumentace nesmějí přepsat realitu aktuálního kódu.
2. Tento `docs/SSOT_CURRENT.md` je autoritou cílového stavu a vůle OWNERa. Rozpor mezi kódem a tímto dokumentem je implementační mezera.
3. Po dokončení implementace musí být zdrojový kód, migrace, runtime kontrakty, UI, testy, `docs/ARCHITECTURE.md`, runbook a relevantní catalog dokumentace v souladu s tímto SSOT.
4. Nejsou přijatelné mocky, placeholdery, demo náhrady, test-only simulace, skryté zkratky ani redukce rozsahu vydávaná za splnění.
5. Část **C — Detailní výrobní specifikace změny** je bezeztrátově převzatý normativní change contract a má přednost všude, kde zpřesňuje nebo mění dřívější produktový tok.
6. Část **B — Zachované platformní invarianty** nese všechny dosavadní požadavky, které nová změna neruší. Tyto invarianty platí současně s částí C.
7. Pokud by mezi částmi B a C vznikl zdánlivý konflikt, použije se toto pravidlo: nová změna smí změnit konkrétní generation UX/lifecycle/browser implementaci, ale nesmí oslabit jeden CML control-plane, component/principal identity, Secret Manager, permission boundary, monitoring/audit, local release/rollback ani restricted generated-handler sandbox, pokud část C sama výslovně neříká jinak.

## A.1 Forenzní mapa změn proti předchozímu SSOT

- Dosavadní produktový směr „jeden uzavřený svět OWNERa“ zůstává beze změny.
- Dosavadní CML standard a zákaz paralelního control-plane zůstávají beze změny.
- Dosavadní jednoduchý tok `zadání → návrh → realizace → hotovo` je **nahrazen a zpřesněn** tokem `zadání → DISCUSSING → persistentní OWNER↔AI diskuse → immutable GenerationSpecification revisions → explicitní approval freeze revision+digest → ANALYZING → IMPLEMENTING → INTEGRATING → VALIDATING → CML_CONFORMANCE → ACTIVATING → COMPLETED`.
- Běžné čekání na OWNERa před approval se již nereprezentuje jako realizační blocker; zůstává `DISCUSSING` s `openQuestions` / `owner.input.required`. Skutečný blocker po approval používá `BLOCKED` s bezpečným resume path.
- Dosavadní „návrh struktury a jednorázové potvrzení plánu“ není samostatná produktová approval brána. Produktovou autoritou je schválená `GenerationSpecification`; `GenerationPlan` vzniká až v `ANALYZING` a nesmí měnit její funkční význam.
- Dosavadní generation browser založený na interní Chromium/CDP implementaci je aktuální stav, nikoli cílový kontrakt. Cílová změna zavádí explicitně verzovaný Playwright + kompatibilní Chromium a dvě role: Generation Browser Session a canonical `KCML Browser Automation Runtime`.
- Dosavadní restricted generated handler sandbox se **nemění ani neoslabuje**. Produkční Playwright není přidán do generated handleru; generated MCP volá platformní browser runtime přes `context.callComponent`.
- Dosavadní migrace `001` až `013` zůstávají baseline; cílová změna přidává `014_generation_discussion.sql` a `015_browser_automation_runtime.sql`.
- Dosavadní minimal OWNER UI je nahrazeno detailním persistentním workspace UI, SSE, browser preview, spec panelem, teaching/replay a automation operations UX z části C.
- Dosavadní zákaz povinného GitHub/PR/CI/GHCR toku pro interní generation runtime zůstává. Branch/merge strategie popsaná v části C je implementační strategie vývojového týmu, nikoli runtime dependency generation produktu.
- Hlasový chat zůstává odloženým vstupním rozhraním a není podmínkou této implementace; budoucí hlas musí používat stejnou serverovou generation business logiku.
- Dosavadní generic monitoring/watchdog repair pro `INTERNAL_GENERATED` zůstává. Browser automation drift/repair jej rozšiřuje, nikoli nahrazuje.
- Dosavadní lokální source snapshot/workspace/release/rollback model zůstává autoritou realizační části po approval freeze.
- Provider-side konfigurace vyžadující skutečnou callback URL generované komponenty se provádí až v `INTEGRATING` po candidate deploymentu a readiness; browserová konfigurace v `DISCUSSING` smí provádět přípravné a OWNERem autorizované externí kroky, které nejsou závislé na ještě neexistujícím finálním candidate callbacku.

## B. Zachované platformní invarianty předchozího SSOT

### B.1 Produktový směr

KajovoCML je jeden uzavřený svět OWNERa. Nové schopnosti se mají navrhovat, vytvářet, integrovat, ověřovat a uvádět do provozu uvnitř KajovoCML z lidského zadání. OWNER popisuje co chce, nikoli technickou implementaci. Systém přebírá odpovědnost za technický rozklad, integrační cestu, vytvoření MCP/AI prvků, konfiguraci externích služeb, ověření a začlenění do CML. Cílem není obecná platforma na výrobu agentů pro třetí strany, ale autonomní rozšiřování vlastního Kájovo prostředí.

### B.2 CML standard je nepřekročitelný invariant

Veškerá nová činnost a každý vytvořený prvek musí fungovat v existujícím CML standardu pro identitu, řízení, oprávnění, Secret Manager, monitoring, heartbeat/state, runtime kontrolu, audit, aktivaci/deaktivaci a vizuální správu.

- AI nesmí CML standard obcházet ani si vytvářet paralelní mantinely.
- AI-generated business handler smí provádět side effecty pouze přes `context.secret`, `context.callComponent`, `context.callExternal` a výslovně omezený `context.state`.
- Přímý network access, Node process/system moduly, libovolný filesystem, `process.env`, dynamický import nebo runtime code-generation nesmějí handleru umožnit obejít CML permissions, Secret Manager, egress nebo state boundary; zákaz musí být technicky vynucen runtime.
- Nový prvek není hotový ani aktivovatelný, dokud není plnohodnotně začleněn do CML standardu.
- Nevytváří se paralelní bezpečnostní, autorizační, secret, monitoringový ani auditní systém.
- Používají se stávající component/principal identity, enable/disable, quarantine/restore, heartbeat, state query, monitoring/watchdog, audit, permissions, Secret Manager grants/revoke/rotate/reveal a OWNER Dashboard.
- OWNER musí být schopen prvek odstavit bez odstranění celého KajovoCML.

### B.3 Výsledné MCP a AI prvky

V terminologii OWNERa je MCP server samostatně ovladatelná funkce/schopnost, i když může technicky obsahovat více přirozeně souvisejících tools. Každý generated runtime prvek je samostatně identifikovatelný, monitorovatelný, zapnutelný/vypnutelný, auditovatelný, napojený na heartbeat/state/monitoring, viditelný v CML administraci, permission-separated a napojený na Secret Manager pouze granty.

Každý generated MCP prvek má samostatnou CML-facing HTTPS identitu/hostname. Lokální UDS nebo jiný lokální transport je pouze implementační detail za CML HTTPS hranou. Externí HTTPS API, webhooky a další protokoly jsou dovoleny podle zadání, ale nejsou externím onboardingem cizího prvku.

AI agent se vytváří pouze tam, kde je skutečně potřeba jazykové porozumění, reasoning, kontext nebo generování. Deterministická funkce nesmí být nahrazena agentem jen z pohodlnosti. Agent používá stejný CML lifecycle, identitu, monitoring, permissions a Secret Manager jako ostatní prvky.

### B.4 Interní generování a retired onboarding

Historický externí onboarding založený na integration tokenu, handoffu programátorovi, source upload/revizích, GitHub PR/CI, OCI/GHCR artefaktech a následném tokenovém handoffu je retired a nesmí být aktivní produktovou cestou.

- Interně vytvořený prvek vzniká pouze v interním generation flow.
- OWNER negeneruje ani nepředává zvláštní onboarding/integration token externímu programátorovi.
- Výsledný component/principal má jednu dlouhodobou CML runtime identitu/access credential spravovanou interně.
- Secret grants se vážou přímo na výslednou component identity.
- Generation job může mít technickou identitu, ale nesmí z ní vzniknout další OWNER-facing token lifecycle.
- Projekt zůstává `PRE_PRODUCTION_TESTING`; breaking migrace historických test-only onboarding cest je povolena a backward compatibility s retired handoffem není požadována.

### B.5 GitHub/CI nejsou runtime dependency interní generation pipeline

Žádný interní generation job nesmí čekat na GitHub PR, CI run, merge, GitHub deployment, GHCR ani OCI jako completion gate. Zdroj a pracovní kopie mohou být na serveru KajovoCML. Lokální build, typecheck, test, integrační ověření a CML runtime evidence jsou očekávány. Pro rollback se používá lokální verzování/snapshot/release mechanismus, nikoli povinná externí CI/CD infrastruktura.

### B.6 Secrets a OWNER trusted zone

KajovoCML je trusted OWNER zone. OWNER smí v chráněném dialogu zadat heslo, API key, token, OTP nebo jiný credential. Samotný plaintext v OWNER-only diskusi nesmí blokovat práci ani vytvářet povinný paralelní transfer workflow. Persistentní runtime secret je však autoritativně uložen pouze v existujícím Secret Manageru.

- Existující použitelný `ACTIVE` secret se znovu nevyžaduje, pouze se reconciliují potřebné granty.
- OWNER questionnaire je minimální a žádá jen neodvoditelnou identitu, credential nebo business rozhodnutí. Hostname, server, port, protokol, TLS, endpoint, timeout a region platforma odvozuje/ověřuje sama.
- Provider-generated secret lze během integrace přímo capture/upsert/rotate do existujícího Secret Manageru bez povinného copy/paste.
- Revoke/rotate/status/reveal zůstávají v existujícím CML Secret Manageru.
- Nevytváří se nový vault/password manager.
- Nová změna zpřesňuje telemetry pravidlo: plaintext, který OWNER sám vložil do OWNER-only message history, se nesmí automaticky duplikovat do technických logů, metrics, tool activity nebo browser evidence.

### B.7 Monitoring, ovladatelnost a generic repair

Každý generated prvek před aktivací prokáže runtime health/readiness, heartbeat, state/reporting, monitoring/watchdog, audit, enable/disable, relevantní quarantine/restore, permission/secret control a CML UI visibility.

Skutečná runtime/contract závada `INTERNAL_GENERATED` může z existujícího monitoringu spustit deduplikovaný/cooldown `REPAIR` generation job ve stejném generation control-plane. Repair používá aktivní lokální release a konkrétní failure evidence, zachovává component identity, vytváří nejmenší úplnou opravu, znovu prochází relevantní conformance a při failure zachová/obnoví poslední funkční release. Pokud repair enqueue selže, chyba se nesmí spolknout: vzniká existující CML alert + audit s component ID, correlation ID a technickým důvodem. Pokud repair objektivně potřebuje OWNER credential nebo rozhodnutí, přejde do cílového blocker/input modelu definovaného částí C.

### B.8 Realizační pipeline po approval freeze

Po schválení přesné `GenerationSpecification` revision/digest pokračuje jeden generation control-plane minimálně těmito odpovědnostmi:

1. intent/spec normalization bez změny schváleného funkčního významu;
2. architecture decomposition do minimálního počtu MCP/AI prvků;
3. extraction pouze skutečně chybějících realizačních vstupů;
4. integration research;
5. implementation v lokální pracovní kopii;
6. candidate deployment a skutečný runtime health/readiness;
7. `INTEGRATING`: externí provider konfigurace proti skutečně běžícím veřejným HTTPS MCP/webhook URL candidate prvků;
8. functional validation a remediation smyčka;
9. CML conformance pro identity, HTTPS, permissions, secrets, monitoring, heartbeat/state a audit;
10. activation až po PASS;
11. completion s výslednými prvky a srozumitelným výsledkem.

Kaskáda pokračuje autonomně, dokud je problém technicky řešitelný. `CANCELLED` je autoritativní: model/browser/shell práce se zastaví v nejbližším praktickém cancellation pointu, žádná další fáze ani candidate activation nesmí pokračovat a pozdní update nesmí `CANCELLED` přepsat. Již funkční aktivní release se cancellation nesmí poškodit.

`context.callExternal` / CML external HTTPS gateway není POST-only. V rámci stejného target/permission/Secret Manager/SSRF/audit/circuit-breaker standardu musí podporovat metody, query, bezpečné headers a body formáty nutné pro schválenou integraci; generated handler kvůli tomu nikdy nezískává přímý network bypass.

### B.9 Lokální pracovní kopie a release

Generation běží na serveru. Před změnou existuje lokální obnovitelný revision point/snapshot; AI pracuje v oddělené pracovní kopii/workspace; změny se lokálně a integračně ověří; nová revision se lokálně nasadí; failure se vrací na předchozí funkční lokální release. Nevzniká druhý komplikovaný release systém jen kvůli generation funkci.

### B.10 Zachované platformní základy

Cílová změna staví na existujících mechanismech, nikoli jejich náhradě:

- PostgreSQL migration baseline `001` až `013`, na kterou navazují změnou předepsané `014` a `015`;
- generic `component` / `principal` model a permissions;
- component control queue/workers;
- heartbeat challenge, state query, monitoring scheduler/watchdog;
- persistent E2E/readiness evidence;
- Secret Manager a Secret API;
- OWNER Dashboard topology a suspend/deregister řízení;
- audit chain a component audit stream;
- admin UI pro components, monitoring, identities, permissions, secrets a audit;
- local generated releases, rollback a repair.

Historické externí onboarding/GitHub-PR-CI/GHCR-OCI/integration-token cesty nesmějí být obnoveny jako product runtime flow.

### B.11 Voice input

Voice chat není součástí této implementační změny ani release gate. Budoucí voice input musí volat stejnou serverovou discussion/generation funkci jako textové UI a nesmí mít vlastní paralelní business logiku.

### B.12 Zachované cílové acceptance invarianty

Vedle detailních acceptance gates části C musí stále platit:

- OWNER zadává funkční cíl lidsky, nikoli technický deployment formulář;
- systém se doptává pouze na skutečně neodvoditelné údaje/rozhodnutí;
- výsledný MCP/agent je plně řízený CML prvek s identity + HTTPS boundary;
- generated prvek je viditelný, monitorovaný, auditovaný a OWNERem odstavitelný;
- persistentní runtime secrets používají existující Secret Manager;
- OWNER plaintext credential v trusted dialogu není blokován speciálním transfer workflow;
- nevzniká externí onboarding-token handoff ani druhý runtime token lifecycle;
- interní generation/deploy není runtime závislý na GitHub/CI/GHCR;
- chyba generated prvku neodebere OWNERovi CML control možnost diagnostiky/deaktivace/repair;
- generic repair i browser drift repair zachovávají identity a poslední funkční release/revision;
- generated handler technicky nemůže obejít CML capability boundary;
- `CANCELLED` je autoritativní;
- repair enqueue failure vytváří alert/audit evidence;
- žádný mock/demo/placeholder se nepočítá jako splnění;
- voice není podmínkou této fáze.

### B.13 Konfliktní interpretační pravidlo

Při pochybnosti se používá tato otázka:

> Dostane OWNER jednoduchým lidským zadáním autonomně připravenou a po explicitním schválení vytvořenou funkční schopnost, která je normálním plně řízeným prvkem KajovoCML podle jednoho existujícího CML standardu, bez skrytého paralelního control-plane a bez redukce schváleného scope?

Pokud odpověď není jednoznačně ano, implementace není v souladu s tímto SSOT.

---

# C. Detailní výrobní specifikace změny — normativní a úplná

Následující část je integrální součástí `docs/SSOT_CURRENT.md`. Její požadavky jsou normativní, programátorsky závazné a zpřesňují cílové chování popsané v části B.

# KájovoCML — výrobní specifikace persistentní AI diskuse, interaktivní browserové konfigurace, deterministické webové automatizace a realizační orchestrace

**Dokument:** závazné výrobní zadání pro paralelní implementační tým a integračního architekta  
**Repozitář:** `karelmartinek-a11y/KajovoCML`  
**Implementační branch:** `main` jako zdrojový základ pro pracovní větve  
**Cílové prostředí:** produkční Ubuntu server; webový klient pro desktop, tablet a mobil  
**Technologický profil:** Node.js 24+, TypeScript, React, PostgreSQL, pnpm, Playwright s verzovaně spravovaným Chromium na Ubuntu, OpenAI Responses API  
**Režim dodávky:** úplná production-grade implementace všech požadavků tohoto dokumentu

---

# 0. Status, autorita a způsob použití dokumentu

Tento dokument je jediným závazným výrobním kontraktem pro implementaci pracovního prostoru `Generování` v KájovoCML. Všechny pracovní skupiny P0–P7 z něj odvozují datový model, lifecycle, API, AI orchestrace, browser chování, frontend, testy, release gates a dokumentaci.

Každý požadavek je normativní. Formulace `musí`, `je`, `používá`, `zajišťuje`, `vrací`, `ukládá`, `ověřuje` a `provádí` označují závazné chování cílového systému. Implementace je přijatelná pouze tehdy, když je požadované chování skutečně funkční v integračním běhu, je persistentní tam, kde dokument požaduje persistenci, a je ověřitelné automatickým nebo manuálním testem.

Implementační tým nesmí redukovat funkční rozsah kvůli času, složitosti, pohodlnosti merge procesu nebo omezení jednotlivé pracovní větve. Pokud pracovní skupina zjistí konflikt, který nelze vyřešit v rámci zde uvedených invariantů, předá jej P0 jako blocker. P0 může sjednotit pouze implementační kontrakt; funkční záměr OWNERa se tím nemění.

Dokument je samonosný. Programátor odpovědný za konkrétní část nemusí znát vznik zadání ani jiné varianty jeho textu. Pro správnou implementaci potřebuje tento dokument, repozitářová pravidla a handoffy explicitně uvedené u jeho role.

---

# 1. Produktový cíl

KájovoCML poskytuje OWNERovi persistentní serverový pracovní prostor, ve kterém OWNER společně s AI připraví přesné zadání výroby MCP serveru, funkce, integrace, deterministické webové automatizace nebo AI prvku před zahájením realizační pipeline.

Pracovní prostor spojuje pět současně dostupných oblastí:

1. **Diskusi OWNER ↔ AI**, která je persistentní, auditovatelná, streamovaná a obnovitelná mezi klienty.
2. **Aktuální zadání**, které AI průběžně udržuje jako verzovanou `GenerationSpecification`.
3. **Browser/Evidence prostor**, ve kterém AI může provádět serverový webový průzkum a OWNER vidí bezpečný obraz relevantního browserového stavu.
4. **Interaktivní browserovou přípravu**, ve které AI může po bezpečném předání přihlašovacích údajů OWNERem sama otevřít externí web, přihlásit se, provést autorizované nastavení, zaznamenat přesný pracovní postup a ověřit jej opakovaným průchodem.
5. **Průběh výroby**, který po schválení zobrazuje stav realizační pipeline až do terminálního výsledku.

OWNER může začít práci na desktopu, pokračovat na mobilu a následně se vrátit na jiný klient bez ztráty historie, specifikace, browserového kontextu nebo stavu jobu. Autoritou je serverová perzistence, nikoliv stav konkrétního browserového tabu.

AI vystupuje jako aktivní technický spolupracovník. Sama ověřuje fakta, používá dostupné nástroje, dohledává canonical capabilities KájovoCML, pracuje s browserem, navrhuje řešení, umí v OWNERem autorizovaném účtu na externím webu provést potřebnou konfiguraci a umí společně s OWNERem naučit přesný webový pracovní postup. Výsledkem diskuse je viditelná a OWNERem čitelná specifikace včetně případných browserových automatizačních požadavků, nikoliv skrytý interní modelový plán.

Realizační pipeline se spouští až po explicitním schválení konkrétní revize `GenerationSpecification`. Server při schválení ověřuje revizi, digest, stav jobu, otevřené otázky a aktivitu diskusního turnu. Schválená specifikace je immutable funkční autorita pro planner a všechny realizační fáze. Pokud zadání obsahuje webovou automatizaci, výsledná produkční capability provádí rutinní webové kroky deterministicky prostřednictvím platformního `KCML Browser Automation Runtime`, bez modelového rozhodování a bez závislosti na AI při jednotlivých produkčních spuštěních.

---

# 2. Terminologie a role

## 2.1 OWNER

`OWNER` je autorizovaný uživatel oprávněný zakládat generation joby, psát zprávy do diskuse, sledovat browser preview, číst revize specifikace, schvalovat specifikaci, rušit job a řešit explicitně vyžádaný vstup.

OWNER je jediná uživatelská role, která provádí mutace popsané v tomto dokumentu. Všechny mutační routes musí používat stejný autentizační a CSRF model jako ostatní chráněné OWNER operace aplikace.

## 2.2 Generation job

`Generation job` je persistentní serverová jednotka celé práce od založení diskuse po dokončení výroby, zrušení, selhání nebo blocker. Obsahuje lifecycle stav, vazbu na diskusní zprávy a turny, aktuální a schválenou specifikaci, auditní informace a vazby na realizační pipeline.

## 2.3 Discussion message

`Discussion message` je immutable položka historie diskuse s deterministickým pořadím. Zpráva má roli `OWNER`, `ASSISTANT` nebo `SYSTEM`, vlastní status a vazbu na turn, pokud vznikla v jeho rámci.

## 2.4 Discussion turn

`Discussion turn` je jedna serverově řízená AI práce zahájená zprávou OWNERa nebo explicitním continuation mechanismem. Turn zahrnuje modelový request, streaming, tool loop, případnou browserovou aktivitu, návrh revize specifikace a konečný status.

## 2.5 GenerationSpecification

`GenerationSpecification` je OWNERem čitelný produktový kontrakt. Obsahuje funkční cíl, pravidla, integrace, omezení, ověřená fakta, acceptance criteria a otevřené otázky. Jednotlivé revize jsou immutable.

## 2.6 GenerationPlan

`GenerationPlan` je interní technický plán realizace odvozený ze schválené `GenerationSpecification`. Není uživatelskou schvalovací branou a nemůže změnit funkční význam schváleného zadání.

## 2.7 Browser session

`Browser session` je job-specific serverová Playwright relace nad Chromium používaná AI pro průzkum, konfiguraci externích webů, teaching průchody a ověřovací replay. Session má job-specific browser context nebo persistentní profil, definovaný lifecycle, resource limity, cleanup a bezpečný preview contract.

## 2.8 Browser preview

`Browser preview` je event-driven obrazový důkaz stavu browseru. Preview používá režimy `NORMAL` a `SENSITIVE`; citlivý frame není distribuován klientovi.

## 2.9 Capability

`Capability` je canonical schopnost evidovaná v KájovoCML, kterou lze znovu použít při řešení požadavku. AI provádí capability-first lookup před rozhodnutím vytvářet další funkci nebo MCP server se stejnou odpovědností.

## 2.10 External operation scope

`External operation scope` je serverově evidovaný rozsah činností na externím webu, které OWNER výslovně požaduje v zadání nebo v navazující zprávě. Scope váže účel, účet nebo portál, povolené originy a třídy operací na konkrétní generation job a zdrojovou OWNER zprávu. Běžné kroky uvnitř takto vymezeného úkolu nevyžadují samostatné potvrzení každého kliknutí.

## 2.11 Irreversible action confirmation

`Irreversible action confirmation` je jednorázové potvrzení používané pouze pro krok s nevratným nebo mimořádně významným dopadem, například smazání produkčního objektu, zrušení přístupu, publikaci do produkce, finanční operaci nebo jinou akci, jejíž následky nelze spolehlivě vrátit. Pokud OWNER takovou akci jednoznačně a konkrétně zadal již v aktuální instrukci, server tuto instrukci může použít jako platné potvrzení stejného action digestu.

## 2.12 Browser teaching run

`Browser teaching run` je přípravný průchod, při kterém AI s OWNERem provede požadovaný proces na reálném webu a KájovoCML z průchodu sestaví strukturovaný workflow contract. Teaching není modelové učení. Výstupem jsou významové kroky, vstupní vazby, locatory, podmínky, assertions, side-effect semantika a očekávané výstupy.

## 2.13 Deterministic browser automation

`Deterministic browser automation` je produkční webový proces prováděný bez LLM. Produkční běh interpretuje immutable `BrowserAutomationManifest` v platformním Playwright runtime, pracuje pouze s deklarovanými vstupy, secret bindingy a povolenými webovými originy a vrací strukturovaný výsledek.

## 2.14 BrowserAutomationManifest

`BrowserAutomationManifest` je immutable deklarativní program konkrétní automatizace. Obsahuje workflow DSL, locator contract, vstupní a výstupní schema, navigation policy, authentication bindingy, side-effect a retry semantiku, concurrency, časové a resource limity, assertions, artifact pravidla, monitoring a repair policy. Manifest neobsahuje libovolný vykonatelný JavaScript dodaný generovanou komponentou.

## 2.15 KCML Browser Automation Runtime

`KCML Browser Automation Runtime` je jedna kanonická platformní CML služba s vlastní component/principal identitou, monitoringem, auditem, Secret Manager oprávněními a runtime lifecycle. Jako jediná produkční vrstva pro browserové automatizace smí spouštět Playwright a Chromium. Generované MCP komponenty ji volají přes standardní `context.callComponent` a nedostávají přímý přístup k browser procesu, Node process API, filesystemu ani síti.

## 2.16 Browser automation definition a revision

`Browser automation definition` je stabilní identita jedné naučené schopnosti. `Browser automation revision` je immutable konkrétní verze manifestu a jeho digestu. Definition ukazuje na jednu aktivní revision a podporuje bezpečný rollback na dříve ověřenou revision.

## 2.17 Browser automation run

`Browser automation run` je samostatná persistentní instance jednoho produkčního spuštění. Má vlastní id, stav, caller principal, vstupy bez plaintext secretů, revision id, step checkpointy, časy, výsledek, bezpečné evidence, cancellation intent a error klasifikaci. Rutinní run není generation job.

## 2.18 Authentication binding

`Authentication binding` je vazba automatizace na účet a credential materiál v Secret Manageru. Generovaná business komponenta standardně nemá grant na přihlašovací secret externího portálu; přístup získává pouze platformní Browser Automation Runtime pro přesně určenou automatizaci.

## 2.19 Human challenge

`Human challenge` je stav, kdy deterministický běh potřebuje OWNER interakci, například push MFA, jednorázový kód, CAPTCHA, WebAuthn nebo jiné potvrzení, které nelze korektně vyřešit uloženým credential flow. Run se bezpečně pozastaví a pokračuje ze serverového checkpointu po splnění výzvy. Systém nesmí obcházet CAPTCHA nebo ochranné mechanismy portálu.

## 2.20 Automation drift

`Automation drift` je prokazatelná změna cílového webu nebo autentizačního toku, kvůli které již aktivní revision nesplňuje svůj deterministický contract. Drift je diagnostický stav automatizace, který spouští existující CML monitoring/repair mechanismus a nevytváří skrytou runtime úpravu manifestu.

## 2.21 Standardní provozní kontrakt automatizace

Každá aktivní browserová automatizace automaticky poskytuje provozní schopnosti `preflight`, `execute/start`, `status`, `result`, `cancel`, `history`, `reauthenticate` a `repair/reteach` v odpovídající OWNER administraci nebo platformním API. Business MCP nástroj vystavuje pouze funkce, které dávají smysl uživateli; provozní schopnosti jsou standardní součástí CML lifecycle a nemusejí být opakovaně explicitně uvedeny v jednotlivém zadání.

# 3. Architektonické invarianty

## 3.1 Serverová autorita

Veškerá autoritativní logika generation workflow běží na Ubuntu serveru. Server zajišťuje:

- Fastify/backend,
- PostgreSQL,
- generation worker,
- OpenAI orchestrace,
- persistentní diskusní historii,
- `GenerationSpecification` revisions,
- generation event log,
- Playwright + Chromium,
- generation workspace,
- Secret Manager,
- monitoring,
- audit,
- realizační pipeline,
- cleanup a recovery.

Desktop, tablet a mobil fungují jako weboví klienti stejného serverového stavu. Zavření karty, reload, výměna zařízení ani dočasná ztráta sítě nesmí ukončit serverovou práci jen proto, že klient není připojen.

Klientská perzistence může sloužit pouze pro neautoritativní UX pomocné hodnoty, například preference velikosti panelu. Historie zpráv, stav jobu, aktuální specifikace, schválená specifikace, stav turnu a lifecycle realizace se vždy načítají ze serveru.

## 3.2 Jeden CML control-plane a oddělené runtime odpovědnosti

Celé řešení zůstává uvnitř jednoho existujícího KájovoCML control-plane. Generation job, component/principal identity, Secret Manager, oprávnění, monitoring, audit, local releases, conformance a repair používají stávající platformní mechanismy.

Přípravná AI browserová práce běží v trusted generation vrstvě a používá Playwright nad serverovým Chromium. Rutinní produkční browserové operace vykonává `KCML Browser Automation Runtime`, který je registrován jako kanonická platformní CML komponenta. Generovaný MCP prvek zůstává v existujícím restricted handler sandboxu a browserovou operaci vyvolává přes `context.callComponent` proti přesně povolenému platformnímu toolu.

Generovaný handler nedostává `playwright`, `child_process`, `process`, přímý `fetch`, host filesystem, browser executable ani jinou cestu k obejití CML capability boundary. Přidání browserové automatizace nesmí oslabit existující sandbox.

Playwright je implementační engine platformní browserové služby, nikoliv druhý control-plane. Produkční Ubuntu server používá verzovanou Playwright dependency a kompatibilní Playwright-managed Chromium. Externí placená browserová služba není runtime předpokladem.

Každá generated browser capability se skládá ze dvou jasně oddělených částí:

1. business MCP/function adapteru v generované komponentě, který validuje business vstup a volá povolenou platformní browser capability;
2. immutable automation definition/revision interpretované trusted Browser Automation Runtime.

Tím se zachová existující CML model identity, permissions, Secret grants, monitoring, audit a repair a současně nevznikne privilegovaný generovaný kód.

## 3.3 Oddělení diskuse a produkční realizace

Stav `DISCUSSING` je produktová přípravná fáze. V této fázi jsou součástí cílového workflow následující operace:

- persistovat OWNER/ASSISTANT/SYSTEM zprávy,
- provádět webový research,
- číst canonical capabilities a technické kontrakty KájovoCML,
- používat job-specific Playwright/Chromium pro průzkum, interaktivní konfiguraci a teaching,
- přihlašovat se do OWNERem určených externích webových účtů pomocí credentialu předaného trusted diskusí nebo credential polem,
- provádět OWNERem autorizované změny na externím webovém portálu,
- zaznamenávat teaching kroky a jejich důkazy,
- spouštět deterministický replay kandidátního workflow pro ověření jeho reprodukovatelnosti,
- vytvářet browser preview,
- vytvářet immutable revize `GenerationSpecification`,
- evidovat otevřené otázky a ověřená fakta,
- používat bezpečný mechanismus vstupu secretu.

KájovoCML release objekty realizace vznikají až po úspěšném approval freeze a vstupu do `ANALYZING`. Externí webové mutace provedené během přípravy jsou browserová činnost omezená explicitním `External operation scope` odvozeným z OWNER instrukce a audit je navázán na konkrétní zdrojovou OWNER zprávu a scope digest. Produkční MCP/function artefakt, runtime principal, runtime credential binding, release a activation vznikají v realizační části lifecycle.

## 3.4 Vstupní prompt jako evidence

Text, kterým OWNER job založil, je immutable vstupní evidence. Datové pole určené pro tento účel se po založení jobu nepřepisuje a není používáno jako jediná realizační autorita.

Po schválení se realizační autoritou stává dvojice:

- `approved_spec_revision_id`,
- `approved_spec_digest`.

Planner a realizační prompty získávají plný obsah schválené specifikace a ověřují její digest proti serverově uložené hodnotě.

## 3.5 Credentials, OWNER chat a Secret Manager

Trusted OWNER diskuse je součástí chráněného administračního prostoru. OWNER smí předat username, heslo, API klíč, OTP nebo jiný credential přímo v diskusi nebo přes dedikované credential pole. KájovoCML nesmí kvůli tomu zavádět povinný paralelní transfer nebo approval workflow.

Dedikované credential pole je preferovaný ergonomický způsob pro persistentní hesla a klíče, protože umožní okamžité uložení do Secret Manageru a maskované zobrazení. Pokud OWNER credential uvede v trusted diskusi, zpráva zůstává součástí OWNER-only historie podle existujícího trust modelu; operační logy, telemetry a browser evidence však nesmějí vytvářet další kopie plaintext hodnoty.

Persistentní runtime credential se ukládá pouze do existujícího Secret Manageru. Generation/browser orchestrace a Browser Automation Runtime používají stable secret name nebo opaque secret reference. Generovaná MCP komponenta dostane grant na secret pouze tehdy, pokud jej sama potřebuje pro jinou business odpovědnost; browserové login credentials jsou standardně grantované pouze platformnímu Browser Automation Runtime.

Playwright `storageState`, session cookies, refresh tokeny a obdobný browser auth state mají stejnou citlivost jako credential. Persistentní auth state je uložen jako secret-grade artefakt s versioningem, granty, revoke/rotate semantikou a nikdy není součástí generated source, manifestu, běžného logu, SSE tool activity ani klientského cache.

Browser preview přechází do `SENSITIVE` před zobrazením nebo vyplněním credential materiálu. Citlivý frame se klientovi nedistribuuje. Po opuštění citlivého UI se vytvoří nový bezpečný frame.

## 3.6 Production-grade úplnost

Každý endpoint, worker path, UI stav a test popsaný v dokumentu musí být napojen na skutečnou backendovou logiku. Stavová změna musí odpovídat reálnému provedení operace. Browser preview musí pocházet ze skutečné job-specific Playwright/Chromium session. Persistentní chat se musí obnovit z databáze. Approval musí pracovat s uloženou revizí a digestem.

Implementace je neúplná, pokud některá z těchto cest existuje pouze jako UI simulace, lokální React stav, statická odpověď, test-only branch nebo ručně nasazený artefakt mimo definovaný runtime flow.

## 3.7 Deterministický produkční browser runtime

Rutinní webová automatizace je interpretována trusted `KCML Browser Automation Runtime` podle immutable `BrowserAutomationManifest`. Jednotlivý run nevolá OpenAI Responses API ani jiný LLM provider a nemůže si za běhu generovat nové kroky.

Workflow je deklarativní a používá pouze platformou podporované browser primitives, podmínky, bounded větvení a bounded opakování. Libovolný JavaScript, `page.evaluate` s generovaným kódem, dynamický import nebo spuštění generovaného procesu není součástí manifest contractu.

Každá automation definition má immutable revisions, serverově počítaný digest, aktivní revision, stav `ACTIVE | DISABLED | DEGRADED | REAUTH_REQUIRED` a auditovanou možnost rollbacku. Změna workflow, locatorů, autentizace, origin policy, side-effect semantiky nebo success criteria vytváří novou revision.

Každé produkční spuštění vzniká jako persistentní `browser_automation_run` s vlastním lifecycle, lease, cancellation intentem, step checkpointy a resultem. Generation lifecycle slouží k vytvoření nebo opravě automatizace; běžné produkční invocation nejsou generation joby.

Standardní provozní vrstva automaticky zajišťuje preflight, health, run history, cancel, reauthentication, drift detection, monitoring a repair handoff. Tyto schopnosti jsou součástí cílového produktu i tehdy, když je OWNER v jednotlivém zadání výslovně nevyjmenuje.

# 4. Lifecycle generation jobu

## 4.1 Stavový model

Autoritativní lifecycle používá tyto produktové stavy:

```text
DISCUSSING
ANALYZING
IMPLEMENTING
INTEGRATING
VALIDATING
CML_CONFORMANCE
ACTIVATING
COMPLETED
BLOCKED
FAILED
CANCELLED
```

Job je po úspěšném `POST /api/generation/jobs` uložen ve stavu `DISCUSSING`. Vytvoření databázového záznamu a inicializace diskusního kontextu proběhnou atomicky tak, aby klient po úspěšné odpovědi nepozoroval mezistav bez funkčního discussion contractu.

## 4.2 Primární přechody

```text
DISCUSSING
  -> ANALYZING            po úspěšném approval freeze
  -> CANCELLED            po autoritativním zrušení
  -> FAILED               při nerecoverable systémovém selhání diskusní vrstvy

ANALYZING
  -> IMPLEMENTING         po vytvoření validního interního GenerationPlan
  -> BLOCKED              při reálném blockeru vyžadujícím OWNER vstup
  -> FAILED
  -> CANCELLED

IMPLEMENTING
  -> INTEGRATING
  -> BLOCKED
  -> FAILED
  -> CANCELLED

INTEGRATING
  -> VALIDATING
  -> BLOCKED
  -> FAILED
  -> CANCELLED

VALIDATING
  -> CML_CONFORMANCE
  -> BLOCKED
  -> FAILED
  -> CANCELLED

CML_CONFORMANCE
  -> ACTIVATING
  -> BLOCKED
  -> FAILED
  -> CANCELLED

ACTIVATING
  -> COMPLETED
  -> BLOCKED
  -> FAILED
  -> CANCELLED
```

`COMPLETED`, `FAILED` a `CANCELLED` jsou terminální. `BLOCKED` je neterminální pouze tehdy, pokud konkrétní blocker obsahuje definovaný a bezpečný resume path. Resume musí pokračovat z uloženého lifecycle kontextu bez duplikace component, runtime identity, release nebo jiného side effectu.

## 4.3 Diskusní waiting behavior

Běžné čekání na odpověď OWNERa během přípravy specifikace nemění stav jobu z `DISCUSSING`. AI turn se ukončí a job zůstane `DISCUSSING` s otevřenou otázkou v aktuální specifikaci nebo s eventem `owner.input.required`.

`BLOCKED` se používá pro realizační blocker, nikoliv jako náhrada běžného konverzačního čekání.

## 4.4 Technický plán

`GenerationPlan` vzniká ve stavu `ANALYZING`. Vznik plánu nezavádí samostatnou OWNER approval bránu. Úspěšná analýza přechází přímo do `IMPLEMENTING`.

Planner smí rozhodovat o technickém způsobu implementace v mezích schválené specifikace. Nesmí měnit business rules, acceptance criteria, explicitní OWNER rozhodnutí ani funkční rozsah.

## 4.5 Blocker po approval freeze

Pokud realizační fáze narazí na skutečnou nejednoznačnost, která vyžaduje produktové rozhodnutí, job přejde do `BLOCKED`. Blocker obsahuje:

- `origin_state`, tedy lifecycle stav, ze kterého job do blockeru vstoupil,
- strojový `blocker_code`,
- uživatelsky srozumitelný popis,
- přesný chybějící vstup nebo rozhodnutí,
- technický kontext potřebný k rozhodnutí,
- informaci, zda lze po vyjasnění pokračovat beze změny schváleného scope.

Schválená revize se v `BLOCKED` nepřepisuje. OWNER odpověď může vyjasnit pouze význam, který je kompatibilní se schválenou specifikací. Rozhodnutí měnící funkční scope se nesmí skrytě propsat do planneru nebo workeru.

---

# 5. Produktový tok OWNERa

## 5.1 Založení jobu

1. OWNER otevře stránku `Generování`.
2. Zadá vstupní popis cíle.
3. Klient odešle `POST /api/generation/jobs` s idempotency identifikátorem requestu.
4. Server založí job ve stavu `DISCUSSING`, uloží vstupní prompt jako immutable evidence a vytvoří počáteční OWNER message.
5. Server publikuje počáteční generation eventy.
6. Worker zahájí discussion turn nebo zařadí turn do fronty podle worker concurrency.
7. Klient otevře SSE stream a zobrazuje authoritative state.

## 5.2 Diskuse

Během diskuse může OWNER posílat libovolný počet zpráv. Každá zpráva je okamžitě persistována před spuštěním AI práce. Úspěšně přijatá zpráva se proto nesmí ztratit při modelovém timeoutu, worker restartu ani klientském disconnectu.

AI při každém turnu:

1. načte serverovou historii potřebnou pro kontext,
2. načte aktuální `GenerationSpecification`,
3. vyhodnotí, zda potřebuje web, capability lookup, contract read nebo browser,
4. provede potřebné tool calls,
5. průběžně streamuje uživatelsky relevantní odpověď,
6. zhodnotí, zda se funkční obsah specifikace změnil,
7. při skutečné změně vytvoří novou immutable revision,
8. ukončí turn stavem `COMPLETED`, `INTERRUPTED` nebo `FAILED`.

## 5.2.1 Interaktivní konfigurace externího portálu

Když splnění zadání vyžaduje nastavit externí developerský nebo provozní portál, AI smí tuto práci provést v browseru jako součást přípravy. Server nejprve určí `External operation scope` z explicitní OWNER instrukce: účel, cílový účet/portál, povolené originy a význam povolených změn.

Typický průchod:

1. AI otevře cílový portál a ověří jeho aktuální stav.
2. Pokud je nutná autentizace, požádá OWNERa o potřebný credential nebo použije již existující autorizovaný Secret Manager binding.
3. OWNER může credential zadat přímo v trusted diskusi nebo přes credential pole.
4. Browser se přihlásí a pokračuje ve stejné job-specific session.
5. AI provede kroky odpovídající explicitnímu operation scope bez samostatného potvrzování každého běžného Save/Continue kroku.
6. Před nevratným nebo mimořádně významným krokem server ověří, zda je stejný krok již jednoznačně obsažen v aktuální OWNER instrukci; jinak vyžádá jednorázové potvrzení konkrétního action digestu.
7. Po každé významné změně AI ověří postcondition a uloží bezpečnou evidence summary.
8. Výsledek konfigurace se propíše do `verifiedFacts`, integračních údajů a případných secret bindingů.

Pokud portál vyžaduje push MFA, OTP, CAPTCHA, WebAuthn nebo potvrzení na druhém zařízení, browser session se zachová a UI zobrazí `BROWSER_AUTH_REQUIRED`. Systém neimprovizuje obcházení ochranného mechanismu.

## 5.2.2 Teaching deterministického webového workflow

Pokud má výsledná MCP/function schopnost později rutinně provádět webový úkon bez AI, discussion orchestrator zahájí teaching run. AI provede proces na reálném webu a recorder zaznamená pouze významové kroky.

Každý teaching step obsahuje minimálně:

- business význam kroku,
- akční primitive,
- semantic locator contract a fallbacky,
- input nebo secret binding,
- precondition,
- wait/actionability podmínku,
- postcondition,
- `sideEffectClass`,
- `retryClass`,
- pravidlo pro nejistý výsledek po timeoutu/crashi,
- bezpečný observed result.

Recorder nezapisuje scroll nebo hover, pokud nejsou funkčně nutné, a nepřenáší transientní DOM id, CSRF tokeny, session query parametry ani jiné jednorázové technické hodnoty do canonical workflow.

AI a OWNER mohou během teaching kroky slovně upravit: označit hodnotu jako runtime input, secret, konstantu, podmínku nebo business výstup. Výsledkem je kandidátní `BrowserAutomationRequirement` a nikoliv záznam kliknutí závislý na jedné konkrétní session.

## 5.2.3 Deterministický replay, preflight a aktivace požadavku

Před approval musí být kandidátní automatizace ověřena stejným platformním interpreterem, který bude používat produkční runtime. Replay nevolá model provider.

Pokud lze workflow bezpečně opakovat, provede se plný replay. U nevratných nebo ne-idempotentních kroků se používá preflight, read-back/postcondition ověření, testovací entita, reverzibilní testovací cesta nebo jiný důkaz, který nevyvolá duplicitní škodlivý side effect jen kvůli testu.

PASS vyžaduje:

- validní manifest candidate,
- splnění všech preconditions a postconditions,
- jednoznačné locatory,
- dodržení navigation policy,
- validní typed output,
- ověření auth/re-auth contractu,
- ověření retry/idempotency semantiky relevantních mutací,
- žádný modelový call během replaye.

Neúspěšný replay vrátí přesný krok, failure code a bezpečný observed state a vrátí práci do diskuse/teaching. Schvalovatelná specifikace může odkazovat pouze na candidate workflow, jehož povinné verification gates jsou PASS.

## 5.3 Steer během turnu

OWNER může poslat korekci během běžícího AI turnu. Server ji persistuje dříve, než zahájí interruption logiku.

Pokud běží steerable turn:

1. nová OWNER message dostane serverové `sequence`,
2. aktivní modelový request dostane cancellation signal,
3. turn se ukončí jako `INTERRUPTED`,
4. částečná assistant message zůstane auditovatelná se statusem `INTERRUPTED`,
5. lease aktivního turnu se uvolní,
6. bez ztráty OWNER message vznikne další turn,
7. další turn pracuje s aktuální historií včetně korekce.

Pokud interruption request nedokáže okamžitě ukončit upstream request, server nesmí spustit druhý souběžný aktivní turn nad stejným jobem. Použije stav `interrupt_requested` nebo ekvivalentní interní signalizaci a další turn zařadí až po bezpečném uvolnění single-active-turn guardu.

## 5.4 Připravenost specifikace

UI považuje specifikaci za schvalovatelnou pouze pokud současně platí:

- job je `DISCUSSING`,
- existuje `current_spec_revision_id`,
- klient zobrazuje právě tuto revision,
- klient zná serverem vrácený digest,
- `openQuestions` je prázdné pole,
- neběží aktivní discussion turn,
- job nemá pending cancellation,
- klient nemá stale state signal.

## 5.5 Approval

Primární CTA ve stavu `DISCUSSING` má text:

**Schválit zadání a realizovat**

Kliknutí odešle přesné `specRevisionId` a `specDigest`. Server provede atomickou kontrolu a freeze. Teprve úspěšný freeze mění job na `ANALYZING`.

## 5.6 Realizace

Po approval UI přepne specifikaci do read-only režimu a zobrazuje:

- schválenou revision,
- digest,
- stav jobu,
- průběh jednotlivých realizačních fází,
- blocker nebo error, pokud vznikne,
- konečný výsledek.

---

# 6. UX a informační architektura

## 6.1 Společné UX principy

Stránka `Generování` funguje jako pracovní prostor, nikoliv jako formulář s jedním promptem. V každém viewportu musí být zřejmé:

- který job je otevřen,
- jaký je jeho lifecycle stav,
- zda AI pracuje,
- jaká je poslední OWNER message,
- co AI právě dělá,
- jaká je aktuální revize zadání,
- zda existují otevřené otázky,
- zda lze zadání schválit,
- zda browser preview obsahuje bezpečný frame,
- zda realizace běží, čeká, selhala nebo byla zrušena.

UI nezobrazuje interní chain-of-thought. Zobrazuje pouze uživatelsky relevantní pracovní stav, název nástroje nebo činnosti, bezpečný stručný popis aktivity a výsledek, který je vhodný pro OWNERa.

## 6.2 Desktop layout

Desktop používá dvouoblastní pracovní plochu:

```text
+-----------------------------------------------------------------------+
| Header: job / název / stav / globální akce                            |
+--------------------------------------+--------------------------------+
|                                      | Browser / Evidence              |
| Diskuse OWNER <-> AI                 |--------------------------------|
|                                      | Aktuální zadání                 |
| - historie                           | - revize + digest               |
| - streaming                          | - objective                     |
| - tool activity                      | - requirements                  |
| - owner input                        | - constraints                   |
| - working/error states               | - acceptance criteria           |
|                                      | - verified facts                |
|                                      | - open questions                |
+--------------------------------------+--------------------------------+
| Composer                                                              |
+-----------------------------------------------------------------------+
```

Pravý panel je resizable a collapsible. Collapsed stav musí ponechat viditelný indikátor stavu specifikace, počet otevřených otázek a stav browser preview. Resize preference může být uložena klientsky jako čistě prezentační preference.

Diskusní oblast je primární. Composer zůstává dostupný během scrollování historie a nesmí zakrývat poslední zprávu. Při streamingu se automatický scroll provádí pouze tehdy, pokud uživatel zůstává u konce historie; při ručním čtení starších zpráv se jeho pozice nesmí násilně přepisovat.

## 6.3 Tablet layout

Tablet může používat dvoupanelový nebo single-column režim podle skutečné šířky. Při nedostatku horizontálního prostoru se browser/spec oblast přesune do tabů nebo draweru. Obsah nesmí vyžadovat horizontální scroll celé stránky.

## 6.4 Mobilní layout

Mobil používá single-column strukturu s taby:

- **Diskuse**
- **Náhled**
- **Zadání**
- **Průběh**

Tab `Diskuse` obsahuje historii a composer. Tab `Náhled` obsahuje browser frame, bezpečný stav a metadata. Tab `Zadání` obsahuje aktuální nebo schválenou specifikaci. Tab `Průběh` obsahuje lifecycle timeline a runtime stav.

Přepnutí tabu nesmí resetovat draft composeru ani authoritative data načtená pro job. Po návratu z backgroundu klient provede resynchronizaci serverového stavu.

## 6.5 Povinné vizuální stavy

UI má explicitní prezentaci pro:

- `AI_QUEUED` — turn čeká ve worker queue,
- `AI_WORKING` — modelový turn běží,
- `WEB_SEARCH` — probíhá webový research,
- `CAPABILITY_LOOKUP` — probíhá vyhledání canonical capability,
- `BROWSER_LOADING` — browser načítá stránku nebo čeká na stav,
- `BROWSER_AUTH_REQUIRED` — browser vyžaduje secure credential nebo auth challenge od OWNERa,
- `IRREVERSIBLE_ACTION_CONFIRMATION_REQUIRED` — nevratný browserový krok čeká na konkrétní OWNER potvrzení,
- `BROWSER_TEACHING` — probíhá teaching run a zaznamenávají se workflow kroky,
- `BROWSER_REPLAY` — kandidátní workflow běží deterministicky bez AI,
- `AUTOMATION_DRAFT_READY` — aktuální specifikace obsahuje validní browser automation requirement,
- `BROWSER_READY` — bezpečný frame je dostupný,
- `BROWSER_SENSITIVE` — preview je chráněné,
- `OWNER_INPUT_REQUIRED` — AI ukončila turn s konkrétní otázkou,
- `SPEC_UPDATED` — vznikla další revision,
- `SPEC_READY` — aktuální revision splňuje approval podmínky,
- `SPEC_STALE` — klient zobrazuje revision, která již není aktuální,
- `IMPLEMENTATION_RUNNING`,
- `BLOCKED`,
- `FAILED`,
- `CANCELLED`,
- `COMPLETED`.

Každý stav musí mít textový label; význam nesmí být sdělen pouze barvou nebo animací.

## 6.6 Composer

Composer podporuje:

- víceřádkový text,
- odeslání klávesovou akcí podle UI conventions aplikace,
- dostupnou alternativu přes tlačítko,
- disabled stav pouze tehdy, když server nemůže zprávu bezpečně přijmout,
- odeslání zprávy i během steerable turnu,
- bezpečný lokální draft během krátkého reconnectu,
- generování `client_message_id` před odesláním,
- retry se stejným `client_message_id`.

Po potvrzení serverem se optimistic položka sváže se serverovým message id a sequence. Při `409` nebo validační chybě se zobrazí srozumitelný retry/error stav bez vytvoření duplicitní zprávy.

## 6.7 Zobrazení specifikace

Panel `Aktuální zadání` zobrazuje minimálně:

- číslo revision,
- digest ve zkrácené podobě s možností zobrazit celý,
- objective,
- result summary,
- behavioral requirements,
- inputs and outputs,
- external systems,
- business rules,
- explicit OWNER decisions,
- constraints,
- acceptance criteria,
- verified facts,
- open questions.

Každá sekce musí být čitelná i při dlouhém obsahu. Dlouhé texty se zalamují, seznamy zachovávají pořadí a žádná sekce nesmí přetékat mimo panel.

## 6.8 Approval UX

CTA `Schválit zadání a realizovat` je výrazná primární akce pouze tehdy, když je revision schvalovatelná. Při neaktivním CTA UI zobrazí konkrétní důvod, například:

- AI dokončuje turn,
- zadání obsahuje otevřené otázky,
- načítá se aktuální revision,
- zobrazená revision je zastaralá,
- job není ve stavu `DISCUSSING`.

Po úspěšném approval se specifikace přepne do read-only zobrazení označeného jako schválená revision.

## 6.9 Accessibility a ergonomie

Frontend musí zajistit:

- logické pořadí tabulátoru,
- viditelný focus,
- labely formulářových prvků,
- přístupné názvy ikonových tlačítek,
- keyboard ovládání tabů a hlavních akcí,
- focus management po erroru a po otevření relevantního panelu,
- touch targets vhodné pro mobilní ovládání,
- textové statusy pro loading/error/blocked stavy,
- zachování čitelnosti při zvětšení textu,
- žádné horizontální rozbití na povinných viewport rozměrech.

Povinné viewport QA:

- `390 × 844`,
- `768 × 1024`,
- `1366 × 768`,
- `1920 × 1080`.

## 6.10 Browser interaction, teaching a provoz automatizací

Browser panel zobrazuje režim `RESEARCH | CONFIGURATION | TEACHING | REPLAY`, cílový origin, auth stav, aktuální krok, stav sensitivity a případný human challenge. OWNER může AI kdykoli slovně korigovat bez přepínání do technického editoru selectorů.

Credential lze vložit v trusted chat composeru i přes samostatné credential pole. Dedikované pole po uložení zobrazí pouze název secretu, stav a případnou expiraci; plaintext se nevrací. Pokud OWNER credential pošle v diskusi, aplikace tuto zprávu neodmítá a nevytváří další povinný transfer dialog.

Když browser zjistí krok s nevratným dopadem, UI zobrazí konkrétní cíl, stručný důsledek a tlačítko potvrzení pouze tehdy, pokud tento přesný krok není již jednoznačně autorizován aktuální OWNER instrukcí.

Teaching timeline zobrazuje význam kroků, locator popsaný lidsky, input/secret binding, precondition, postcondition a side-effect/retry semantiku. Raw selector a interní browser handle jsou dostupné pouze v technickém detailu.

Replay zobrazuje `QUEUED | RUNNING | PASS | FAIL | CHALLENGE_REQUIRED` pro každý krok a bezpečný důkaz výsledku.

Po aktivaci generated capability má OWNER v detailu komponenty nebo v navázaném automation panelu standardně k dispozici:

- stav `ACTIVE | DISABLED | DEGRADED | REAUTH_REQUIRED`,
- aktivní revision a digest,
- cílový portál a account binding,
- `Preflight`,
- `Spustit nyní` s formulářem podle input schema,
- poslední úspěšný běh a poslední chybu,
- historii runů a detail jednotlivých kroků,
- zrušení právě běžícího runu,
- `Znovu přihlásit`,
- `Opravit / znovu naučit`,
- enable/disable,
- informaci o pending repair jobu.

Dlouhý run používá async UX s run id a průběhem; uživatel není nucen držet otevřenou stránku.

# 7. Datový model

Generation discussion schema vzniká v migraci:

`apps/server/src/migrations/014_generation_discussion.sql`

Platformní browser automation runtime používá navazující migraci:

`apps/server/src/migrations/015_browser_automation_runtime.sql`

Obě migrace používají explicitní foreign keys, unique/partial indexy, serverové timestamps a constraints. Generation tabulky evidují přípravu a teaching; browser automation tabulky jsou dlouhodobou produkční autoritou automatizací a runů. Rutinní automation run se neukládá jako generation job.

## 7.1 `generation_job_message`

Tabulka reprezentuje persistentní historii diskuse.

Povinná pole:

```text
id
job_id
sequence
role
content
status
client_message_id
turn_id
model
provider_response_id
created_at
completed_at
```

### 7.1.1 Význam polí

- `id`: globálně jednoznačné immutable ID zprávy.
- `job_id`: vazba na generation job.
- `sequence`: serverově přidělené monotónní pořadí v rámci jobu.
- `role`: `OWNER | ASSISTANT | SYSTEM`.
- `content`: persisted message content odpovídající danému statusu.
- `status`: `QUEUED | STREAMING | COMPLETED | INTERRUPTED | FAILED`.
- `client_message_id`: idempotency identifikátor OWNER zprávy; pro server-generated messages může být `NULL`.
- `turn_id`: vazba na discussion turn, pokud je zpráva jeho součástí.
- `model`: model použitý pro assistant message, je-li relevantní.
- `provider_response_id`: provider identifikátor uložený pro continuation/audit, je-li dostupný.
- `created_at`: serverový čas založení.
- `completed_at`: čas přechodu do konečného message statusu.

### 7.1.2 Constraints

Databáze vynucuje minimálně:

- `UNIQUE(job_id, sequence)`,
- `UNIQUE(job_id, client_message_id)` pro non-null `client_message_id`,
- validní `role`,
- validní `status`,
- OWNER message s client id nesmí být přidána dvakrát,
- message history se nepřepisuje destruktivním UPDATE obsahu dokončené zprávy.

Streaming assistant message může během statusu `STREAMING` aktualizovat pracovní content nebo používat oddělený event/delta mechanismus. Po přechodu do `COMPLETED`, `INTERRUPTED` nebo `FAILED` je výsledná persisted podoba auditní položkou a nesmí být později přepsána jiným turnem.

## 7.2 `generation_discussion_turn`

Povinná pole:

```text
id
job_id
status
trigger_message_id
model
previous_response_id
response_id
lease_owner
lease_until
started_at
completed_at
interrupted_at
error_code
usage_json
```

### 7.2.1 Turn status

Turn používá explicitní stavy:

```text
QUEUED
RUNNING
INTERRUPT_REQUESTED
COMPLETED
INTERRUPTED
FAILED
```

### 7.2.2 Single-active-turn invariant

Pro jeden `job_id` může existovat nejvýše jeden turn ve stavu `RUNNING` nebo `INTERRUPT_REQUESTED`. Constraint musí být vynucen databázově nebo transakčním lockem doplněným testem concurrency; samotná kontrola v paměti procesu není dostatečná.

### 7.2.3 Lease

Worker při převzetí turnu atomicky nastaví `lease_owner` a `lease_until`. Heartbeat prodlužuje lease pouze tehdy, pokud worker stále vlastní konkrétní turn. Po expiraci lease může recovery logika turn převzít nebo bezpečně označit k retry podle stavu provider requestu a persisted response id.

Recovery nesmí vytvořit dva současně běžící upstream modelové requesty pro stejný turn.

### 7.2.4 Usage a chyby

`usage_json` ukládá dostupná usage metadata bez secretů. `error_code` používá stabilní strojové kódy, které lze mapovat na observability a uživatelský error state.

## 7.3 `generation_spec_revision`

Povinná pole:

```text
id
job_id
sequence
specification JSONB
rendered_markdown
canonical_payload
digest
source_turn_id
created_at
```

`canonical_payload` může být implementován jako text nebo odvozen deterministicky při čtení; podstatné je, aby digest vždy vznikal nad jednoznačnou kanonickou serializací stejné struktury.

### 7.3.1 Immutability

Po INSERT se revision nemění. Jakákoli funkční změna specifikace vytváří další `sequence`.

Databáze vynucuje:

- `UNIQUE(job_id, sequence)`,
- digest má očekávaný formát,
- `source_turn_id` patří stejnému jobu, pokud není null.

### 7.3.2 Canonical serialization

Kanonická serializace používá:

- UTF-8,
- stabilní pořadí objektových klíčů,
- normalizované line endings,
- žádné volatile timestamps uvnitř digest payloadu,
- zachování pořadí seznamů, pokud jejich pořadí nese význam,
- explicitní reprezentaci prázdných polí podle schema.

Digest je serverově vypočtený kryptografický hash, standardně SHA-256 v hex reprezentaci. Klient digest nikdy neurčuje; pouze vrací hodnotu, kterou dříve obdržel od serveru.

## 7.4 `generation_job` — specifikační a diskusní pole

Generation job obsahuje minimálně:

```text
current_spec_revision_id
approved_spec_revision_id
approved_spec_digest
discussion_closed_at
```

Dále může obsahovat explicitní metadata potřebná pro lease, blocker a recovery, pokud zůstávají součástí jednoho generation lifecycle.

### 7.4.1 Referential invariants

- `current_spec_revision_id` odkazuje na revision stejného jobu.
- `approved_spec_revision_id` odkazuje na revision stejného jobu.
- `approved_spec_digest` odpovídá digestu `approved_spec_revision_id`.
- `discussion_closed_at` je vyplněn pouze po úspěšném approval freeze.
- po freeze se `approved_spec_revision_id` a `approved_spec_digest` nemění.

## 7.5 Persistentní generation event log

SSE replay vyžaduje serverově obnovitelné eventy. Implementace proto používá persistentní nebo transakčně spolehlivý event log navázaný na job.

Minimální kontrakt event položky:

```text
id
job_id
sequence
event_type
payload_json
created_at
retention_class
```

`sequence` je monotónní v rámci jobu a používá se jako SSE `id`. Event vytvořený v téže business transakci jako změna authoritative state nesmí být publikován bez odpovídající uložené změny stavu.

Payload nesmí obsahovat plaintext secret. Delta eventy mohou mít kratší retention než lifecycle/spec eventy, pokud reconnect vždy umí provést bezpečný resync z authoritative REST snapshotu.

## 7.6 Browser preview metadata

Preview metadata musí být scoped na job a obsahovat minimálně:

```text
job_id
frame_id
revision
content_type
created_at
url
title
sensitive
storage_reference
byte_size
width
height
```

`storage_reference` je server-internal a nikdy se neposílá klientovi jako přímá filesystem cesta.

Filesystem nebo objektový preview store používá job-specific namespace a validaci cesty tak, aby job nemohl číst artefakty jiného jobu.

## 7.7 `generation_external_operation_scope`

Tabulka eviduje rozsah externích browserových změn odvozený z explicitní OWNER instrukce.

```text
id
job_id
source_message_id
browser_session_id
purpose
target_account_label
allowed_origins_json
allowed_action_classes_json
scope_digest
status              ACTIVE | REVOKED | EXPIRED
expires_at
created_at
revoked_at
```

Scope nesmí být širší než význam zdrojové OWNER zprávy. Běžné kroky uvnitř scope nepotřebují další per-click approval.

## 7.8 `generation_irreversible_action_confirmation`

```text
id
job_id
browser_session_id
source_message_id
action_digest
action_summary
target_origin
status              ACTIVE | USED | REVOKED | EXPIRED
expires_at
created_at
used_at
```

Tabulka se používá pouze pro nevratný nebo mimořádně významný krok, který není již jednoznačně autorizován zdrojovou OWNER instrukcí.

## 7.9 `generation_browser_teaching_run`

```text
id
job_id
source_turn_id
browser_session_id
status              RUNNING | COMPLETED | FAILED | CANCELLED
purpose
start_url
allowed_origins_json
started_at
completed_at
```

## 7.10 `generation_browser_teaching_step`

```text
id
teaching_run_id
sequence
semantic_purpose
action_type
locator_strategy_json
input_binding_json
precondition_json
wait_policy_json
postcondition_json
side_effect_class
retry_class
uncertain_result_policy_json
observed_result_json
created_at
```

Databáze vynucuje `UNIQUE(teaching_run_id, sequence)`. Secret je reprezentován pouze named bindingem; transientní browser hodnoty nejsou canonical inputs.

## 7.11 `browser_automation_definition`

Stabilní produkční identita automatizace.

```text
id
owner_component_id
stable_key
display_name
purpose
status              ACTIVE | DISABLED | DEGRADED | REAUTH_REQUIRED
active_revision_id
last_success_at
last_failure_at
last_failure_code
created_at
updated_at
```

`UNIQUE(owner_component_id, stable_key)` zabraňuje duplicitní schopnosti v jedné komponentě. Definition přežívá repair a změny revisions.

## 7.12 `browser_automation_revision`

```text
id
definition_id
sequence
source_generation_job_id
approved_spec_revision_id
manifest_json
canonical_payload
digest
verification_status  PENDING | PASS | FAIL
created_at
activated_at
```

Revision je immutable. `UNIQUE(definition_id, sequence)` a digest nad kanonickou serializací jsou povinné. Aktivace definition odkazuje pouze na revision s `verification_status=PASS`.

## 7.13 `browser_automation_auth_binding`

```text
id
definition_id
binding_name
account_key
secret_name
binding_type        USERNAME | PASSWORD | API_KEY | TOTP_SEED | SESSION_STATE | OTHER_SECRET
required
status              ACTIVE | ROTATED | REVOKED | EXPIRED
created_at
updated_at
```

Tabulka neobsahuje plaintext hodnotu. `secret_name` odkazuje do existujícího Secret Manageru. Grant má platformní Browser Automation Runtime; caller komponenta dostává browser credential grant pouze pokud jej potřebuje i mimo browser automatizaci.

## 7.14 `browser_automation_run`

```text
id
definition_id
revision_id
caller_principal_id
idempotency_key
execution_mode      SYNC | ASYNC
status              QUEUED | RUNNING | CHALLENGE_REQUIRED | SUCCEEDED | FAILED | CANCEL_REQUESTED | CANCELLED | MANUAL_REVIEW
input_json
result_json
current_step_sequence
lease_owner
lease_until
started_at
completed_at
error_code
error_summary
created_at
```

`input_json` a `result_json` nesmějí obsahovat resolved secret values. Idempotency scope je `(definition_id, caller_principal_id, idempotency_key)` pro non-null key.

## 7.15 `browser_automation_run_step`

```text
id
run_id
sequence
attempt
status              RUNNING | PASS | FAIL | SKIPPED | CHALLENGE_REQUIRED | UNCERTAIN
locator_fingerprint
action_type
side_effect_class
started_at
completed_at
error_code
observed_state_json
evidence_ref
```

Run step je checkpoint pro recovery a diagnostiku. Nejasný výsledek mutace se ukládá jako `UNCERTAIN`, nikoli jako automatický retry.

## 7.16 `browser_automation_artifact`

```text
id
run_id
step_sequence
artifact_type       DOWNLOAD | SCREENSHOT | TRACE | DOM_EVIDENCE | OTHER
content_type
safe_filename
byte_size
digest
storage_reference
sensitivity         NORMAL | SENSITIVE
retention_until
created_at
```

`storage_reference` zůstává server-internal. Sensitive trace nebo screenshot není dostupný běžným OWNER preview endpointem bez odpovídající protected-evidence policy.

## 7.17 Aktivace, rollback a vazba na component release

Generated component revision obsahuje reference na přesné automation definition/revision ids a digests. Aktivace komponenty a aktivace příslušných automation revisions jsou provedeny v integračním pořadí, které zabrání tomu, aby business MCP tool ukazoval na neaktivní nebo neověřený manifest.

Repair zachovává `browser_automation_definition.id` i owning `component_id`. Nová oprava vytvoří další immutable revision. Při failure se aktivní pointer vrátí na poslední ověřenou revision společně s existujícím component release rollbackem.

## 7.18 Teaching evidence integrity

Teaching run/steps zůstávají auditním důkazem přípravy. Produkční runtime nečte teaching table jako program; běží výhradně podle aktivní `browser_automation_revision.manifest_json`.

# 8. GenerationSpecification

## 8.1 Produktový kontrakt

TypeScript kontrakt obsahuje minimálně:

```ts
type GenerationSpecification = {
  objective: string;
  resultSummary: string;
  behavioralRequirements: string[];
  inputsAndOutputs: string[];
  externalSystems: string[];
  businessRules: string[];
  explicitOwnerDecisions: string[];
  constraints: string[];
  acceptanceCriteria: string[];
  verifiedFacts: string[];
  openQuestions: string[];
  browserAutomations: BrowserAutomationRequirement[];
};
```

Schema lze technicky rozdělit do vnořených typů, pokud zůstane zachován význam všech uvedených oblastí, jejich validace, OWNER čitelnost a deterministická serializace.

## 8.2 Význam jednotlivých polí

### `objective`
Jedna přesná formulace hlavního cíle. Popisuje, čeho má výsledná funkce nebo systém dosáhnout z pohledu OWNERa.

### `resultSummary`
Stručný, ale konkrétní popis výsledku, který má po dokončení existovat. Neobsahuje interní postup práce.

### `behavioralRequirements`
Úplný seznam očekávaného runtime a uživatelského chování. Každý bod musí být testovatelný nebo alespoň jednoznačně ověřitelný.

### `inputsAndOutputs`
Vstupy, zdroje dat, očekávané výstupy, formáty, směry dat a uživatelské nebo systémové předávací body.

### `externalSystems`
Systémy, API, weby, zařízení, datové zdroje a služby, se kterými realizace pracuje. Každá položka uvádí účel integrace.

### `businessRules`
Pravidla, podmínky, priority, validace a rozhodovací logika, které definují funkční správnost.

### `explicitOwnerDecisions`
Rozhodnutí OWNERa, která AI nesmí reinterpretovat. Každý bod se přenáší do planneru jako závazný invariant.

### `constraints`
Technická, provozní, bezpečnostní, UX nebo integrační omezení, která musí řešení respektovat.

### `acceptanceCriteria`
Konkrétní ověřitelné podmínky, podle kterých se určí, že realizace odpovídá zadání.

### `verifiedFacts`
Fakta, která AI ověřila prostřednictvím dostupných research nástrojů nebo canonical KájovoCML kontraktů a která jsou relevantní pro návrh.

### `openQuestions`
Pouze otázky, jejichž odpověď je nutná pro uzavření produktového zadání. Každá otázka má být formulována tak, aby OWNER mohl jednoznačně rozhodnout.

## 8.2.1 `browserAutomations`

Pole `browserAutomations` obsahuje úplný produktový kontrakt každé deterministické browserové schopnosti:

```ts
type BrowserAutomationRequirement = {
  id: string;
  name: string;
  purpose: string;
  invocation: {
    type: 'MCP_TOOL' | 'INTERNAL_FUNCTION';
    executionMode: 'SYNC' | 'ASYNC' | 'AUTO';
    businessToolName: string;
    asyncCompanionTools: boolean;
  };
  runtime: {
    engine: 'KCML_PLAYWRIGHT_PLATFORM';
    contractVersion: string;
  };
  navigationPolicy: {
    entryOrigins: string[];
    allowedOrigins: string[];
    authOrigins: string[];
    redirectOrigins: string[];
    downloadOrigins: string[];
    denyPrivateNetwork: boolean;
  };
  browserContext: {
    locale?: string;
    timezoneId?: string;
    viewport?: { width: number; height: number };
    userAgentPolicy: 'PLAYWRIGHT_DEFAULT' | 'PINNED';
  };
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  authentication: {
    mode: 'NONE' | 'LOGIN_EACH_RUN' | 'REUSABLE_SESSION_STATE' | 'HYBRID';
    accountKey?: string;
    secretBindings: Array<{ name: string; purpose: string; required: boolean }>;
    challengePolicy: 'PAUSE_FOR_OWNER' | 'FAIL';
  };
  workflow: BrowserAutomationStepRequirement[];
  successCriteria: Record<string, unknown>[];
  failureCriteria: Record<string, unknown>[];
  idempotency: {
    strategy: 'READ_ONLY' | 'CALLER_KEY' | 'PRECONDITION_POSTCONDITION' | 'NO_BLIND_RETRY';
    keyInputPaths?: string[];
  };
  concurrency: {
    keyTemplate: string;
    maxConcurrent: number;
  };
  execution: {
    queueTimeoutMs: number;
    runTimeoutMs: number;
    stepDefaultTimeoutMs: number;
    maxSteps: number;
  };
  artifacts: {
    allowUpload: boolean;
    allowDownload: boolean;
    maxUploadBytes?: number;
    maxDownloadBytes?: number;
    allowedMimeTypes?: string[];
    retentionHours: number;
  };
  monitoring: {
    driftDetection: true;
    recordFailedStepEvidence: true;
    repairOnContractDrift: true;
  };
  teachingEvidenceIds: string[];
};

type BrowserAutomationStepRequirement = {
  sequence: number;
  purpose: string;
  action:
    | 'NAVIGATE' | 'CLICK' | 'FILL' | 'FILL_SECRET' | 'SELECT'
    | 'CHECK' | 'UNCHECK' | 'PRESS' | 'UPLOAD' | 'DOWNLOAD'
    | 'WAIT_FOR' | 'ASSERT' | 'EXTRACT' | 'BRANCH' | 'REPEAT_BOUNDED';
  locator: Record<string, unknown> | null;
  inputBinding: Record<string, unknown> | null;
  precondition: Record<string, unknown> | null;
  waitCondition: Record<string, unknown> | null;
  postcondition: Record<string, unknown> | null;
  sideEffectClass:
    | 'READ_ONLY' | 'LOCAL_INPUT' | 'AUTHENTICATION'
    | 'MUTATION_IDEMPOTENT' | 'MUTATION_NON_IDEMPOTENT' | 'DESTRUCTIVE';
  retryClass: 'SAFE_RETRY' | 'RECHECK_BEFORE_RETRY' | 'NO_AUTO_RETRY';
  timeoutMs?: number;
  maxIterations?: number;
};
```

### Povinné standardní odvození

Planner doplní i vlastnosti, které OWNER běžně neuvádí: navigation allowlist, timeouty, retry/idempotency, concurrency key, browser context locale/timezone, auth expiry handling, artifact limits, monitoring, cancellation, preflight a repair policy. Tyto hodnoty se odvozují z povahy cílového portálu a business operace a nesmějí měnit funkční záměr.

### Locator contract

Primární locatory používají user-facing semantics: role + accessible name, label, test id, placeholder/text ve scoped containeru a stabilní atributy. CSS je poslední deterministic fallback. Absolutní XPath a screen coordinates nejsou canonical primary locator.

Fallback locator je možné použít pouze tehdy, když označuje stejný významový prvek a následná postcondition ověří stejný business výsledek. Úspěch přes fallback se auditně označí jako drift signal; runtime nesmí potichu přepisovat active revision.

### Deterministický workflow DSL

Manifest je deklarativní. Produkční interpret nesmí přijímat arbitrary JavaScript, dynamický `page.evaluate`, shell command ani runtime source code jako step. Bounded `BRANCH` a `REPEAT_BOUNDED` pracují pouze s explicitně podporovanými observed-state predicates.

### Execution mode

`AUTO` se při contract freeze přeloží na `SYNC` pouze pro běhy, které bezpečně skončí v limitu generated handler invocation. Delší nebo challenge-prone workflow používá `ASYNC`; business tool vrátí run id a generation pipeline automaticky vytvoří potřebnou status/result/cancel interakci.

## 8.3 Validace specifikace

Server před uložením revision validuje:

- schema,
- povinná pole,
- typy všech hodnot,
- absence nevalidních null hodnot,
- rozumné velikostní limity,
- validitu textového encodingu,
- deterministickou serializovatelnost,
- validitu každého `browserAutomations` entry,
- neprázdný `allowedOrigins` pro webovou automatizaci,
- úplnost input/output schema,
- existenci success a failure criteria,
- platné named secret bindings bez secret hodnot v payloadu.

Approval navíc vyžaduje `openQuestions.length === 0`.

## 8.4 Revision semantics

AI po turnu porovná navrženou specifikaci s aktuální kanonickou podobou. Další revision vznikne pouze tehdy, pokud se změnil funkční obsah. Změna whitespace, pořadí objektových klíčů nebo ekvivalentní serializační rozdíl nesmí vytvářet další revision.

Každá vytvořená revision publikuje `spec.revision.created` s job id, revision id, sequence a digestem. Event neobsahuje celý obsah specifikace, pokud by tím vznikal nadbytečný event payload; klient si obsah načte přes spec API nebo dostane bezpečný summary payload.

## 8.5 Rendered Markdown

Server generuje `rendered_markdown` deterministicky ze stejné struktury. Markdown slouží pro čitelné zobrazení a export, zatímco `specification JSONB` je strojová autorita.

Rendered verze musí obsahovat všechny funkční položky ze strukturované specifikace a nesmí přidávat další požadavky, které ve strukturovaném kontraktu nejsou.

---

# 9. AI discussion orchestrace

## 9.1 Model orchestrace

AI orchestrace používá vztah:

**Generation job → Discussion turn → Messages + Tool activity + Specification revision**

Worker řídí celý turn jako jednu recoverable serverovou jednotku. Provider response id může být využit pro continuation, ale lokální databáze je autoritou historie, job state a schválené specifikace.

## 9.2 Kontext turnu

Před modelovým requestem orchestrator připraví kontext obsahující:

- závazné discussion system instructions,
- relevantní serverovou historii zpráv,
- aktuální `GenerationSpecification`,
- identitu jobu a bezpečný lifecycle context,
- seznam povolených discussion tools,
- canonical capability lookup instrukci,
- pravidla pro browser a secret handling,
- instrukci nevytvářet KájovoCML component/runtime/release/activation side effects; externí webové změny se provádějí výhradně přes serverově vynucený external-operation scope contract.

Dlouhá historie se spravuje bounded context mechanismem. Zkrácení modelového kontextu nesmí změnit authoritative audit historii v DB. Jakákoli sumarizace používaná pro modelový kontext musí zachovat explicitní OWNER rozhodnutí a aktuální specifikaci.

## 9.3 Povolené discussion tools

Discussion tool policy poskytuje minimálně:

- `web_search`,
- bezpečný `fetch_url`,
- canonical CML capability lookup,
- čtení relevantních CML contractů,
- `browser_open`, `browser_state`, `browser_switch_page`,
- `browser_click`, `browser_fill`, `browser_select`, `browser_check`, `browser_press`,
- `browser_upload`, `browser_download`, `browser_wait`,
- secret capture/resolve přes existující Secret Manager contract,
- `browser_establish_external_operation_scope`,
- `browser_confirm_irreversible_action`,
- `browser_begin_teaching`, `browser_end_teaching`,
- `browser_replay_candidate`, `browser_preflight_candidate`,
- `get_current_specification`,
- `propose_specification_revision`,
- explicitní OWNER input/challenge mechanismus.

Každý tool má server-side schema validation, lifecycle policy a auditovatelný safe activity label.

## 9.4 Discussion capability boundary

Model může během `DISCUSSING` používat research, browser, credential, external-operation, teaching a replay primitives. Externí webové změny jsou omezené `External operation scope` odvozeným z explicitní OWNER instrukce. Nevratný krok mimo jednoznačnou aktuální instrukci vyžaduje `Irreversible action confirmation`.

Discussion registry neposkytuje component reservation, runtime principal creation, local release activation, platform secret grant mutation pro budoucí generated runtime ani jiný KájovoCML production side effect. Tyto operace patří až za approval freeze.

Model output nikdy není přímým oprávněním. Server před browser akcí kontroluje origin, action class, operation scope a sensitivity policy.

## 9.5 Capability-first algoritmus

Před doporučením výroby další capability AI:

1. normalizuje požadovanou schopnost,
2. vyhledá relevantní canonical capabilities,
3. načte jejich dostupný kontrakt a omezení,
4. porovná funkční coverage s OWNER požadavkem,
5. použije existující canonical capability, pokud odpovídá požadavku,
6. navrhne další implementaci pouze pro nepokrytou funkční odpovědnost.

Výsledek capability lookupu se může zapsat do `verifiedFacts`, pokud ovlivňuje specifikaci.

## 9.6 Tool activity events

Orchestrator publikuje tool activity bez interního reasoning obsahu:

- `discussion.tool.started`,
- `discussion.tool.completed`,
- `discussion.tool.failed`.

Payload obsahuje bezpečný tool name, tool call id, čas, bezpečný activity label a případně stručný výsledek. Argumenty obsahující sensitive data se redigují před persistencí i publikací.

## 9.7 Streaming assistant odpovědi

Assistant message vznikne před prvním streamovaným delta eventem a dostane status `STREAMING`. Deltas jsou spojeny s message id a turn id. Po úspěšném dokončení se message přepne do `COMPLETED`.

Při interruption se zachovaný částečný text označí `INTERRUPTED`. Při provider failure se zpráva označí `FAILED`; UI ji nesmí prezentovat jako dokončenou odpověď.

## 9.8 Spec proposal po turnu

Po dokončení relevantní práce orchestrator vyhodnotí specifikaci strukturovaným outputem. Server validuje schema, kanonizuje payload a porovná digest s aktuální revision.

- shodný digest → další revision nevzniká,
- odlišný digest → vloží se další immutable revision,
- nevalidní structured output → turn nesmí uložit poškozenou revision; chyba se zpracuje jako recoverable orchestration failure podle retry policy.

## 9.9 OWNER otázky

AI položí OWNERovi otázku pouze tehdy, když odpověď mění funkční záměr nebo je nezbytná pro bezpečné uzavření specifikace a nelze ji zjistit research nástroji či canonical kontrakty.

Otázka musí být:

- konkrétní,
- srozumitelná,
- zaměřená na rozhodnutí,
- doplněná stručným vysvětlením dopadu, pokud OWNER bez něj nemůže kvalifikovaně rozhodnout.

Běžné technické volby, které neovlivňují uživatelský záměr, řeší technický planner po approval.

## 9.10 Browser teaching a automation design orchestrace

AI během teaching neprodukuje hotový privilegovaný Playwright program. Orchestrator převádí ověřené kroky do typed `BrowserAutomationRequirement` a candidate deklarativního manifestu.

Postup je:

1. vytvořit teaching run;
2. provést reálný workflow v trusted generation browser session;
3. zaznamenat významové kroky a observed assertions;
4. parametrizovat business vstupy a secret bindingy;
5. zkompilovat semantic locators;
6. doplnit side-effect/retry/idempotency/concurrency semantiku;
7. odvodit navigation policy, auth expiry a human-challenge chování;
8. spustit schema validation a deterministic preflight/replay;
9. vytvořit/aktualizovat `browserAutomations` ve `GenerationSpecification`;
10. po OWNER approval předat planneru immutable requirement.

AI smí při návrhu použít web research a browser evidence. Rutinní run však nesmí používat model pro výběr locatoru, rozhodování o retry nebo improvizaci dalšího kroku.

# 10. Playwright browser subsystem a platformní Browser Automation Runtime

## 10.1 Dvě browserové runtime role

KájovoCML používá stejný Playwright technologický základ ve dvou odlišných runtime rolích:

1. **Generation Browser Session** — trusted job-specific browser pro research, interaktivní konfiguraci, teaching a verification.
2. **KCML Browser Automation Runtime** — dlouhodobá kanonická platformní CML služba pro rutinní deterministické běhy aktivovaných automatizací.

Obě vrstvy sdílejí locator DSL, navigation policy, screenshot/sensitivity helpers a failure taxonomii, ale mají oddělený lifecycle a perzistenci. Produkční run není navázán na existenci původního generation workspace nebo AI session.

## 10.2 Playwright a Chromium dependency

`@kcml/server` přidá explicitní verzovanou dependency `playwright`. Browser binaries jsou instalovány deploymentem verzí odpovídající lockfile, standardně `pnpm exec playwright install --with-deps chromium`. Produkce používá Playwright-managed Chromium nebo ekvivalentně verzi prokazatelně kompatibilní v release gate.

Deployment před aktivací ověří browser executable, systémové knihovny a Playwright smoke test. Upgrade Playwright/Chromium je release změna a musí projít browser regression gates před nasazením.

Produkční browser worker běží jako neprivilegovaný systemd service identity. Chromium sandbox je zapnutý; produkční konfigurace nesmí jako běžný režim záviset na `--no-sandbox`.

## 10.3 Generation Browser Session

Generation session používá izolovaný Playwright `BrowserContext` nebo job-specific persistent context podle auth potřeby. Session podporuje:

- navigaci,
- role/label/text/test-id locators,
- iframe a popup/tab práci,
- dialogy,
- dynamic DOM,
- upload/download,
- actions a web-first assertions,
- screenshot preview,
- teaching recorder,
- secure credential fill,
- storage state capture pod secret-grade policy.

Session je scoped na job, nemíchá cookies/state mezi joby a má lease, idle lifecycle a idempotentní cleanup.

## 10.4 Browser preview a evidence

Každý bezpečný frame má `frame_id`, revision, content type, URL/title metadata, timestamp a rozměry. Preview je event-driven po významné akci, nikoliv remote desktop video.

Režimy jsou `NORMAL` a `SENSITIVE`. Ve `SENSITIVE` se obraz s credential materiálem klientovi nevydá. Po bezpečném opuštění citlivé stránky vznikne nový `NORMAL` frame.

Preview endpoint používá OWNER/job authorization, `Cache-Control: no-store` a nikdy nevrací filesystem path.

## 10.5 Credential a auth state handling

OWNER může credential předat trusted diskusí nebo credential polem. Persistentní credential se kanonizuje do existujícího Secret Manageru. Browser tool pracuje s named bindingem/reference a provozní logy neobsahují resolved hodnotu.

`storageState`, cookies a token-bearing local/session storage jsou credential material. Persistují se pouze přes secret-grade storage. Rotation/revoke credentialu invaliduje odpovídající reusable session state a nastaví automatizaci do `REAUTH_REQUIRED`, dokud preflight neprokáže nový funkční auth stav.

## 10.6 External operation scope

Server před mutující browserovou prací odvodí z aktuální OWNER instrukce operation scope. Scope obsahuje účel, účet/portál, allowed origins a action classes.

Běžné mutace nutné k výslovně zadanému cíli — například vytvoření aplikace, uložení callback URL nebo nastavení webhooku — mohou pokračovat uvnitř scope bez opakovaného potvrzování každého formulářového kroku.

`DESTRUCTIVE` nebo jinak nevratný krok vyžaduje konkrétní confirmation pouze tehdy, pokud jeho přesný význam není již jednoznačně součástí aktuální OWNER instrukce.

## 10.7 Teaching capture model

Recorder ukládá pouze významové kroky. Každý step má purpose, action, locator, input/secret binding, precondition, wait, postcondition, side-effect class, retry class a uncertain-result policy.

Secret value, OTP, cookie, CSRF token, transient DOM id a session-specific query parameter nejsou součástí canonical workflow.

## 10.8 Locator compiler

Locator compiler používá v pořadí:

1. `getByRole` + accessible name,
2. `getByLabel`,
3. stabilní `getByTestId`,
4. stabilní explicitní atribut ve scoped containeru,
5. `getByPlaceholder` nebo scoped `getByText`,
6. stabilní CSS fallback.

Locator musí být při verification jednoznačný. Fallback nesmí změnit sémantický cíl. Runtime využívá Playwright auto-waiting/actionability namísto umělých sleepů, pokud business workflow skutečně nevyžaduje časovou prodlevu.

## 10.9 Deklarativní automation DSL

`BrowserAutomationManifest.workflow` je interpretovaný datový program. Povolené primitives jsou minimálně:

```text
NAVIGATE
CLICK
FILL
FILL_SECRET
SELECT
CHECK
UNCHECK
PRESS
UPLOAD
DOWNLOAD
WAIT_FOR
ASSERT
EXTRACT
BRANCH
REPEAT_BOUNDED
```

Conditions podporují minimálně URL, visibility, text, value, count, attribute a explicitní extraction/result predicates. `BRANCH` a `REPEAT_BOUNDED` mají staticky známé maximální větvení/iterace.

Manifest nesmí obsahovat arbitrary JavaScript, shell, import, filesystem path, `page.evaluate` source nebo dynamický runtime code.

## 10.10 KCML Browser Automation Runtime

Platformní runtime je jedna kanonická CML komponenta spravovaná stejným component/principal, Secret Manager, control, monitoring a audit modelem jako ostatní platformní schopnosti. Má vlastní worker queue a není součástí generated handler sandboxu.

Runtime poskytuje přes CML MCP boundary stabilní platformní tools minimálně:

```text
automation_execute
automation_start
automation_status
automation_result
automation_cancel
automation_preflight
```

Každý request obsahuje `automationDefinitionId` nebo stabilní serverem mapovaný handle. Platformní service ověří caller principal, active revision, definition status, CML permission a constraint, než run vytvoří.

## 10.11 Generated MCP/function adapter

Výsledná generated komponenta neobsahuje Playwright runtime. Její business handler:

1. validuje business input;
2. doplní caller idempotency key podle contractu;
3. přes `context.callComponent` zavolá přesně povolený tool Browser Automation Runtime;
4. vrátí typed business output nebo run handle;
5. mapuje stabilní automation error codes na svůj MCP contract.

Generation pipeline materializuje component permission z generated principalu na Browser Automation Runtime a omezuje ji na potřebný tool a automation definition. Browser login secrets zůstávají grantované platformnímu runtime.

## 10.12 Standardní provozní funkce

Každá automation definition automaticky podporuje:

- **Preflight** — ověření browser availability, origin policy, auth stavu a klíčových read-only locatorů bez business mutace;
- **Execute/Start** — zahájení business runu;
- **Status** — queue/running/challenge/terminal stav;
- **Result** — typed výsledek dokončeného runu;
- **Cancel** — autoritativní cancellation intent;
- **History** — stránkovaná historie runů;
- **Reauthenticate** — obnovení login/session state;
- **Enable/Disable** — provozní odstavení bez odstranění komponenty;
- **Repair/Reteach** — vytvoření navazujícího generation repair jobu s failure evidence.

Při `ASYNC` invocation generation pipeline vytvoří odpovídající business-facing run handle contract a podle potřeby companion MCP tools `status/result/cancel`, aby OWNER ani jiná komponenta nemusela znát platformní interní API.

## 10.13 Run lifecycle

Produkční run používá:

```text
QUEUED
RUNNING
CHALLENGE_REQUIRED
SUCCEEDED
FAILED
CANCEL_REQUESTED
CANCELLED
MANUAL_REVIEW
```

Worker claimuje run přes lease. Step checkpoint se persistuje před a po významové akci. Terminal result je immutable.

## 10.14 Side-effect, idempotence a retry

Každý step má `sideEffectClass` a `retryClass`.

- `READ_ONLY`, `LOCAL_INPUT` a prokazatelně idempotentní akce mohou použít bounded safe retry.
- `MUTATION_NON_IDEMPOTENT` po timeoutu, worker crasji nebo nejasné odpovědi nesmí být slepě opakován.
- před případným retry se znovu otevře/reloaduje relevantní stav a vyhodnotí postcondition nebo business existence check;
- pokud nelze určit, zda side effect proběhl, run přejde do `MANUAL_REVIEW` místo dvojího provedení.

Caller idempotency key zabraňuje tomu, aby network retry založil druhý business run. Idempotence se nikdy neodvozuje pouze z totožného textu vstupu.

## 10.15 Authentication modes

Podporované režimy:

- `NONE`,
- `LOGIN_EACH_RUN`,
- `REUSABLE_SESSION_STATE`,
- `HYBRID`.

`HYBRID` nejprve použije storage state a při deterministicky rozpoznaném expiry provede definovaný re-login. Credential rotation invaliduje session state. Auth failure se odlišuje od locator driftu.

## 10.16 MFA, CAPTCHA a human challenge

OTP lze dodat jako ephemeral OWNER input; uložený TOTP seed smí být použit pouze pokud jej OWNER výslovně poskytl jako persistentní secret. Push confirmation, WebAuthn nebo obdobná výzva přepne run do `CHALLENGE_REQUIRED`.

CAPTCHA nebo provider human-verification mechanismus se neobchází. Runtime zachová bezpečný context v rámci challenge timeoutu a požádá OWNERa o zásah. Po expiraci skončí stabilním failure code.

## 10.17 Navigation a egress policy

Každá top-level navigation, redirect, popup a download request se kontroluje proti manifest navigation policy. Auth redirecty mají oddělený allowlist.

Výchozí policy blokuje localhost, link-local a privátní síťové adresy pro externí portálové automatizace. Interní webový systém může být povolen pouze explicitním CML platformním pravidlem pro konkrétní capability.

DNS rebinding a redirect na nepovolený origin musí skončit fail-closed.

## 10.18 Uploady, downloady a artifacts

Upload akceptuje pouze deklarované MIME/size typy a serverem kontrolovaný artifact/input handle; manifest neobsahuje libovolnou host filesystem path.

Download se zachytí před vyvolávající akcí, dokončí se atomicky, zkontroluje size/MIME, vypočte digest a uloží do job/run-scoped storage. Výstup předává artifact id a metadata, nikoliv serverovou cestu.

Retention a cleanup jsou manifestem/policy omezené.

## 10.19 Evidence, screenshot a trace

Při failure se ukládá minimální bezpečný evidence balík: run/step id, URL origin, locator fingerprint, assertion/failure code a podle sensitivity poslední bezpečný screenshot nebo DOM/accessibility summary.

Playwright trace lze používat pro diagnostiku, protože může obsahovat síťové a obrazové údaje je však vždy `SENSITIVE` evidence, má omezenou retention a není automaticky dostupný běžnému klientovi.

## 10.20 Drift, fallback a repair

Runtime smí použít pouze předem schválené fallback locators. Pokud primary locator selže a fallback prokazatelně zasáhne stejný semantic element a postcondition projde, run může dokončit, ale automatizace se označí `DEGRADED` a vznikne drift evidence.

Runtime nikdy sám nepřepisuje manifest ani nevytváří nový locator pomocí AI.

Opakovaný nebo kritický `AUTOMATION_CONTRACT_DRIFT` využije existující CML monitoring/repair mechanismus k deduplikovanému enqueue REPAIR generation jobu owning komponenty. Repair zachová component i automation definition identity, otevře portál v trusted generation browseru, vytvoří další revision, ověří ji a aktivuje přes standardní conformance/release gate. Failure vrátí předchozí funkční revision.

## 10.21 Cancellation a worker recovery

Cancel nastaví persistentní cancellation intent. Worker ho kontroluje před navigací, před side-effect krokem, po každém kroku a během dlouhého wait/downloadu.

Po worker restartu se run převezme pouze po expiraci lease. Read-only nebo bezpečně retryable step lze opakovat. U uncertain mutace se nejprve provede reconciliation/postcondition. Recovery nesmí spustit dva writable browser contexts pro stejný account/concurrency key.

## 10.22 Concurrency a account isolation

Manifest definuje `concurrency.keyTemplate` a `maxConcurrent`. Výchozí account-bound workflow používá max 1 pro stejný externí účet. Lock má lease a heartbeat.

Každý run používá nový izolovaný BrowserContext s volitelným načtením chráněného storage state. Sdílený persistent user-data-dir není výchozí produkční model.

## 10.23 Resource limity a backpressure

Konfigurovatelné jsou minimálně: worker concurrency, browser process count, contexts per browser, queue length, queue timeout, run timeout, step timeout, pages per run, upload/download size, screenshot size, trace quota a artifact retention.

Při vyčerpání kapacity se run zařadí do bounded queue nebo skončí klasifikovaným capacity error; systém nespouští neomezeně další Chromium procesy.

## 10.24 Cleanup

Terminal cleanup uzavře pages/context, release lock/lease, dočasné downloady a ephemeral browser data. Persistentní Secret Manager/session-state artefakty se řídí vlastní retention/revoke policy a nemažou se jako náhodný temp adresář.

Cleanup je idempotentní a scoped na run/job.

## 10.25 Runtime bez AI

`automation_execute`, `automation_start`, step interpreter, retry, auth refresh, assertions, extract, cancel a result path nesmějí volat OpenAI ani jiný LLM. Model se vrací pouze v explicitním generation/repair/reteach workflow.

# 11. Realtime transport a event contract

## 11.1 Transportní model

Klient → server mutace používají REST `POST`.  
Server → klient realtime aktualizace používají SSE.

SSE endpoint:

```text
GET /api/generation/jobs/:id/events
```

## 11.2 SSE response requirements

Endpoint používá:

- OWNER auth,
- autorizaci konkrétního jobu,
- `Content-Type: text/event-stream`,
- `Cache-Control: no-store`,
- `X-Accel-Buffering: no` nebo odpovídající proxy nastavení, pokud je pro Nginx potřeba,
- periodic heartbeat,
- monotonic event id,
- reconnect kompatibilitu,
- `Last-Event-ID` replay.

Proxy a server timeouts musí být nastaveny tak, aby dlouho otevřený stream nebyl pravidelně ukončován dříve než heartbeat.

## 11.3 Event envelope

Každý event má jednotný envelope:

```json
{
  "jobId": "...",
  "eventId": "...",
  "type": "discussion.turn.started",
  "emittedAt": "...",
  "payload": {}
}
```

SSE `id:` odpovídá `eventId`. SSE `event:` odpovídá `type`.

## 11.4 Povinné event typy

Generation SSE zachovává discussion/spec/browser eventy a navíc publikuje bezpečné OWNER-facing události pro teaching a manuální challenge:

```text
generation.state.changed
discussion.turn.queued
discussion.turn.started
discussion.turn.interrupt_requested
discussion.turn.interrupted
discussion.turn.completed
discussion.turn.failed
discussion.message.created
discussion.message.delta
discussion.message.completed
discussion.message.interrupted
discussion.message.failed
discussion.tool.started
discussion.tool.completed
discussion.tool.failed
spec.revision.created
spec.approved
browser.navigation
browser.preview.updated
browser.preview.sensitive
browser.operation_scope.established
browser.irreversible_confirmation.required
browser.irreversible_confirmation.used
browser.teaching.started
browser.teaching.step
browser.teaching.completed
browser.replay.started
browser.replay.step
browser.replay.completed
browser.challenge.required
owner.input.required
generation.blocked
generation.cancelled
generation.failed
generation.completed
generation.resync.required
```

Rutinní produkční `browser_automation_run` používá vlastní persistentní event/run historii. OWNER UI může její změny načítat přes automation SSE/poll contract definovaný P4; generation event log se nesmí nekonečně používat jako produkční runtime event store.

## 11.5 Replay

Při reconnect klient odešle poslední zpracovaný `Last-Event-ID`. Server načte eventy daného jobu s vyšším sequence a odešle je v pořadí.

Replay je bounded. Pokud požadovaný event leží mimo retenované okno:

1. server odešle `generation.resync.required`,
2. klient provede REST snapshot načtení jobu, messages, spec a browser metadata,
3. klient naváže SSE z aktuálního event cursoru.

Replay gap nesmí být řešen tichým přeskočením, které by mohlo ponechat UI ve falešném stavu.

## 11.6 Snapshot + stream bootstrap

Frontend bootstrap jobu používá tento pořádek:

1. načte authoritative job snapshot,
2. načte messages podle pagination contractu,
3. načte current/approved spec,
4. získá poslední známý event cursor nebo otevře SSE s bezpečným bootstrap mechanismem,
5. aplikuje eventy vzniklé mezi snapshotem a aktivací streamu bez ztráty nebo duplicity.

P4 musí zvolit konkrétní race-free bootstrap contract. Akceptovatelné je například vrátit snapshot spolu s `eventCursor` a otevřít SSE od tohoto cursoru.

## 11.7 Delta idempotence

Klient aplikuje `discussion.message.delta` podle message id a event id. Opakovaně doručený event se nesmí připojit dvakrát. Po `discussion.message.completed` je serverový final message content autoritativní a klient jím může normalizovat lokálně složené delty.

---

# 12. REST API kontrakt

P4 finalizuje konkrétní JSON schema v souladu s touto kapitolou. Názvy fields mohou být upraveny pouze při contract freeze a musí být stejné v backendu, frontendu, testech a handoff dokumentaci.

## 12.1 `POST /api/generation/jobs`

### Účel
Založení generation jobu ve stavu `DISCUSSING` a uložení počáteční OWNER zprávy.

### Request

```json
{
  "prompt": "text zadání",
  "clientRequestId": "uuid-or-stable-client-id"
}
```

### Validace

- `prompt` je neprázdný po trim validaci,
- velikost je pod serverovým limitem,
- `clientRequestId` je validní idempotency identifikátor,
- OWNER je autorizován.

### Response `201`

Vrací minimálně:

```json
{
  "job": {
    "id": "...",
    "state": "DISCUSSING",
    "createdAt": "...",
    "currentSpecRevisionId": null,
    "approvedSpecRevisionId": null
  },
  "message": {
    "id": "...",
    "sequence": 1,
    "role": "OWNER",
    "status": "COMPLETED"
  },
  "eventCursor": "..."
}
```

Retry stejného `clientRequestId` nesmí založit druhý job.

## 12.2 `GET /api/generation/jobs`

Vrací OWNERovi seznam jobů s pagination a minimálně:

- id,
- zobrazitelný název nebo summary,
- state,
- created/updated timestamps,
- current spec revision sequence,
- approved spec revision sequence,
- last activity,
- blocker/error summary pro odpovídající stav.

Seznam nesmí načítat plné message histories.

## 12.3 `GET /api/generation/jobs/:id`

Vrací authoritative job snapshot:

- lifecycle state,
- discussion turn summary,
- current spec metadata,
- approved spec metadata,
- browser preview metadata,
- blocker summary,
- cancellation state,
- timestamps,
- `eventCursor` použitelný pro race-free SSE bootstrap.

## 12.4 `GET /api/generation/jobs/:id/messages`

Endpoint je stránkovaný. Podporuje načtení historie po stabilním cursoru nebo sequence.

Response každé message obsahuje:

- id,
- sequence,
- role,
- content,
- status,
- turnId,
- model, pokud je relevantní a bezpečný,
- createdAt,
- completedAt.

API umožňuje efektivně načíst poslední část dlouhé diskuse a následně starší stránky bez změny pořadí.

## 12.5 `POST /api/generation/jobs/:id/messages`

### Request

```json
{
  "clientMessageId": "...",
  "content": "OWNER text"
}
```

### Server behavior

1. ověří auth, CSRF a job,
2. ověří, že job přijímá discussion OWNER message,
3. v transakci zkontroluje `clientMessageId`,
4. existující message se stejným id vrátí jako idempotentní výsledek,
5. jinak přidělí další message sequence a vloží OWNER message,
6. pokud neběží turn, vytvoří/zařadí turn,
7. pokud běží steerable turn, aktivuje interruption flow,
8. publikuje eventy.

### Response

`201` pro vytvořenou message, `200` pro idempotentní replay existující message podle P4 contractu. Response vždy obsahuje server message id a sequence.

## 12.6 `GET /api/generation/jobs/:id/events`

Implementuje kapitolu Realtime transport. Endpoint nemá klientskou mutaci a nevyužívá CSRF token; vyžaduje autentizaci a autorizaci jobu.

## 12.7 `GET /api/generation/jobs/:id/spec`

Vrací současný specifikační stav:

```json
{
  "current": {
    "id": "...",
    "sequence": 4,
    "digest": "...",
    "specification": {},
    "renderedMarkdown": "...",
    "createdAt": "..."
  },
  "approved": null,
  "approvalEligible": true,
  "approvalBlockers": []
}
```

Po approval `approved` obsahuje immutable schválenou revision a `approvalEligible` je false.

## 12.8 `GET /api/generation/jobs/:id/spec/revisions`

Vrací stránkovaný seznam revision metadata a na požádání obsah jednotlivé revision podle finálního P4 contractu. Historie umožňuje OWNERovi auditovat, jak se zadání zpřesňovalo, ale UI prezentuje `current` jako hlavní pracovní verzi.

## 12.9 `POST /api/generation/jobs/:id/approve-spec`

### Request

```json
{
  "specRevisionId": "...",
  "specDigest": "..."
}
```

### Povinné serverové kontroly

Server v jedné transakční approval operaci ověří:

- job existuje a patří OWNERovi,
- `state === DISCUSSING`,
- request revision odpovídá `current_spec_revision_id`,
- request digest odpovídá serverově vypočtenému digestu této revision,
- `openQuestions.length === 0`,
- neexistuje turn `RUNNING` nebo `INTERRUPT_REQUESTED`,
- job nemá pending cancellation,
- revision je schema-valid,
- revision skutečně patří jobu.

### Freeze

Při úspěchu transakce nastaví:

```text
approved_spec_revision_id = current_spec_revision_id
approved_spec_digest = verified digest
discussion_closed_at = server now
state = ANALYZING
```

Součástí stejné business operace vznikne audit event a generation event `spec.approved`/`generation.state.changed`.

### Conflicts

Stale revision, stale digest, aktivní turn nebo neplatný lifecycle vrací `409` se stabilním error code. Open questions mohou vracet `409` nebo doménově sjednocený validation conflict; konkrétní volba se zamkne v P4 contractu a testech.

## 12.10 `POST /api/generation/jobs/:id/cancel`

Cancellation je autoritativní serverová operace.

Server:

1. ověří auth/CSRF,
2. zamkne job pro lifecycle změnu,
3. nastaví cancellation intent,
4. signalizuje aktivní model/browser/worker operace,
5. zabrání vzniku dalších side effects,
6. provede cleanup v bezpečném pořadí,
7. přejde do `CANCELLED`, jakmile jsou splněny cancellation invariants,
8. publikuje generation event.

Retry stejného cancel requestu je bezpečný a nesmí způsobit error pouze proto, že job již je `CANCELLED`.

## 12.11 `GET /api/generation/jobs/:id/browser/preview`

Endpoint vrací poslední bezpečný frame nebo metadata stavu.

Při `NORMAL` a dostupném frameu vrací image bytes.  
Při `SENSITIVE` vrací bezpečný status bez obrazu, například `423`/`409` nebo definovaný JSON response podle P4 contractu.  
Při neexistujícím frameu vrací explicitní no-preview stav, nikoliv statickou náhražku.

Response používá `Cache-Control: no-store` a nikdy neodhaluje filesystem path.

## 12.11.1 `POST /api/generation/jobs/:id/browser/credentials`

Přijímá credential přes dedikované pole a ukládá jej do existujícího Secret Manageru nebo ephemeral challenge store. Trusted OWNER message endpoint zůstává platnou alternativou; credential uvedený v chat zprávě není kvůli tomuto endpointu odmítnut.

Response vrací pouze stable secret metadata/reference.

## 12.11.2 `POST /api/generation/jobs/:id/browser/operation-scope`

Vytvoří nebo zpřesní external operation scope navázaný na konkrétní OWNER message. Server ověří, že scope není širší než význam instrukce a current browser target.

## 12.11.3 `POST /api/generation/jobs/:id/browser/irreversible-confirmations`

Vytvoří jednorázové potvrzení přesného pending action digestu. Endpoint se používá pouze pro krok, který není již explicitně zahrnut v OWNER instrukci.

## 12.11.4 `GET /api/generation/jobs/:id/browser/teaching`

Vrací teaching runs, normalizované kroky, candidate manifest metadata, preflight/replay stav a verification evidence bez secret values.

## 12.11.5 `POST /api/generation/jobs/:id/browser/teaching/preflight`

Spustí read-only candidate preflight. Candidate revision/digest musí být aktuální.

## 12.11.6 `POST /api/generation/jobs/:id/browser/teaching/replay`

Spustí deterministic replay přes platformní interpreter se stejným manifest contractem jako produkce.

## 12.11.7 OWNER automation management API

P4 doplní owner-scoped API pro dlouhodobý provoz automatizací, minimálně:

```text
GET  /api/browser-automations
GET  /api/browser-automations/:id
GET  /api/browser-automations/:id/revisions
POST /api/browser-automations/:id/preflight
POST /api/browser-automations/:id/run
GET  /api/browser-automations/:id/runs
GET  /api/browser-automation-runs/:runId
POST /api/browser-automation-runs/:runId/cancel
POST /api/browser-automations/:id/reauthenticate
POST /api/browser-automations/:id/enable
POST /api/browser-automations/:id/disable
POST /api/browser-automations/:id/repair
GET  /api/browser-automation-runs/:runId/artifacts/:artifactId
```

Všechny mutace používají OWNER auth + CSRF; read routes používají OWNER authorization. Repair endpoint zakládá deduplikovaný navazující generation repair flow s runtime evidence.

## 12.11.8 Run API semantics

`run` přijímá `clientRunId`/idempotency key a business input podle active revision schema. Retry stejného klíče vrátí tentýž run. `cancel` je idempotentní.

Run detail vrací status, current step, timestamps, safe error, typed result a artifact metadata. Resolved secrets, cookies, storage state a protected traces se nevracejí.

## 12.12 Standardní error envelope

Všechny JSON API chyby používají jednotný tvar:

```json
{
  "error": {
    "code": "GENERATION_SPEC_STALE",
    "message": "Zobrazené zadání již není aktuální.",
    "details": {},
    "requestId": "..."
  }
}
```

`details` nesmí obsahovat secret ani interní stack trace.

## 12.13 Status codes

Minimální semantika:

- `200` úspěšná read/idempotentní mutation,
- `201` vytvořený resource,
- `400` schema/format validation,
- `401` chybějící nebo neplatná autentizace,
- `403` autentizovaný uživatel nemá oprávnění,
- `404` job/resource není dostupný v daném auth kontextu,
- `409` stale revision, stale digest, illegal lifecycle transition, concurrency conflict,
- `429` serverový rate/concurrency limit, je-li používán,
- `5xx` technické selhání serveru/provideru podle standardní error policy.

---

# 13. Approval freeze a realizační autorita

## 13.1 Atomická hranice

Approval je jediná produktová hranice mezi společnou přípravou zadání a výrobou. Operace musí být transakční. Stav `ANALYZING` nesmí být viditelný s prázdným `approved_spec_revision_id` nebo bez validního digestu.

## 13.2 Immutable approved specification

Po freeze:

- schválená revision se nemění,
- schválený digest se nemění,
- `rendered_markdown` odpovídá stejnému schema payloadu,
- planner čte schválenou revision podle jejího id,
- implementation/integration prompts obsahují schválený produktový kontrakt,
- audit uchovává approval timestamp a digest.

Další discussion message se přes běžný message endpoint po freeze nepřijímá jako součást přípravné diskuse.

## 13.3 Planner boundary

Planner může zvolit:

- rozdělení kódu do modulů,
- technické datové struktury,
- konkrétní validační strategii,
- pořadí implementačních kroků,
- testovací přístup,
- optimalizace a interní abstractions.

Planner nesmí změnit:

- `objective`,
- business význam behavioral requirements,
- explicitOwnerDecisions,
- acceptanceCriteria,
- funkční integrace,
- OWNERem definované constraints.

Pokud planner nemůže vytvořit validní technický plán bez změny těchto prvků, vzniká blocker.

## 13.4 Digest verification v pipeline

Každá hranice, která persistuje nebo předává schválenou specifikaci mezi významnými realizačními fázemi, musí být schopna dohledat její revision id a digest. Implementace nesmí použít jinou pracovní kopii bez vazby na schválenou autoritu.

## 13.5 Browser automation authority

Schválená `browserAutomations` část `GenerationSpecification` je funkční autoritou pro vytvoření nebo změnu automation definition. Planner může odvodit implementační detaily platformního manifestu, ale nesmí změnit business účel, input/output contract, cílové weby, side-effect význam nebo acceptance criteria.

Pipeline při browser capability:

1. zajistí existenci kanonického `KCML Browser Automation Runtime`;
2. vytvoří/aktualizuje stabilní automation definition;
3. vloží další immutable automation revision s approved spec references a digestem;
4. ověří manifest schema, navigation policy, secret bindings a platformní permissions;
5. spustí preflight/replay/E2E gates;
6. vytvoří generated MCP/function adapter;
7. materializuje `context.callComponent` permission na platformní runtime s omezením na konkrétní automation definition a potřebné tooly;
8. aktivuje pouze revision s PASS evidence;
9. zahrne automation health do component conformance a monitoringu.

Generated handler source není browserovou realizační autoritou. Autoritou runtime workflow je active immutable `browser_automation_revision`.

# 14. Concurrency, idempotence a recovery

## 14.1 Job-level concurrency

Operace měnící lifecycle, active turn nebo approval používají job-level locking strategy. P0/P1 definují jednu strategii použitou konzistentně v doménových operacích, například transakční row lock + constraints.

Cílem je zabránit zejména:

- dvojímu approval,
- dvojímu active turnu,
- duplicate message insertu,
- approval souběžnému s další spec revision,
- cancellation souběžnému s vytvořením implementačního side effectu,
- worker retry vedoucímu ke dvěma releases/components.

## 14.2 Message idempotence

`client_message_id` je unikátní v rámci jobu. Retry po network timeoutu vrací stejnou message. Server nesmí odvozovat idempotenci z textu zprávy, protože dvě obsahově stejné OWNER zprávy mohou být legitimně dvě různé akce.

## 14.3 Job creation idempotence

Create request používá samostatný client idempotency key. Retry po nejasné HTTP odpovědi nesmí založit druhý job.

## 14.4 Approval idempotence

Opakování již úspěšně dokončeného approval requestu pro totožnou approved revision může vrátit bezpečný idempotentní výsledek podle P4 contractu. Request s jinou revision po freeze je conflict.

## 14.5 Worker restart

Po restartu worker:

1. načte joby s recoverable work,
2. vyhodnotí leases,
3. převezme pouze expirovanou nebo explicitně recoverable práci,
4. ověří persisted side effects před jejich opakováním,
5. pokračuje z authoritative DB state,
6. nevydává nedokončený turn za `COMPLETED`.

Provider request s nejasným výsledkem se řeší pomocí response id, idempotency provider mechanismu a lokálního state podle možností API. Pokud nelze bezpečně zjistit výsledek, worker preferuje konzistentní failure/recovery stav před dvojím side effectem.

## 14.6 Generation browser recovery

Při restartu generation workeru se job-specific Playwright session obnovuje podle uloženého job/browser lease a případného protected auth state. Dva procesy nesmějí současně vlastnit tentýž persistent context.

## 14.7 Client reconnect

Client reconnect pouze načte authoritative snapshot a stream. Neprovádí serverovou recovery mutaci.

## 14.8 Produkční automation concurrency

Každý run má vlastní lease. `concurrencyKey` chrání zejména stejný external account nebo business entitu. Queue je bounded a lock má heartbeat/expiry.

## 14.9 Run idempotence

Caller poskytne `idempotency_key` tam, kde může request opakovat. Duplicitní start stejné definition/caller/key vrátí stejný run.

## 14.10 Recovery po nejistém side effectu

Step s `MUTATION_NON_IDEMPOTENT` nebo `DESTRUCTIVE` ukládá checkpoint před akcí. Pokud proces skončí mezi akcí a potvrzením postcondition, obnovený worker nejprve provede read-only reconciliation. Teprve pokud je prokazatelné, že akce neproběhla a retry policy to dovoluje, může krok opakovat. Jinak run skončí `SUCCEEDED` podle nalezené postcondition nebo `MANUAL_REVIEW`.

## 14.11 Cancellation produkčního runu

Cancel intent je persistentní a kontroluje se před side effecty. Ukončení browser contextu je až důsledek cancellation, nikoli autorita. Pozdní worker update nesmí přepsat `CANCELLED` obdobně jako u generation jobu.

# 15. Security model

## 15.1 Authorization

Všechny generation resources jsou owner-scoped. Každý route handler ověřuje oprávnění k danému `job_id`; nestačí ověřit pouze přihlášení.

Browser preview, messages, spec revisions a event stream používají stejnou job authorization boundary.

## 15.2 CSRF

Všechny browser-originated mutace používají repo CSRF mechanismus. Read endpoints a SSE používají standardní auth protection a bezpečná same-site pravidla podle server conventions.

## 15.3 Input validation

Každý request je schema validated před vstupem do domain vrstvy. Validace zahrnuje:

- datové typy,
- délky,
- formát identifikátorů,
- zakázané nevalidní Unicode/control sekvence podle repo policy,
- nečekaná pole podle zvolené schema strictness,
- body size limity.

## 15.4 Output encoding

Frontend nikdy nevkládá message/spec text jako neověřený HTML. Markdown rendering používá bezpečný renderer a sanitization odpovídající repo pravidlům. Browser metadata `title` a `url` se renderují jako text nebo bezpečně validovaná URL.

## 15.5 Preview isolation

Preview route nesmí přijímat libovolnou filesystem cestu. Frame se identifikuje serverovým job/frame id a server z mapování zjistí storage reference.

Job A nesmí žádným parametrem načíst frame jobu B.

## 15.6 Tool authorization

Model nikdy neurčuje, zda je tool povolen. Orchestration server před každým tool callem kontroluje registry, lifecycle state, job context a sensitivity policy.

## 15.7 Secrets a privilege separation

Persistentní secrets zůstávají v existujícím Secret Manageru. Operational log, trace metadata a metrics neobsahují resolved secret.

Browser credentials jsou standardně grantované pouze `KCML Browser Automation Runtime`. Generated caller komponenta má permission vyvolat svou automation definition, nikoliv číst její login password.

Trusted OWNER discussion může obsahovat credential podle OWNER trust modelu; tento obsah se nesmí automaticky kopírovat do pino logu, audit diffu, metrics labelu nebo browser evidence.

## 15.8 Platform Browser Runtime isolation

Browser Automation Runtime běží jako samostatná neprivilegovaná service identity. Produkční Chromium sandbox je zapnutý. Worker má filesystem přístup pouze do vyhrazených browser/run/artifact cest a k mechanismům potřebným pro Secret Manager/CML RPC.

Generated manifest nedovoluje shell, arbitrary JavaScript, dynamic import, host path ani libovolnou síťovou destinaci.

## 15.9 Navigation security

Každá navigace, redirect a popup je allowlistována. URL validation probíhá i po redirectu a DNS resolution nesmí umožnit přechod z povoleného public hostname na privátní/link-local adresu.

## 15.10 Caller authorization

Platformní runtime při startu runu ověřuje současně:

- caller principal,
- CML component permission,
- automation definition ownership/allowed-caller relation,
- active revision,
- definition enabled state,
- input schema,
- případný idempotency key.

Pouhá znalost automation id není oprávnění.

## 15.11 Files a artifacts

Upload/download API nepřijímá host filesystem path od generated handleru. Artifacts používají serverové handles, size/MIME limity, safe filenames, digest a retention.

## 15.12 Human challenge security

CAPTCHA, WebAuthn nebo push MFA se neobcházejí. Challenge odpověď je scoped na konkrétní run/account a má expiraci. OTP se nepersistuje jako dlouhodobý secret, pokud OWNER výslovně neukládá TOTP seed.

## 15.13 Audit security events

Audit obsahuje minimálně authorization denial, operation-scope establishment/revoke, irreversible confirmation, secret binding změnu bez hodnoty, automation revision activation/rollback, run start/terminal, challenge, drift, manual review, cancel a repair enqueue.

# 16. Observability

## 16.1 Korelace

Každá významná log položka generation workflow obsahuje podle dostupnosti:

- request id,
- job id,
- turn id,
- message id,
- tool call id,
- browser session id,
- spec revision id,
- worker id,
- lifecycle state.

## 16.2 Povinné logované události

Vedle generation událostí se logují/auditují bezpečná metadata pro:

- automation definition/revision create/verify/activate/rollback,
- run queued/claimed/start/terminal/cancel,
- step start/pass/fail/uncertain,
- auth session load/relogin/expiry,
- human challenge start/resolve/expire,
- navigation policy denial,
- artifact create/cleanup,
- drift/fallback detection,
- repair enqueue/success/failure,
- browser worker lease/recovery,
- Playwright/Chromium startup/version failure.

Korelace používá podle vrstvy request id, job id, component id, automation definition/revision id, run id, step sequence, worker id a correlation id.

## 16.3 Zakázaný log content

Běžný log neobsahuje password, OTP, API token, cookies, storage state, Authorization header, screenshot bytes, downloaded file contents ani protected Playwright trace.

OWNER discussion content se neloguje znovu jako technický prompt dump.

## 16.4 Metrics

Monitoring poskytuje minimálně:

- generation discussion turn duration/failure,
- active generation browser sessions,
- automation queue depth a queue wait,
- active automation runs,
- run success/failure/cancel rate,
- run duration podle definition,
- step failure rate podle anonymizovaného step/action typu,
- auth expiry/relogin/challenge rate,
- drift/fallback rate,
- manual-review count,
- Playwright browser launch latency/failure,
- Chromium process/context count a resource pressure,
- artifact storage usage,
- repair enqueue/result,
- last successful run age pro aktivní automatizace.

## 16.5 OWNER diagnostika

Detail automation zobrazuje bezpečný poslední failure code, krok, čas, origin, active revision, auth status a dostupnou akci `Preflight`, `Reauthenticate` nebo `Repair`. Nízkourovňové trace/evidence je dostupné pouze přes protected diagnostic flow a není podmínkou běžného používání.

# 17. Failure handling

## 17.1 OpenAI/provider failure

Pokud modelový request selže:

- OWNER message zůstává uložená,
- turn přejde do `FAILED` nebo do interního retry flow podle klasifikace chyby,
- assistant message se neoznačí jako completed,
- retry používá stejný trigger context a nevytváří duplicitní OWNER message,
- spec revision vznikne pouze z validně dokončeného spec proposal flow,
- UI zobrazí srozumitelný stav a dostupnou retry cestu, pokud ji server dovolí.

Transient chyby mají bounded retry s backoffem. Retry count a timeout jsou konfigurovatelné a logované.

## 17.2 Browser failure

Pokud browser tool selže:

- tool activity dostane `failed`,
- AI nesmí tvrdit, že ověření proběhlo,
- pokud lze produktové rozhodnutí bezpečně dokončit bez browseru, turn může pokračovat a transparentně sdělit omezení relevantní OWNERovi,
- pokud browser evidence rozhodnutí podmiňuje, AI vytvoří konkrétní OWNER-visible blocker/otázku nebo turn failure podle contextu.

Browser crash nezpůsobí automatickou ztrátu celé diskusní historie.

## 17.3 SSE failure

SSE disconnect neovlivňuje serverovou práci. Klient použije reconnect a replay. Pokud replay není kompletní, použije `generation.resync.required` a snapshot bootstrap.

## 17.4 Database failure

Business operace, která nemůže bezpečně commitnout authoritative state, nesmí publikovat success event. Transaction rollback zachová předchozí konzistentní stav.

## 17.5 Approval failure

Při approval conflict frontend:

1. neukazuje realizaci jako zahájenou,
2. načte authoritative spec/job state,
3. zobrazí důvod conflict,
4. umožní OWNERovi zkontrolovat aktuální revision.

## 17.6 Cancellation failure

Pokud některý cleanup krok při cancel selže, cancellation intent zůstává autoritativní. Worker nesmí pokračovat do dalších výrobních side effects. Cleanup se může retryovat idempotentně; incident se loguje a zobrazuje v diagnostice.

## 17.7 Storage pressure

Při nedostatku diskového prostoru nebo překročení browser preview quota systém zastaví další preview capture pro postižený job a vyvolá diagnostikovatelný error. Nesmí pokračovat v nekontrolovaném zapisování.

## 17.8 Browser automation failure taxonomy

Platformní runtime používá stabilní kódy minimálně:

```text
AUTOMATION_INPUT_INVALID
AUTOMATION_DISABLED
AUTOMATION_REVISION_NOT_ACTIVE
AUTOMATION_PERMISSION_DENIED
AUTOMATION_CAPACITY_EXCEEDED
AUTOMATION_BROWSER_START_FAILED
AUTOMATION_BROWSER_VERSION_MISMATCH
AUTOMATION_ORIGIN_NOT_ALLOWED
AUTOMATION_PRIVATE_NETWORK_BLOCKED
AUTOMATION_AUTH_FAILED
AUTOMATION_AUTH_EXPIRED
AUTOMATION_CHALLENGE_REQUIRED
AUTOMATION_CHALLENGE_EXPIRED
AUTOMATION_LOCATOR_NOT_FOUND
AUTOMATION_LOCATOR_AMBIGUOUS
AUTOMATION_PRECONDITION_FAILED
AUTOMATION_POSTCONDITION_FAILED
AUTOMATION_TIMEOUT
AUTOMATION_RATE_LIMITED
AUTOMATION_UPLOAD_FAILED
AUTOMATION_DOWNLOAD_FAILED
AUTOMATION_ARTIFACT_INVALID
AUTOMATION_CONTRACT_DRIFT
AUTOMATION_EXTERNAL_REJECTED
AUTOMATION_SIDE_EFFECT_UNCERTAIN
AUTOMATION_MANUAL_REVIEW_REQUIRED
AUTOMATION_CANCELLED
```

Transient technická chyba může použít bounded retry pouze podle step retry policy. Auth expiry spouští deterministic relogin nebo `REAUTH_REQUIRED`. Contract drift nevytváří runtime AI fallback.

## 17.9 Drift a repair

Počet/typ drift failure se promítá do monitoring state. Opakovaný nebo kritický drift vytvoří deduplikovaný REPAIR job owning komponenty přes existující repair mechanismus. Aktivní poslední funkční revision zůstává rollback autoritou.

## 17.10 Portal rate limit a maintenance

HTTP 429, provider maintenance a obdobné signály se klasifikují odděleně od locator driftu. Retry respektuje bounded backoff a externí `Retry-After`, pokud je bezpečný. Automatizace nesmí přejít do nekonečné retry smyčky.

## 17.11 Human challenge

Run v `CHALLENGE_REQUIRED` má timeout a OWNER-facing instrukci. Po vyřešení pokračuje ze stejného checkpointu; po expiraci končí klasifikovaně a neprovádí další mutace.

# 18. Performance, limity a provozní chování

## 18.1 Bounded data

Implementace používá explicitní limity pro:

- velikost jedné OWNER zprávy,
- velikost jedné assistant zprávy,
- počet messages načtených jedním API requestem,
- velikost SSE replay window,
- počet eventů v jednom replay batchi,
- počet současných worker turns,
- počet browser sessions,
- počet preview frameů na job,
- velikost screenshotu,
- délku modelového kontextu.

## 18.2 Dlouhé diskuse

Dlouhá diskuse nesmí vést k načtení celé historie do každého HTTP payloadu. Messages endpoint je stránkovaný a frontend používá incremental history loading.

Model context management může používat serverovou kontextovou sumarizaci nebo selekci, ale schválená specifikace, explicitní OWNER decisions a open questions mají vždy prioritu a authoritative DB historie se nemaže.

## 18.3 Worker concurrency

Worker concurrency je konfigurovatelná. Queueing je viditelné prostřednictvím `discussion.turn.queued`/AI queued UX stavu. Přetížení nesmí vytvářet další workery bez limitu.

## 18.4 Browser memory pressure

Browser manager monitoruje počet session/processů a reaguje na konfigurované limity. Idle session může být bezpečně ukončena při zachování profilu, pokud job zůstává obnovitelný a další turn ji umí znovu vytvořit.

## 18.5 SSE scalability

SSE connection state je neautoritativní. Restart HTTP procesu nesmí ztratit generation state. Event replay používá persistentní event data a bounded retention.

## 18.6 Produkční browser automation limity

Konfigurace obsahuje explicitní limity pro:

- automation queue depth,
- současné runy celkem,
- současné runy na account/concurrency key,
- Chromium procesy a contexts,
- pages/popups per run,
- run a step timeout,
- challenge timeout,
- upload/download size,
- screenshot/trace size,
- artifact retention,
- retries a backoff,
- history pagination/retention.

Browser pool používá backpressure. Nedostatek kapacity nesmí vést k neomezenému spawnování procesů. Dlouhé async runy pokračují na serveru bez otevřeného klienta.

Deployment může browser proces recyklovat mezi runs, ale BrowserContexts a auth bindings zůstávají izolované. Persistentní account state se předává pouze přes protected storage state, nikoliv sdíleným writable profile directory mezi různými účty.

# 19. Implementační tým, vlastnictví a handoffy

Implementace je rozdělena mezi pracovní role P0–P7. Vlastnictví souborů omezuje paralelní konflikty a zároveň určuje, kdo nese odpovědnost za kontrakt dané vrstvy.

Každá pracovní skupina:

- pracuje proti contract freeze,
- provádí úplnou funkční implementaci své vrstvy,
- přidává testy dokazující její invarianty,
- nepřepisuje unrelated files,
- nepřidává dead code,
- předává strojově a lidsky čitelný handoff,
- hlásí blocker P0 dříve, než by změnila cross-team kontrakt.

## 19.1 P0 — Senior architekt / Integration Lead

### Odpovědnost

P0 vlastní integrační kontrakt, pořadí merge, cross-cutting rozhodnutí a release acceptance. P0 je jediná role oprávněná měnit contract freeze po zahájení paralelní práce.

### Povinné činnosti

P0:

1. vydá `IMPLEMENTATION_CONTRACT.md`,
2. zamkne lifecycle enum a přechody,
3. zamkne názvy DB entit a constraints,
4. zamkne `GenerationSpecification` schema,
5. zamkne domain service signatures,
6. zamkne SSE event names/envelope,
7. zamkne browser preview contract,
8. zamkne REST paths a request/response shapes,
9. zamkne external operation scope contract, teaching schema, `BrowserAutomationRequirement` a `BrowserAutomationManifest`,
10. zamkne deterministic runner entrypoint, allowed-origin a auth semantics,
11. stanoví jednotnou error code taxonomii,
12. stanoví job locking a transaction strategii,
13. kontroluje handoff P1–P7,
14. řeší cross-owned merge konflikty,
15. hlídá generation control-plane invariant,
16. ověřuje approval freeze boundary,
17. ověřuje, že produkční browser automation run nemá modelovou runtime dependency,
18. spouští finální quality gates,
19. provádí manuální happy path a failure path review,
20. potvrzuje release candidate pouze na základě důkazů.

### Povinný P0 review checklist u každého handoffu

- Implementace vykonává skutečnou operaci, kterou deklaruje?
- Autoritativní stav je uložen na serveru?
- Retry a concurrency nemohou vytvořit duplicitní side effect?
- Reconnect obnoví stejný stav?
- Security boundary se vynucuje serverově?
- Test ověřuje runtime chování, nikoliv pouze přítomnost symbolu?
- Schválená specifikace je jediná funkční autorita realizace?

### Výstupy

- `IMPLEMENTATION_CONTRACT.md`,
- integrační review notes v repo standardu,
- finální release acceptance záznam.

---

## 19.2 P1 — Senior PostgreSQL + Domain Lifecycle Engineer

### Vlastněné soubory

- `apps/server/src/migrations/014_generation_discussion.sql`
- `apps/server/src/migrations/015_browser_automation_runtime.sql`
- `apps/server/src/domain/generation.ts`
- nový `apps/server/src/domain/browser-automation.ts`
- domain schema/validátory příslušných kontraktů

### Odpovědnost

P1 implementuje discussion persistence i dlouhodobý automation registry/run model. Zamkne constraints pro single active discussion turn, immutable spec/automation revisions, idempotentní run start, run lease/cancel a bezpečnou active-revision vazbu.

Povinné domain operace zahrnují create/append/turn/spec/approval/cancel a dále createAutomationDefinition, createAutomationRevision, activateAutomationRevision, rollbackAutomationRevision, createAutomationRun, claim/heartbeat/checkpoint/complete/fail/cancel run, setAutomationOperationalStatus a auth-binding metadata operace bez plaintext secretu.

### P1 testy

Kromě discussion concurrency testuje immutable automation revision, active pointer, duplicate idempotency key, run lease takeover, terminal immutability, `UNCERTAIN` step recovery, auth-binding bez plaintext hodnoty a rollback na předchozí PASS revision.

### P1 handoff

`P1_HANDOFF.md` popíše ER model, migration order, constraints, domain signatures, locks/leases, run state machine, transaction boundaries a stable domain errors.

---

## 19.3 P2 — Senior AI Orchestration Engineer

### Vlastněné soubory

- `apps/server/src/generation/openai-responses.ts`
- `apps/server/src/generation/worker.ts`
- `apps/server/src/generation/discussion.ts`
- generation-only browser teaching/spec compiler adaptéry

### Odpovědnost

P2 implementuje persistentní discussion turns, Responses API tool loop, capability-first research, OWNER steer, browser konfiguraci, operation-scope práci, teaching recorder orchestration, manifest candidate compilation a deterministic preflight/replay přes P3 platformní interface.

Model připravuje deklarativní workflow a nesmí generovat privilegovaný runtime Playwright source. Po approval planner vytvoří generated business adapter a automation revision/package reference.

P2 musí umět odvodit standardní nevyslovené provozní požadavky: timeout, retry/idempotency, concurrency, auth expiry, human challenge, navigation policy, artifacts, preflight, monitoring a repair, aniž by měnil OWNER business cíl.

### P2 testy

Testuje streaming/interrupt, tool policy, operation scope, teaching, candidate schema, no-secret teaching evidence, replay s model network vypnutým, stejný spec bez nové revision, approved spec binding a zákaz runtime AI dependency.

### P2 handoff

Obsahuje tool schemas, teaching/manifest compiler contract, provider retry, browser calls, events a planner binding.

---

## 19.4 P3 — Senior Browser Platform / Playwright Engineer

### Vlastněné soubory

- refaktor `apps/server/src/generation/browser-session.mjs` a typings na Playwright API
- `apps/server/src/generation/browser-preview.*`
- nový adresář `apps/server/src/browser-automation/`
- nový `apps/server/src/cli/browser-automation-worker.ts`
- runtime tool/worker integration potřebná pro canonical Browser Automation component
- Playwright/Chromium deployment wiring a browser-focused tests

### Odpovědnost

P3 vlastní oba browser runtime contracts: generation BrowserSession a produkční `KCML Browser Automation Runtime`. Implementuje společný locator/condition DSL, manifest validator/interpreter, navigation guard, browser/context pool, auth-state adapter, artifacts, trace/evidence, run worker, cancellation, recovery, drift a human challenge.

P3 nesmí přidat Playwright/process/network capability do generated handler sandboxu.

### Platform interface

P3 stabilizuje minimálně:

```text
GenerationBrowser.open/state/click/fill/select/check/press/upload/download/wait/screenshot
GenerationBrowser.beginTeaching/endTeaching/replayCandidate/preflightCandidate
AutomationRuntime.execute/start/status/result/cancel/preflight
AutomationRuntime.reauthenticate
AutomationRuntime.verifyManifest
AutomationRuntime.captureSafeEvidence
```

### P3 testy

Povinné jsou reálné Ubuntu Playwright/Chromium testy pro dynamic DOM, iframe, popup, redirect, auth state, screenshot, sensitivity, upload/download, origin guard, private-network guard, manifest interpreter, branch/bounded loop, idempotent run start, cancel, worker crash recovery, uncertain side effect, human challenge, fallback drift a runtime bez OpenAI síťového přístupu.

Test musí současně prokázat, že generated handler sandbox nadále nemá direct browser/process/network authority.

### P3 handoff

`P3_HANDOFF.md` obsahuje package/browser version, service topology, platform component identity contract, tool schemas, manifest DSL, run lifecycle, resource limits, error codes, evidence policy a deployment requirements.

---

## 19.5 P4 — Senior Backend API / Realtime / Security Engineer

### Vlastněné soubory

- `apps/server/src/http/generation-routes.ts`
- generation SSE helpers
- nové OWNER automation routes
- platform runtime MCP/HTTP boundary podle CML conventions
- validation/security tests

### Odpovědnost

P4 implementuje všechny kapitoly API: discussion/messages/spec/SSE/preview, credential/operation-scope/confirmation/teaching a dlouhodobou automation management/run API.

P4 zajistí OWNER auth + CSRF, component caller authorization, run idempotency, pagination, no-store, safe error envelopes a protected artifact delivery. Platform automation tools nesmějí být veřejnou anonymní browser API.

### P4 testy

Kromě generation route testů ověří automation list/detail/run/history/preflight/cancel/reauth/enable-disable/repair, caller permission, cross-component denial, duplicate run key, protected artifacts a no-secret responses.

### P4 handoff

`P4_HANDOFF.md` je finální API/event contract pro P5 a P6.

---

## 19.6 P5 — Senior Frontend Product / UX Engineer

### Vlastněné soubory

- generation page a její komponenty/hooks/styles
- component/automation detail UI podle existujících admin conventions
- frontend testy

### Odpovědnost

P5 vytvoří persistentní conversation workspace, preview/spec/progress UI a standardní automation operations panel. UI musí umožnit bez technických znalostí zjistit, zda je automatizace připravená, přihlášená, funkční nebo degradovaná a provést Preflight, Run now, Cancel, Reauthenticate, Disable/Enable a Repair/Reteach.

Dlouhé runy mají async progress. Human challenge je zobrazen jako konkrétní požadavek na OWNERa. Technické raw selectors/traces nejsou primární UX.

P5 zachová authoritative server state, responsive viewports, keyboard flow, accessibility a reconnect.

### P5 testy

Kromě discussion UX testuje run form ze schema, run history, async progress, cancel, auth challenge, `DEGRADED/REAUTH_REQUIRED`, repair action, protected evidence a mobilní automation detail.

### P5 handoff

Obsahuje UX state matrix, API/event mapping, responsive/accessibility evidence a manual viewport results.

---

## 19.7 P6 — Senior QA / Contract / Reliability Engineer

### Odpovědnost

P6 rozšíří generation contract checker a přidá `browser automation runtime` gates. PASS vyžaduje reálné důkazy, ne pouze přítomnost symbolu.

Povinné targeted testy zahrnují discussion/spec freeze, generation browser, platform automation interpreter, sandbox boundary, component->automation call, runtime no-AI, auth expiry/challenge, idempotency, uncertain side effects, worker recovery, drift/repair, artifacts a Playwright deployment smoke.

`QA_REPORT.md` používá `PASS | FAIL | NOT VERIFIED`; `NOT VERIFIED` na povinném bodu blokuje release.

---

## 19.8 P7 — Senior Technical Writer / SSOT & Runbook Engineer

P7 po runtime acceptance aktualizuje `docs/SSOT_CURRENT.md`, `docs/ARCHITECTURE.md`, runbook a catalog tak, aby popisovaly generation discussion i platformní Browser Automation Runtime, jeho component identity, automation registry/revisions/runs, permission boundary, Secret grants, Playwright deployment, monitoring, repair, artifacts, challenge a recovery.

Dokumentace musí jasně ukazovat, že generated handler pouze volá platformní browser capability a nezískává přímou Playwright autoritu.

---

# 20. Implementační orchestrace

## 20.1 Fáze A — Contract freeze

P0 s P1–P4 zamkne:

- lifecycle generation i automation runů,
- migration 014/015 schema,
- `GenerationSpecification.browserAutomations`,
- `BrowserAutomationManifest` DSL,
- platform Browser Automation component/tool contract,
- caller permissions a secret grants,
- operation scope/irreversible confirmation semantiku,
- OWNER automation API,
- Playwright/Chromium deployment contract,
- error/event taxonomii,
- repair/rollback vazbu.

## 20.2 Fáze B — Foundation

Paralelně:

- P1: DB/domain discussion + automation registry/run model;
- P3: Playwright generation BrowserSession + platform automation service skeleton nad produkčním manifest interpreterem.

### Gate B

P0 + P6 ověří migrations, constraints, reálný Playwright launch, handler sandbox beze změny privilege, manifest validator, origin guard a automation run lease/idempotency.

## 20.3 Fáze C — Platform browser runtime

P3 dokončí canonical Browser Automation Runtime, queue/worker, interpreter, auth binding, artifacts, cancel/recovery a platform MCP tools. P1/P4 napojí domain a caller authorization.

### Gate C

Bez AI se přes canonical CML call spustí test automation z neprivilegované caller komponenty, projde Playwright workflow a vrátí typed output. Neautorizovaný caller je odmítnut. Generated sandbox nemá Playwright dependency ani direct network.

## 20.4 Fáze D — AI discussion, teaching a spec

P2 implementuje persistentní discussion engine, operation scope, browser konfiguraci, teaching a candidate compile/replay nad skutečným P3 contractem.

### Gate D

OWNER message -> AI turn -> browser teaching -> deterministic replay -> immutable spec revision funguje bez frontendové závislosti. Replay je prokazatelně bez modelového callu.

## 20.5 Fáze E — API/SSE a OWNER automation API

P4 implementuje generation routes, SSE, preview a dlouhodobé automation management/run routes.

### Gate E

P0 + P6 ověří auth/CSRF, idempotency, replay/resync, protected artifacts, operation scope, run/cancel/preflight/reauth/repair API.

## 20.6 Fáze F — Frontend

P5 implementuje generation workspace a automation operations UX proti finálnímu P4 handoffu.

### Gate F

Desktop/tablet/mobile, reconnect, steer, teaching, challenge, Run now, Cancel, Reauthenticate, Degraded/Repair a protected evidence jsou PASS.

## 20.7 Fáze G — Full generation + activation integration

P2/P3/P1 integrují planner output s automation definition/revision activation, generated MCP adapterem, component permissions, Secret grants, conformance a rollbackem.

### Gate G

Happy path `zadání -> teaching -> approval -> generated MCP -> platform automation -> externí web -> typed výsledek` projde na reálné integrační fixture. Failure activation vrací předchozí release i automation revision.

## 20.8 Fáze H — Reliability a repair

P6 ověří worker crash, uncertain mutation, auth expiry, human challenge, portal drift, monitoring repair enqueue a návrat na poslední funkční revision.

## 20.9 Fáze I — SSOT/runbook

P7 aktualizuje dokumentaci pouze podle ověřeného runtime.

## 20.10 Release gate

Release candidate vyžaduje všechny mandatory automatické i manuální gates PASS, žádný `NOT VERIFIED`, kompatibilní Playwright/Chromium deployment, nulový otevřený production blocker a shodu runtime/SSOT.

# 21. Branch, merge a commit strategie

## 21.1 Pracovní větve

```text
feature/gen-discussion-domain
feature/browser-automation-domain
feature/browser-automation-runtime
feature/gen-discussion-ai
feature/gen-discussion-api
feature/gen-discussion-ui
feature/gen-discussion-tests
docs/gen-discussion-automation-ssot
integration/gen-discussion-browser-automation
```

## 21.2 Merge pořadí

1. P1 discussion + automation domain/migrations
2. P3 platform Browser Automation foundation
3. P4 platform caller/run API boundary potřebná pro integrační test
4. P2 AI discussion/teaching/spec compiler
5. P4 zbytek generation/SSE/OWNER API
6. P5 UI
7. P6 test hardening
8. P7 dokumentace
9. P0 finální integrační conflict cleanup

P3 platform runtime musí být integračně funkční před tím, než generated MCP packaging začne na jeho tool contract spoléhat.

## 21.3 Commit pravidla

Každý commit je logicky kompletní, obsahuje odpovídající test, nepřepisuje unrelated files, nepřidává secrets ani dead code. Public contract změna aktualizuje schema/types/tests/handoff v témže integračním kroku.

Doporučené prefixy:

```text
feat(generation-domain):
feat(browser-automation):
feat(generation-ai):
feat(generation-api):
feat(generation-ui):
test(generation):
test(browser-automation):
docs(generation):
```

# 22. Quality gates

Finální kandidát projde minimálně:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm generation:contract:check
pnpm generation:browser:check
pnpm generation:browser-automation:check
pnpm generation:automation-sandbox-boundary:check
pnpm generation:automation-runtime-no-ai:check
pnpm generation:automation-recovery:check
```

`@kcml/server` obsahuje zamknutou Playwright dependency a deployment test ověřuje odpovídající Chromium binary. `pnpm test`/pretest zahrne mandatory local checks; targeted commands zůstávají dostupné pro diagnostiku.

Povinný browser integration test nesmí být považován za PASS jen proto, že Chromium chybí. Release prostředí musí mít skutečný Ubuntu Playwright/Chromium runtime a test jej musí spustit.

QA report u každého gate eviduje command, exit code a důkaz. Skipped mandatory gate = `NOT VERIFIED` = release blocker.

# 23. Povinná integrační testovací matice

P6 udržuje následující matici. Každý bod musí být pokryt testem nebo explicitně definovaným manuálním scénářem.

## 23.1 Založení a persistence

1. `POST /jobs` vytvoří job ve stavu `DISCUSSING`.
2. Vstupní prompt je uložen jako immutable evidence.
3. Počáteční OWNER message existuje v message history.
4. Reload klienta načte stejný job a historii.
5. Druhý klient načte stejný authoritative state.

## 23.2 Message idempotence a pořadí

6. Dvě různé OWNER messages dostanou různé sequence.
7. Retry stejného `client_message_id` nevytvoří další message.
8. Concurrent message insert nezpůsobí duplicitní sequence.
9. Historie se stránkuje bez změny pořadí.

## 23.3 Turn lifecycle

10. Jedna OWNER message spustí nebo zařadí turn.
11. Nad jedním jobem neběží dva active turns.
12. Turn streamuje assistant message.
13. Completed turn má completed timestamp.
14. Failed turn není prezentován jako completed.
15. Worker lease je obnovitelná.

## 23.4 Steer / interrupt

16. OWNER message během active turnu se persistuje okamžitě.
17. Turn přejde přes interruption flow.
18. Částečná assistant message je označena `INTERRUPTED`.
19. Další turn pracuje s korekcí OWNERa.
20. Race interrupt/completion nevytvoří dva navazující turny.

## 23.5 Tool policy

21. Web research tool je dostupný.
22. Capability lookup je dostupný.
23. Browser tool je dostupný.
24. KájovoCML component/runtime/release/activation tool není součástí discussion registry; externí browserová mutace je dostupná pouze přes external-operation scope contract.
25. Tool failure se propíše do eventů a auditu.

## 23.6 Specification revisions

26. První validní spec proposal vytvoří revision 1.
27. Identický canonical spec nevytvoří další revision.
28. Funkční změna vytvoří revision 2.
29. Revision 1 zůstane immutable.
30. Digest je deterministický.
31. Rendered Markdown odpovídá structured spec.
32. `current_spec_revision_id` ukazuje na poslední revision.

## 23.7 Approval

33. Approval current revision s prázdnými openQuestions je úspěšný.
34. Approval stale revision vrátí `409`.
35. Approval stale digest vrátí `409`.
36. Approval během active turnu vrátí `409`.
37. Approval s openQuestions je odmítnut.
38. Concurrent double approval nevytvoří rozdílné approved hodnoty.
39. Approved revision je immutable.
40. Approved digest odpovídá revision.
41. Job přejde do `ANALYZING` atomicky s freeze.

## 23.8 Realizační autorita

42. Planner čte approved revision.
43. Planner dostane approved digest.
44. Implementation prompt obsahuje approved functional contract.
45. Před approval nevznikne canonical component.
46. Před approval nevznikne runtime principal.
47. Před approval nevznikne release/activation side effect.
48. Worker retry nevytvoří duplicitní component/runtime/release.

## 23.9 Browser

49. Job-specific browser session se spustí.
50. Browser profile je scoped na job.
51. Navigace vytvoří bezpečný preview frame.
52. Preview frame má monotonic revision.
53. Job A nemůže načíst frame jobu B.
54. `Cache-Control: no-store` je přítomen.
55. Sensitive transition skryje image.
56. Secret není v preview response.
57. Návrat do `NORMAL` obnoví bezpečný preview.
58. Browser crash je diagnostikovatelný.
59. Cleanup odstraní artefakty konkrétního jobu.
60. Opakovaný cleanup je bezpečný.

## 23.10 SSE a reconnect

61. SSE klient dostává eventy v pořadí.
62. `Last-Event-ID` replay vrátí chybějící retenované eventy.
63. Replay gap vyvolá resync flow.
64. Reconnect nevytvoří duplicitní message deltas.
65. Dva klienti dostávají stejný authoritative lifecycle.
66. Disconnect klienta neukončí serverový turn.

## 23.11 Cancellation

67. Cancel ve `DISCUSSING` ukončí aktivní turn a browser lifecycle.
68. Cancel v `ANALYZING` zastaví planner path.
69. Cancel v realizační fázi respektuje generation cancellation invariants.
70. Retry cancel requestu je bezpečný.
71. Po cancellation nevznikají další side effects.

## 23.12 UI

72. Desktop workflow je plně ovladatelné.
73. Tablet layout nepřetéká horizontálně.
74. Mobil `390 × 844` je použitelný bez horizontálního scrollu stránky.
75. Composer je dostupný a focusovatelný.
76. Streaming state je čitelný.
77. Tool activity je čitelná bez interního reasoning obsahu.
78. Spec panel obsahuje všechny schema sekce.
79. Approval CTA má správnou enable/disable logiku.
80. Stale approval zobrazí aktuální revision.
81. Sensitive preview zobrazuje bezpečný chráněný stav panelu.
82. Approved spec je read-only.
83. Lifecycle progress odpovídá server state.

## 23.13 Security

84. Všechny mutation routes vyžadují auth + CSRF.
85. Read routes vyžadují auth/job authorization.
86. Cross-job access je odmítnut.
87. Secret se neobjeví v logu testovaného flow.
88. Resolved secret, secret handle payload ani credential z dedikovaného pole se neobjeví v technických SSE eventech; trusted OWNER message event smí nést obsah zprávy, kterou OWNER sám odeslal.
89. Model-generated zakázaný tool call je odmítnut serverem.
90. Preview route nepřijímá filesystem path.

## 23.14 Regression

91. Generation cancellation tests musí být zelené.
92. Generation repair/integration tests musí být zelené.
93. Admin UI navigace zůstává funkční.
94. Root lint/typecheck/test/build musí být zelené.

## 23.15 Interaktivní konfigurace a teaching

95. AI otevře OWNERem určený externí portál.
96. Explicitní OWNER instrukce vytvoří bounded external operation scope.
97. Běžný Save/Continue krok uvnitř scope nevyžaduje další per-click potvrzení.
98. Nevratný krok mimo jednoznačnou instrukci vyžaduje exact action confirmation.
99. OWNER může credential dodat trusted chatem i credential polem.
100. Persistentní credential vznikne v Secret Manageru.
101. Browser login secret se nekopíruje do technického logu ani evidence.
102. Browser pokračuje ve stejné job session přes login redirect/popup.
103. Push MFA/OTP/WebAuthn vytvoří human challenge bez ztráty session.
104. CAPTCHA není obcházena.
105. Teaching run ukládá structured semantic steps.
106. Secret step ukládá pouze binding.
107. Parametrizovaný field ukládá typed input binding.
108. Locator compiler preferuje user-facing semantics.
109. Teaching step obsahuje side-effect i retry class.
110. Candidate manifest neobsahuje arbitrary JavaScript.
111. Candidate je součástí spec digestu.
112. Preflight funguje bez business mutace.
113. Replay funguje s OpenAI/model síťovým přístupem vypnutým.
114. Ne-idempotentní acceptance se ověřuje bez škodlivého duplicitního side effectu.
115. Replay fail identifikuje přesný krok a safe observed state.

## 23.16 Platformní Browser Automation Runtime

116. Platformní browser runtime je canonical CML component/principal.
117. Generated handler sandbox nemá Playwright, process, direct fetch ani host filesystem.
118. Generated MCP volá browser runtime výhradně přes `context.callComponent`.
119. CML permission omezuje caller na potřebný platformní tool.
120. Runtime navíc ověří caller/automation relation.
121. Browser login secret je grantován platformnímu runtime, nikoliv caller komponentě, není-li business důvod jiný.
122. Automation definition má immutable revisions a active revision.
123. Aktivovat lze pouze PASS revision.
124. Rollback obnoví poslední PASS revision.
125. Produkční run nevytváří generation job.
126. Produkční run nevolá žádný LLM provider.
127. Každý run má lease a persistentní step checkpoints.
128. `clientRunId` retry nevytvoří druhý run.
129. Disable blokuje další runy.
130. Preflight, status, cancel, history a reauth fungují jako standardní provozní funkce.

## 23.17 Determinismus, recovery a drift

131. Každý run používá izolovaný BrowserContext.
132. Reusable auth state je secret-grade artefakt.
133. Navigation, redirect i popup podléhají allowlistu.
134. Private/link-local target je defaultně blokován.
135. Primary locator fail může použít pouze schválený semantic fallback.
136. Fallback success vytvoří drift signal a nezmění manifest.
137. Non-idempotent timeout nepoužije blind retry.
138. Reconciliation rozliší již provedený side effect od bezpečného retry.
139. Neurčitelný výsledek přejde do `MANUAL_REVIEW`.
140. Worker crash nepovede ke dvěma browser contexts se stejným account lockem.
141. Cancel zabrání dalším side-effect krokům.
142. Auth expiry použije deterministic relogin nebo `REAUTH_REQUIRED`.
143. Contract drift nastaví `DEGRADED`.
144. Monitoring drift enqueueuje deduplikovaný REPAIR job.
145. Repair zachová component i automation definition identity.
146. Repair failure ponechá/obnoví poslední funkční revision.

## 23.18 Artifacts, provoz a deployment

147. Upload nepřijímá libovolnou host path.
148. Download má size/MIME/digest a run-scoped artifact id.
149. Sensitive trace není běžně distribuován.
150. Artifact retention cleanup je bounded a idempotentní.
151. Queue má capacity/backpressure.
152. Account concurrency key zabrání nebezpečnému paralelnímu běhu.
153. Async run pokračuje bez otevřeného klienta.
154. OWNER UI zobrazuje active revision, auth stav, last success/failure a run history.
155. OWNER může Run now, Preflight, Cancel, Reauthenticate, Disable/Enable a Repair/Reteach.
156. Playwright/Chromium smoke test běží na skutečném Ubuntu release prostředí.
157. Produkční Chromium runtime nepoužívá `--no-sandbox` jako standardní konfiguraci.
158. Upgrade Playwright/Chromium neprojde bez browser regression gate.
159. Root generation repair/cancellation/conformance testy zůstávají PASS.
160. Celá testovací matice nemá `FAIL` ani `NOT VERIFIED` u mandatory bodu.

# 24. Manuální end-to-end scénáře

## 24.1 Scénář A — desktop → mobil → approval → realizace

1. OWNER otevře `Generování` na desktopu.
2. Založí job neúplným, ale smysluplným popisem.
3. Job se zobrazí jako `DISCUSSING`.
4. AI zahájí turn a položí pouze otázku potřebnou pro funkční rozhodnutí.
5. OWNER odpoví.
6. AI provede capability lookup a web/browser ověření.
7. Tool activity je viditelná v diskusi.
8. Browser panel zobrazí skutečný bezpečný frame.
9. AI vytvoří `GenerationSpecification` revision.
10. OWNER otevře panel `Zadání` a zkontroluje obsah.
11. OWNER zavře desktopovou kartu.
12. Na mobilu otevře stejný job.
13. Serverová historie se načte ve stejném pořadí.
14. Aktuální spec má stejné revision id a digest.
15. OWNER pošle další instrukci.
16. AI vytvoří další revision pouze tehdy, když se změnil funkční obsah.
17. `openQuestions` je po uzavření diskuse prázdné.
18. Approval CTA je aktivní.
19. OWNER klikne `Schválit zadání a realizovat`.
20. Server schválí přesnou revision a digest.
21. UI označí specifikaci read-only.
22. Job přejde `ANALYZING → IMPLEMENTING → INTEGRATING → VALIDATING → CML_CONFORMANCE → ACTIVATING → COMPLETED` nebo zobrazí reálný blocker/failure podle runtime výsledku.
23. Approved revision se v průběhu výroby nezmění.

### Důkaz PASS

- message history z DB,
- spec revision ids/digests,
- SSE event log,
- browser preview metadata,
- lifecycle audit,
- QA screenshoty desktop/mobil,
- finální test/build output.

## 24.2 Scénář B — steer během modelové práce

1. OWNER odešle instrukci.
2. AI turn začne pracovat.
3. OWNER ještě během turnu odešle korekci.
4. Korekce se objeví v DB s message sequence.
5. Aktivní turn dostane interruption signal.
6. Turn skončí jako `INTERRUPTED`.
7. Částečná assistant message je auditovatelná.
8. Další turn se spustí s korekcí v historii.
9. AI pokračuje podle korigovaného záměru.
10. Spec revision odpovídá výsledku druhého turnu.

## 24.3 Scénář C — stale approval ze dvou klientů

1. Klient A a klient B otevřou stejný job a revision `N`.
2. Klient A odešle další OWNER message.
3. AI vytvoří revision `N+1`.
4. Klient B má stále zobrazenou revision `N`.
5. Klient B odešle approval revision `N`.
6. Server vrátí `409 GENERATION_SPEC_STALE` nebo contractem definovaný ekvivalent.
7. Klient B načte revision `N+1`.
8. Realizace se před úspěšným approval `N+1` nespustí.

## 24.4 Scénář D — credential a sensitive browser flow

1. AI zjistí, že browser práce vyžaduje credential.
2. OWNER jej zadá trusted diskusí nebo credential polem.
3. Pokud jde o persistentní credential, server jej uloží do existujícího Secret Manageru a vytvoří stable binding.
4. Operační logy nevytvoří další plaintext kopii credentialu.
5. Browser preview přejde do `SENSITIVE` před vyplněním credential field.
6. Browser tool provede login přes resolved binding nebo ephemeral challenge value.
7. Preview endpoint neposkytne citlivý screenshot.
8. Po opuštění credential UI preview přejde do `NORMAL` a vytvoří další bezpečný frame.
9. Pokud credential byl uveden přímo v OWNER message, zpráva zůstává součástí OWNER-only discussion historie podle trust modelu; Secret Manager je autoritou persistentního runtime použití.
10. Generated business komponenta nedostane browser login secret grant, pokud jej nepotřebuje pro jinou samostatnou business odpovědnost.

## 24.5 Scénář E — worker restart

1. AI turn běží s aktivní lease.
2. Worker proces je ukončen.
3. DB zachová message/turn/job state.
4. Lease expiruje nebo recovery mechanismus vyhodnotí vlastnictví.
5. Další worker provede bezpečnou recovery.
6. Nevznikne duplicitní OWNER message.
7. Nevzniknou dva active turns.
8. Turn skončí v korektním completed/failed/retried stavu.
9. Klient po reconnectu vidí authoritative výsledek.

## 24.6 Scénář F — cancel během browser/model aktivity

1. AI má aktivní turn a job-specific browser.
2. OWNER odešle cancel.
3. Server uloží cancellation intent.
4. Model request dostane cancellation signal.
5. Browser lifecycle se ukončí.
6. Preview/profile cleanup proběhne podle retention policy.
7. Job přejde do `CANCELLED`.
8. Po cancel se neprovede approval, další externí browserová mutace ani KájovoCML component/runtime/release/activation side effect.

## 24.7 Scénář G — AI nakonfiguruje externí developerský portál

1. OWNER zadá cíl, například vytvořit/nastavit integraci v developerském portálu.
2. AI otevře portál přes generation Playwright session.
3. Server vytvoří operation scope z OWNER instrukce.
4. OWNER předá login credential chatem nebo credential polem.
5. AI se přihlásí a provede běžné kroky uvnitř scope bez per-click potvrzování.
6. Pokud vznikne push MFA/OTP, session přejde do challenge a po OWNER zásahu pokračuje.
7. Pokud je nutný nevratný krok mimo explicitní instrukci, UI vyžádá exact confirmation.
8. AI ověří konečný stav portálu a zapíše verified facts/secret bindings.

## 24.8 Scénář H — teaching -> MCP -> rutinní běh bez AI

1. OWNER popíše webový úkon, pro který neexistuje API.
2. AI proces provede v teaching session.
3. Recorder vytvoří semantic workflow a typed inputs/secrets.
4. Candidate manifest projde preflight/replay bez LLM.
5. OWNER schválí specifikaci.
6. Pipeline vytvoří automation definition/revision a generated MCP adapter.
7. CML materializuje caller permission na platformní Browser Automation Runtime.
8. MCP business tool je vyvolán s runtime inputem.
9. Generated handler přes `context.callComponent` spustí platformní automation run.
10. Platformní runtime provede Playwright workflow bez OpenAI a vrátí typed výsledek.
11. Audit prokáže caller, revision, run a step výsledky.

## 24.9 Scénář I — portál se změní

1. Aktivní automatizace dříve funguje.
2. Portál změní DOM/label tak, že primary locator přestane fungovat.
3. Pokud schválený fallback prokáže stejný semantic cíl, run dokončí a definition se označí `DEGRADED`.
4. Pokud fallback neexistuje, run skončí `AUTOMATION_CONTRACT_DRIFT`.
5. Monitoring založí deduplikovaný REPAIR job s failure evidence.
6. AI v repair flow otevře aktuální web, upraví teaching/spec a vytvoří další revision.
7. Nová revision projde replay/conformance a aktivuje se.
8. Component identity, business MCP contract a automation definition id zůstávají stejné.

## 24.10 Scénář J — worker crash po mutující akci

1. Run provádí non-idempotentní submit.
2. Browser klikne na potvrzení a worker ztratí proces dříve než zapíše postcondition.
3. Lease expiruje.
4. Recovery worker nespustí submit znovu.
5. Otevře relevantní stav read-only cestou a vyhodnotí postcondition.
6. Pokud je výsledek již přítomen, označí krok/run jako úspěšný.
7. Pokud je prokazatelně nepřítomen a policy dovoluje retry, provede jeden bezpečný retry.
8. Pokud nelze rozhodnout, run přejde do `MANUAL_REVIEW` a požádá OWNERa o rozhodnutí.

## 24.11 Scénář K — expirace přihlášení

1. Aktivní automation používá reusable session state.
2. Preflight zjistí expiraci.
3. `HYBRID` flow provede deterministic relogin pomocí Secret Manager bindingu.
4. Pokud provider vyžaduje MFA, run přejde `CHALLENGE_REQUIRED`.
5. Po OWNER potvrzení se nový auth state bezpečně uloží a run pokračuje.
6. Pokud reauth nelze dokončit, definition dostane `REAUTH_REQUIRED` a business mutace se neprovede.

# 25. Security release checklist

P0 + P4 + P6 potvrdí:

- [ ] OWNER auth/job authorization na generation resources.
- [ ] CSRF na browser-originated OWNER mutations.
- [ ] CML caller authorization na platformních automation tools.
- [ ] Pouhá znalost automation id neposkytuje přístup.
- [ ] Generated handler sandbox nemá Playwright/process/direct network/filesystem authority.
- [ ] Browser login secrets jsou grantovány platformnímu runtime podle least privilege.
- [ ] Trusted OWNER chat se neduplikuje do technických prompt/log dumpů.
- [ ] Preview používá no-store a cross-job isolation.
- [ ] Sensitive screenshot/trace není veřejně dostupný.
- [ ] Navigation/redirect/popup allowlist je fail-closed.
- [ ] External public automation blokuje private/link-local targets.
- [ ] Manifest nedovoluje arbitrary JavaScript/shell/host paths.
- [ ] Upload/download používá server artifact handles a limity.
- [ ] Operation scope nepřekračuje explicitní OWNER instrukci.
- [ ] Nevratná akce mimo instrukci vyžaduje exact confirmation.
- [ ] CAPTCHA/WebAuthn není obcházeno.
- [ ] Run idempotency je serverově vynucená.
- [ ] Non-idempotentní uncertain step nepoužije blind retry.
- [ ] Cancel je autoritativní a pozdní update jej nepřepíše.
- [ ] Active automation revision je immutable PASS artefakt.
- [ ] Runtime automatizace nevolá LLM.
- [ ] Produkční Chromium běží pod neprivilegovanou identity se sandboxem.
- [ ] Error response neobsahuje stack trace ani credential data.
- [ ] Markdown/message rendering je sanitizovaný.

# 26. Provozní runbook požadavky

## 26.1 Playwright/Chromium deployment

Runbook obsahuje exact Playwright package version, browser install command, `PLAYWRIGHT_BROWSERS_PATH`/release path podle deploymentu, Ubuntu dependencies, service identity, Chromium sandbox requirements, smoke test, disk footprint a upgrade/rollback postup.

## 26.2 KCML Browser Automation Runtime

Dokumentuje platform component identity, worker service, queue/concurrency, run lease/heartbeat, contexts/process pool, health/readiness, enable/disable, monitoring a restart recovery.

## 26.3 Automation registry a runy

Dokumentuje definition/revision status, active revision, run states, idempotency, preflight, cancel, history, artifact retention, manual review a rollback.

## 26.4 Authentication

Dokumentuje Secret Manager bindingy, storage state, credential rotation, session invalidation, `REAUTH_REQUIRED`, challenge timeout a bezpečné OWNER doplnění OTP/MFA.

## 26.5 Drift a repair

Obsahuje failure kódy, jak rozlišit auth expiry/rate limit/drift, fallback telemetry, dedupe/cooldown repair enqueue, repair evidence a návrat na poslední funkční revision.

## 26.6 Artifacts/evidence

Popisuje storage root, quotas, MIME/size policy, sensitive evidence, protected trace access, retention a cleanup.

## 26.7 Generation discussion/SSE

Zachovává lifecycle discussion workeru, SSE heartbeat/replay/resync, preview, cancellation a browser job recovery.

## 26.8 Diagnostické příkazy

Runbook uvádí konkrétní repo commands pro generation contract, browser smoke, browser automation runtime, sandbox boundary, no-AI runtime a recovery checks. Manuální recovery akce jsou auditované a nesmějí měnit immutable evidence.

# 27. Dokumentační kontrakt

`docs/SSOT_CURRENT.md`, `docs/ARCHITECTURE.md`, runbook a relevantní component catalog dokumentace musí po release popisovat jeden shodný runtime.

Povinně dokumentují:

- persistentní `DISCUSSING` a spec freeze,
- generation browser research/configuration/teaching,
- platformní `KCML Browser Automation Runtime`,
- generated handler -> `context.callComponent` -> platform runtime boundary,
- automation definition/revision/run model,
- declarativní manifest DSL,
- navigation/origin policy,
- Secret Manager/auth binding a storage state,
- standardní preflight/run/status/cancel/history/reauth/repair funkce,
- async run contract,
- side-effect/idempotency/reconciliation,
- human challenge,
- artifacts/evidence,
- drift/monitoring/repair/rollback,
- Playwright/Chromium deployment a sandbox,
- observability a resource limits.

Architecture diagram musí obsahovat minimálně:

```text
OWNER Web UI
  | REST + SSE
  v
Fastify / Generation API
  |---- PostgreSQL: jobs/messages/turns/spec/teaching
  |---- Generation worker + OpenAI Responses
  |---- Generation Playwright BrowserSession
  |---- Secret Manager
  v
Approval freeze -> Generation planner / release pipeline
  |
  +---- Generated MCP component (restricted handler sandbox)
  |       |
  |       +-- context.callComponent
  |               |
  |               v
  +---- KCML Browser Automation Runtime (canonical platform component)
          |---- PostgreSQL: automation definitions/revisions/runs
          |---- Secret Manager grants
          |---- Playwright + Chromium
          |---- artifacts/evidence
          +---- monitoring / audit / repair
```

Dokumentace nesmí zobrazovat Playwright uvnitř generated handler sandboxu.

# 28. Definition of Done

Implementace je hotová pouze při splnění všech bodů.

## 28.1 Produkt

- [ ] OWNER pracuje v persistentním `DISCUSSING` workspace z desktopu, tabletu i mobilu.
- [ ] AI aktivně používá research a generation browser.
- [ ] AI umí v explicitně zadaném rozsahu nakonfigurovat externí portál bez per-click byrokracie.
- [ ] OWNER může credential předat trusted chatem i credential polem.
- [ ] Human challenge zachová práci a vrátí konkrétní požadavek OWNERovi.
- [ ] AI umí teaching a candidate replay bez runtime LLM.
- [ ] Approval zmrazí exact specification revision/digest.
- [ ] Pipeline vytvoří generated business MCP/function adapter a automation definition/revision.
- [ ] Rutinní webová funkce funguje bez AI.
- [ ] OWNER má Preflight, Run now, Status, Cancel, History, Reauthenticate, Enable/Disable a Repair/Reteach.

## 28.2 CML architektura

- [ ] Existuje jedna canonical `KCML Browser Automation Runtime` component/principal identity.
- [ ] Generated handler sandbox nebyl oslaben.
- [ ] Generated handler volá browser runtime pouze přes `context.callComponent`.
- [ ] CML permissions a platformní caller validation omezují přístup na správnou automation definition.
- [ ] Browser credentials používají least-privilege Secret Manager grants.
- [ ] Component release a automation revision activation/rollback jsou konzistentní.

## 28.3 Data a runtime

- [ ] Discussion messages/turns/spec revisions jsou persistentní a recoverable.
- [ ] Automation definitions/revisions jsou persistentní; revisions immutable.
- [ ] Runy mají lease, step checkpoints, cancellation a terminal immutability.
- [ ] Idempotentní start nevytváří duplicate run.
- [ ] Uncertain non-idempotent side effect má reconciliation/manual-review cestu.
- [ ] Async run přežije odpojení klienta.

## 28.4 Browser

- [ ] Playwright používá verzovaně kompatibilní Chromium na Ubuntu.
- [ ] Primární locators používají user-facing semantics.
- [ ] Browser contexts jsou mezi runs izolované.
- [ ] Navigation/redirect/popup policy je fail-closed.
- [ ] Auth state je secret-grade.
- [ ] Upload/download jsou bounded artifacts.
- [ ] Sensitive preview/trace neuniká.
- [ ] Produkční Chromium sandbox je zapnutý.

## 28.5 Reliability

- [ ] Preflight rozliší auth/portal/runtime problém před mutací.
- [ ] Retry respektuje side-effect semantiku.
- [ ] Worker crash recovery neduplikuje side effect.
- [ ] Cancel zastaví další side effects.
- [ ] Drift je diagnostikován a nevede k runtime AI improvizaci.
- [ ] Monitoring drift enqueueuje repair přes existující CML mechanismus.
- [ ] Repair zachová identity a rollbackuje na funkční revision při failure.

## 28.6 Security

- [ ] OWNER/job/caller authorization je serverově vynucená.
- [ ] CSRF chrání OWNER mutations.
- [ ] Manifest neumožní arbitrary code nebo host path.
- [ ] Browser login secret není dostupný generated calleru bez samostatného důvodu.
- [ ] CAPTCHA/WebAuthn se neobchází.
- [ ] Logs/SSE/evidence neobsahují nechtěné kopie resolved secrets.

## 28.7 UX a observability

- [ ] OWNER vidí active revision, auth status, poslední success/failure a run history.
- [ ] `DEGRADED`, `REAUTH_REQUIRED`, `CHALLENGE_REQUIRED`, `MANUAL_REVIEW` jsou srozumitelně prezentované.
- [ ] Desktop/tablet/mobile a keyboard/accessibility QA jsou PASS.
- [ ] Metrics pokrývají queue/run/auth/drift/browser resources/repair.

## 28.8 QA a release

- [ ] lint/typecheck/test/build PASS.
- [ ] generation contract/browser checks PASS.
- [ ] browser automation runtime/sandbox/no-AI/recovery checks PASS.
- [ ] Všech 160 integračních bodů je PASS.
- [ ] Manuální scénáře A–K jsou PASS.
- [ ] Skutečný Ubuntu Playwright/Chromium smoke je PASS.
- [ ] P6 vydal PASS QA report bez mandatory `NOT VERIFIED`.
- [ ] P0 vydal release acceptance.
- [ ] SSOT/architecture/runbook/catalog odpovídají runtime.

# 29. Instrukce pro předání pracovním skupinám

Každá role P1–P7 před zahájením práce obdrží:

1. tento celý dokument,
2. `IMPLEMENTATION_CONTRACT.md`, jakmile jej P0 vydá,
3. svůj role section z kapitoly 19,
4. aktuální repo `AGENTS.md`,
5. `docs/SSOT_CURRENT.md`,
6. `docs/ARCHITECTURE.md`,
7. handoffy všech upstream rolí, na kterých závisí.

Před prvním commitem každá role:

- načte repo pravidla,
- ověří branch a HEAD,
- ověří migration numbering,
- ověří, že owned files odpovídají contract freeze,
- spustí relevantní baseline tests,
- zaznamená případný blocker P0.

Pracovní skupina nesmí upravit cross-team public contract bez P0 amendmentu. Pokud implementační detail vyžaduje změnu rozhraní, role předloží P0 přesný důvod, dopad na downstream role a navrženou variantu. Po schválení se aktualizuje `IMPLEMENTATION_CONTRACT.md` a všechny dotčené handoffy/testy.

---

# 30. Finální cílové chování

OWNER otevře KájovoCML a v persistentní diskusi popíše běžným jazykem požadovaný výsledek. AI může zadání prodiskutovat, ověřit dokumentaci, otevřít skutečný web, přihlásit se pomocí OWNER credentialu a v rozsahu explicitního zadání provést praktickou konfiguraci externího portálu. Běžné kroky uvnitř tohoto cíle nevyžadují potvrzování každého kliknutí; nevratný krok mimo jednoznačnou instrukci má konkrétní confirmation.

Pokud požadavek obsahuje rutinní činnost na webu bez API, AI provede teaching, vytvoří semantic locators, typed inputs/outputs, auth bindings, side-effect a retry semantiku a ověří candidate preflight/replayem. OWNER schválí viditelnou immutable `GenerationSpecification`.

Generation pipeline vytvoří nebo aktualizuje generated MCP/function komponentu a současně stabilní browser automation definition s immutable aktivní revision. Generated komponenta zůstane v přísném CML sandboxu. Nemá Playwright ani přímý síťový přístup; business tool volá kanonický `KCML Browser Automation Runtime` přes `context.callComponent` a přes CML permission omezenou na svou automatizaci.

Platformní runtime spustí Playwright nad serverovým Chromium, načte pouze své Secret Manager bindingy, vytvoří izolovaný BrowserContext a interpretuje deklarativní manifest. Běh má idempotency, queue/lease, cancellation, pre/postconditions, side-effect-aware retry, artifacts, monitoring a typed result. Při jednotlivém rutinním spuštění se nevolá AI.

OWNER automaticky získá standardní provozní ovládání: Preflight, Run now, Status, Result, Cancel, History, Reauthenticate, Enable/Disable a Repair/Reteach. Expirace loginu vede k reauth flow, human verification k challenge, nejistý non-idempotentní side effect k reconciliation/manual review a změna portálu k drift evidence a existujícímu CML repair workflow. Runtime si sám pomocí AI nepřepisuje locatory ani manifest.

Celé řešení zůstává v jednom KájovoCML control-plane: component/principal identity, permissions, Secret Manager, HTTPS CML boundary, monitoring, audit, conformance, local release versioning, rollback a repair. Tím OWNER dostane praktický výsledek odpovídající očekávání: AI mu pomůže internetovou integraci skutečně připravit a naučit, ale běžná produkční funkce je stabilní, levná, auditovatelná a deterministická bez závislosti na AI.

---

**Konec závazného SSOT.**