import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  Ban,
  BellOff,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  ClipboardCopy,
  Clock3,
  Download,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  Search,
  Server as ServerIcon,
  ShieldCheck,
  Terminal,
  Workflow
} from "lucide-react";
import "./styles.css";
import { AppLayout, PageRouter } from "./app-layout.js";
import { AdminAccountsPage, SecurityPage } from "./admin-pages.js";
import { AuditPage, auditQueryParams, type AuditFilters } from "./audit-page.js";
import { BootstrapPage, Login, ReauthModal } from "./auth-pages.js";
import { IconButton, MetricCard, Modal, PageHeader } from "./common.js";
import {
  CreateCredentialModal,
  CredentialConfirmModal,
  CredentialSecretModal,
  CredentialsPage,
  PermissionsPage,
  RenameCredentialModal
} from "./credential-pages.js";
import { onboardingHandoffText } from "./onboarding-handoff.js";
import { OperationalConfigPage } from "./operational-config-page.js";
import { formatMinuteSecondCountdown, getIntegrationTokenLifecycle } from "./integration-token-lifecycle.js";
import { REAUTH_REQUIRED_EVENT, SESSION_EXPIRED_EVENT } from "./session-auth.js";
import {
  acknowledgeOperationalAlert,
  createServerRevision,
  getMonitoringProfile,
  persistMonitoringProfile,
  retryAlertDelivery as retryAlertDeliveryRequest,
  runRegisteredServerTest,
  setServerEnabled,
  suppressOperationalAlert,
  testAlertChannels,
  type ServerTestResult
} from "./server-api.js";
import {
  type AdminRole,
  type AdminAccount,
  type AdminSecurity,
  type AlertDelivery,
  type AuditEvent,
  type AuditIntegrity,
  type AuditResponse,
  type IntegrationSecret,
  type IntegrationToken,
  type KajaCredential,
  type KajaPermission,
  type MonitoringProbe,
  type MonitoringOverview,
  type MonitoringProfile,
  type OnboardingDescriptor,
  type OnboardingJob,
  type OperationalConfigSetting,
  type OperationalAlert,
  type Page,
  type SecretResult,
  type Server,
  type Session
} from "./types.js";
import { api, csrf, formatDate, formatLocalDateTimeInput, prettyJson, setUiTimeZone } from "./ui-helpers.js";

const integrationTokenActionLabel = "Vygenerovat Integrační token";

function recertificationTone(phase: Server["recertification"]["phase"]): "ok" | "warn" | "danger" | "neutral" {
  if (phase === "VALID") return "ok";
  if (phase === "WARNING") return "warn";
  if (phase === "GRACE") return "danger";
  return phase === "SUSPENDED" || phase === "INVALID" ? "danger" : "neutral";
}

function formatBoundary(seconds: number | null): string {
  if (seconds === null) return "Bez dalšího termínu";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  if (days > 0) return `${days} d ${hours} h`;
  return formatMinuteSecondCountdown(seconds * 1_000);
}

function CreateIntegrationTokenModal({ resumeJobId, onClose, onCreated }: { resumeJobId?: string; onClose: () => void; onCreated: (secret: IntegrationSecret) => void }) {
  const [label, setLabel] = useState(resumeJobId ? `Pokračování integrace ${resumeJobId.slice(0, 8)}` : "");
  const [summary, setSummary] = useState("");
  const [businessPurpose, setBusinessPurpose] = useState("");
  const [serviceOwner, setServiceOwner] = useState("");
  const [technicalOwner, setTechnicalOwner] = useState("");
  const [criticality, setCriticality] = useState<OnboardingDescriptor["criticality"]>("MEDIUM");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!label.trim()) { setError("Zadej označení tokenu."); return; }
    if (!summary.trim() || !businessPurpose.trim() || !serviceOwner.trim() || !technicalOwner.trim()) {
      setError("Vyplň shrnutí, účel i oba vlastníky serveru.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api<IntegrationSecret>("/api/integration-tokens", {
        method: "POST",
        headers: { "x-csrf-token": csrf() },
        body: JSON.stringify({
          label: label.trim(),
          descriptor: {
            summary: summary.trim(),
            businessPurpose: businessPurpose.trim(),
            serviceOwner: serviceOwner.trim(),
            technicalOwner: technicalOwner.trim(),
            criticality
          },
          resumeJobId
        })
      });
      onCreated(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Token se nepodařilo vytvořit");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={resumeJobId ? "Navazující implementační token" : integrationTokenActionLabel} onClose={onClose}>
      <form className="modal-form" onSubmit={(event) => { void submit(event); }}>
        <div className="form-intro"><span className="modal-icon"><Workflow size={20} /></span><p>Connect in Catalog v1.7, strukturovaný descriptor a integrační token.</p></div>
        <label>Označení tokenu<span className="field-hint">Krátký interní název pro pozdější dohledání tokenu.</span><input autoFocus value={label} onChange={(event) => setLabel(event.target.value)} maxLength={120} placeholder="Např. Fakturační onboarding" /></label>
        <div className="descriptor-grid">
          <label>Shrnutí serveru<span className="field-hint">Jednovětý popis integračního záměru.</span><textarea value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={120} rows={3} placeholder="Např. Zpracování fakturačních podkladů" /></label>
          <label>Účel serveru<span className="field-hint">Formální business purpose, který se předá dál.</span><textarea value={businessPurpose} onChange={(event) => setBusinessPurpose(event.target.value)} maxLength={400} rows={3} placeholder="Např. Automatizace fakturačního workflow" /></label>
          <label>Vlastník služby<input value={serviceOwner} onChange={(event) => setServiceOwner(event.target.value)} maxLength={160} placeholder="Např. Finance Ops" /></label>
          <label>Technický vlastník<input value={technicalOwner} onChange={(event) => setTechnicalOwner(event.target.value)} maxLength={160} placeholder="Např. Platform Engineering" /></label>
          <label>Kritičnost<select value={criticality} onChange={(event) => setCriticality(event.target.value as OnboardingDescriptor["criticality"])}><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="CRITICAL">Critical</option></select></label>
        </div>
        {resumeJobId ? <div className="permission-preview"><strong>Pokračování existujícího jobu</strong><code>{resumeJobId}</code><span>Předchozí token bude revokován. KCML identita zůstane zachována.</span></div> : null}
        {error && <p className="error">{error}</p>}
        <footer className="modal-actions"><button type="button" className="secondary" onClick={onClose} disabled={busy}>Zrušit</button><button type="submit" disabled={busy}><Rocket size={16} /> {busy ? "Generuji…" : integrationTokenActionLabel}</button></footer>
      </form>
    </Modal>
  );
}

function IntegrationSecretModal({ secret, onClose }: { secret: IntegrationSecret; onClose: () => void }) {
  const [copied, setCopied] = useState<"token" | "instructions" | null>(null);
  async function copyToken() {
    await navigator.clipboard.writeText(secret.token);
    setCopied("token");
  }
  async function copyInstructions() {
    await navigator.clipboard.writeText(onboardingHandoffText({
      label: secret.label,
      descriptor: secret.descriptor,
      token: secret.token,
      initialExpiresAt: secret.initialExpiresAt,
      programmerApiUrl: secret.programmerApiUrl
    }));
    setCopied("instructions");
  }
  return (
    <Modal title="Podklady pro programátora jsou připravené" onClose={onClose}>
      <div className="secret-dialog">
        <div className="notice success"><CheckCircle2 size={18} /><span><strong>Vaše práce tímto končí.</strong><br />Programátorovi předejte onboarding katalog a token. Stav, opravitelné chyby i nahrání nové revize obslouží sám přes programátorské API až do zeleného výsledku.</span></div>
        <div className="handoff-step"><span>1</span><div><strong>Onboarding katalog</strong><p>Závazný registrační kontrakt 1.5.</p><a className="button-link secondary" href={secret.onboardingCatalogUrl} download={secret.onboardingCatalogFileName}><Download size={16} /> Stáhnout onboarding katalog</a></div></div>
        <div className="handoff-step"><span>2</span><div><strong>Server descriptor</strong><p>{secret.descriptor.summary}</p><dl className="descriptor-dl"><dt>Účel</dt><dd>{secret.descriptor.businessPurpose}</dd><dt>Vlastník služby</dt><dd>{secret.descriptor.serviceOwner}</dd><dt>Technický vlastník</dt><dd>{secret.descriptor.technicalOwner}</dd><dt>Kritičnost</dt><dd>{secret.descriptor.criticality}</dd></dl></div></div>
        <div className="handoff-step"><span>3</span><div><strong>Integrační token</strong><p>Plnou hodnotu lze zobrazit i předat v tomto handoffu. První upload musí programátor provést do {formatDate(secret.initialExpiresAt)}.</p><div className="secret-once"><code>{secret.token}</code><small>Fingerprint {secret.fingerprint}</small></div><button type="button" className="secondary" onClick={() => { void copyToken(); }}><ClipboardCopy size={16} /> {copied === "token" ? "Token zkopírován" : "Zkopírovat token"}</button></div></div>
        <div className="permission-preview"><strong>Co proběhne po uploadu</strong><span>Systém přidělí KCML identitu a vlastní HTTPS adresu a provede PR/CI, podepsaný OCI build, izolované nasazení, katalog, autorizaci, logging, audit, monitoring, veřejné testy a aktivaci. Opravitelnou chybu API vrátí programátorovi jako <code>UPLOAD_REVISION</code>; po nové revizi pipeline sama pokračuje.</span></div>
        <footer className="modal-actions"><button className="secondary" onClick={onClose}>Zavřít</button><button onClick={() => { void copyInstructions(); }}><ClipboardCopy size={16} /> {copied === "instructions" ? "Pokyny zkopírovány" : "Zkopírovat pokyny i token"}</button></footer>
      </div>
    </Modal>
  );
}

