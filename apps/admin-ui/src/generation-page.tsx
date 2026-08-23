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
  authorityKind: "OWNER_APPROVED" | "INHERITED_TECHNICAL" | null;
  authoritySourceJobId: string | null;
  authoritySourceSpecRevisionId: string | null;
  authoritySpecDigest: string | null;
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
  eventCursor: number;
};
type DiscussionMessage = { id: string; sequence: number; role: string; status: string; content: string; createdAt: string };
type SpecRevision = { id: string; revision: number; digest: string; spec: { objective: string; resultSummary: string; behavioralRequirements: string[]; openQuestions: string[]; capabilityDecisions?: Array<{ requirementDigest: string; decision: string; reuse: Array<{ componentId: string; revisionId: string; toolContractId: string; contractDigest: string }>; reusableBehavior: string[]; missingDelta: string[]; permissionDelta: string[] }> }; renderedMarkdown?: string; createdAt: string };
type DiscussionSseEnvelope = { eventId: number | null; type: string; jobId: string; emittedAt: string; payload: Record<string, unknown> };

const TERMINAL = new Set(["COMPLETED", "FAILED", "BLOCKED", "CANCELLED"]);

export function reduceDiscussionEvent(messages: DiscussionMessage[], event: DiscussionSseEnvelope): { messages: DiscussionMessage[]; refreshSpec: boolean } {
  const payload = event.payload;
  const messageId = typeof payload.messageId === "string" ? payload.messageId : null;
  const index = messageId ? messages.findIndex((message) => message.id === messageId) : -1;
  const next = [...messages];
  if (event.type === "discussion.message.created" && messageId && index < 0) {
    next.push({
      id: messageId,
      sequence: typeof payload.sequence === "number" ? payload.sequence : Number.MAX_SAFE_INTEGER,
      role: typeof payload.role === "string" ? payload.role : "ASSISTANT",
      status: "STREAMING",
      content: typeof payload.content === "string" ? payload.content : "",
      createdAt: event.emittedAt
    });
  } else if (event.type === "discussion.message.delta" && messageId) {
    const current: DiscussionMessage = (index >= 0 && next[index]) ? next[index] : { id: messageId, sequence: Number.MAX_SAFE_INTEGER, role: "ASSISTANT", status: "STREAMING", content: "", createdAt: event.emittedAt };
    const delta = typeof payload.delta === "string" ? payload.delta : "";
    const replacement = { ...current, status: "STREAMING", content: `${current.content}${delta}` };
    if (index >= 0) next[index] = replacement; else next.push(replacement);
  } else if (["discussion.message.completed", "discussion.message.interrupted", "discussion.message.failed"].includes(event.type) && messageId) {
    const status = event.type.endsWith("completed") ? "COMPLETED" : event.type.endsWith("interrupted") ? "INTERRUPTED" : "FAILED";
    const current = (index >= 0 ? next[index] : undefined) ?? { id: messageId, sequence: Number.MAX_SAFE_INTEGER, role: "ASSISTANT", status: "STREAMING", content: "", createdAt: event.emittedAt };
    next[index >= 0 ? index : next.length] = { ...current, status, content: typeof payload.content === "string" ? payload.content : current.content };
  }
  return { messages: next.sort((a, b) => a.sequence - b.sequence), refreshSpec: event.type === "spec.revision.created" };
}

function stateTone(state: string): "ok" | "warn" | "danger" | "neutral" {
  if (state === "COMPLETED") return "ok";
  if (["FAILED", "BLOCKED", "CANCELLED"].includes(state)) return "danger";
  if (["DISCUSSING", "ANALYZING", "IMPLEMENTING", "INTEGRATING", "VALIDATING", "CML_CONFORMANCE", "ACTIVATING"].includes(state)) return "warn";
  return "neutral";
}

