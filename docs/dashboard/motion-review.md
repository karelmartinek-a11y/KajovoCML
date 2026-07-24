# Dashboard KájovoCML – motion model

Pohyb nevzniká z časovače ani z existence nakresleného kabelu. Autoritativním zdrojem je persistovaný `component_operation_lease` pro fázi STARTED, `component_operation_event` pro dokončení a `component_external_gateway_call` pro externí komunikaci. SSE přehrává STARTED před FINAL i při rychlé operaci a řadí souběžné události deterministickým compound cursorem.

- **STARTED**: opakovaný směrový impuls po konkrétním PULSE nebo externím vlákně a procesní indikátor v uzlu.
- **COMPLETED / SUCCEEDED**: jednorázový výsledkový signál a textové potvrzení.
- **COMPLETED / FAILED**: chybový symbol, krátké zvýraznění vlákna a korelační identita.
- **BLOCKED**: varovný stav odlišný od transportní chyby.
- **Souběh**: události se evidují odděleně podle kind/id/stage; jedna událost nepřepisuje jinou.
- **Odpojení streamu**: živé indikátory se zastaví a UI výslovně označí poslední potvrzený stav.
- **Reduced motion**: trajektorie se nespustí; na vlákně zůstane statický symbol směru nebo výsledku a všechny informace zůstanou textově dostupné.

- **Tažení nového PULSE**: odchozí konektor kreslí živý náhled kabelu; cílová zásuvka se označí až podle asynchronního serverového compatibility preview. Loading, compatible, incompatible a forbidden mají textově/symbolicky rozlišitelné stavy.