function IntegrationConfirmModal({ token, action, onClose, onConfirm }: { token: IntegrationToken; action: "revoke" | "delete"; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  async function confirmAction() {
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); }
  }
  return (
    <Modal title={action === "revoke" ? "Revokovat implementační token?" : "Smazat záznam tokenu?"} onClose={onClose}>
      <div className="modal-form">
        <p className="destructive-copy">{action === "revoke" ? "Programátorské API token okamžitě odmítne. Běžící krok jobu skončí fail-closed a nebude znovu pronajat." : "Token bude revokován a skryt z přehledu; auditní a onboardingová stopa zůstane zachována."}</p>
        <label>Pro potvrzení opiš označení<input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={token.label} /></label>
        <footer className="modal-actions"><button className="secondary" onClick={onClose}>Zrušit</button><button className="danger-button" disabled={typed !== token.label || busy} onClick={() => { void confirmAction(); }}>{action === "revoke" ? "Revokovat" : "Smazat"}</button></footer>
      </div>
    </Modal>
  );
}

function ServerDetailModal({
  server,
  accountName,
  onClose,
  onToggleEnabled,
  onRunTest,
  onLoadMonitoringProfile,
  onSaveMonitoringProfile,
  onStartRevision,
  onDeleteServer
}: {
  server: Server;
  accountName: string | null;
  onClose: () => void;
  onToggleEnabled: (server: Server, enabled: boolean) => Promise<void>;
  onRunTest: (server: Server) => Promise<ServerTestResult>;
  onLoadMonitoringProfile: (server: Server) => Promise<MonitoringProfile>;
  onSaveMonitoringProfile: (server: Server, profile: MonitoringProfile) => Promise<void>;
  onStartRevision: (server: Server) => Promise<void>;
  onDeleteServer: (server: Server, input: { confirmedCode: string; reason: string; password: string; totp: string }) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [testStatus, setTestStatus] = useState<ServerTestResult | null>(null);
  const [error, setError] = useState("");
  const [monitoring, setMonitoring] = useState<MonitoringProfile | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const activeRevision = ["ACTIVE", "TRIAL"].includes(server.registrationState);
  useEffect(() => {
    void onLoadMonitoringProfile(server)
      .then(setMonitoring)
      .catch((err) => setError(err instanceof Error ? err.message : "Profil monitoringu se nepodařilo načíst"));
  }, [onLoadMonitoringProfile, server]);
  async function toggleEnabled() {
    setBusy(true);
    setError("");
    try {
      await onToggleEnabled(server, !server.enabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Změna stavu selhala");
    } finally {
      setBusy(false);
    }
  }
  async function runTest() {
    setBusy(true);
    setError("");
    try {
      setTestStatus(await onRunTest(server));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test serveru selhal");
    } finally {
      setBusy(false);
    }
  }
  async function saveMonitoring() {
    if (!monitoring) return;
    setBusy(true);
    setError("");
    try {
      await onSaveMonitoringProfile(server, monitoring);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Profil monitoringu se nepodařilo uložit");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={server.displayName} onClose={onClose}>
      <div className="server-detail">
        <div className="server-detail-status"><span className={`status-dot ${server.enabled ? "ok" : "danger"}`} /><strong>{server.operationalState}</strong><span>{server.registrationState}</span></div>
        <dl>
          <dt>Kód serveru</dt><dd>{server.code}</dd>
          <dt>Hostname</dt><dd>{server.hostname}</dd>
          <dt>Nástroj</dt><dd>{server.toolName}</dd>
          <dt>Handler</dt><dd>{server.handlerKey} · {server.handlerVersion}</dd>
          <dt>Contract</dt><dd>{server.contractVersion}</dd>
          <dt>Registrační revize</dt><dd>{server.registrationRevision ?? "-"}</dd>
          <dt>Recertifikace</dt><dd><span className={`badge ${recertificationTone(server.recertification.phase)}`}>{server.recertification.phase}</span><span className="cell-subtitle">{server.recertification.reason ?? "Platná certifikace"} · {formatBoundary(server.recertification.secondsToBoundary)}</span>{server.reviewDueAt ? <span className="cell-subtitle">Termín {formatDate(server.reviewDueAt)}</span> : null}</dd>
          <dt>Monitoring</dt><dd><span className={`badge ${server.monitoringEnabled ? "ok" : "danger"}`}>{server.monitoringEnabled ? "Povinný profil aktivní" : "Profil blokuje provoz"}</span><span className="cell-subtitle">{server.monitoringProfileDigest ?? "Chybí digest profilu"}</span></dd>
          <dt>Artifact digest</dt><dd><code>{server.artifactDigest}</code></dd>
          <dt>Manifest digest</dt><dd><code>{server.manifestDigest}</code></dd>
          <dt>Úspěšná volání</dt><dd>{server.successCount}</dd>
          <dt>Chyby autorizace</dt><dd>{server.unauthorizedCount}</dd>
          <dt>Provozní chyby</dt><dd>{server.failureCount}</dd>
          <dt>Latence poslední / průměr / p95</dt><dd>{server.lastLatencyMs ?? "-"} / {server.averageLatencyMs ?? "-"} / {server.p95LatencyMs ?? "-"} ms</dd>
          <dt>Poslední úspěch</dt><dd>{formatDate(server.lastSuccessAt)}</dd>
          <dt>Poslední chyba</dt><dd>{formatDate(server.lastFailureAt)}</dd>
        </dl>
        {server.description ? <p>{server.description}</p> : null}
        {testStatus ? <div className={`notice ${testStatus.ok ? "success" : "error"}`}><div><strong>{testStatus.ok ? "Safe test prošel" : "Safe test neprošel"}</strong><br />{testStatus.status} · latence {testStatus.latencyMs} ms.<br /><code>{testStatus.correlationId}</code><span className="cell-subtitle">Revize {testStatus.activeRevisionId} · {testStatus.manifestDigest}</span>{testStatus.output === undefined ? null : <pre className="test-output">{prettyJson(testStatus.output)}</pre>}</div></div> : null}
        {error ? <p className="error">{error}</p> : null}
        {monitoring && activeRevision ? <div className="notice"><ShieldCheck size={18} /><span>Monitoring aktivní revize je neměnný. Změna profilu založí novou registrační revizi 1.5 a znovu spustí povinné brány.</span></div> : null}
        {monitoring && !activeRevision ? <div className="monitoring-editor">
          <label>Runbook reference<input value={monitoring.profile.runbookRef} onChange={(event) => setMonitoring({ ...monitoring, profile: { ...monitoring.profile, runbookRef: event.target.value } })} /></label>
          <label>Primární alert kanál<input value={monitoring.profile.primaryAlertChannel} onChange={(event) => setMonitoring({ ...monitoring, profile: { ...monitoring.profile, primaryAlertChannel: event.target.value } })} /></label>
          <label>Záložní alert kanál<input value={monitoring.profile.backupAlertChannel} onChange={(event) => setMonitoring({ ...monitoring, profile: { ...monitoring.profile, backupAlertChannel: event.target.value } })} /></label>
          <label>Vzorek je zastaralý po (s)<input type="number" min={30} max={7200} value={monitoring.profile.staleAfterSeconds} onChange={(event) => setMonitoring({ ...monitoring, profile: { ...monitoring.profile, staleAfterSeconds: Number(event.target.value) } })} /></label>
          <label>Retence výsledků (dny)<input type="number" min={1} max={3650} value={monitoring.profile.retentionDays} onChange={(event) => setMonitoring({ ...monitoring, profile: { ...monitoring.profile, retentionDays: Number(event.target.value) } })} /></label>
          <label>SLO targety (JSON)<textarea rows={5} value={prettyJson(monitoring.profile.sloTargets)} onChange={(event) => {
            try {
              setMonitoring({ ...monitoring, profile: { ...monitoring.profile, sloTargets: JSON.parse(event.target.value) as Record<string, unknown> } });
              setError("");
            } catch {
              setError("SLO targety musí být platný JSON.");
            }
          }} /></label>
          <label>Intervaly probe (JSON)<textarea rows={5} value={prettyJson(monitoring.profile.probeIntervals)} onChange={(event) => {
            try {
              setMonitoring({ ...monitoring, profile: { ...monitoring.profile, probeIntervals: JSON.parse(event.target.value) as Record<string, unknown> } });
              setError("");
            } catch {
              setError("Intervaly probe musí být platný JSON.");
            }
          }} /></label>
          <label>Alert pravidla (JSON pole)<textarea rows={6} value={prettyJson(monitoring.profile.alertRules)} onChange={(event) => {
            try {
              setMonitoring({ ...monitoring, profile: { ...monitoring.profile, alertRules: JSON.parse(event.target.value) as Array<Record<string, unknown>> } });
              setError("");
            } catch {
              setError("Alert pravidla musí být platné JSON pole.");
            }
          }} /></label>
        </div> : null}
        <details><summary>Vstupní JSON Schema</summary><pre className="test-output">{JSON.stringify(server.inputSchema, null, 2)}</pre></details>
        <details><summary>Výstupní JSON Schema</summary><pre className="test-output">{JSON.stringify(server.outputSchema, null, 2)}</pre></details>
        <footer className="modal-actions">
          {!activeRevision ? <button type="button" className="secondary" disabled={busy || !monitoring} onClick={() => { void saveMonitoring(); }}><Save size={16} /> Uložit monitoring</button> : <button type="button" disabled={busy} onClick={() => { setBusy(true); void onStartRevision(server).catch((err) => setError(err instanceof Error ? err.message : "Založení revize selhalo")).finally(() => setBusy(false)); }}><Workflow size={16} /> Založit změnovou revizi</button>}
          <button type="button" className="secondary" disabled={busy} onClick={() => { void runTest(); }}><Terminal size={16} /> Otestovat server</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => { void toggleEnabled(); }}>{server.enabled ? "Vypnout server" : "Zapnout server"}</button>
          <button type="button" className="danger-button" disabled={busy} onClick={() => setDeleteOpen(true)}><Ban size={16} /> Smazat registraci</button>
          <button type="button" className="secondary" onClick={onClose}>Zavřít detail</button>
        </footer>
      </div>
      {deleteOpen ? <DeleteServerModal
        server={server}
        accountName={accountName}
        onClose={() => setDeleteOpen(false)}
        onDeleted={async (input) => {
          await onDeleteServer(server, input);
          setDeleteOpen(false);
          onClose();
        }}
      /> : null}
    </Modal>
  );
}

function MonitoringPage({
  servers,
  accountName,
  probes,
  overview,
  onRefresh,
  onAutomatedOnboarding,
  onToggleEnabled,
  onRunTest,
  onLoadMonitoringProfile,
  onSaveMonitoringProfile,
  onStartRevision,
  onDeleteServer,
  onTestWebhook,
  onAcknowledgeAlert,
  onSuppressAlert,
  onRetryDelivery
}: {
  servers: Server[];
  accountName: string | null;
  probes: MonitoringProbe[];
  overview: MonitoringOverview;
  onRefresh: () => void;
  onAutomatedOnboarding: () => void;
  onToggleEnabled: (server: Server, enabled: boolean) => Promise<void>;
  onRunTest: (server: Server) => Promise<ServerTestResult>;
  onLoadMonitoringProfile: (server: Server) => Promise<MonitoringProfile>;
  onSaveMonitoringProfile: (server: Server, profile: MonitoringProfile) => Promise<void>;
  onStartRevision: (server: Server) => Promise<void>;
  onDeleteServer: (server: Server, input: { confirmedCode: string; reason: string; password: string; totp: string }) => Promise<void>;
  onTestWebhook: () => Promise<void>;
  onAcknowledgeAlert: (alert: OperationalAlert) => Promise<void>;
  onSuppressAlert: (alert: OperationalAlert, reason: string, until: string) => Promise<void>;
  onRetryDelivery: (delivery: AlertDelivery) => Promise<void>;
}) {
  const [actionBusy, setActionBusy] = useState(false);
  const [actionNotice, setActionNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [query, setQuery] = useState("");
  const [timeRange, setTimeRange] = useState("24h");
  const [view, setView] = useState<"status" | "alerts" | "deliveries" | "history">("status");
  const [detailServer, setDetailServer] = useState<Server | null>(null);
  const [suppressingAlert, setSuppressingAlert] = useState<OperationalAlert | null>(null);
  const online = servers.filter((server) => server.enabled && server.recertification.canServeExisting && server.monitoringEnabled).length;
  const degraded = servers.filter((server) => server.operationalState === "DEGRADED").length;
  const activeAlerts = overview.alerts.filter((alert) => alert.status !== "CLOSED");
  const filtered = servers.filter((server) => `${server.displayName} ${server.hostname} ${server.code}`.toLowerCase().includes(query.toLowerCase()));
  const rangeMs = timeRange === "30d" ? 30 * 86400000 : timeRange === "7d" ? 7 * 86400000 : 86400000;
  const visibleProbes = probes.filter((probe) => new Date(probe.checked_at).getTime() > Date.now() - rangeMs).slice(0, 80).reverse();
  const latestProbe = new Map<string, MonitoringProbe>();
  for (const probe of probes) if (!latestProbe.has(probe.server_id)) latestProbe.set(probe.server_id, probe);

  async function runAction(action: () => Promise<void>, successText: string, failureText: string) {
    setActionBusy(true);
    setActionNotice(null);
    try {
      await action();
      setActionNotice({ tone: "success", text: successText });
    } catch (err) {
      setActionNotice({ tone: "error", text: err instanceof Error ? err.message : failureText });
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Monitoring MCP" description="Provozní stav, recertifikace a alerting">
        <button onClick={onAutomatedOnboarding}><Rocket size={17} /> {integrationTokenActionLabel}</button>
        <IconButton label="Obnovit monitoring" onClick={onRefresh}><RefreshCw size={17} /></IconButton>
        <label className="range-select"><Clock3 size={16} /><select value={timeRange} onChange={(event) => setTimeRange(event.target.value)} aria-label="Časový rozsah monitoringu"><option value="24h">Posledních 24 hodin</option><option value="7d">Posledních 7 dní</option><option value="30d">Posledních 30 dní</option></select><ChevronDown size={15} /></label>
      </PageHeader>
      <section className="metric-row">
        <MetricCard tone="neutral" icon={<ServerIcon size={22} />} value={servers.length} label="Celkem serverů" />
        <MetricCard tone="success" icon={<CheckCircle2 size={22} />} value={online} label="Online" />
        <MetricCard tone="warning" icon={<AlertTriangle size={22} />} value={degraded} label="Degradováno" />
        <MetricCard tone="danger" icon={<Ban size={22} />} value={activeAlerts.length} label="Aktivní alerty" />
      </section>
      <section className="monitor-toolbar">
        <div className="segmented-control" aria-label="Pohled monitoringu">
          <button aria-pressed={view === "status"} onClick={() => setView("status")}>Stav</button>
          <button aria-pressed={view === "alerts"} onClick={() => setView("alerts")}>Alerty <span>{activeAlerts.length}</span></button>
          <button aria-pressed={view === "deliveries"} onClick={() => setView("deliveries")}>Webhooky</button>
          <button aria-pressed={view === "history"} onClick={() => setView("history")}>Historie</button>
        </div>
        <div className={`scheduler-state ${overview.scheduler?.last_error ? "danger" : "ok"}`}><span className="status-dot" /><span><strong>{overview.scheduler?.last_error ? "Monitor selhal" : "Monitor aktivní"}</strong><small>{formatDate(overview.scheduler?.last_completed_at ?? null)}</small></span></div>
      </section>
      {view === "status" ? <>
        <section className="panel monitor-panel">
          <div className="panel-head"><div className="heading-with-help"><h2>Stav v čase</h2><CircleHelp size={15} /></div></div>
          <div className="timeline-chart" aria-label="Dostupnost MCP serverů ve zvoleném období">
            <div className="chart-y-axis"><span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0%</span></div>
            <div className="chart-grid">
              {visibleProbes.length === 0 ? <div className="timeline-empty"><ServerIcon size={34} /><strong>Žádná data k zobrazení</strong></div> : <div className="probe-timeline">{visibleProbes.map((probe) => <span key={probe.id} className={`probe-point ${probe.status.toLowerCase()}`} title={`${probe.code} · ${probe.probe_type} · ${probe.status} · ${formatDate(probe.checked_at)}`} />)}</div>}
              <div className="chart-x-axis"><span>-24 h</span><span>-18 h</span><span>-12 h</span><span>-6 h</span><span>nyní</span></div>
            </div>
          </div>
        </section>
        <section className="panel">
        <div className="panel-head server-panel-head"><h2>Přehled serverů</h2><label className="search-box compact-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hledat podle názvu serveru" aria-label="Hledat podle názvu serveru" /></label></div>
        {servers.length === 0 ? (
          <div className="empty-state server-empty">
            <ServerIcon size={34} /><strong>Katalog MCP serverů je prázdný</strong>
          </div>
        ) : (
          <div className="table-scroll"><table><thead><tr><th>Server</th><th>Registrace</th><th>Recertifikace</th><th>Provoz</th><th>Volání</th><th>Vzorek</th><th>Akce</th></tr></thead>
            <tbody>{filtered.map((server) => {
              const probe = latestProbe.get(server.id);
              return <tr key={server.id}><td><strong>{server.displayName}</strong><span className="cell-subtitle">{server.code} · {server.hostname}</span></td><td><span className="badge neutral">{server.registrationState}</span><span className="cell-subtitle">rev. {server.registrationRevision ?? "-"}</span></td><td><span className={`badge ${recertificationTone(server.recertification.phase)}`}>{server.recertification.phase}</span><span className="cell-subtitle">{formatBoundary(server.recertification.secondsToBoundary)}</span></td><td><span className={`badge ${server.operationalState === "HEALTHY" ? "ok" : server.operationalState === "DEGRADED" ? "warn" : "danger"}`}>{server.operationalState}</span>{server.recertification.reason ? <span className="cell-subtitle">{server.recertification.reason}</span> : null}</td><td>{server.successCount}/{server.failureCount}<span className="cell-subtitle">p95 {server.p95LatencyMs ?? "-"} ms</span></td><td>{probe ? <><span className={`badge ${probe.status === "PASS" ? "ok" : "danger"}`}>{probe.probe_type}</span><span className="cell-subtitle">{formatDate(probe.checked_at)}</span></> : <span className="badge danger">Bez vzorku</span>}</td><td><IconButton label={`Detail serveru ${server.displayName}`} onClick={() => setDetailServer(server)}><MoreHorizontal size={17} /></IconButton></td></tr>;
            })}</tbody></table></div>
        )}
        </section>
      </> : null}
      {view === "alerts" ? <section className="panel table-panel">
        <div className="panel-head"><h2>Aktivní alerty</h2><button className="secondary" disabled={actionBusy} onClick={() => { void runAction(onTestWebhook, "Test webhooků byl úspěšně odeslán.", "Test webhooků selhal."); }}><Terminal size={16} /> Test webhooků</button></div>
        {actionNotice ? <div className={`notice ${actionNotice.tone === "success" ? "success" : "error"}`}><span>{actionNotice.text}</span></div> : null}
        <div className="table-scroll"><table><thead><tr><th>Závažnost</th><th>Server</th><th>Alert</th><th>Stav</th><th>Naposledy</th><th>Akce</th></tr></thead><tbody>{activeAlerts.map((alert) => <tr key={alert.id}><td><span className={`badge ${alert.severity === "CRITICAL" ? "danger" : "warn"}`}>{alert.severity}</span></td><td>{alert.code ?? "KCML"}</td><td><strong>{alert.title}</strong><span className="cell-subtitle">{alert.alert_type}</span></td><td><span className="badge neutral">{alert.status}</span>{alert.suppressed_until ? <span className="cell-subtitle">do {formatDate(alert.suppressed_until)}</span> : null}</td><td>{formatDate(alert.last_seen_at)}</td><td><div className="row-actions">{alert.status === "OPEN" ? <button className="secondary" disabled={actionBusy} onClick={() => { void runAction(() => onAcknowledgeAlert(alert), `Alert ${alert.title} byl potvrzen.`, "Potvrzení alertu selhalo."); }}>Potvrdit</button> : null}{["OPEN", "ACKNOWLEDGED"].includes(alert.status) ? <button className="secondary" disabled={actionBusy} onClick={() => setSuppressingAlert(alert)}><BellOff size={15} /> Potlačit</button> : null}</div></td></tr>)}</tbody></table></div>
        {activeAlerts.length === 0 ? <div className="empty-state"><CheckCircle2 size={34} /><strong>Žádné aktivní alerty</strong></div> : null}
      </section> : null}
      {view === "deliveries" ? <section className="panel table-panel">
        <div className="panel-head"><h2>Webhook delivery</h2></div>
        {actionNotice ? <div className={`notice ${actionNotice.tone === "success" ? "success" : "error"}`}><span>{actionNotice.text}</span></div> : null}
        <div className="table-scroll"><table><thead><tr><th>Kanál</th><th>Alert</th><th>Stav</th><th>Pokusy</th><th>HTTP</th><th>Další pokus</th><th>Akce</th></tr></thead><tbody>{overview.deliveries.map((delivery) => <tr key={delivery.id}><td><span className="badge neutral">{delivery.channel}</span></td><td>{delivery.code ?? "KCML"}<span className="cell-subtitle">{delivery.alert_type}</span></td><td><span className={`badge ${delivery.state === "DELIVERED" ? "ok" : delivery.state === "DEAD_LETTER" ? "danger" : "warn"}`}>{delivery.state}</span>{delivery.last_error ? <span className="cell-subtitle">{delivery.last_error}</span> : null}</td><td>{delivery.attempt_count}</td><td>{delivery.last_http_status ?? "-"}</td><td>{formatDate(delivery.next_attempt_at)}</td><td>{["RETRY", "DEAD_LETTER"].includes(delivery.state) ? <button className="secondary" disabled={actionBusy} onClick={() => { void runAction(() => onRetryDelivery(delivery), `Delivery ${delivery.id} byla zařazena k opakování.`, "Opakování delivery selhalo."); }}>Opakovat</button> : "-"}</td></tr>)}</tbody></table></div>
        {overview.deliveries.length === 0 ? <div className="empty-state"><Terminal size={34} /><strong>Žádné webhook delivery</strong></div> : null}
      </section> : null}
      {view === "history" ? <section className="panel table-panel">
        <div className="panel-head"><h2>Historie stavů</h2></div>
        <div className="table-scroll"><table><thead><tr><th>Čas</th><th>Server</th><th>Registrace</th><th>Provoz</th><th>Recertifikace</th><th>Důvod</th><th>Correlation ID</th></tr></thead><tbody>{overview.stateHistory.map((entry) => <tr key={entry.id}><td>{formatDate(entry.recorded_at)}</td><td>{entry.code}</td><td><span className="badge neutral">{entry.registration_state}</span></td><td>{entry.operational_state}</td><td>{entry.recertification_phase}</td><td>{entry.reason}</td><td><code>{entry.correlation_id}</code></td></tr>)}</tbody></table></div>
        {overview.stateHistory.length === 0 ? <div className="empty-state"><Clock3 size={34} /><strong>Historie je prázdná</strong></div> : null}
      </section> : null}
      {detailServer ? <ServerDetailModal server={servers.find((server) => server.id === detailServer.id) ?? detailServer} accountName={accountName} onClose={() => setDetailServer(null)} onToggleEnabled={onToggleEnabled} onRunTest={onRunTest} onLoadMonitoringProfile={onLoadMonitoringProfile} onSaveMonitoringProfile={onSaveMonitoringProfile} onStartRevision={onStartRevision} onDeleteServer={onDeleteServer} /> : null}
      {suppressingAlert ? <AlertSuppressionModal alert={suppressingAlert} onClose={() => setSuppressingAlert(null)} onSubmit={async (reason, until) => { await onSuppressAlert(suppressingAlert, reason, until); setSuppressingAlert(null); }} /> : null}
    </>
  );
}

function DeleteServerModal({
  server,
  accountName,
  onClose,
  onDeleted
}: {
  server: Server;
  accountName: string | null;
  onClose: () => void;
  onDeleted: (input: { confirmedCode: string; reason: string; password: string; totp: string }) => Promise<void>;
}) {
  const [confirmedCode, setConfirmedCode] = useState("");
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onDeleted({ confirmedCode: confirmedCode.trim(), reason: reason.trim(), password, totp: totp.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Smazání registrace selhalo");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Smazat registraci serveru" onClose={onClose}>
      <form className="modal-form" onSubmit={(event) => { void submit(event); }}>
        <div className="notice error"><AlertTriangle size={18} /><span>Server bude kompletně odstraněn z registru KCML. Pokud se bude registrovat znovu, musí být vystaven nový onboarding token a proběhne celý onboarding od začátku.</span></div>
        <label>Důvod smazání<textarea autoFocus value={reason} onChange={(event) => setReason(event.target.value)} minLength={10} maxLength={1000} rows={4} /></label>
        <label>Pro potvrzení opište přesný KCML kód<input value={confirmedCode} onChange={(event) => setConfirmedCode(event.target.value)} placeholder={server.code} /></label>
        <input type="text" autoComplete="username" value={accountName ?? ""} readOnly hidden />
        <label>Heslo administrátora<input name="password" value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" /></label>
        <label>Jednorázový MFA kód (je-li zapnutý)<input value={totp} onChange={(event) => setTotp(event.target.value)} inputMode="numeric" autoComplete="one-time-code" /></label>
        {error ? <p className="error">{error}</p> : null}
        <footer className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Zrušit</button><button type="submit" className="danger-button" disabled={busy || confirmedCode !== server.code || reason.trim().length < 10 || !password}>{busy ? "Mažu…" : "Smazat registraci"}</button></footer>
      </form>
    </Modal>
  );
}

function AlertSuppressionModal({ alert, onClose, onSubmit }: { alert: OperationalAlert; onClose: () => void; onSubmit: (reason: string, until: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState(() => formatLocalDateTimeInput(new Date(Date.now() + 60 * 60 * 1_000)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit(reason.trim(), new Date(until).toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Potlačení alertu selhalo");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`Potlačit alert ${alert.code ?? "KCML"}`} onClose={onClose}>
      <form className="modal-form" onSubmit={(event) => { void submit(event); }}>
        <div className="notice warning"><BellOff size={18} /><span>{alert.title}</span></div>
        <label>Důvod potlačení<textarea autoFocus rows={4} minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <label>Potlačit do<input type="datetime-local" value={until} min={formatLocalDateTimeInput(new Date())} onChange={(event) => setUntil(event.target.value)} /></label>
        {error ? <p className="error">{error}</p> : null}
        <footer className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Zrušit</button><button type="submit" disabled={busy || reason.trim().length < 5 || !until}><BellOff size={16} /> {busy ? "Ukládám…" : "Potlačit do termínu"}</button></footer>
      </form>
    </Modal>
  );
}

function OnboardingJobModal({ jobId, onClose, onResume, onCancel, onReleaseQuarantine }: { jobId: string; onClose: () => void; onResume: (jobId: string) => void; onCancel: (jobId: string) => Promise<void>; onReleaseQuarantine: (job: OnboardingJob) => void }) {
  const [job, setJob] = useState<OnboardingJob | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void api<{ job: OnboardingJob }>(`/api/onboarding-jobs/${jobId}`).then((result) => setJob(result.job)).catch((err) => setError(err instanceof Error ? err.message : "Detail se nepodařilo načíst"));
  }, [jobId]);
  return (
    <Modal title="Detail onboarding jobu" onClose={onClose}>
      {!job ? <div className="server-detail">{error ? <p className="error">{error}</p> : <p>Načítám detail…</p>}</div> : <div className="job-detail">
        <div className="server-detail-status"><span className={`status-dot ${job.state === "ACTIVE" ? "ok" : ["FAILED", "QUARANTINED", "CANCELLED"].includes(job.state) ? "danger" : "warn"}`} /><strong>{job.state}</strong><span>{job.code ?? "Bez identity"}</span></div>
        <dl className="job-metadata"><dt>Job ID</dt><dd><code>{job.id}</code></dd><dt>Correlation ID</dt><dd><code>{job.correlationId}</code></dd><dt>HTTPS resource</dt><dd>{job.resource ? <a href={job.resource} target="_blank" rel="noreferrer">{job.resource}</a> : "-"}</dd><dt>PR / CI</dt><dd>{job.githubPrUrl ? <a href={job.githubPrUrl} target="_blank" rel="noreferrer">Otevřít pull request</a> : "-"}</dd><dt>Image digest</dt><dd><code>{job.imageDigest ?? "-"}</code></dd><dt>SBOM digest</dt><dd><code>{job.sbomDigest ?? "-"}</code></dd><dt>Revize zdrojů</dt><dd>{job.sourceRevision}</dd></dl>
        {job.blockingErrorCode ? <div className="notice error"><AlertTriangle size={18} /><span><strong>{job.blockingErrorCode}</strong><br />{job.blockingErrorDetail}</span></div> : null}
        <section><h3>Bezpečnostní a aktivační brány</h3><div className="gate-grid">{job.gates?.map((gate) => <article key={gate.gate_name}><span className={`status-dot ${gate.status === "PASS" ? "ok" : ["FAIL", "QUARANTINED"].includes(gate.status) ? "danger" : "warn"}`} /><div><strong>{gate.gate_name}</strong><small>{gate.stage} · {gate.status}</small></div></article>)}</div></section>
        <section><h3>Časová osa</h3><ol className="job-timeline">{job.events?.map((event) => <li key={event.id}><span className="status-dot ok" /><div><strong>{event.event_type}</strong><small>{event.from_state ?? "START"} → {event.to_state} · {formatDate(event.created_at)}</small><code>{event.correlation_id}</code></div></li>)}</ol></section>
        <footer className="modal-actions"><button className="secondary" onClick={onClose}>Zavřít</button>{job.state === "QUARANTINED" ? <button className="danger-button" onClick={() => onReleaseQuarantine(job)}>Schválit novou revizi</button> : null}{job.state !== "ACTIVE" && job.state !== "QUARANTINED" && job.state !== "CANCELLED" ? <button className="secondary" onClick={() => onResume(job.id)}>Vystavit navazující token</button> : null}{!["ACTIVE", "FAILED", "QUARANTINED", "CANCELLED"].includes(job.state) ? <button className="danger-button" onClick={() => { void onCancel(job.id); }}>Zrušit job</button> : null}</footer>
      </div>}
    </Modal>
  );
}

function QuarantineReleaseModal({
  job,
  accountName,
  onClose,
  onReleased
}: {
  job: OnboardingJob;
  accountName: string | null;
  onClose: () => void;
  onReleased: () => Promise<void>;
}) {
  const [confirmedCode, setConfirmedCode] = useState("");
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/api/onboarding-jobs/${job.id}/release-quarantine`, {
        method: "POST",
        headers: { "x-csrf-token": csrf() },
        body: JSON.stringify({ confirmedCode: confirmedCode.trim(), reason: reason.trim(), password, totp: totp.trim() })
      });
      await onReleased();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Uvolnění karantény selhalo");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Schválit novou registrační revizi" onClose={onClose}>
      <form className="modal-form" onSubmit={(event) => { void submit(event); }}>
        <div className="notice error"><AlertTriangle size={18} /><span>Server zůstane vypnutý. Tato ruční akce pouze povolí nahrání nové revize a její kompletní bezpečnostní přetestování.</span></div>
        <label>Důvod a doložená náprava<textarea autoFocus value={reason} onChange={(event) => setReason(event.target.value)} minLength={10} maxLength={1000} rows={4} /></label>
        <label>Pro potvrzení opište přesný KCML kód<input value={confirmedCode} onChange={(event) => setConfirmedCode(event.target.value)} placeholder={job.code ?? "KCML…"} /></label>
        <input type="text" autoComplete="username" value={accountName ?? ""} readOnly hidden />
        <label>Heslo administrátora<input name="password" value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" /></label>
        <label>Jednorázový MFA kód (je-li zapnutý)<input value={totp} onChange={(event) => setTotp(event.target.value)} inputMode="numeric" autoComplete="one-time-code" /></label>
        {error ? <p className="error">{error}</p> : null}
        <footer className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Zrušit</button><button type="submit" className="danger-button" disabled={busy || confirmedCode !== job.code || reason.trim().length < 10 || !password}>{busy ? "Ověřuji…" : "Schválit novou revizi"}</button></footer>
      </form>
    </Modal>
  );
}

function IntegrationTokenRunIndicator({ token, nowMs }: { token: IntegrationToken; nowMs: number }) {
  const lifecycle = getIntegrationTokenLifecycle(token, nowMs);
  return (
    <div className={`integration-run-state ${lifecycle.runState}`} title={lifecycle.protectionLabel}>
      <span className="integration-run-heading"><span className="integration-run-dot" /><strong>{lifecycle.runLabel}</strong></span>
      <span className={`integration-protection ${lifecycle.protectionActive ? "protected" : "unprotected"}`}>
        {lifecycle.protectionActive ? <ShieldCheck size={13} /> : <Clock3 size={13} />}{lifecycle.protectionLabel}
      </span>
      {token.tokenExtendedAt ? <small>Naposledy prodlouženo {formatDate(token.tokenExtendedAt)}</small> : null}
    </div>
  );
}

function IntegrationTokenExpiry({ token, nowMs }: { token: IntegrationToken; nowMs: number }) {
  const lifecycle = getIntegrationTokenLifecycle(token, nowMs);
  return (
    <div className={`token-countdown ${lifecycle.tokenValid ? "valid" : "expired"}`} aria-label={lifecycle.tokenValid ? `Platnost končí za ${formatMinuteSecondCountdown(lifecycle.currentRemainingMs)}` : "Platnost tokenu skončila"}>
      <strong>{formatMinuteSecondCountdown(lifecycle.currentRemainingMs)}</strong>
      <small>{lifecycle.tokenValid ? `Končí ${formatDate(token.expiresAt)}` : "Token již nelze použít"}</small>
    </div>
  );
}

function IntegrationTokenMaximum({ token, nowMs }: { token: IntegrationToken; nowMs: number }) {
  const lifecycle = getIntegrationTokenLifecycle(token, nowMs);
  const maximumExhausted = lifecycle.maximumRemainingMs === 0;
  const progressLabel = Math.round(lifecycle.maximumProgressPercent);
  return (
    <div className={`token-maximum ${lifecycle.nearMaximum || maximumExhausted ? "near" : "safe"}`}>
      <strong>{formatMinuteSecondCountdown(lifecycle.maximumRemainingMs)}</strong>
      <small>{maximumExhausted ? "Pevný limit 24 h vyčerpán" : lifecycle.nearMaximum ? "Blíží se pevný limit 24 h" : "Zbývá do pevného limitu 24 h"}</small>
      <progress max="100" value={lifecycle.maximumProgressPercent} aria-label={`Využito ${progressLabel} procent z maximální doby 24 hodin`} />
      <small>Využito {progressLabel} % · maximum {formatDate(token.maxExpiresAt)}</small>
    </div>
  );
}

function IntegrationTokensPage({ tokens, jobs, onCreate, onOpenJob, onResume, onRevoke, onDelete, onRefresh }: { tokens: IntegrationToken[]; jobs: OnboardingJob[]; onCreate: () => void; onOpenJob: (id: string) => void; onResume: (id: string) => void; onRevoke: (token: IntegrationToken) => void; onDelete: (token: IntegrationToken) => void; onRefresh: () => void }) {
  const [query, setQuery] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const countdownTimer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    const refreshTimer = window.setInterval(onRefresh, 15_000);
    return () => {
      window.clearInterval(countdownTimer);
      window.clearInterval(refreshTimer);
    };
  }, [onRefresh]);
  const filtered = tokens.filter((token) => `${token.label} ${token.descriptor.summary} ${token.fingerprint} ${token.code ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <>
      <PageHeader title="Implementační tokeny" description="Označení integračního toku, strukturovaný descriptor a token pro automatickou integraci jednoho MCP serveru.">
        <label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hledat token, job nebo KCML…" aria-label="Hledat implementační token" /></label>
        <button onClick={onCreate}><Plus size={17} /> {integrationTokenActionLabel}</button><IconButton label="Obnovit" onClick={onRefresh}><RefreshCw size={17} /></IconButton>
      </PageHeader>
      <section className="panel table-panel"><div className="panel-head"><div><h2>Vydané tokeny</h2><p>Plná hodnota je v create response a handoffu; tento přehled trvale uchovává fingerprint.</p></div><span className="panel-count">{filtered.length} záznamů</span></div>
        {filtered.length === 0 ? <div className="empty-state"><Workflow size={34} /><strong>Žádné implementační tokeny</strong><p>Vygeneruj první token a předej jej programátorovi bezpečným kanálem.</p></div> : <div className="table-scroll"><table className="integration-token-table"><thead><tr><th>Token</th><th>KCML / job</th><th>Stav integrace / ochrana</th><th>Platnost a limit 24 hodin</th><th>Akce</th></tr></thead><tbody>{filtered.map((token) => <tr key={token.id}><td><strong>{token.label}</strong><span className="cell-subtitle">{token.descriptor.summary}</span><span className="cell-subtitle">Vydán {formatDate(token.issuedAt)}</span><code className="cell-fingerprint">{token.fingerprint}</code></td><td>{token.code ?? "Čeká na upload"}<span className="cell-subtitle">{token.jobId ? token.jobId.slice(0, 8) : "Nevázaný"}</span></td><td><div className="integration-state-cell"><span className={`badge ${token.active ? "ok" : "danger"}`}>{token.jobState ?? (token.active ? "PŘIPRAVEN" : "NEPLATNÝ")}</span><IntegrationTokenRunIndicator token={token} nowMs={nowMs} /></div></td><td><div className="token-timing-cell"><IntegrationTokenExpiry token={token} nowMs={nowMs} /><IntegrationTokenMaximum token={token} nowMs={nowMs} /></div></td><td><div className="row-actions integration-row-actions">{token.jobId ? <button className="small-button" onClick={() => onOpenJob(token.jobId!)}>Detail</button> : null}{token.jobId && !["ACTIVE", "QUARANTINED", "CANCELLED"].includes(token.jobState ?? "") && !token.active ? <button className="small-button" onClick={() => onResume(token.jobId!)}>Navázat</button> : null}<button className="small-button" disabled={!token.active} onClick={() => onRevoke(token)}>Revokovat</button><button className="small-button danger-link" onClick={() => onDelete(token)}>Smazat</button></div></td></tr>)}</tbody></table></div>}
      </section>
      <section className="panel"><div className="panel-head"><h2>Onboardingové joby</h2><span className="panel-count">{jobs.length} jobů</span></div>{jobs.length === 0 ? <div className="empty-state server-empty"><Rocket size={32} /><strong>Zatím nebyl zahájen žádný upload</strong></div> : <div className="job-cards">{jobs.map((job) => <button key={job.id} onClick={() => onOpenJob(job.id)}><span className={`status-dot ${job.state === "ACTIVE" ? "ok" : ["FAILED", "QUARANTINED", "CANCELLED"].includes(job.state) ? "danger" : "warn"}`} /><span><strong>{job.code ?? "Čeká na identitu"}</strong><small>{job.state} · {formatDate(job.updatedAt)}</small></span><ChevronDown className="item-chevron" size={15} /></button>)}</div>}</section>
    </>
  );
}

function Dashboard({ accountName, role, onLogout }: { accountName: string | null; role: AdminRole; onLogout: () => void }) {
  const [page, setPage] = useState<Page>("monitoring");
  const [servers, setServers] = useState<Server[]>([]);
  const [credentials, setCredentials] = useState<KajaCredential[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [auditNextCursor, setAuditNextCursor] = useState<string | null>(null);
  const [auditIntegrity, setAuditIntegrity] = useState<AuditIntegrity | null>(null);
  const [security, setSecurity] = useState<AdminSecurity | null>(null);
  const [adminAccounts, setAdminAccounts] = useState<AdminAccount[]>([]);
  const [operationalConfig, setOperationalConfig] = useState<OperationalConfigSetting[]>([]);
  const [integrationTokens, setIntegrationTokens] = useState<IntegrationToken[]>([]);
  const [onboardingJobs, setOnboardingJobs] = useState<OnboardingJob[]>([]);
  const [probes, setProbes] = useState<MonitoringProbe[]>([]);
  const [monitoringOverview, setMonitoringOverview] = useState<MonitoringOverview>({ alerts: [], deliveries: [], stateHistory: [], scheduler: null });
  const [selectedCredentialId, setSelectedCredentialId] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<KajaPermission[]>([]);
  const [savingPermissions, setSavingPermissions] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [secret, setSecret] = useState<SecretResult | null>(null);
  const [integrationCreate, setIntegrationCreate] = useState<{ resumeJobId?: string } | null>(null);
  const [integrationSecret, setIntegrationSecret] = useState<IntegrationSecret | null>(null);
  const [integrationConfirm, setIntegrationConfirm] = useState<{ token: IntegrationToken; action: "revoke" | "delete" } | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [quarantineRelease, setQuarantineRelease] = useState<OnboardingJob | null>(null);
  const [confirm, setConfirm] = useState<{ credential: KajaCredential; action: "revoke" | "delete" } | null>(null);
  const [renameCredential, setRenameCredential] = useState<KajaCredential | null>(null);
  const [error, setError] = useState("");
  async function load() {
    setError("");
    try {
      const [serverRes, credentialRes, auditRes, integrationRes, jobsRes, probesRes, monitoringRes, securityRes, integrityRes, adminAccountsRes, configRes] = await Promise.all([
        api<{ servers: Server[] }>("/api/mcp-servers"),
        api<{ credentials: KajaCredential[] }>("/api/kaja"),
        api<AuditResponse>("/api/audit"),
        api<{ tokens: IntegrationToken[] }>("/api/integration-tokens"),
        api<{ jobs: OnboardingJob[] }>("/api/onboarding-jobs"),
        api<{ probes: MonitoringProbe[] }>("/api/monitoring-probes"),
        api<MonitoringOverview>("/api/monitoring-overview"),
        api<AdminSecurity>("/api/admin-security"),
        api<AuditIntegrity>("/api/audit/integrity"),
        role === "OWNER" ? api<{ accounts: AdminAccount[] }>("/api/admin-accounts") : Promise.resolve({ accounts: [] }),
        api<{ settings: OperationalConfigSetting[] }>("/api/operational-config")
      ]);
      setServers(serverRes.servers);
      setCredentials(credentialRes.credentials);
      setEvents(auditRes.events);
      setAuditNextCursor(auditRes.nextCursor);
      setAuditIntegrity(integrityRes);
      const configuredTimeZone = configRes.settings.find((setting) => setting.key === "uiTimeZone")?.value;
      if (typeof configuredTimeZone === "string") setUiTimeZone(configuredTimeZone);
      setIntegrationTokens(integrationRes.tokens);
      setOnboardingJobs(jobsRes.jobs);
      setProbes(probesRes.probes);
      setMonitoringOverview(monitoringRes);
      setSecurity(securityRes);
      setAdminAccounts(adminAccountsRes.accounts);
      setOperationalConfig(configRes.settings);
      setSelectedCredentialId((current) => current ?? credentialRes.credentials[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Načtení selhalo");
    }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!selectedCredentialId) {
      setPermissions([]);
      return;
    }
    void api<{ permissions: KajaPermission[] }>(`/api/kaja/${selectedCredentialId}/permissions`)
      .then((result) => setPermissions(result.permissions))
      .catch((err) => setError(err instanceof Error ? err.message : "Načtení oprávnění selhalo"));
  }, [selectedCredentialId]);

  async function savePermissions() {
    if (!selectedCredentialId) return;
    setSavingPermissions(true);
    try {
      await api(`/api/kaja/${selectedCredentialId}/permissions`, {
        method: "PUT",
        headers: { "x-csrf-token": csrf() },
        body: JSON.stringify({ permissions: permissions.filter((permission) => permission.granted).map((permission) => ({ serverId: permission.serverId, accessLevel: permission.accessLevel ?? "EXECUTE" })) })
      });
      await load();
    } finally {
      setSavingPermissions(false);
    }
  }

  async function runConfirm() {
    if (!confirm) return;
    await api(`/api/kaja/${confirm.credential.id}/${confirm.action === "revoke" ? "revoke" : "delete"}`, { method: "POST", headers: { "x-csrf-token": csrf() }, body: "{}" });
    setConfirm(null);
    await load();
  }

  async function renameCredentialLabel(label: string) {
    if (!renameCredential) return;
    await api(`/api/kaja/${renameCredential.id}/label`, {
      method: "PATCH",
      headers: { "x-csrf-token": csrf() },
      body: JSON.stringify({ label })
    });
    setRenameCredential(null);
    await load();
  }

  async function runIntegrationConfirm() {
    if (!integrationConfirm) return;
    await api(`/api/integration-tokens/${integrationConfirm.token.id}/${integrationConfirm.action}`, { method: "POST", headers: { "x-csrf-token": csrf() }, body: "{}" });
    setIntegrationConfirm(null);
    await load();
  }

  async function cancelOnboardingJob(jobId: string) {
    await api(`/api/onboarding-jobs/${jobId}/cancel`, { method: "POST", headers: { "x-csrf-token": csrf() }, body: "{}" });
    setSelectedJobId(null);
    await load();
  }

  async function logout() {
    await api("/api/logout", { method: "POST", headers: { "x-csrf-token": csrf() }, body: "{}" });
    onLogout();
  }

  async function toggleServerEnabled(server: Server, enabled: boolean) {
    await setServerEnabled(server, enabled);
    await load();
  }

  async function runServerTest(server: Server) {
    const result = await runRegisteredServerTest(server);
    await load();
    return result;
  }

  async function loadMonitoringProfile(server: Server) {
    return getMonitoringProfile(server);
  }

  async function saveMonitoringProfile(server: Server, profile: MonitoringProfile) {
    await persistMonitoringProfile(server, profile);
    await load();
  }

  async function startServerRevision(server: Server) {
    setIntegrationCreate({ resumeJobId: await createServerRevision(server) });
    await load();
  }

  async function deleteServerRegistration(server: Server, input: { confirmedCode: string; reason: string; password: string; totp: string }) {
    await api(`/api/mcp-servers/${server.id}/delete`, {
      method: "POST",
      headers: { "x-csrf-token": csrf() },
      body: JSON.stringify(input)
    });
    await load();
  }

  async function testAlertWebhooks() {
    await testAlertChannels();
    await load();
  }

  async function acknowledgeAlert(alert: OperationalAlert) {
    await acknowledgeOperationalAlert(alert);
    await load();
  }

  async function suppressAlert(alert: OperationalAlert, reason: string, until: string) {
    await suppressOperationalAlert(alert, reason, until);
    await load();
  }

  async function retryAlertDelivery(delivery: AlertDelivery) {
    await retryAlertDeliveryRequest(delivery);
    await load();
  }

  async function refreshAudit(params: AuditFilters) {
    const search = auditQueryParams(params);
    const result = await api<AuditResponse>(`/api/audit${search.size ? `?${search.toString()}` : ""}`);
    setEvents(result.events);
    setAuditNextCursor(result.nextCursor);
  }

  async function loadMoreAudit(params: AuditFilters) {
    if (!auditNextCursor) return;
    const search = auditQueryParams(params);
    search.set("cursor", auditNextCursor);
    const result = await api<AuditResponse>(`/api/audit?${search.toString()}`);
    setEvents((current) => [...current, ...result.events]);
    setAuditNextCursor(result.nextCursor);
  }

  async function refreshAuditIntegrity() {
    setAuditIntegrity(await api<AuditIntegrity>("/api/audit/integrity"));
  }

  async function loadAuditDetail(id: number) {
    const result = await api<{ event: AuditEvent }>(`/api/audit/events/${id}`);
    return result.event;
  }

  async function refreshSecurity() {
    const result = await api<AdminSecurity>("/api/admin-security");
    setSecurity(result);
  }

  async function changeAdminPassword(currentPassword: string, nextPassword: string) {
    await api("/api/admin-password", {
      method: "POST",
      headers: { "x-csrf-token": csrf() },
      body: JSON.stringify({ currentPassword, nextPassword })
    });
    await refreshSecurity();
  }

  async function revokeOtherSessions() {
    await api("/api/admin-sessions/revoke-others", {
      method: "POST",
      headers: { "x-csrf-token": csrf() },
      body: "{}"
    });
    await refreshSecurity();
  }

  async function revokeSession(sessionId: string) {
    await api(`/api/admin-sessions/${sessionId}/revoke`, {
      method: "POST",
      headers: { "x-csrf-token": csrf() },
      body: "{}"
    });
    await refreshSecurity();
  }

  async function revokeAllSessions() {
    await api("/api/admin-sessions/revoke-all", {
      method: "POST",
      headers: { "x-csrf-token": csrf() },
      body: "{}"
    });
    onLogout();
  }

  async function refreshAdminAccounts() {
    const result = await api<{ accounts: AdminAccount[] }>("/api/admin-accounts");
    setAdminAccounts(result.accounts);
  }

  async function refreshOperationalConfig() {
    const result = await api<{ settings: OperationalConfigSetting[] }>("/api/operational-config");
    const configuredTimeZone = result.settings.find((setting) => setting.key === "uiTimeZone")?.value;
    if (typeof configuredTimeZone === "string") setUiTimeZone(configuredTimeZone);
    setOperationalConfig(result.settings);
  }

  async function saveOperationalConfig(setting: OperationalConfigSetting, value: string | number | boolean | string[]) {
    const domainVersions = Object.fromEntries(
      operationalConfig
        .filter((item) => ["publicBaseDomain", "adminHost", "authHost", "registerHost"].includes(item.key))
        .map((item) => [item.key, item.version])
    );
    const path = setting.key === "publicBaseDomain" ? "/api/operational-config/domain" : `/api/operational-config/${setting.key}`;
    const body = setting.key === "publicBaseDomain"
      ? { baseDomain: value, expectedVersions: domainVersions }
      : { value, expectedVersion: setting.version };
    await api(path, {
      method: "PUT",
      headers: { "x-csrf-token": csrf() },
      body: JSON.stringify(body)
    });
    await refreshOperationalConfig();
  }

  async function createAdminAccount(input: { username: string; password: string; mfaSecret: string; role: AdminRole }) {
    await api("/api/admin-accounts", {
      method: "POST",
      headers: { "x-csrf-token": csrf() },
      body: JSON.stringify(input)
    });
    await refreshAdminAccounts();
  }

  async function updateAdminAccount(accountId: string, input: { role?: AdminRole; active?: boolean }) {
    await api(`/api/admin-accounts/${accountId}`, {
      method: "PATCH",
      headers: { "x-csrf-token": csrf() },
      body: JSON.stringify(input)
    });
    await refreshAdminAccounts();
  }

  async function setAdminAccountPassword(accountId: string, nextPassword: string) {
    await api(`/api/admin-accounts/${accountId}/password`, {
      method: "POST",
      headers: { "x-csrf-token": csrf() },
      body: JSON.stringify({ nextPassword })
    });
    await refreshAdminAccounts();
  }

  async function setAdminAccountMfa(accountId: string, enabled: boolean, secret: string) {
    await api(`/api/admin-accounts/${accountId}/mfa`, {
      method: "PUT",
      headers: { "x-csrf-token": csrf() },
      body: JSON.stringify({ enabled, secret })
    });
    await refreshAdminAccounts();
  }

  async function revokeAdminAccountSessions(accountId: string) {
    await api(`/api/admin-accounts/${accountId}/sessions/revoke`, {
      method: "POST",
      headers: { "x-csrf-token": csrf() },
      body: "{}"
    });
    await Promise.all([refreshAdminAccounts(), refreshSecurity()]);
  }

  async function rotateAdminRecoveryCodes(accountId: string) {
    const result = await api<{ recoveryCodes: string[] }>(`/api/admin-accounts/${accountId}/recovery/rotate`, {
      method: "POST",
      headers: { "x-csrf-token": csrf() },
      body: "{}"
    });
    await refreshAdminAccounts();
    return result.recoveryCodes;
  }

  function openPermissions(id: string) {
    setSelectedCredentialId(id);
    setPage("permissions");
  }

  return (
    <AppLayout
      page={page}
      role={role}
      accountName={accountName}
      error={error}
      onPageChange={setPage}
      onLogout={() => { void logout(); }}
      overlays={<>
        {createOpen && <CreateCredentialModal serverCount={servers.length} onClose={() => setCreateOpen(false)} onCreated={(created) => { setCreateOpen(false); setSecret(created); void load(); }} />}
        {secret && <CredentialSecretModal secret={secret} onClose={() => setSecret(null)} />}
        {confirm && <CredentialConfirmModal credential={confirm.credential} action={confirm.action} onClose={() => setConfirm(null)} onConfirm={runConfirm} />}
        {renameCredential && <RenameCredentialModal credential={renameCredential} onClose={() => setRenameCredential(null)} onRename={renameCredentialLabel} />}
        {integrationCreate && <CreateIntegrationTokenModal resumeJobId={integrationCreate.resumeJobId} onClose={() => setIntegrationCreate(null)} onCreated={(created) => { setIntegrationCreate(null); setIntegrationSecret(created); setPage("integration"); void load(); }} />}
        {integrationSecret && <IntegrationSecretModal secret={integrationSecret} onClose={() => setIntegrationSecret(null)} />}
        {integrationConfirm && <IntegrationConfirmModal token={integrationConfirm.token} action={integrationConfirm.action} onClose={() => setIntegrationConfirm(null)} onConfirm={runIntegrationConfirm} />}
        {selectedJobId && <OnboardingJobModal jobId={selectedJobId} onClose={() => setSelectedJobId(null)} onResume={(jobId) => { setSelectedJobId(null); setIntegrationCreate({ resumeJobId: jobId }); }} onCancel={cancelOnboardingJob} onReleaseQuarantine={(job) => { setSelectedJobId(null); setQuarantineRelease(job); }} />}
        {quarantineRelease && <QuarantineReleaseModal job={quarantineRelease} accountName={accountName} onClose={() => setQuarantineRelease(null)} onReleased={async () => { setQuarantineRelease(null); await load(); }} />}
      </>}
    >
      <PageRouter page={page} routes={{
        monitoring: <MonitoringPage servers={servers} accountName={accountName} probes={probes} overview={monitoringOverview} onRefresh={() => { void load(); }} onAutomatedOnboarding={() => setIntegrationCreate({})} onToggleEnabled={toggleServerEnabled} onRunTest={runServerTest} onLoadMonitoringProfile={loadMonitoringProfile} onSaveMonitoringProfile={saveMonitoringProfile} onStartRevision={startServerRevision} onDeleteServer={deleteServerRegistration} onTestWebhook={testAlertWebhooks} onAcknowledgeAlert={acknowledgeAlert} onSuppressAlert={suppressAlert} onRetryDelivery={retryAlertDelivery} />,
        integration: <IntegrationTokensPage tokens={integrationTokens} jobs={onboardingJobs} onCreate={() => setIntegrationCreate({})} onOpenJob={setSelectedJobId} onResume={(jobId) => setIntegrationCreate({ resumeJobId: jobId })} onRevoke={(token) => setIntegrationConfirm({ token, action: "revoke" })} onDelete={(token) => setIntegrationConfirm({ token, action: "delete" })} onRefresh={() => { void load(); }} />,
        tokens: <CredentialsPage credentials={credentials} onOpenCreate={() => setCreateOpen(true)} onEditPermissions={openPermissions} onRename={setRenameCredential} onConfirm={(credential, action) => setConfirm({ credential, action })} onRefresh={() => { void load(); }} />,
        permissions: <PermissionsPage credentials={credentials} servers={servers} selectedId={selectedCredentialId} permissions={permissions} saving={savingPermissions} onSelect={setSelectedCredentialId} onChange={setPermissions} onSave={() => { void savePermissions(); }} />,
        audit: <AuditPage events={events} nextCursor={auditNextCursor} integrity={auditIntegrity} onLoadMore={loadMoreAudit} onLoadDetail={loadAuditDetail} onRefresh={refreshAudit} onRefreshIntegrity={refreshAuditIntegrity} />,
        config: <OperationalConfigPage settings={operationalConfig} onRefresh={refreshOperationalConfig} onSave={saveOperationalConfig} />,
        security: <SecurityPage security={security} onRefresh={refreshSecurity} onChangePassword={changeAdminPassword} onRevokeOtherSessions={revokeOtherSessions} onRevokeSession={revokeSession} onRevokeAllSessions={revokeAllSessions} />,
        admins: role === "OWNER" ? <AdminAccountsPage accounts={adminAccounts} onRefresh={refreshAdminAccounts} onCreate={createAdminAccount} onSetPassword={setAdminAccountPassword} onSetMfa={setAdminAccountMfa} onRevokeSessions={revokeAdminAccountSessions} onRotateRecovery={rotateAdminRecoveryCodes} onUpdate={updateAdminAccount} /> : null
      }} />
    </AppLayout>
  );
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionNotice, setSessionNotice] = useState("");
  const [reauthRequired, setReauthRequired] = useState(false);
  useEffect(() => { void api<Session>("/api/session").then(setSession).catch(() => setSession({ authenticated: false, account: null, role: null, bootstrapRequired: false })); }, []);
  useEffect(() => {
    const handleExpiredSession = () => {
      setSessionNotice("Vaše přihlašovací relace skončila nebo byla odhlášena. Po přihlášení můžete bezpečně pokračovat ve stejné operaci.");
      setSession({ authenticated: false, account: null, role: null, bootstrapRequired: false });
    };
    const handleReauthRequired = () => setReauthRequired(true);
    window.addEventListener(SESSION_EXPIRED_EVENT, handleExpiredSession);
    window.addEventListener(REAUTH_REQUIRED_EVENT, handleReauthRequired);
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, handleExpiredSession);
      window.removeEventListener(REAUTH_REQUIRED_EVENT, handleReauthRequired);
    };
  }, []);
  if (!session) return <main className="loading">Načítám</main>;
  if (session.bootstrapRequired) return <BootstrapPage onComplete={() => setSession({ authenticated: false, account: null, role: null, bootstrapRequired: false })} />;
  if (!session.authenticated || !session.role) return <Login notice={sessionNotice} onLogin={() => { void api<Session>("/api/session").then((next) => { setSessionNotice(""); setSession(next); }); }} />;
  return <><Dashboard accountName={session.account} role={session.role} onLogout={() => { setSessionNotice(""); setSession({ authenticated: false, account: null, role: null, bootstrapRequired: false }); }} />{reauthRequired ? <ReauthModal onClose={() => setReauthRequired(false)} /> : null}</>;
}

createRoot(document.getElementById("root")!).render(<App />);
