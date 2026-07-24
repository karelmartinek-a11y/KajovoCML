# Capability parity – Dashboard revize 2

| ID | Doména | Backend | Standardní UI | Dashboard UI | Test | Evidence | Stav |
|---|---|---|---|---|---|---|---|
| DASH-TOPOLOGY-READ | dashboard | `GET /api/dashboard/topology` | Katalog komponent / Monitoring | Dashboard canvas | `dashboard-topology.test.ts` | `DASH-RESPONSIVE` | COVERED_STANDARD_AND_DASHBOARD |
| DASH-LAYOUT-SAVE | dashboard | `PUT /api/dashboard/layout` | Dashboard workspace | Dashboard toolbar | `dashboard-page.test.tsx` | `DASH-RESPONSIVE` | COVERED_STANDARD_AND_DASHBOARD |
| DASH-CONNECTION-PREVIEW | pulse | `POST /api/dashboard/connections/preview` | Detail komponenty | Port connect dialog | `dashboard-topology.test.ts` | `DASH-COMPAT-AUTH-SPLIT` | COVERED_STANDARD_AND_DASHBOARD |
| DASH-CONNECTION-CREATE | pulse | `POST /api/dashboard/connections` | Správa oprávnění | Canvas drag/keyboard connect | `dashboard-page.test.tsx` | `DASH-COMPAT-AUTH-SPLIT` | COVERED_STANDARD_AND_DASHBOARD |
| DASH-CONNECTION-AUTH | pulse | `PUT /api/dashboard/connections/:id/authorization` | Správa oprávnění | PULSE context menu | `dashboard-page.test.tsx` | `DASH-COMPAT-AUTH-SPLIT` | COVERED_STANDARD_AND_DASHBOARD |
| DASH-CONNECTION-DISCONNECT | pulse | `DELETE /api/dashboard/connections/:id` | Správa oprávnění | PULSE context menu | `dashboard-page.test.tsx` | `DASH-COMPAT-AUTH-SPLIT` | COVERED_STANDARD_AND_DASHBOARD |
| DASH-IDENTITY-SUSPEND | identity | `PUT /api/dashboard/nodes/:id/suspension` | Přístupové tokeny | Node context panel | `dashboard-topology.test.ts` | `DASH-SUSPENSION` | COVERED_STANDARD_AND_DASHBOARD |
| DASH-IDENTITY-CARDS | identity | `GET /api/dashboard/identity-cards` | Secret Manager | Secret Manager + Dashboard | `dashboard-page.test.tsx` | `DASH-NODE-PREREG` | COVERED_STANDARD_AND_DASHBOARD |
| DASH-SECRET-GRANT | secrets | `POST /api/dashboard/secrets/:secretId/grants` | Secret Manager | Secret card drop | `dashboard-page.test.tsx` | `DASH-SECRET-TRANSFER` | COVERED_STANDARD_AND_DASHBOARD |
| DASH-SECRET-REVOKE | secrets | `DELETE /api/dashboard/secrets/:secretId/grants/:nodeId` | Secret Manager | Node Secret chip/detail | `dashboard-page.test.tsx` | `DASH-SECRET-TRANSFER` | COVERED_STANDARD_AND_DASHBOARD |
| DASH-SECRET-BULK-PREVIEW | secrets | `GET /api/dashboard/secrets/:secretId/grants/bulk-preview` | Secret Manager | Secret library bulk impact preview | `dashboard-page.test.tsx` | `DASH-SECRET-TRANSFER` | COVERED_STANDARD_AND_DASHBOARD |
| DASH-SECRET-BULK | secrets | `POST /api/dashboard/secrets/:secretId/grants/bulk` | Secret Manager | Secret library bulk action | `dashboard-page.test.tsx` | `DASH-SECRET-TRANSFER` | COVERED_STANDARD_AND_DASHBOARD |
| DASH-SECRET-REVEAL | secrets | `existing Secret reveal API` | Secret Manager | Dashboard Secret detail | `dashboard-page.test.tsx` | `DASH-SECRET-TRANSFER` | COVERED_STANDARD_AND_DASHBOARD |
| DASH-DEREG-PREVIEW | lifecycle | `GET /api/dashboard/nodes/:id/deregistration-preview` | Katalog komponent | Node destructive dialog | `dashboard-page.test.tsx` | `DASH-DEREG-PREVIEW` | COVERED_STANDARD_AND_DASHBOARD |
| DASH-DEREG-EXECUTE | lifecycle | `POST /api/dashboard/nodes/:id/deregister` | Katalog komponent | Node destructive dialog | `dashboard-page.test.tsx` | `DASH-DEREG-PREVIEW` | COVERED_STANDARD_AND_DASHBOARD |
| DASH-RUNTIME-STREAM | runtime | `GET /api/dashboard/events` | Audit / Monitoring | Timeline + PULSE animation | `app.test.ts` | `DASH-LIVE-RUNTIME` | COVERED_STANDARD_AND_DASHBOARD |
| DASH-NODE-HANDOFF | onboarding | `internal onboarding transaction` | Integrační tokeny / Komponenty | Same Dashboard node | `dashboard-topology.test.ts` | `DASH-HANDOFF-STABLE` | COVERED_STANDARD_AND_DASHBOARD |
| DASH-COMPAT-EVALUATOR | pulse | `internal pure operation` | Detail komponenty | Port/edge detail | `dashboard-topology.test.ts` | `DASH-COMPAT-AUTH-SPLIT` | COVERED_STANDARD_AND_DASHBOARD |
| DASH-COMPONENT-ACTIVATION | component | `POST /api/components/:id/activation` | Katalog komponent | Node context panel | `component domain/API tests` | `DASH-RESPONSIVE` | COVERED_STANDARD_AND_DASHBOARD |
| DASH-COMPONENT-LIFECYCLE | component | `POST /api/components/:id/lifecycle` | Katalog komponent | Node context panel | `component domain/API tests` | `DASH-SUSPENSION` | COVERED_STANDARD_AND_DASHBOARD |
| DASH-COMPONENT-E2E | component | `POST /api/components/:id/e2e-runs` | Detail komponenty | Node context panel | `component domain/API tests` | `DASH-LIVE-RUNTIME` | COVERED_STANDARD_AND_DASHBOARD |
| DASH-COMPONENT-STATE-QUERY | component | `POST /api/components/:id/state-queries` | Detail komponenty | Node context panel | `component domain/API tests` | `DASH-LIVE-RUNTIME` | COVERED_STANDARD_AND_DASHBOARD |
| DASH-COMPONENT-HEARTBEAT | component | `POST /api/components/:id/heartbeat-challenges` | Detail komponenty | Node context panel | `component domain/API tests` | `DASH-LIVE-RUNTIME` | COVERED_STANDARD_AND_DASHBOARD |
| REGISTERED-ELEMENTS-OVERVIEW | component | `GET /api/dashboard/topology + GET /api/dashboard/events` | Registrované prvky | Dashboard node/context links | `registered-elements-page.test.tsx` | `DASH-RESPONSIVE` | COVERED_STANDARD_AND_DASHBOARD |
