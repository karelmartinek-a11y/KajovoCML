# KajovoCML — SSOT_CURRENT

**Stav dokumentu:** normativní cílový SSOT pro další implementační běh
**Účinnost:** 2026-08-09
**Produkt:** `KajovoCML`
**Technický prefix:** `KCML`
**Lifecycle:** `PRE_PRODUCTION_TESTING`
**Vlastník systému:** deployment-managed OWNER `karmar78`

Tento dokument nahrazuje předchozí obsah `docs/SSOT_CURRENT.md` jako závazné zadání cílového fungování KajovoCML. Vznikl po forenzním porovnání skutečného zdrojového kódu s explicitními rozhodnutími vlastníka v pracovním vlákně.

## 1. Autorita a zdroj pravdy

1. **Skutečný aktuální stav programu se vždy zjišťuje forenzně ze zdrojového kódu.** Testy, komentáře, auditní reporty, historické dokumenty ani popisné texty nesmějí přepsat realitu zdrojového kódu.
2. **Tento SSOT je autoritou pro cílový stav a vůli vlastníka.** Pokud je současný zdrojový kód s tímto SSOT v rozporu, je to implementační mezera, kterou je nutné odstranit změnou programu; není to důvod reinterpretovat SSOT podle starého kódu.
3. Po dokončení implementace musí být zdrojový kód, migrace, runtime kontrakty, UI a aktivní dokumentace s tímto SSOT v souladu.
4. Nejsou přijatelné mocky, placeholdery, demo náhrady, skryté zkratky, „dočasně hotové“ stavy ani redukce rozsahu vydávaná za splnění.

## 2. Produktový směr

KajovoCML je **jeden uzavřený svět vlastníka**, ve kterém se nové schopnosti nemají primárně připojovat jako cizí externě vyvíjené prvky přes ruční onboardingový handoff. Nové schopnosti se mají **navrhovat, vytvářet, integrovat, ověřovat a uvádět do provozu přímo uvnitř KajovoCML** z lidského zadání.

Uživatel popisuje **co chce**, nikoli technickou implementaci. KajovoCML převezme odpovědnost za technické rozložení úkolu, volbu integrační cesty, vytvoření potřebných MCP prvků nebo AI prvků, konfiguraci externích služeb, ověření funkčnosti a začlenění výsledku do CML.

Cílem není vytvořit obecnou platformu na výrobu agentů pro třetí strany. Cílem je autonomně rozšiřovat **vlastní Kájovo prostředí**.

## 3. CML standard je nepřekročitelný invariant

Veškerá nová činnost a každý nově vytvořený prvek musí fungovat **v rámci existujícího CML standardu**. CML standard znamená soubor platformních mechanismů, které skutečný zdrojový kód KajovoCML používá pro identitu, řízení, oprávnění, Secret Manager, monitoring, heartbeat/state, runtime kontrolu, audit, aktivaci/deaktivaci a vizuální správu prvků.

- AI nesmí CML standard obcházet ani si rozšiřovat vlastní mantinely mimo něj.
- AI-generated business handler smí provádět side-effecty pouze přes capability rozhraní poskytované KajovoCML: `context.secret`, `context.callComponent`, `context.callExternal` a výslovně omezený `context.state`. Přímý síťový přístup, Node process/system moduly, libovolný filesystem, `process.env`, dynamický import nebo runtime code-generation nesmějí umožnit obejít CML oprávnění, Secret Manager, egress ani state boundary; toto musí být technicky vynuceno runtime, nikoli pouze promptem.
- Nový prvek nesmí být označen jako hotový ani aktivován, dokud není plnohodnotně začleněn do CML standardu.
- **Nevytvářet paralelní bezpečnostní, autorizační, secret, monitoringové ani auditní systémy.** Používat a rozšiřovat existující CML mechanismy pouze tehdy, když je to nutné pro požadovanou schopnost.
- Nevytvářet nové bezpečnostní brány, compliance workflow nebo schvalovací procesy, které nejsou nutné pro CML standard a pouze komplikují práci vlastníka.

