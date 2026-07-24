# Dashboard KájovoCML – doménový model

## Autoritativní identity

Dashboard používá `dashboard_visual_node` jako stabilní vizuální identitu. Před registrací je uzel navázán na `integration_token`; po úspěšném onboardingu se tentýž řádek atomicky přepne na `component` a `principal`. Plná hodnota tokenu se do uzlu, layoutu, API ani DOM nepřenáší.

## Čtyři oddělené pravdy PULSE

1. `pulse_topology_connection` ukládá existenci směrového spojení.
2. `compatibility_status` a `compatibility_evidence` jsou deterministický serverový výsledek porovnání portů.
3. `authorization_desired`, `component_permission`, tokenový scope/audience a případná suspendace určují účinnou autorizaci.
4. `component_operation_event` je jediný zdroj živé runtime indikace.

Odebrání oprávnění ponechá edge. Rozpojení edge je samostatná operace. Žádná z těchto operací nemaže komponentu ani celý bearer token.

## Secret granty

Předregistrační uzel používá `integration_token_secret_grant`. Registrovaný uzel používá kanonický komponentový grant a současně respektuje již existující přenesené onboardingové granty. Dashboard i přesný Secret Manager volají stejný serverový command s bezpečnou identitou uzlu; drag payload nikdy neobsahuje bearer token.

## Suspendace

`principal_permission_suspension` je reverzibilní stav oddělený od nevratného `revoked_at`. Aktivní suspendace fail-closed blokuje komponentové volání i Secret resolve, ale zachovává uzel, layout a topologická spojení.

## Destruktivní deregistrace

Deregistrace je explicitní command s preview dopadu, čerstvým heslem, TOTP, typed confirmation a idempotency key. Zneplatní aktivní credentialy, granty a incidentní spojení, ale auditní historii nemaže.
