import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Play, RefreshCw, ShieldCheck, Square, Wrench } from "lucide-react";
import { PageHeader } from "./common.js";
import { api, csrf, formatDate, prettyJson } from "./ui-helpers.js";

type Automation = {
  id: string;
  code: string;
  stableKey: string;
  displayName: string;
  purpose: string | null;
  status: string;
  activeRevisionId: string | null;
  activeRevision: number | null;
  activeDigest: string | null;
  activeVerificationStatus: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureCode: string | null;
  createdAt: string;
  updatedAt: string;
};

type AutomationDetail = Automation & {
  revision: { id: string; number: number; manifest: Record<string, unknown>; canonicalJson: string; digest: string; status: string; verificationStatus: string; createdAt: string; activatedAt: string | null } | null;
  authBindings: Array<{ stableSecretName: string; mode: string; enabled: boolean }>;
};

type AutomationRun = {
  id: string;
  definitionId: string;
  revisionId: string;
  idempotencyKey: string;
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  errorCode: string | null;
  attempt: number;
  currentStep: number | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  steps: Array<{ index: number; action: string; status: string; errorCode: string | null }>;
};

function statusTone(status: string): "ok" | "warn" | "danger" | "neutral" {
  if (["ENABLED", "SUCCEEDED", "PASS"].includes(status)) return "ok";
  if (["DISABLED", "PENDING", "QUEUED", "RUNNING", "CANCEL_REQUESTED", "PREFLIGHTED"].includes(status)) return "warn";
  if (["FAILED", "DEGRADED", "REPAIR_REQUIRED", "DRIFT", "REAUTH_REQUIRED", "CANCELLED"].includes(status)) return "danger";
  return "neutral";
}

