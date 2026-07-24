# Dashboard KájovoCML – motion model

Pohyb po PULSE vlákně vzniká pouze z persistované `component_operation_event`, jejíž komponenta, směr a PULSE typ odpovídají zobrazenému spojení. Po odpojení SSE se animace zastaví a UI ukazuje poslední potvrzený stav. SSE podporuje omezený replay, `Last-Event-ID`, heartbeat a reconnect hint.

`prefers-reduced-motion: reduce` potlačí trajektorii a přechody; výsledek, směr, čas, correlation ID a stav autorizace zůstávají dostupné textem a ikonou.
