# DELIVERY SUMMARY — poslední cílený ZIP-IN / ZIP-OUT opravný běh

**Datum:** 2026-08-09
**Vstupní ZIP:** `KajovoCML_INTERNAL_GENERATION_FINALIZED_2026-08-09(2).zip`
**Normativní kontrakt:** `docs/SSOT_CURRENT.md`
**Režim:** cílená oprava dvou potvrzených root cause; stávající internal-generation architektura a produktový koncept byly zachovány.

## 1. Forenzní závěr

Zdrojový kód potvrdil oba zadané nálezy:

1. `handleTechnicalFailure()` opouštěl post-deploy candidate přes rollback cestu, která předpokládala `previous_release_id`. U prvního CREATE tak rollback mohl skončit `generated_release_rollback_unavailable`; následná remediation přitom neměla autoritativně zajištěno zastavení runtime, odstranění `current` a přechod candidate release do `ROLLED_BACK`.
2. Při `INTEGRATING -> NEEDS_INPUT -> INTEGRATING` se OWNERem doplněný nebo již existující ACTIVE secret sice ukládal/reusoval v existujícím KajovoCML Secret Manageru, ale deterministický COMPONENT grant mohl vzniknout až v následném `runIntegrationPhase()`. První obnovený provider callback tedy mohl předběhnout grant.

`docs/SSOT_CURRENT.md` už požadovaný cílový invariant pokrývá, proto nebyl kvůli této opravě měněn.

## 2. Skutečně implementováno

### 2.1 Autoritativní cleanup opuštěného candidate release

- Candidate cleanup je sjednocen na existujících lokálních release/runtime mechanismech; nevznikl nový rollback/deployment systém.
- Přidán sdílený release cleanup helper použitelný pro obě existující varianty:
  - **CREATE bez previous release:** zastaví candidate runtime, odstraní candidate `current` symlink a candidate DB release se označí `ROLLED_BACK`.
  - **UPDATE/REPAIR s previous release:** obnoví previous release do `current`, restartuje jej, previous release se stane `ACTIVE` a `component.active_revision_id` odpovídá obnovené revizi.
- `cancelGeneratedCandidateRelease()` nyní umí korektně i první CREATE bez previous release; stop failure se už tiše nepolyká.
- `handleTechnicalFailure()` používá jediný cleanup callback pro post-deploy failure větve před přechodem na novou `IMPLEMENTING` remediation nebo do terminálního `FAILED`.
- Běžný technický retry v `INTEGRATING` candidate **neodstraňuje**; zůstává živý pro další integrační pokus. Cleanup se provede až při skutečném opuštění candidate.
- U REPAIR se po opuštění neúspěšného candidate obnoví zachycený repair base lifecycle/control stav existujícím repair-base-state mechanismem. Platí i pro terminální vyčerpání remediation pokusů.
- Pokud by samotný candidate cleanup po retry selhal, worker nezačne další candidate nad nekonzistentním stavem: job jde fail-closed do `FAILED` s `generation_candidate_cleanup_failed` evidencí.

### 2.2 COMPONENT Secret grant před resume `INTEGRATING`

- `setGenerationNeedsInput()` při již ACTIVE secretu před pokračováním vypočte explicitní i deterministické grant cíle z `grant_element_keys` a `elements[].requiredSecretNames` a použije existující `grantSecret` mechanismus.
- `submitGenerationInputs()` pro nový/rotovaný OWNER secret používá stejnou existující Secret Manager upsert cestu jako provider-issued secrets.
- Před změnou job state zpět na `INTEGRATING` se spustí společný grant helper nad všemi splněnými secret inputs a vytvoří PLATFORM + potřebné COMPONENT granty.
- Teprve po úspěšném dokončení grantů je job přepsán na `INTEGRATING` a může pokračovat browser/API/provider krok.
- Stejná pre-grant logika platí pro secret, který už v Secret Manageru existuje a integrační fáze jej znovu identifikuje jako požadovaný; OWNER není znovu dotázán.
- Nevznikl nový vault, approval ani secret-transfer mechanismus; OWNER plaintext invariant a stávající Secret Manager lifecycle zůstávají beze změny.

### 2.3 Release packaging / dokumentace

- Nové malé `.mjs` generation helpery jsou explicitně zahrnuty do existujícího release builderu, protože `tsc` je sám neemituje.
- `scripts/test-build-release.sh` kontroluje jejich přítomnost v release balíku.
- Aktivní README/architecture/deployment manifest stručně popisují first-CREATE cleanup, previous-release rollback, terminal REPAIR restore a pre-resume INTEGRATING Secret grant.
- Všechny předchozí mechanismy zůstaly zachovány: post-deploy INTEGRATING, živé candidate HTTPS callbacky, generalized egress, capability sandbox, browser/CDP, authoritative CANCEL, measured conformance, monitoring/repair, local rollback, Secret Manager autonomy, dependency permissions a absence GitHub/CI/GHCR runtime flow.

## 3. Nové executable regression testy