export function BrowserAutomationsPage() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AutomationDetail | null>(null);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [input, setInput] = useState("{}");
  const [bindingName, setBindingName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await api<{ automations: Automation[] }>("/api/browser-automations");
    setAutomations(response.automations);
    setSelectedId((current) => current ?? response.automations[0]?.id ?? null);
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const [detailResponse, runsResponse] = await Promise.all([
      api<{ automation: AutomationDetail }>(`/api/browser-automations/${id}`),
      api<{ runs: AutomationRun[] }>(`/api/browser-automations/${id}/runs`)
    ]);
    setDetail(detailResponse.automation);
    setRuns(runsResponse.runs);
    setAutomations((current) => current.map((entry) => entry.id === id ? { ...entry, ...detailResponse.automation } : entry));
  }, []);

  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Automatizace nelze načíst")); }, [load]);
  useEffect(() => {
    if (!selectedId) { setDetail(null); setRuns([]); return; }
    void loadDetail(selectedId).catch((reason) => setError(reason instanceof Error ? reason.message : "Detail automatizace nelze načíst"));
  }, [loadDetail, selectedId]);

  async function mutate(task: () => Promise<void>) {
    setBusy(true); setError("");
    try { await task(); await load(); if (selectedId) await loadDetail(selectedId); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Operace automatizace selhala"); }
    finally { setBusy(false); }
  }

  async function preflight() {
    if (!selectedId) return;
    await mutate(async () => { await api(`/api/browser-automations/${selectedId}/preflight`, { method: "POST", headers: { "x-csrf-token": csrf() }, body: "{}" }); });
  }

  async function verifyRuntime() {
    if (!selectedId || !detail?.revision) return;
    await mutate(async () => { await api(`/api/browser-automations/${selectedId}/revisions/${detail.revision!.id}/verify`, { method: "POST", headers: { "x-csrf-token": csrf() }, body: JSON.stringify({ input: {} }) }); });
  }

  async function activate() {
    if (!selectedId || !detail?.revision) return;
    await mutate(async () => { await api(`/api/browser-automations/${selectedId}/revisions/${detail.revision!.id}/activate`, { method: "POST", headers: { "x-csrf-token": csrf() }, body: "{}" }); });
  }

  async function toggle(enabled: boolean) {
    if (!selectedId) return;
    await mutate(async () => { await api(`/api/browser-automations/${selectedId}/${enabled ? "enable" : "disable"}`, { method: "POST", headers: { "x-csrf-token": csrf() }, body: "{}" }); });
  }

  async function repair() {
    if (!selectedId) return;
    await mutate(async () => { await api(`/api/browser-automations/${selectedId}/repair`, { method: "POST", headers: { "x-csrf-token": csrf() }, body: "{}" }); });
  }

  async function bindSecret() {
    if (!selectedId || !bindingName.trim()) { setError("Zadejte stable name existujícího Secret Manager secretu."); return; }
    await mutate(async () => {
      await api(`/api/browser-automations/${selectedId}/auth-bindings`, { method: "POST", headers: { "x-csrf-token": csrf() }, body: JSON.stringify({ stableSecretName: bindingName.trim(), mode: "SECRET_MANAGER" }) });
      setBindingName("");
    });
  }

  async function run() {
    if (!selectedId) return;
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(input) as Record<string, unknown>; }
    catch { setError("Vstup běhu musí být validní JSON objekt."); return; }
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") { setError("Vstup běhu musí být JSON objekt."); return; }
    await mutate(async () => { await api(`/api/browser-automations/${selectedId}/run`, { method: "POST", headers: { "x-csrf-token": csrf() }, body: JSON.stringify({ input: parsed, idempotencyKey: crypto.randomUUID() }) }); });
  }

  async function cancel(runId: string) {
    await mutate(async () => { await api(`/api/browser-automation-runs/${runId}/cancel`, { method: "POST", headers: { "x-csrf-token": csrf() }, body: "{}" }); });
  }

  return <>
    <PageHeader title="Browser automatizace" description="Kanonické Playwright automatizace, immutable manifest revize a skutečné asynchronní běhy bez LLM v produkční rutině.">
      <button className="secondary" onClick={() => { void load(); if (selectedId) void loadDetail(selectedId); }} disabled={busy}><RefreshCw size={17} /> Obnovit</button>
    </PageHeader>
    {error ? <div className="notice error"><AlertTriangle size={18} /> {error}</div> : null}
    <div className="automation-layout">
      <section className="panel automation-list-panel">
        <div className="panel-head"><div><h2>Definice automatizací</h2><p>Identity přežívají immutable revize a opravy.</p></div><span className="panel-count">{automations.length}</span></div>
        {automations.length ? <div className="automation-list">{automations.map((automation) => <button key={automation.id} className={automation.id === selectedId ? "selected" : ""} onClick={() => setSelectedId(automation.id)}><span className={`status-dot ${statusTone(automation.status)}`} /><span><strong>{automation.displayName}</strong><small>{automation.code} · {automation.status}</small></span></button>)}</div> : <div className="empty-state"><ShieldCheck size={32} /><strong>Zatím žádná automatizace</strong><span>Nová definice vzniká z approved generation workflow.</span></div>}
      </section>
      <section className="panel automation-detail-panel">
        {!detail ? <div className="empty-state"><ShieldCheck size={32} /><strong>Vyberte automatizaci</strong></div> : <>
          <div className="panel-head"><div><h2>{detail.displayName}</h2><p>{detail.purpose ?? detail.code}</p></div><span className={`badge ${statusTone(detail.status)}`}>{detail.status}</span></div>
          <div className="automation-detail-body">
            <div className="automation-summary"><div><small>Aktivní revision</small><strong>{detail.revision ? `v${detail.revision.number}` : "—"}</strong></div><div><small>Verification</small><strong>{detail.revision?.verificationStatus ?? "—"}</strong></div><div><small>Poslední úspěch</small><strong>{detail.lastSuccessAt ? formatDate(detail.lastSuccessAt) : "—"}</strong></div></div>
            {detail.revision ? <section className="automation-card"><h3>Immutable manifest</h3><p><code>{detail.revision.digest}</code></p><span className={`badge ${statusTone(detail.revision.status)}`}>{detail.revision.status} · {detail.revision.verificationStatus}</span><details><summary>Canonical manifest</summary><pre>{prettyJson(detail.revision.manifest)}</pre></details></section> : <div className="notice">Definice zatím nemá aktivní revision.</div>}
            <section className="automation-card"><h3>Provozní akce</h3><div className="row-actions"><button className="secondary" onClick={() => { void preflight(); }} disabled={busy || !detail.revision}><CheckCircle2 size={16} /> Preflight</button><button className="secondary" onClick={() => { void verifyRuntime(); }} disabled={busy || !detail.revision}><ShieldCheck size={16} /> Ověřit runtime</button>{detail.revision?.verificationStatus === "PASS" && detail.revision.status !== "ACTIVE" ? <button onClick={() => { void activate(); }} disabled={busy}><Play size={16} /> Aktivovat revizi</button> : null}{detail.status === "ENABLED" ? <button className="secondary" onClick={() => { void toggle(false); }} disabled={busy}><Square size={16} /> Vypnout</button> : <button onClick={() => { void toggle(true); }} disabled={busy || !detail.revision}><Play size={16} /> Zapnout</button>}<button className="secondary" onClick={() => { void repair(); }} disabled={busy || !detail.revision}><Wrench size={16} /> Opravit / znovu ověřit</button></div><p className="field-hint">Preflight ověří manifest a digest. Runtime ověření skutečně spustí stejný Playwright interpreter pouze v read-only režimu; aktivace je možná až po PASS.</p></section>
            {detail.status === "ENABLED" ? <section className="automation-card"><h3>Spustit běh</h3><label>Typed input JSON<textarea value={input} onChange={(event) => setInput(event.target.value)} spellCheck={false} aria-label="Vstup automatizace" /></label><button onClick={() => { void run(); }} disabled={busy}><Play size={16} /> Spustit nyní</button></section> : null}
            <section className="automation-card"><h3>Auth bindingy</h3>{detail.authBindings.length ? <ul className="automation-binding-list">{detail.authBindings.map((binding) => <li key={binding.stableSecretName}><code>{binding.stableSecretName}</code><span className={`badge ${binding.enabled ? "ok" : "danger"}`}>{binding.mode} · {binding.enabled ? "enabled" : "disabled"}</span></li>)}</ul> : <p className="field-hint">Bez připojeného credential bindingu.</p>}<div className="automation-binding-form"><label>Existující stable name<input value={bindingName} onChange={(event) => setBindingName(event.target.value.toUpperCase())} placeholder="PROVIDER_SECRET" autoComplete="off" /></label><button className="secondary" onClick={() => { void bindSecret(); }} disabled={busy || !bindingName.trim()}>Připojit secret</button></div><p className="field-hint">Hodnota se nevkládá do této stránky; runtime ji řeší přes Secret Manager a platform principal.</p></section>
            <section className="automation-card"><div className="panel-head"><h3>Historie běhů</h3><span className="panel-count">{runs.length}</span></div>{runs.length ? <div className="table-scroll"><table><thead><tr><th>Stav</th><th>Run</th><th>Pokus</th><th>Vytvořeno</th><th>Akce</th></tr></thead><tbody>{runs.map((run) => <tr key={run.id}><td><span className={`badge ${statusTone(run.status)}`}>{run.status}</span></td><td><code>{run.id.slice(0, 12)}…</code>{run.errorCode ? <small className="cell-subtitle">{run.errorCode}</small> : null}</td><td>{run.attempt}</td><td>{formatDate(run.createdAt)}</td><td>{["QUEUED", "RUNNING", "CANCEL_REQUESTED"].includes(run.status) ? <button className="small-button" onClick={() => { void cancel(run.id); }} disabled={busy}>Zrušit</button> : <small>{run.completedAt ? formatDate(run.completedAt) : "—"}</small>}</td></tr>)}</tbody></table></div> : <p className="field-hint">Žádné běhy.</p>}</section>
          </div>
        </>}
      </section>
    </div>
  </>;
}