Pro cílovou implementaci jsou zvlášť závazné existující schopnosti doložené ve zdrojovém kódu:

- samostatná identita a lifecycle prvku;
- administrativní enable/disable, quarantine/restore a další již existující řídicí operace;
- heartbeat, state query, monitoring a watchdog logika;
- persistentní provozní a auditní evidence;
- oprávnění mezi identitami/prvky;
- Secret Manager, verze secretů, granty, revoke/rotate/reveal;
- OWNER Dashboard a stabilní vizuální reprezentace prvku;
- možnost vlastníka prvek odstavit bez nutnosti odstranit celý KajovoCML.

## 4. Nový základní uživatelský tok: zadání → návrh → realizace → hotovo

V OWNER administračním rozhraní vznikne jedna nová hlavní sekce, pracovně **„Generování“** / **„Nový MCP / agent“**.

Primární rozhraní je záměrně jednoduché:

1. velká čistá plocha / textové pole připomínající jednu A4;
2. vlastník volným českým textem popíše požadovaný výsledek;
3. KajovoCML zadání analyzuje a navrhne nejmenší smysluplnou strukturu výsledku — například jeden MCP server, více MCP serverů, jeden AI agent nebo kombinaci několika prvků;
4. návrh je vysvětlen laicky a stručně; vlastník jej může jedním krokem potvrdit;
5. pokud chybí skutečně nezbytný údaj, KajovoCML se doptá **laicky a pouze na potřebnou informaci** (např. telefonní číslo, účet, URL, heslo, API klíč, požadované pravidlo chování);
6. po doplnění údajů realizace pokračuje autonomně;
7. uživatel sleduje pouze srozumitelný průběh/stav kaskády a konečný výsledek.

Výchozí UI nesmí uživatele nutit vyplňovat technické formuláře, architektonické volby, protokoly, tokenové lifecycle detaily, build parametry, CI parametry ani jiné informace, které si systém umí odvodit sám.

## 5. Role AI

AI má v KajovoCML dvě hlavní role:

### 5.1 Překladač lidského záměru

AI převede běžné lidské zadání do přesného interního realizačního plánu, kontraktů, MCP funkcí, agentních rolí, oprávnění, potřebných secretů, externích integrací a ověřovacích kroků.

### 5.2 Autonomní systémový integrátor

AI má aktivně hledat a realizovat technickou cestu k výsledku. Je očekáváno, že podle potřeby:

- prostuduje aktuální technickou dokumentaci externí služby;
- použije webové vyhledávání a prohlížeč/Chromium;
- přihlásí se pomocí údajů poskytnutých vlastníkem;
- nastaví webhooky, developer účty, API konfiguraci, callback URL a další integrační parametry;
- upraví zdrojový kód v pracovní kopii;
- spustí potřebné lokální buildy a funkční ověření;
- vyzkouší skutečnou integrační cestu;
- při chybě provede diagnostiku, opravu a opakování;
- dokončí integraci teprve po dosažení funkčního výsledku v CML standardu.

AI není oprávněna měnit produktové invarianty ani CML standard. Inteligence slouží k nalezení a provedení cesty, nikoli k přepisování cíle.

## 6. Výsledné prvky: MCP server jako samostatná schopnost

V terminologii vlastníka je **MCP server prakticky jedna samostatně ovladatelná funkce/schopnost**, i když technicky může obsahovat více souvisejících MCP tools, pokud je to přirozený atomický celek.

Každý nově vytvořený runtime prvek musí být:

- samostatně identifikovatelný v KajovoCML;
- samostatně monitorovatelný;
- samostatně zapnutelný a vypnutelný;
- samostatně auditovatelný;
- připojený na heartbeat/state/monitoring podle CML standardu;
- viditelný v existujících CML administračních pohledech;
- oprávněními oddělitelný od ostatních prvků;
- navázaný na Secret Manager pouze přes příslušné granty.

