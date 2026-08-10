# Dashboard KájovoCML – doménový model

## Autoritativní identity

Dashboard zobrazuje pouze registrované CML komponenty. Interní `Generování` vytváří `component`, `principal`, kanonickou runtime identitu a `dashboard_visual_node` v jedné CML-owned lifecycle cestě; žádný pre-registration integration-token handoff není produktovou cestou.

## Čtyři oddělené pravdy PULSE

1. `pulse_topology_connection` ukládá existenci směrového spojení.
2. `compatibility_status` a `compatibility_evidence` jsou deterministický serverový výsledek porovnání portů.
3. `authorization_desired`, `component_permission`, tokenový scope/audience a případná suspendace určují účinnou autorizaci.
4. `component_operation_event` je jediný zdroj živé runtime indikace.

Odebrání oprávnění ponechá edge. Rozpojení edge je samostatná operace. Žádná z těchto operací nemaže komponentu ani její runtime identitu.

## Secret granty

Registrovaný uzel používá výhradně kanonický `secret_grant` pro `COMPONENT` identitu. Dashboard i Secret Manager volají stejný serverový command; drag payload nepřenáší runtime bearer ani hodnotu secretu. OWNER může plaintext credential zadat v důvěryhodném OWNER toku, ale trvalé runtime použití je vždy přes existující KajovoCML Secret Manager.

## Suspendace

`principal_permission_suspension` je reverzibilní stav oddělený od nevratného `revoked_at`. Aktivní suspendace fail-closed blokuje komponentové volání i Secret resolve, ale zachovává uzel, layout a topologická spojení.

## Destruktivní deregistrace

Deregistrace je explicitní command s preview dopadu, čerstvým heslem, TOTP, typed confirmation a idempotency key. Zneplatní aktivní credentialy, granty a incidentní spojení, ale auditní historii nemaže. Nová schopnost po deregistraci vzniká přes interní `Generování`.
