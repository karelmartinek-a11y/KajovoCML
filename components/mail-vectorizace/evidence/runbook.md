# Runbook

- Overit, ze runtime bezi v `LONG_RUNNING` rezimu a readiness je `PREPARED` nebo `READY`.
- Overit mount stabilniho datoveho rootu a pritomnost SQLite souboru v `context.storage.dataPath`.
- Pri zmene hesla schranky rotovat pouze KCML secret `MAIL_RECEPCE_PASS`; rebuild image neni potreba.
- Pri zmene OpenAI pristupu rotovat pouze KCML secret `API_KEY_VECTOR`.
- Pokud readiness hlasi chybu lease nebo `TCP_TLS` egress, neopravovat to obchazenim brokeru ani otevrenou siti v kontejneru.
