# KájovoCML — SSOT integration matrix

Source of truth: `docs/SSOT_CURRENT.md`, section 23. The matrix deliberately
uses `NOT VERIFIED` until a behavior has evidence from the required PostgreSQL,
Ubuntu/Chromium, authenticated HTTP/SSE, or production path. A unit test or a
static symbol check is not upgraded to runtime PASS.

| # | Integration point | Status | Evidence |
|---:|---|---|---|
| 1 | POST /jobs creates `DISCUSSING` | NOT VERIFIED | PostgreSQL HTTP/SSE E2E is CI/production gated. |
| 2 | Immutable prompt evidence | PASS | PostgreSQL `generation-discussion-db.test.ts` verifies persisted OWNER content and idempotency conflict. |
| 3 | Initial OWNER message history | PASS | PostgreSQL discussion suite verifies the initial OWNER message is linked to its turn. |
| 4 | Reload preserves job/history | NOT VERIFIED | Authenticated browser E2E pending. |
| 5 | Second client sees authoritative state | NOT VERIFIED | Multi-client E2E pending. |
| 6 | Distinct OWNER message sequence | NOT VERIFIED | PostgreSQL concurrency evidence pending. |
| 7 | `client_message_id` retry idempotence | PASS | PostgreSQL discussion suite verifies same idempotency key returns the same message without content mutation. |
| 8 | Concurrent message sequence uniqueness | NOT VERIFIED | PostgreSQL concurrency evidence pending. |
| 9 | Stable paginated history ordering | NOT VERIFIED | PostgreSQL persistence evidence pending. |
| 10 | OWNER message starts/queues one turn | PASS | PostgreSQL discussion suite verifies a queued OWNER turn and its input linkage. |
| 11 | Single active turn | PASS | PostgreSQL steer suite verifies one `INTERRUPT_REQUESTED` upstream plus one queued successor. |
| 12 | Assistant streaming message | NOT VERIFIED | Authenticated provider-backed E2E pending. |
| 13 | Completed timestamp | NOT VERIFIED | DB-gated terminal-state evidence pending. |
| 14 | Failed turn is not completed | NOT VERIFIED | DB-gated failure evidence pending. |
| 15 | Renewable worker lease | NOT VERIFIED | PostgreSQL lease test pending in CI. |
| 16 | OWNER input persists during turn | PASS | PostgreSQL steer test persists two OWNER inputs while the upstream turn is active. |
| 17 | Interruption lifecycle | PASS | PostgreSQL steer/cancel tests cover `RUNNING` to interruption-requested/terminal handling. |
| 18 | Partial assistant becomes `INTERRUPTED` | PASS | PostgreSQL cancellation test persists partial assistant output and verifies `INTERRUPTED`. |
| 19 | Successor uses OWNER correction | NOT VERIFIED | Provider-backed steer E2E pending. |
| 20 | Interrupt/completion race is single successor | NOT VERIFIED | PostgreSQL race test pending. |
| 21 | Web research tool availability | NOT VERIFIED | Production Responses tool-loop pending. |
| 22 | Canonical capability lookup availability | PASS | `capability-discovery.test.ts` and capability guard tests. |
| 23 | Browser tool availability | NOT VERIFIED | Generation browser production E2E pending. |
| 24 | No internal runtime-mutation tool in discussion registry | NOT VERIFIED | Static guard exists; authenticated tool registry E2E pending. |
| 25 | Tool failures become events/audit | NOT VERIFIED | DB/provider event E2E pending. |
| 26 | First valid proposal is revision 1 | PASS | PostgreSQL immutable-revision test creates the first specification as revision 1. |
| 27 | Identical canonical spec is deduplicated | PASS | PostgreSQL immutable-revision test reuses the same digest and revision. |
| 28 | Functional change creates revision 2 | PASS | PostgreSQL immutable-revision test allocates revision 2 for changed content. |
| 29 | Revision 1 remains immutable | NOT VERIFIED | DB-gated immutability evidence pending. |
| 30 | Deterministic digest | PASS | Canonical serialization and digest unit tests. |
| 31 | Markdown matches structured spec | NOT VERIFIED | Full renderer acceptance pending. |
| 32 | Current revision pointer is latest | PASS | PostgreSQL approval test verifies the approved/current pointer freezes the selected current revision. |
| 33 | Current revision approval succeeds | NOT VERIFIED | Authenticated DB route E2E pending. |
| 34 | Stale revision approval returns 409 | PASS | PostgreSQL approval test rejects the older revision with `GENERATION_SPEC_STALE`. |
| 35 | Stale digest approval returns 409 | NOT VERIFIED | DB-gated stale approval test pending. |
| 36 | Approval during active turn returns 409 | NOT VERIFIED | Authenticated route E2E pending. |
| 37 | Open questions block approval | NOT VERIFIED | Authenticated route E2E pending. |
| 38 | Concurrent approval is deterministic | NOT VERIFIED | PostgreSQL race test pending. |
| 39 | Approved revision is immutable | NOT VERIFIED | PostgreSQL immutability evidence pending. |
| 40 | Approved digest matches revision | PASS | PostgreSQL approval test verifies the persisted approved digest equals the selected revision digest. |
| 41 | Approval freezes atomically into `ANALYZING` | PASS | PostgreSQL approval test verifies state and approved revision are frozen together. |
| 42 | Planner reads approved revision | NOT VERIFIED | Production generation E2E pending. |
| 43 | Planner receives approved digest | NOT VERIFIED | Production generation E2E pending. |
| 44 | Implementation uses approved functional contract | NOT VERIFIED | Planner runtime evidence pending. |
| 45 | No component before approval | NOT VERIFIED | Production side-effect E2E pending. |
| 46 | No principal before approval | NOT VERIFIED | Production side-effect E2E pending. |
| 47 | No release/activation before approval | NOT VERIFIED | Production side-effect E2E pending. |
| 48 | Retry does not duplicate runtime objects | NOT VERIFIED | Production retry E2E pending. |
| 49 | Job browser session starts | NOT VERIFIED | Browser runtime production E2E pending. |
| 50 | Browser profile is job-scoped | NOT VERIFIED | Browser isolation E2E pending. |
| 51 | Safe preview frame is produced | NOT VERIFIED | Browser preview E2E pending. |
| 52 | Preview revision is monotonic | NOT VERIFIED | Browser preview E2E pending. |
| 53 | Cross-job frame access is denied | NOT VERIFIED | Authenticated browser route E2E pending. |
| 54 | Preview sends `Cache-Control: no-store` | NOT VERIFIED | Production HTTP assertion pending. |
| 55 | Sensitive transition hides image | NOT VERIFIED | Browser sensitive-state E2E pending. |
| 56 | Preview contains no secret | NOT VERIFIED | Secret-isolation E2E pending. |
| 57 | Safe preview returns to `NORMAL` | NOT VERIFIED | Browser session E2E pending. |
| 58 | Browser crash is diagnosable | NOT VERIFIED | Runtime recovery E2E pending. |
| 59 | Job cleanup removes its artifacts | NOT VERIFIED | Runtime cleanup E2E pending. |
| 60 | Repeated cleanup is idempotent | NOT VERIFIED | Runtime cleanup E2E pending. |
| 61 | SSE event order is authoritative | NOT VERIFIED | Authenticated SSE E2E pending. |
| 62 | `Last-Event-ID` replay works | NOT VERIFIED | Authenticated SSE replay E2E pending. |
| 63 | Replay gap requests resync | NOT VERIFIED | Authenticated SSE gap E2E pending. |
| 64 | Reconnect has no duplicate deltas | NOT VERIFIED | Browser/SSE reducer E2E pending. |
| 65 | Two clients share lifecycle | NOT VERIFIED | Multi-client SSE E2E pending. |
| 66 | Disconnect does not cancel turn | NOT VERIFIED | Provider-backed SSE E2E pending. |
| 67 | Cancel in `DISCUSSING` stops turn/browser | PASS | PostgreSQL plus authenticated Fastify route tests verify cancel state and interrupted assistant handling. |
| 68 | Cancel in `ANALYZING` stops planner | NOT VERIFIED | Production cancellation E2E pending. |
| 69 | Realization cancellation invariants | NOT VERIFIED | Production generation E2E pending. |
| 70 | Cancel retry is idempotent | NOT VERIFIED | Authenticated route E2E pending. |
| 71 | No post-cancel side effects | NOT VERIFIED | Production cancellation evidence pending. |
| 72 | Desktop workflow usable | NOT VERIFIED | Required real-browser viewport audit pending. |
| 73 | Tablet has no horizontal overflow | NOT VERIFIED | Required real-browser viewport audit pending. |
| 74 | 390x844 has no page scroll | NOT VERIFIED | Required real-browser viewport audit pending. |
| 75 | Composer is focusable | NOT VERIFIED | Required keyboard browser audit pending. |
| 76 | Streaming state is readable | NOT VERIFIED | Required browser streaming audit pending. |
| 77 | Tool activity hides reasoning | NOT VERIFIED | Required browser audit pending. |
| 78 | Spec panel covers schema sections | NOT VERIFIED | Required browser audit pending. |
| 79 | Approval CTA guards correctly | NOT VERIFIED | Required browser route audit pending. |
| 80 | Stale approval shows current revision | NOT VERIFIED | Required browser E2E pending. |
| 81 | Sensitive preview uses protected state | NOT VERIFIED | Required browser E2E pending. |
| 82 | Approved spec is read-only | NOT VERIFIED | Required browser E2E pending. |
| 83 | Progress matches server state | NOT VERIFIED | Required browser E2E pending. |
| 84 | Mutations require auth and CSRF | NOT VERIFIED | Authenticated HTTP/SSE suite pending in CI. |
| 85 | Reads require auth/job authorization | NOT VERIFIED | Authenticated HTTP/SSE suite pending in CI. |
| 86 | Cross-job access denied | NOT VERIFIED | Authenticated authorization suite pending. |
| 87 | No secret in test-flow logs | NOT VERIFIED | CI/prod redaction evidence pending. |
| 88 | Technical SSE events exclude secret payloads | NOT VERIFIED | CI/prod redaction evidence pending. |
| 89 | Forbidden model tool call rejected | NOT VERIFIED | Provider-backed tool validation E2E pending. |
| 90 | Preview rejects filesystem paths | NOT VERIFIED | Authenticated HTTP route test pending. |
| 91 | Cancellation regression suite | PASS | `generation:cancellation:check` and root tests pass locally. |
| 92 | Repair/integration regression suite | PASS | `generation:repair-authority:check`, repair/enqueue/integration checks pass locally. |
| 93 | Admin UI navigation preserved | NOT VERIFIED | Required production browser audit pending. |
| 94 | Root lint/typecheck/test/build | PASS | Local `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. |
| 95 | AI opens OWNER-selected external portal | NOT VERIFIED | Teaching/browser production E2E pending. |
| 96 | External operation scope is bounded | NOT VERIFIED | Teaching/runtime E2E pending. |
| 97 | Save/Continue needs no extra confirmation | NOT VERIFIED | Teaching/runtime E2E pending. |
| 98 | Irreversible action confirmation | NOT VERIFIED | Teaching/runtime E2E pending. |
| 99 | Trusted chat/field credential input | NOT VERIFIED | Production credential E2E pending. |
| 100 | Credential persists in Secret Manager | NOT VERIFIED | Production Secret Manager E2E pending. |
| 101 | Browser login secret is not logged | NOT VERIFIED | Production redaction E2E pending. |
| 102 | Login redirect/popup retains session | NOT VERIFIED | Browser teaching E2E pending. |
| 103 | MFA/OTP/WebAuthn human challenge | NOT VERIFIED | Browser teaching E2E pending. |
| 104 | CAPTCHA is not bypassed | NOT VERIFIED | Browser teaching E2E pending. |
| 105 | Teaching stores semantic steps | NOT VERIFIED | Teaching persistence E2E pending. |
| 106 | Secret step stores only binding | NOT VERIFIED | Teaching persistence E2E pending. |
| 107 | Typed parameter binding | NOT VERIFIED | Teaching persistence E2E pending. |
| 108 | Semantic locator preference | NOT VERIFIED | Browser DSL E2E pending. |
| 109 | Side-effect and retry class in step | NOT VERIFIED | Teaching persistence E2E pending. |
| 110 | Candidate manifest rejects arbitrary JavaScript | PASS | Sandbox/manifest contract checks pass locally; Ubuntu runtime gate pending. |
| 111 | Candidate is included in spec digest | NOT VERIFIED | Teaching/spec PostgreSQL E2E pending. |
| 112 | Preflight has no business mutation | NOT VERIFIED | Runtime preflight E2E pending. |
| 113 | Replay works without model network | NOT VERIFIED | Runtime replay E2E pending. |
| 114 | Non-idempotent acceptance is safe | NOT VERIFIED | Runtime acceptance E2E pending. |
| 115 | Replay failure identifies exact step/state | NOT VERIFIED | Runtime replay E2E pending. |
| 116 | Runtime is canonical CML component/principal | NOT VERIFIED | Browser Runtime implementation/production scope pending. |
| 117 | Generated handler sandbox boundary | NOT VERIFIED | macOS local runner cannot prove Linux namespaces; Ubuntu CI required. |
| 118 | Generated MCP uses `context.callComponent` | NOT VERIFIED | Production generated-component E2E pending. |
| 119 | CML permission limits platform tool | NOT VERIFIED | Production authorization E2E pending. |
| 120 | Runtime verifies caller/automation relation | NOT VERIFIED | Production authorization E2E pending. |
| 121 | Runtime-only browser secret grant | NOT VERIFIED | Production Secret Manager E2E pending. |
| 122 | Immutable automation revisions | NOT VERIFIED | Browser Runtime persistence pending. |
| 123 | Only PASS revision activates | NOT VERIFIED | Browser Runtime persistence pending. |
| 124 | Rollback restores last PASS revision | NOT VERIFIED | Browser Runtime recovery pending. |
| 125 | Production run does not create generation job | NOT VERIFIED | Production Browser Runtime E2E pending. |
| 126 | Production run calls no LLM | NOT VERIFIED | Ubuntu no-AI runtime E2E pending. |
| 127 | Run lease and step checkpoints | NOT VERIFIED | Browser Runtime persistence pending. |
| 128 | `clientRunId` is idempotent | PASS | `browser-automation-db.test.ts` replays the same definition/idempotency key and receives the original durable run without a duplicate. |
| 129 | Disable blocks new runs | NOT VERIFIED | Browser Runtime API E2E pending. |
| 130 | Preflight/status/cancel/history/reauth | NOT VERIFIED | Browser Runtime API E2E pending. |
| 131 | Isolated BrowserContext per run | NOT VERIFIED | Playwright runtime E2E pending. |
| 132 | Auth state is secret-grade artifact | NOT VERIFIED | Browser Runtime artifact E2E pending. |
| 133 | Navigation/redirect/popup allowlist | NOT VERIFIED | Browser Runtime security E2E pending. |
| 134 | Private/link-local targets blocked | NOT VERIFIED | Browser Runtime security E2E pending. |
| 135 | Only approved semantic fallback | NOT VERIFIED | Browser DSL E2E pending. |
| 136 | Fallback emits drift without manifest change | NOT VERIFIED | Browser Runtime drift E2E pending. |
| 137 | Non-idempotent timeout avoids blind retry | NOT VERIFIED | Browser Runtime recovery E2E pending. |
| 138 | Reconciliation distinguishes side effect | NOT VERIFIED | Browser Runtime recovery E2E pending. |
| 139 | Unknown result reaches `MANUAL_REVIEW` | NOT VERIFIED | Browser Runtime recovery E2E pending. |
| 140 | Crash avoids duplicate account context | NOT VERIFIED | Browser Runtime worker E2E pending. |
| 141 | Cancel prevents further side effects | NOT VERIFIED | Browser Runtime cancellation E2E pending. |
| 142 | Auth expiry deterministic relogin/reauth | NOT VERIFIED | Browser Runtime auth E2E pending. |
| 143 | Contract drift is `DEGRADED` | NOT VERIFIED | Browser Runtime monitoring E2E pending. |
| 144 | Drift enqueues deduplicated repair | NOT VERIFIED | Browser Runtime monitoring E2E pending. |
| 145 | Repair preserves identities | NOT VERIFIED | Production repair E2E pending. |
| 146 | Repair failure preserves last good revision | NOT VERIFIED | Production repair E2E pending. |
| 147 | Upload rejects arbitrary host path | NOT VERIFIED | Browser Runtime API E2E pending. |
| 148 | Download is scoped and checks digest/MIME/size | NOT VERIFIED | Browser Runtime artifact E2E pending. |
| 149 | Sensitive trace is not distributed | NOT VERIFIED | Browser Runtime artifact E2E pending. |
| 150 | Artifact cleanup is bounded/idempotent | NOT VERIFIED | Browser Runtime artifact E2E pending. |
| 151 | Queue has capacity/backpressure | NOT VERIFIED | Browser Runtime worker E2E pending. |
| 152 | Account concurrency key works | NOT VERIFIED | Browser Runtime worker E2E pending. |
| 153 | Async run survives client disconnect | NOT VERIFIED | Browser Runtime worker E2E pending. |
| 154 | OWNER UI shows runtime status/history | NOT VERIFIED | Browser Runtime UI E2E pending. |
| 155 | OWNER run/preflight/cancel/reauth/disable/repair | NOT VERIFIED | Browser Runtime UI E2E pending. |
| 156 | Ubuntu Playwright/Chromium smoke | NOT VERIFIED | Real browser passed locally; Ubuntu release runner evidence pending. |
| 157 | Production Chromium has no standard `--no-sandbox` | NOT VERIFIED | Production process inspection pending. |
| 158 | Browser upgrade requires regression gate | NOT VERIFIED | CI/release workflow evidence pending. |
| 159 | Root repair/cancel/conformance tests | PASS | Targeted generation checks and root tests pass locally. |
| 160 | No mandatory FAIL/NOT VERIFIED remains | NOT VERIFIED | Matrix is intentionally incomplete pending CI, authenticated E2E, and production evidence. |
