# MCP handler – katalog zařízení Home Assistant

Izolovaný read-only handler pro automatický onboarding KCML 1.4. Přes řízený
`context.egress.fetch` načte aktuální katalog z vyhrazeného HTTPS upstreamu a
vrátí jej beze změny jako MCP `structuredContent`.

Funkce nemá žádné vstupní parametry. Každé úspěšné volání vždy vrátí celý
aktuální katalog; filtrování, stránkování ani zkrácený režim nejsou součástí
kontraktu a každý neznámý vstupní parametr je odmítnut.

Zdroj neobsahuje žádné tokeny ani jiné tajné hodnoty. Síťový přístup je v
manifestu omezen pouze na `ha-inventory.hcasc.cz:443`.
