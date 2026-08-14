import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, KeyRound, LoaderCircle, Play, RefreshCw, Sparkles, Square } from "lucide-react";
import { PageHeader } from "./common.js";
import { api, csrf, formatDate, prettyJson } from "./ui-helpers.js";

type GenerationInput = {
  id: string;
  key: string;
  label: string;
  description: string;
  kind: string;
  required: boolean;
  secret: boolean;
  stableSecretName: string | null;
  grantElementKeys: string[];
  supplied: boolean;
};

type GenerationElement = {
  key: string;
  kind: "MCP_SERVER" | "AI_AGENT";
  displayName: string;
  businessPurpose: string;
  responsibilities: string[];
};

type GenerationJob = {
  id: string;
  jobKind: "CREATE" | "REPAIR" | "RETRY";
  parentJobId: string | null;
  runSequence: number;
  operatorPrompt: string | null;
  originalPrompt: string;
  state: string;
  plan: null | {
    understoodIntent: string;
    resultSummary: string;
    elements: GenerationElement[];
    dependencies: Array<{ from: string; to: string; purpose: string }>;
    missingInputs: unknown[];
  };
  inputs: GenerationInput[];
  events: Array<{ id: number; phase: string; eventType: string; message: string; details: Record<string, unknown>; createdAt: string }>;
  components: Array<{ componentId: string; code: string; hostname: string; displayName: string; elementKind: string }>;
  resultSummary: Record<string, unknown> | null;
  blockerSummary: string | null;
  remediationAttempts: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

const TERMINAL = new Set(["COMPLETED", "FAILED", "BLOCKED", "CANCELLED"]);

function stateTone(state: string): "ok" | "warn" | "danger" | "neutral" {
  if (state === "COMPLETED") return "ok";
  if (["FAILED", "BLOCKED", "CANCELLED"].includes(state)) return "danger";
  if (["NEEDS_INPUT", "PLAN_READY"].includes(state)) return "warn";
  return "neutral";
}

export function GenerationPage() {
  const [prompt, setPrompt] = useState("");
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [setup, setSetup] = useState<{ openAiReady: boolean; model: string } | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [followUpInstruction, setFollowUpInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [setupResponse, jobsResponse] = await Promise.all([
      api<{ openAiReady: boolean; model: string }>("/api/generation/setup"),
      api<{ jobs: GenerationJob[] }>("/api/generation/jobs")
    ]);
    setSetup(setupResponse);
    setJobs(jobsResponse.jobs);
    setSelectedId((current) => current ?? jobsResponse.jobs[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Generování nelze načíst"));
  }, [load]);

  useEffect(() => {
    const active = jobs.some((job) => !TERMINAL.has(job.state) && job.state !== "PLAN_READY" && job.state !== "NEEDS_INPUT");
    if (!active) return;
    const timer = window.setInterval(() => { void load().catch(() => undefined); }, 3000);
    return () => window.clearInterval(timer);
  }, [jobs, load]);

  const selected = jobs.find((job) => job.id === selectedId) ?? null;

  async function mutate(task: () => Promise<void>) {
    setBusy(true); setError("");
    try { await task(); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Operace generování selhala"); }
    finally { setBusy(false); }
  }

  async function saveApiKey() {
    await mutate(async () => {
      await api("/api/generation/setup/openai-key", { method: "PUT", headers: { "x-csrf-token": csrf() }, body: JSON.stringify({ value: apiKey }) });
      setApiKey("");
    });
  }

  async function createJob() {
    const value = prompt.trim();
    if (value.length < 3) return;
    await mutate(async () => {
      const response = await api<{ job: GenerationJob }>("/api/generation/jobs", { method: "POST", headers: { "x-csrf-token": csrf() }, body: JSON.stringify({ prompt: value }) });
      setPrompt(""); setSelectedId(response.job.id);
    });
  }

  async function submitInputs() {
    if (!selected) return;
    await mutate(async () => {
      await api(`/api/generation/jobs/${selected.id}/inputs`, { method: "POST", headers: { "x-csrf-token": csrf() }, body: JSON.stringify({ values: inputs }) });
      setInputs({});
    });
  }

  async function confirmPlan() {
    if (!selected) return;
    await mutate(async () => { await api(`/api/generation/jobs/${selected.id}/confirm`, { method: "POST", headers: { "x-csrf-token": csrf() }, body: "{}" }); });
  }

  async function cancelJob() {
    if (!selected) return;
    await mutate(async () => { await api(`/api/generation/jobs/${selected.id}/cancel`, { method: "POST", headers: { "x-csrf-token": csrf() }, body: "{}" }); });
  }

  async function createFollowUp() {
    if (!selected || followUpInstruction.trim().length < 3) return;
    await mutate(async () => {
      const response = await api<{ job: GenerationJob }>(`/api/generation/jobs/${selected.id}/runs`, { method: "POST", headers: { "x-csrf-token": csrf() }, body: JSON.stringify({ instruction: followUpInstruction.trim() }) });
      setFollowUpInstruction(""); setSelectedId(response.job.id);
    });
  }

  return <>
    <PageHeader title="Generování" description="Popište výsledek lidsky. KajovoCML navrhne, vytvoří, ověří a začlení nové MCP schopnosti nebo AI agenty do CML standardu.">
      <button className="secondary" onClick={() => { void load(); }} disabled={busy}><RefreshCw size={17} /> Obnovit</button>
    </PageHeader>
    {error ? <div className="notice error"><AlertTriangle size={18} /> {error}</div> : null}
    <section className="panel generation-create-panel">
      <div className="panel-head"><div><h2>Co mám vytvořit?</h2><p>Technickou architekturu, identity, runtime, testy a CML začlenění řeší interní generation pipeline.</p></div>{setup ? <span className={`badge ${setup.openAiReady ? "ok" : "warn"}`}>{setup.openAiReady ? `OpenAI · ${setup.model}` : "OpenAI API key chybí"}</span> : null}</div>
      {!setup?.openAiReady ? <div className="generation-key-row"><KeyRound size={18} /><input type="text" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="OpenAI API key" aria-label="OpenAI API key" /><button disabled={busy || apiKey.length < 20} onClick={() => { void saveApiKey(); }}>Uložit do Secret Manageru</button></div> : null}
      <textarea rows={5} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Např. vytvoř MCP schopnost, která…" aria-label="Zadání generování" />
      <div className="generation-actions"><button disabled={busy || !setup?.openAiReady || prompt.trim().length < 3} onClick={() => { void createJob(); }}><Sparkles size={17} /> {busy ? "Pracuji…" : "Navrhnout řešení"}</button></div>
    </section>
    <section className="generation-grid">
      <article className="panel generation-jobs"><div className="panel-head"><h2>Generation joby</h2><span className="panel-count">{jobs.length}</span></div>{jobs.length ? <div className="job-cards">{jobs.map((job) => <button key={job.id} className={job.id === selectedId ? "selected" : ""} onClick={() => setSelectedId(job.id)}><span className={`status-dot ${stateTone(job.state)}`} /><span><strong>{job.plan?.resultSummary ?? job.originalPrompt}</strong><small>{job.state} · {formatDate(job.updatedAt)}</small></span></button>)}</div> : <div className="empty-state"><Sparkles size={32} /><strong>Zatím žádné generování</strong></div>}</article>
      <article className="panel generation-detail"><div className="panel-head"><div><h2>{selected?.plan?.resultSummary ?? "Detail jobu"}</h2>{selected ? <p>{selected.originalPrompt}</p> : null}</div>{selected ? <span className={`badge ${stateTone(selected.state)}`}>{selected.state}</span> : null}</div>
        {!selected ? <div className="empty-state"><Sparkles size={32} /><strong>Vyberte job</strong></div> : <>
          {selected.parentJobId ? <div className="notice"><RefreshCw size={17} /> Navazující běh #{selected.runSequence}; původní job zůstává neměnnou auditní evidencí.</div> : null}
          {selected.blockerSummary ? <div className="notice error"><AlertTriangle size={17} /> {selected.blockerSummary}</div> : null}
          {selected.plan ? <section className="generation-plan"><h3>Návrh</h3><p>{selected.plan.understoodIntent}</p><div className="generation-elements">{selected.plan.elements.map((element) => <article key={element.key}><strong>{element.displayName}</strong><span className="badge neutral">{element.kind}</span><p>{element.businessPurpose}</p><small>{element.responsibilities.join(" · ")}</small></article>)}</div>{selected.plan.dependencies.length ? <p><strong>Vazby:</strong> {selected.plan.dependencies.map((dependency) => `${dependency.from} → ${dependency.to}: ${dependency.purpose}`).join("; ")}</p> : null}</section> : <div className="generation-running"><LoaderCircle className="spin" size={20} /> KajovoCML připravuje technický návrh…</div>}
          {selected.state === "NEEDS_INPUT" ? <section className="generation-inputs"><h3>Potřebuji doplnit</h3><p>Požadovány jsou pouze informace, které KajovoCML nemůže zjistit samo. Pole jsou v tomto zabezpečeném prostoru zobrazená jako běžný text; citlivé hodnoty se po odeslání ukládají pouze do Secret Manageru.</p>{selected.inputs.filter((input) => !input.supplied).map((input) => <label key={input.key}>{input.label}<small>{input.description}</small><input type="text" value={inputs[input.key] ?? ""} onChange={(event) => setInputs((current) => ({ ...current, [input.key]: event.target.value }))} /></label>)}<button disabled={busy} onClick={() => { void submitInputs(); }}>Uložit vstupy</button></section> : null}
          {selected.state === "PLAN_READY" ? <div className="generation-actions"><button disabled={busy} onClick={() => { void confirmPlan(); }}><Play size={17} /> Potvrdit a vytvořit</button></div> : null}
          {selected.components.length ? <section><h3>Vytvořené prvky</h3><div className="generation-elements">{selected.components.map((component) => <article key={component.componentId}><strong>{component.displayName}</strong><span className="badge ok">{component.code}</span><p>{component.hostname}</p></article>)}</div></section> : null}
          {selected.events.length ? <section><h3>Průběh</h3><div className="generation-events">{[...selected.events].reverse().map((event) => <article key={event.id}><CheckCircle2 size={15} /><span><strong>{event.message}</strong><small>{event.phase} · {formatDate(event.createdAt)}</small></span>{Object.keys(event.details).length ? <details><summary>Evidence</summary><pre>{prettyJson(event.details)}</pre></details> : null}</article>)}</div></section> : null}
          {["FAILED", "BLOCKED", "CANCELLED"].includes(selected.state) ? <section className="generation-inputs"><h3>Další běh</h3><p>Popište konkrétní opravu nebo doplnění. Vznikne nový auditovatelný job navázaný na tento běh; existující CML identita se zachová.</p><textarea rows={3} value={followUpInstruction} onChange={(event) => setFollowUpInstruction(event.target.value)} placeholder="Např. oprav manifest: přesuň metody a autentizaci z runtime egress grant do outboundPolicies." /><button disabled={busy || followUpInstruction.trim().length < 3} onClick={() => { void createFollowUp(); }}><Play size={17} /> Spustit další běh</button></section> : null}
          {!TERMINAL.has(selected.state) ? <div className="generation-actions"><button className="secondary" disabled={busy} onClick={() => { void cancelJob(); }}><Square size={15} /> Zrušit job</button></div> : null}
        </>}
      </article>
    </section>
  </>;
}