Pro nově generované MCP prvky je závazné, že jejich **CML-facing runtime rozhraní je dostupné přes samostatnou HTTPS identitu/hostname**. Interní lokální transport může být použit pouze jako implementační detail za HTTPS hranou; nesmí být autoritou pro komunikaci mezi samostatnými CML prvky.

Externí komunikace není zakázána. Generované prvky smějí používat webhooky, HTTPS API a další technicky nutné externí služby/protokoly podle konkrétního zadání. Externí integrace nesmí být zaměňována za externí onboarding cizího prvku.

## 7. AI agenti

AI agent se vytváří pouze tam, kde požadovaná schopnost skutečně potřebuje jazykové porozumění, úsudek, práci s kontextem nebo generování obsahu.

Agent může mít například:

- vlastní instrukce/charakter;
- přístup k definovanému kontextu;
- vector store nebo jiný vyhledávací kontext;
- přístup k produkčním systémům prostřednictvím CML oprávnění a MCP funkcí;
- pravidla pro generování nebo odesílání odpovědí.

Agent nesmí být použit jako náhrada deterministické MCP funkce tam, kde AI není potřeba. AI agent a deterministická MCP schopnost používají stejný CML lifecycle, monitoring, identitu, oprávnění a Secret Manager.

## 8. Interní generování nahrazuje externí onboardingový handoff

Historický zdrojový strom obsahoval externí onboardingový model založený na integračním tokenu, handoffu programátorovi, source upload/revizích, GitHub PR/CI, OCI/GHCR artefaktech a následném předání dalšího dlouhodobého access tokenu. **Tento model je zastaralý a nesmí být aktivní produktovou cestou.**

Cílový stav:

- onboarding nově vytvářených interních prvků je interní součást generation pipeline;
- vlastník negeneruje ani nepředává zvláštní onboardingový/integration token externímu programátorovi;
- nevzniká sekvence „dočasný integrační token → onboarding → nový přístupový token“ jako uživatelský proces;
- KajovoCML si interně vytvoří a spravuje **jednu runtime identitu / jeden dlouhodobý přístupový token pro každý vytvořený prvek**;
- token/identita je viditelná a spravovatelná v existující administraci identit/oprávnění, včetně revoke/rotate podle CML standardu;
- Secret granty se vážou přímo na výslednou komponentní identitu;
- interní generation job může mít vlastní technickou job identitu, ale nesmí z ní vzniknout další tokenový produktový lifecycle pro vlastníka.

Protože projekt zůstává v `PRE_PRODUCTION_TESTING`, je výslovně povolena breaking migrace starého testovacího onboardingového modelu na tento nový interní model. Není požadována backward compatibility se starým externím handoffem.

## 9. GitHub a CI nejsou součástí cílového výrobního toku

Cílové KajovoCML nesmí pro generování, integraci, ověření ani nasazení nového interního prvku záviset na GitHubu, GitHub Actions, pull requestu, externím CI/CD ani GHCR jako povinném mezičlánku.

- Žádný generation job nesmí čekat na PR, CI run, merge nebo GitHub deployment.
- GitHub/CI nesmí být completion gate.
- Zdrojový kód a pracovní kopie mohou být udržovány přímo na serveru KajovoCML.
- Pro bezpečný návrat stačí jednoduché **lokální verzování/snapshot/rollback** před změnou a při aktivaci nové revize.
- Vlastník výslovně akceptuje možnost, že chybná změna může dočasně narušit web; priorita je jednoduchost a autonomní oprava, nikoli budování další distribuované deployment infrastruktury.
- Architektura musí přesto držet generované prvky oddělené tak, aby jejich běžná runtime chyba neznemožnila vlastníkovi využít CML řízení k jejich vypnutí nebo opravě.

Lokální build, typecheck, funkční ověření, skutečný integrační test a CML runtime evidence jsou dovoleny a očekávány. Zakázanou věcí je **procesní závislost na externím CI/GitHub pipeline**, nikoli smysluplné ověření výsledku.

## 10. Secrets a přístupové údaje

KajovoCML je považováno za důvěryhodnou OWNER zónu.

### 10.1 Komunikace s vlastníkem