### `npm run generation:failure-cleanup:check` -> PASS

Test používá produkční failure-recovery/release-cleanup helper a skutečný lokální child runtime + `current` symlink. Ověřuje:

- první CREATE candidate bez previous release + technická chyba -> runtime zastaven, `current` odstraněn, candidate `ROLLED_BACK`;
- CREATE remediation -> nový candidate smí vzniknout až po odstranění starého;
- REPAIR candidate failure -> previous release je znovu `ACTIVE`, `current` a active revision míří na base release;
- terminální REPAIR failure -> base release a zachycený component lifecycle/control stav jsou obnoveny;
- běžný `INTEGRATING` retry zachová živý candidate.

### `npm run generation:integrating-secret-grant:check` -> PASS

Test používá skutečný lokální HTTPS candidate webhook a ověřuje pořadí grant-before-resume:

- candidate už běží;
- bez secretu callback secret resolve selže;
- job je `NEEDS_INPUT`;
- OWNER secret doplní;
- COMPONENT grant existuje ještě před první změnou zpět na `INTEGRATING` / prvním obnoveným provider callbackem;
- candidate webhook secret skutečně resolve a challenge projde;
- již existující ACTIVE secret nezpůsobí další OWNER prompt a chybějící component grant se deterministicky doplní před pokračováním.

## 4. Skutečně executable/runtime otestováno

Finální pracovní strom po všech změnách:

```text
npm run pretest                                      -> PASS
npm run generation:failure-cleanup:check             -> PASS
npm run generation:integrating-secret-grant:check    -> PASS
node scripts/test-generation-integration-phase.mjs   -> PASS
node scripts/test-generation-secret-autonomy.mjs     -> PASS
node scripts/test-generalized-external-egress.mjs    -> PASS
node scripts/test-generated-component-runtime.mjs    -> PASS
node scripts/test-generated-handler-capabilities.mjs -> PASS
node scripts/test-generation-cancellation.mjs        -> PASS
node scripts/test-repair-enqueue-control.mjs         -> PASS
bash scripts/test-install-release-guards.sh           -> PASS
```

`npm run pretest` zahrnuje Dashboard parity, internal-generation contract, capability sandbox, generated runtime, browser, cancellation, oba nové regression testy, repair enqueue evidence, post-deploy INTEGRATING, generalized egress a Secret Manager autonomy.

Další syntax kontroly:

```text
TypeScript parser (TS/TSX/MTS/CTS) -> PASS, 194 souborů
node --check (JS/MJS)              -> PASS, 36 souborů
bash -n                             -> PASS, 20 souborů
JSON parse                          -> PASS, 23 souborů
```

## 5. Neověřeno / environmentálně blokováno

Tyto body **nejsou vydávány za PASS**:

- `npm run generation:browser-cross-origin:check` -> **BLOCKED**, Chromium skončí před navigací na `browser_navigation_failed:net::ERR_BLOCKED_BY_ADMINISTRATOR`; test ani OOPIF implementace nebyly oslabené nebo nahrazené mockem.
- `npm run generation:live:check` -> **BLOCKED**, `KCML_LIVE_COMPONENT_URL_required`; skutečné nasazené KajovoCML prostředí není v tomto sandboxu dostupné.
- Repo vyžaduje Node `>=24.0.0`, dostupný je Node `v22.16.0`.
- Repo piná `pnpm@11.7.0`, `pnpm` není v PATH. Proto nebyl falešně označen jako PASS plný podporovaný `lint/typecheck/test/build`.
- `bash scripts/test-build-release.sh` nelze v tomto obrazu dokončit, protože chybí instalované repo dependencies / `node_modules/.bin/vitest`; release packaging změna je pokryta zdrojovým guardem, ale plný build-release není vydáván za PASS.
- Live PostgreSQL/systemd deployment nebyl v tomto sandboxu vydáván za E2E PASS.

## 6. Výstupní integrita

Výstupem je celý repozitář, nikoli patch. Finální archiv `KajovoCML_INTERNAL_GENERATION_FINAL_CLEANUP_2026-08-09.zip` je vytvořen bez `.git`, `node_modules`, `dist`, `build` a cache/runtime artefaktů.

První čisté re-extract ověření výsledného balíku bylo provedeno skutečně, ne deklarativně:

```text
unzip -t finálního ZIPu                              -> PASS
čistý re-extract                                     -> PASS, 343 souborů
npm run pretest                                      -> PASS
bash scripts/test-install-release-guards.sh          -> PASS
npm run generation:failure-cleanup:check             -> PASS
npm run generation:integrating-secret-grant:check    -> PASS
npm run generation:browser-cross-origin:check       -> BLOCKED: net::ERR_BLOCKED_BY_ADMINISTRATOR
npm run generation:live:check                       -> BLOCKED: KCML_LIVE_COMPONENT_URL_required
```

Po zápisu tohoto reportu se archiv znovu deterministicky zabalí a provede se finální CRC/integrity kontrola; report samotný už nemění produktový kód ani výsledek executable testů.
