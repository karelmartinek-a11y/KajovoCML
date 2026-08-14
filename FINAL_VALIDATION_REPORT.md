# FINAL VALIDATION REPORT — 2026-08-09 final targeted pass

Aktuální detailní autoritou tohoto validačního běhu je `DELIVERY_SUMMARY.md`.

Cíleně byly dokončeny čtyři mezery bez změny internal-generation produktového konceptu: `INTEGRATING` je skutečný post-deploy provider konfigurační průchod proti živému candidate HTTPS endpointu; existující CML `context.callExternal` podporuje potřebné HTTPS metody/query/headers/body formáty pod stejnými permissions/Secret/SSRF/audit pravidly; generation deterministicky znovupoužívá ACTIVE secrets, odvozuje grants z `requiredSecretNames` a umí provider-issued credential uložit/rotovat přes existující Secret Manager; persistentní Chromium/CDP vrstva umí flattened frame sessions a opaque locators pro cross-origin/OOPIF kontext.

`npm run pretest` a nové INTEGRATING/egress/secret regression testy jsou PASS. Cross-origin OOPIF fixture je skutečný dvou-originový test, ale Chromium v tomto sandboxu má managed `URLBlocklist: ["*"]` a končí `ERR_BLOCKED_BY_ADMINISTRATOR`; tento bod není označen jako PASS. Live deployment check je blokován chybějícím `KCML_LIVE_COMPONENT_URL`; plný podporovaný Node/pnpm build není zde proveden, protože dostupný Node je 22 místo požadovaného >=24 a pnpm není dostupný. Přesné příkazy a hranice důkazů jsou v `DELIVERY_SUMMARY.md`.