- Vlastník smí do textového nebo později hlasového dialogu zadat heslo, API klíč, token nebo jiný přístupový údaj přímo v plaintextu.
- AI nesmí práci blokovat ani vytvářet zvláštní proces jen proto, že vlastník poskytl secret v plaintextu.
- Vlastník smí požádat o zobrazení secretu a existující `Reveal` funkce má zůstat použitelná.
- Trusted OWNER chat a interní OWNER log mohou plaintext secret obsahovat; **zamezení plaintextu v této důvěryhodné zóně není produktový gate**.
- Redakce může existovat jako transparentní implementační detail pouze tehdy, pokud nezdržuje, neblokuje ani nemění uživatelský tok.

### 10.2 Trvalé runtime použití

Pro skutečné runtime použití je povinný **existující KajovoCML Secret Manager**:

- AI po získání údaje vytvoří nebo použije odpovídající stabilní secret;
- pokud požadovaný stabilní secret již existuje v použitelném stavu `ACTIVE`, generation pipeline jej znovu nevyžaduje od OWNERa a pouze zajistí potřebné existující CML granty;
- dotazník je deterministicky minimální: OWNER dostává pouze neodvoditelnou účetní identitu, credential nebo business rozhodnutí s uvedeným důvodem; hostname, server, port, protokol, TLS, endpoint, timeout a region si platforma ověří sama z CML/providera;
- každá neúspěšná nebo zablokovaná generace může dostat nový navázaný OWNER běh s plain-text instrukcí. Původní job/evidence zůstávají neměnné, komponenta/principal/hostname zůstávají stejné a nikdy nevznikne paralelní control plane;
- secret nebo token nově vydaný externím providerem během integrace umí integrační AI přímo uložit/rotovat v existujícím Secret Manageru a grantovat výsledným prvkům bez povinného ručního copy/paste;
- trvalá hodnota se ukládá mechanismem existujícího Secret Manageru;
- přístup výsledného prvku je dán existujícím grantem;
- revoke/rotate/status/reveal se řeší existujícím CML mechanismem;
- nevytvářet nový password manager, nový vault ani paralelní secret systém.

## 11. Monitoring, ovladatelnost a zotavení jsou povinné

Každý generovaný prvek musí před aktivací prokázat, že je plně začleněn do CML runtime řízení.

Minimálně musí být podle povahy prvku k dispozici:

- runtime health/readiness;
- heartbeat;
- state/reporting;
- monitoring a watchdog;
- auditní stopa;
- enable/disable;
- možnost quarantine/restore nebo ekvivalentní existující lifecycle řízení;
- vlastníkova možnost změnit/revokovat oprávnění a Secret granty;
- viditelnost v CML UI.

Toto není nový bezpečnostní workflow. Jde o existující CML standard, který je samotnou definicí toho, že je prvek správně součástí KajovoCML.

### 11.1 Automatická oprava interně generovaného prvku

Pokud existující monitoring/watchdog naměří u `INTERNAL_GENERATED` prvku skutečnou runtime nebo contract závadu, KajovoCML smí automaticky založit **repair generation job ve stejném existujícím toku `Generování`**. Nejde o nový repair control plane.

- repair vychází z aktuálního zdroje a aktivního lokálního release poškozeného prvku a přebírá konkrétní monitoring/error evidence;
- AI diagnostikuje root cause a vytváří nejmenší úplnou lokální opravnou revizi při zachování CML identity prvku;
- opravená revize musí před aktivací znovu projít celý relevantní skutečně měřený CML conformance;
- při neúspěšné opravě se zachová nebo obnoví poslední funkční lokální release;
- stejná závada nesmí vytvářet paralelní nekonečné repair joby; povinná je deduplikace a cooldown nad existujícím generation job modelem;
- pokud monitoring závadu naměří, ale repair job nelze založit, chyba nesmí být spolknuta: musí vzniknout evidence v existujícím CML alert/audit mechanismu s component ID, correlation ID a technickým důvodem; další normální monitorovací cyklus smí založení znovu zkusit;
- pokud oprava objektivně potřebuje chybějící OWNER credential, oprávnění nebo obchodní rozhodnutí, repair job přejde do existujícího `NEEDS_INPUT`/`BLOCKED` stavu a je viditelný v `Generování`.