export function GenerationPage() {
  const [prompt, setPrompt] = useState("");
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [setup, setSetup] = useState<{ openAiReady: boolean; model: string; openAi: { reason: string; secretExists: boolean } } | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [followUpInstruction, setFollowUpInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState<DiscussionMessage[]>([]);
  const [spec, setSpec] = useState<SpecRevision | null>(null);
  const [messageDraft, setMessageDraft] = useState("");
  const [streamStatus, setStreamStatus] = useState("offline");

  const load = useCallback(async () => {
    const [setupResponse, jobsResponse] = await Promise.all([
      api<{ openAiReady: boolean; model: string; openAi: { reason: string; secretExists: boolean } }>("/api/generation/setup"),
      api<{ jobs: GenerationJob[] }>("/api/generation/jobs")
    ]);
    setSetup(setupResponse);
    setJobs(jobsResponse.jobs);
    setSelectedId((current) => current ?? jobsResponse.jobs[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Generování nelze načíst"));
  }, [load]);

  const selected = jobs.find((job) => job.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId) return;
    let disposed = false;
    let stream: EventSource | null = null;
    const cursor = { value: selected?.eventCursor ?? 0 };
    const loadWorkspace = async (): Promise<number> => {
      const [messageResponse, specResponse, jobResponse] = await Promise.all([
        api<{ messages: DiscussionMessage[] }>(`/api/generation/jobs/${selectedId}/messages`),
        api<{ spec: SpecRevision | null }>(`/api/generation/jobs/${selectedId}/spec`),
        api<{ job: GenerationJob }>(`/api/generation/jobs/${selectedId}`)
      ]);
      if (!disposed) {
        setMessages(messageResponse.messages); setSpec(specResponse.spec);
        setJobs((current) => current.some((job) => job.id === jobResponse.job.id) ? current.map((job) => job.id === jobResponse.job.id ? jobResponse.job : job) : current);
      }
      return jobResponse.job.eventCursor;
    };
    const eventTypes = [
      "generation.state.changed", "discussion.turn.queued", "discussion.turn.started", "discussion.turn.interrupt_requested",
      "discussion.turn.interrupted", "discussion.turn.completed", "discussion.turn.failed", "discussion.message.created",
      "discussion.message.delta", "discussion.message.completed", "discussion.message.interrupted", "discussion.message.failed",
      "discussion.tool.started", "discussion.tool.progress", "discussion.tool.completed", "discussion.tool.failed",
      "spec.revision.created", "spec.approved", "generation.blocked", "generation.cancelled", "generation.failed",
      "generation.completed", "generation.resync.required"
    ];
    const refreshJobEvents = new Set(["generation.state.changed", "discussion.turn.completed", "discussion.turn.failed", "spec.approved", "generation.blocked", "generation.cancelled", "generation.failed", "generation.completed"]);
    const handleEvent = (rawEvent: Event) => {
      const event = rawEvent as MessageEvent<string>;
      let envelope: DiscussionSseEnvelope;
      try { envelope = JSON.parse(event.data) as DiscussionSseEnvelope; } catch { return; }
      const eventId = Number(event.lastEventId || envelope.eventId || 0);
      if (eventId > 0 && eventId <= cursor.value) return;
      if (eventId > 0) cursor.value = eventId;
      if (envelope.type === "generation.resync.required") {
        void loadWorkspace().then((snapshotCursor) => { if (snapshotCursor > cursor.value) cursor.value = snapshotCursor; }).catch(() => undefined);
        return;
      }
      setMessages((current) => reduceDiscussionEvent(current, envelope).messages);
      if (envelope.type === "spec.revision.created") {
        void api<{ spec: SpecRevision | null }>(`/api/generation/jobs/${selectedId}/spec`).then((response) => { if (!disposed) setSpec(response.spec); }).catch(() => undefined);
      }
      if (refreshJobEvents.has(envelope.type)) void load().catch(() => undefined);
    };
    const connect = async () => {
      try { cursor.value = await loadWorkspace(); } catch { return; }
      if (disposed || typeof EventSource === "undefined") return;
      stream = new EventSource(`/api/generation/jobs/${selectedId}/events?after=${cursor.value}`);
      setStreamStatus("connecting");
      stream.onopen = () => setStreamStatus("live");
      eventTypes.forEach((eventType) => stream?.addEventListener(eventType, handleEvent));
      stream.onerror = () => setStreamStatus("reconnecting");
    };
    void connect();
    return () => {
      disposed = true;
      eventTypes.forEach((eventType) => stream?.removeEventListener(eventType, handleEvent));
      stream?.close(); setStreamStatus("offline");
    };
  }, [selected?.eventCursor, selectedId, load]);

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

  async function reconcileOpenAiGrant() {
    await mutate(async () => {
      await api("/api/generation/setup/reconcile-openai", { method: "POST", headers: { "x-csrf-token": csrf() }, body: "{}" });
    });
  }

  async function createJob() {
    const value = prompt.trim();
    if (value.length < 3) return;
    await mutate(async () => {
      const response = await api<{ job: GenerationJob }>("/api/generation/jobs", { method: "POST", headers: { "x-csrf-token": csrf() }, body: JSON.stringify({ prompt: value, clientRequestId: crypto.randomUUID() }) });
      setPrompt(""); setSelectedId(response.job.id);
    });
  }

  async function sendMessage() {
    if (!selected || messageDraft.trim().length < 1) return;
    await mutate(async () => {
      await api(`/api/generation/jobs/${selected.id}/messages`, { method: "POST", headers: { "x-csrf-token": csrf() }, body: JSON.stringify({ content: messageDraft.trim(), idempotencyKey: crypto.randomUUID() }) });
      setMessageDraft("");
    });
  }

  async function approveSpec() {
    if (!selected || !spec) return;
    await mutate(async () => { await api(`/api/generation/jobs/${selected.id}/approve-spec`, { method: "POST", headers: { "x-csrf-token": csrf() }, body: JSON.stringify({ revisionId: spec.id, digest: spec.digest }) }); });
  }

  async function submitInputs() {
    if (!selected) return;
    await mutate(async () => {
      await api(`/api/generation/jobs/${selected.id}/inputs`, { method: "POST", headers: { "x-csrf-token": csrf() }, body: JSON.stringify({ values: inputs }) });
      setInputs({});
    });
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
      <div className="panel-head"><div><h2>Co mám vytvořit?</h2><p>Technickou architekturu, identity, runtime, testy a CML začlenění řeší interní generation pipeline.</p></div>{setup ? <span className={`badge ${setup.openAiReady ? "ok" : "warn"}`}>{setup.openAiReady ? `OpenAI · ${setup.model}` : setup.openAi.secretExists ? "OpenAI credential vyžaduje opravu přístupu" : "OpenAI API key chybí"}</span> : null}</div>
      {!setup?.openAiReady && setup?.openAi.reason === "PLATFORM_GRANT_MISSING" ? <div className="generation-key-row"><KeyRound size={18} /><span>Existující kanonický OpenAI credential je uložený. Obnoví se pouze jeho platformní grant; žádný nový klíč se nevytváří ani nerotuje.</span><button disabled={busy} onClick={() => { void reconcileOpenAiGrant(); }}>Obnovit přístup existujícího credentialu</button></div> : null}
      {!setup?.openAiReady && setup?.openAi.reason === "MISSING" ? <div className="generation-key-row"><KeyRound size={18} /><input type="text" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="OpenAI API key" aria-label="OpenAI API key" /><button disabled={busy || apiKey.length < 20} onClick={() => { void saveApiKey(); }}>Uložit do Secret Manageru</button></div> : null}
      {!setup?.openAiReady && setup?.openAi.secretExists && setup?.openAi.reason !== "PLATFORM_GRANT_MISSING" ? <div className="notice error"><KeyRound size={18} /> Existující kanonický OpenAI credential není připraven ({setup.openAi.reason}). Spravujte jeho stav v Secret Manageru; tato stránka nevytváří ani nerotuje nový klíč.</div> : null}
      <textarea rows={5} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Např. vytvoř MCP schopnost, která…" aria-label="Zadání generování" />
      <div className="generation-actions"><button disabled={busy || !setup?.openAiReady || prompt.trim().length < 3} onClick={() => { void createJob(); }}><Sparkles size={17} /> {busy ? "Pracuji…" : "Začít persistentní diskusi"}</button></div>
    </section>
    <section className="generation-grid">
      <article className="panel generation-jobs"><div className="panel-head"><h2>Generation joby</h2><span className="panel-count">{jobs.length}</span></div>{jobs.length ? <div className="job-cards">{jobs.map((job) => <button key={job.id} className={job.id === selectedId ? "selected" : ""} onClick={() => setSelectedId(job.id)}><span className={`status-dot ${stateTone(job.state)}`} /><span><strong>{job.plan?.resultSummary ?? job.originalPrompt}</strong><small>{job.state} · {formatDate(job.updatedAt)}</small></span></button>)}</div> : <div className="empty-state"><Sparkles size={32} /><strong>Zatím žádné generování</strong></div>}</article>
      <article className="panel generation-detail"><div className="panel-head"><div><h2>{selected?.plan?.resultSummary ?? "Detail jobu"}</h2>{selected ? <p>{selected.originalPrompt}</p> : null}</div>{selected ? <span className={`badge ${stateTone(selected.state)}`}>{selected.state}</span> : null}</div>
        {!selected ? <div className="empty-state"><Sparkles size={32} /><strong>Vyberte job</strong></div> : <>
          {selected.parentJobId ? <div className="notice"><RefreshCw size={17} /> Navazující běh #{selected.runSequence}; původní job zůstává neměnnou auditní evidencí.</div> : null}
          {selected.blockerSummary ? <div className="notice error"><AlertTriangle size={17} /> {selected.blockerSummary}</div> : null}
          <section className="generation-workspace" aria-label="Persistentní diskuse">
            <div className="panel-head"><div><h3>OWNER ↔ AI diskuse</h3><p>Historie je uložená serverově; stream: {streamStatus}.</p></div><div className="generation-badges">{selected.authorityKind ? <span className="badge ok">Autorita: {selected.authorityKind}</span> : null}{spec ? <span className="badge neutral">Spec v{spec.revision} · {spec.digest.slice(0, 18)}…</span> : null}</div></div>
            <div className="generation-messages">{messages.map((message) => <article key={message.id} className={`generation-message ${message.role.toLowerCase()}`}><strong>{message.role}</strong><p>{message.content}</p><small>{formatDate(message.createdAt)}</small></article>)}</div>
            {selected.state === "DISCUSSING" ? <div className="generation-composer"><textarea rows={3} value={messageDraft} onChange={(event) => setMessageDraft(event.target.value)} placeholder="Doplňte cíl, omezení nebo rozhodnutí…" aria-label="Zpráva do diskuse" /><button disabled={busy || !messageDraft.trim()} onClick={() => { void sendMessage(); }}><Sparkles size={16} /> Odeslat do diskuse</button></div> : null}
            {spec ? <div className="generation-spec"><h4>Aktuální GenerationSpecification</h4><p>{spec.spec.objective}</p><small>{spec.spec.resultSummary}</small>{spec.spec.openQuestions.length ? <p><strong>Otevřené otázky:</strong> {spec.spec.openQuestions.join(" · ")}</p> : null}{spec.spec.capabilityDecisions?.length ? <div className="generation-capability-decisions"><strong>Capability-first rozhodnutí</strong>{spec.spec.capabilityDecisions.map((decision, index) => <article key={`${decision.requirementDigest}-${index}`}><span className="badge neutral">{decision.decision}</span>{decision.reuse.length ? <small>Reuse: {decision.reuse.map((reference) => reference.componentId).join(", ")}</small> : null}{decision.reusableBehavior.length ? <small>Pokryto: {decision.reusableBehavior.join(" · ")}</small> : null}{decision.missingDelta.length ? <small>Chybějící delta: {decision.missingDelta.join(" · ")}</small> : null}{decision.permissionDelta.length ? <small>Permission delta: {decision.permissionDelta.join(" · ")}</small> : null}</article>)}</div> : null}<button disabled={busy || selected.state !== "DISCUSSING" || spec.spec.openQuestions.length > 0} onClick={() => { void approveSpec(); }}><CheckCircle2 size={16} /> Schválit tuto revizi a realizovat</button></div> : null}
          </section>
          {selected.plan ? <section className="generation-plan"><h3>Návrh</h3><p>{selected.plan.understoodIntent}</p><div className="generation-elements">{selected.plan.elements.map((element) => <article key={element.key}><strong>{element.displayName}</strong><span className="badge neutral">{element.kind}</span><p>{element.businessPurpose}</p><small>{element.responsibilities.join(" · ")}</small></article>)}</div>{selected.plan.dependencies.length ? <p><strong>Vazby:</strong> {selected.plan.dependencies.map((dependency) => `${dependency.from} → ${dependency.to}: ${dependency.purpose}`).join("; ")}</p> : null}</section> : <div className="generation-running"><LoaderCircle className="spin" size={20} /> KajovoCML připravuje technický návrh…</div>}
          {selected.state === "BLOCKED" && selected.inputs.some((input) => !input.supplied) ? <section className="generation-inputs"><h3>Potřebuji doplnit</h3><p>Požadovány jsou pouze informace, které KajovoCML nemůže zjistit samo. Pole jsou v tomto zabezpečeném prostoru zobrazená jako běžný text; citlivé hodnoty se po odeslání ukládají pouze do Secret Manageru.</p>{selected.inputs.filter((input) => !input.supplied).map((input) => <label key={input.key}>{input.label}<small>{input.description}</small><input type="text" value={inputs[input.key] ?? ""} onChange={(event) => setInputs((current) => ({ ...current, [input.key]: event.target.value }))} /></label>)}<button disabled={busy} onClick={() => { void submitInputs(); }}>Uložit vstupy</button></section> : null}
          {selected.components.length ? <section><h3>Vytvořené prvky</h3><div className="generation-elements">{selected.components.map((component) => <article key={component.componentId}><strong>{component.displayName}</strong><span className="badge ok">{component.code}</span><p>{component.hostname}</p></article>)}</div></section> : null}
          {selected.events.length ? <section><h3>Průběh</h3><div className="generation-events">{[...selected.events].reverse().map((event) => <article key={event.id}><CheckCircle2 size={15} /><span><strong>{event.message}</strong><small>{event.phase} · {formatDate(event.createdAt)}</small></span>{Object.keys(event.details).length ? <details><summary>Evidence</summary><pre>{prettyJson(event.details)}</pre></details> : null}</article>)}</div></section> : null}
          {["FAILED", "BLOCKED", "CANCELLED"].includes(selected.state) ? <section className="generation-inputs"><h3>Další běh</h3><p>Popište konkrétní opravu nebo doplnění. Vznikne nový auditovatelný job navázaný na tento běh; existující CML identita se zachová.</p><textarea rows={3} value={followUpInstruction} onChange={(event) => setFollowUpInstruction(event.target.value)} placeholder="Např. oprav manifest: přesuň metody a autentizaci z runtime egress grant do outboundPolicies." /><button disabled={busy || followUpInstruction.trim().length < 3} onClick={() => { void createFollowUp(); }}><Play size={17} /> Spustit další běh</button></section> : null}
          {!TERMINAL.has(selected.state) ? <div className="generation-actions"><button className="secondary" disabled={busy} onClick={() => { void cancelJob(); }}><Square size={15} /> Zrušit job</button></div> : null}
        </>}
      </article>
    </section>
  </>;
}
