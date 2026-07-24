# Kompatibilitní matice Dashboardu

| Oblast | Stav | Poznámka |
|---|---|---|
| Stávající komponenty a principal access tokeny | PASS | Nový model rozšiřuje `component_permission` a `principal_access_token`; scope vydaného tokenu se nepřepisuje. |
| Stávající integration-token Secret granty | PASS | Handoff zachovává transfer metadata a stabilní visual node. |
| Starší aktivní komponentová oprávnění | MIGRATION REQUIRED | Migrace zachová oprávnění; jednoznačná automatická syntéza portových edges není v této změně prováděna. Zůstávají funkční ve standardním modelu. |
| Starší manifesty bez popisů portů | PASS | Porty se odvozují z aktuálních PULSE mask; chybějící lidský popis se nevymýšlí. |
| Nový PULSE edge model | PASS | Aditivní forward migrace 004, bez změny historických migrací. |
| Externí boundary nodes | BLOCKED | Datové modely externích stran zůstaly nedotčené, ale nejsou v této dodávce vykresleny v canvasu. |
| Produkční SSE/replay v multi-instance režimu | MIGRATION REQUIRED | Zdroj je PostgreSQL a replay je persistovaný; produkční zatížení a proxy buffering vyžadují deploy ověření. |
| Historické onboarding katalogy | PASS | Nebyly přepsány. Nová component-facing manifestová povinnost nevznikla, proto katalog 1.1 zůstává kanonický. |