## 12. Generation pipeline

Generation pipeline je jeden serverový proces z pohledu vlastníka, ale může interně používat několik AI kroků. Vnitřní kaskáda není samostatným produktem a uživatele nemá zatěžovat.

Doporučená interní sekvence:

1. **Intent normalization** — převod lidského zadání na jednoznačný cíl a invarianty.
2. **Architecture decomposition** — návrh minimálního počtu MCP prvků / agentů a jejich vazeb.
3. **Missing-input extraction** — zjištění pouze skutečně chybějících údajů.
4. **Integration research** — nalezení aktuální technické cesty a dokumentace externích systémů.
5. **Implementation** — vytvoření/úprava kódu a integračního plánu v lokální pracovní kopii; provider-side konfigurace, která potřebuje živý callback, se zde ještě neprovádí.
6. **Candidate deployment** — registrace a lokální nasazení candidate runtime; před integrační konfigurací musí projít skutečný runtime health/readiness probe.
7. **External configuration / INTEGRATING** — browser/API konfigurace webhooků, účtů a integrací probíhá až proti skutečně běžícím veřejným HTTPS MCP/webhook URL candidate prvků; candidate callback je v této fázi dosažitelný přes existující CML ingress, i když prvek ještě není finálně OWNER-active.
8. **Functional validation** — skutečné ověření cílového scénáře a oprava chyb ve smyčce.
9. **CML conformance** — začlenění identity, HTTPS endpointu, oprávnění, secret grantů, monitoringu, heartbeat/state a auditu.
10. **Activation** — aktivace až po splnění CML standardu.
11. **Completion** — stručné sdělení výsledku a zobrazení vytvořených prvků.

Kaskáda má automaticky pokračovat, dokud je možné problém vyřešit technicky. Zastavit se a doptat vlastníka má pouze při skutečně chybějícím údaji, oprávnění nebo externí překážce, kterou systém sám odstranit nemůže. OWNER operace `CANCELLED` je naopak autoritativní: běžící worker musí v nejbližším praktickém cancellation pointu ukončit model/browser/shell práci, nesmí pokračovat do další fáze ani aktivovat kandidátní release a nesmí stav `CANCELLED` přepsat pozdějším stavem; již funkční aktivní release se zrušením nesmí poškodit.

Existující CML `context.callExternal` / external HTTPS gateway není POST-only transport. Musí v rámci stejného CML target/permission/Secret Manager/SSRF/audit/circuit-breaker standardu podporovat HTTP operace, query, bezpečné headers a body formáty, které jsou technicky nutné pro konkrétní schválenou externí integraci; generated handler kvůli tomu nikdy nezískává přímý síťový bypass.

## 13. Lokální pracovní kopie a nasazení

Generování kódu probíhá na serveru, kde je KajovoCML schopno pracovat se zdrojovým stromem, protože vlastník musí být schopen zadat rozšíření vzdáleně přes web bez dostupného developerského počítače.

Požadovaný princip:

- před generation jobem vznikne lokální obnovitelný snapshot/revision point;
- AI pracuje v oddělené pracovní kopii/worktree;
- změny se ověří lokálně a integračně;
- nová revize prvku se nasadí lokálně;
- při neúspěchu může systém obnovit předchozí lokální revizi;
- není vyžadován GitHub ani externí CI/CD;
- nesmí vzniknout druhý komplikovaný release systém jen kvůli této funkci.

## 14. UI a viditelnost kaskády

OWNER UI má zobrazovat pouze informace užitečné vlastníkovi:

- původní zadání;
- stručný navržený rozklad na prvky;
- případné chybějící údaje;
- aktuální srozumitelnou fázi a průběh;
- vzniklé prvky a jejich stav;
- výsledek nebo konkrétní blocker.

Není cílem zobrazovat interní chain-of-thought, technické prompty jednotlivých interních modelů ani detailní procesní papírování.

## 15. Hlasový chat

Hlasový chat je **pozdější vstupní rozhraní**, nikoli součást této první implementační změny. V budoucnu má volat stejnou serverovou generation funkci jako textová A4. Business logika generation pipeline nesmí být navázána přímo na konkrétní UI vstup.

## 16. Zachované aktuální platformní základy

Forenzní audit aktuálního repozitáře potvrzuje, že se má stavět na existujících implementovaných mechanismech, nikoli je nahrazovat novou platformou:

- PostgreSQL migrační baseline `001` a navazující aktivní migrace včetně internal-generation/repair/integration/follow-up změn až `013`;
- generic `component` / `principal` model a oprávnění;
- component control queue a worker;
- heartbeat challenge, state query, monitoring scheduler/watchdog;
- persistentní E2E/readiness evidence;
- Secret Manager a Secret API;
- OWNER Dashboard topology a suspend/deregister řízení;
- audit chain a component audit stream;
- existující admin UI pro komponenty, monitoring, identity, permissions, secrets a audit.

Mimo cílový stav jsou historické/retired části svázané s externím onboarding handoffem, GitHub PR/CI, GHCR/OCI provenance jako povinnou cestou a dočasným integration-token lifecycle; nesmějí být aktivní runtime/generation cestou.

## 17. Cílové acceptance invariants

Implementace tohoto SSOT je hotová pouze tehdy, když platí současně:

1. OWNER může v novém UI napsat volné zadání a založit generation job bez technického formuláře.
2. Systém vytvoří srozumitelný návrh struktury prvků a doptá pouze nezbytné údaje.
3. AI worker dokáže autonomně pracovat se zdrojovým kódem, shell/build nástroji, webovým výzkumem a browser automatizací podle potřeby.
4. Vytvořený MCP/agentní prvek je samostatný CML prvek s vlastní identitou a HTTPS adresou.
5. Prvek je plně viditelný v existujícím CML řízení, monitoringu, heartbeat/state, auditu a Dashboardu.
6. Prvek lze OWNERem vypnout a znovu zapnout bez odstranění KajovoCML.
7. Runtime secrets používají existující Secret Manager a granty.
8. Vstupní plaintext credential v OWNER dialogu není blokován speciální security procedurou.
9. Nevzniká externí integration-token handoff ani druhý access-token handoff; výsledný prvek má jednu CML runtime identitu/token spravovanou interně.
10. Generation/deploy tok není závislý na GitHubu, GitHub Actions, PR, externím CI/CD ani GHCR.
11. Chyba generovaného prvku neodebere vlastníkovi možnost použít CML k jeho diagnostice, deaktivaci nebo nahrazení.
12. Skutečná runtime/contract závada `INTERNAL_GENERATED` prvku může z existujícího monitoringu/watchdogu spustit deduplikovaný repair generation job nad aktivním lokálním release; neúspěšná oprava zachová nebo obnoví poslední funkční revizi a chybějící OWNER vstup se zobrazí v existujícím `Generování`.
13. Neexistuje mock/demo/placeholder implementace vydávaná za hotový cíl.
14. Generated business handler technicky nemůže obejít CML capability boundary přímým Node/network/process/filesystem přístupem; legitimní side-effecty jdou pouze přes poskytovaný CML context.
15. OWNER `CANCELLED` je autoritativní pro běžící generation/repair job a po zrušení nemůže worker aktivovat nový candidate release ani stav později přepsat.
16. Selhání automatického repair enqueue z monitoringu vytváří existující CML alert/audit evidence a není potichu spolknuto.
17. Voice chat není podmínkou dokončení této fáze.

## 18. Implementační pravidlo pro konflikty

Při jakékoli pochybnosti platí tato otázka:

> **Dostane vlastník jednoduchým lidským zadáním autonomně vytvořenou funkční schopnost, která je po dokončení normálním plně řízeným prvkem KajovoCML podle existujícího CML standardu?**

Pokud odpověď není jednoznačně ano, implementace není v souladu s tímto SSOT.
