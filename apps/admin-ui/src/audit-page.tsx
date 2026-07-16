import React, { useState } from "react";
import { AlertTriangle, CheckCircle2, Download, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Terminal } from "lucide-react";
import { Modal, PageHeader } from "./common.js";
import type { AuditEvent, AuditIntegrity } from "./types.js";
import { formatDate } from "./ui-helpers.js";

export type AuditFilters = {
  eventType: string;
  actorType: string;
  actorId: string;
  objectType: string;
  correlationId: string;
  objectId: string;
  from: string;
  to: string;
};

export function auditQueryParams(filters: AuditFilters): URLSearchParams {
  const search = new URLSearchParams();
  if (filters.eventType && filters.eventType !== "all") search.set("eventType", filters.eventType);
  if (filters.actorType && filters.actorType !== "all") search.set("actorType", filters.actorType);
  if (filters.actorId) search.set("actorId", filters.actorId);
  if (filters.objectType && filters.objectType !== "all") search.set("objectType", filters.objectType);
  if (filters.correlationId) search.set("correlationId", filters.correlationId);
  if (filters.objectId) search.set("objectId", filters.objectId);
  if (filters.from) search.set("from", new Date(filters.from).toISOString());
  if (filters.to) search.set("to", new Date(filters.to).toISOString());
  return search;
}

export function AuditPage({
  events,
  nextCursor,
  integrity,
  onLoadMore,
  onLoadDetail,
  onRefresh,
  onRefreshIntegrity
}: {
  events: AuditEvent[];
  nextCursor: string | null;
  integrity: AuditIntegrity | null;
  onLoadMore: (params: AuditFilters) => Promise<void>;
  onLoadDetail: (id: number) => Promise<AuditEvent>;
  onRefresh: (params: AuditFilters) => Promise<void>;
  onRefreshIntegrity: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [eventType, setEventType] = useState("all");
  const [actorType, setActorType] = useState("all");
  const [actorId, setActorId] = useState("");
  const [objectType, setObjectType] = useState("all");
  const [correlationId, setCorrelationId] = useState("");
  const [objectId, setObjectId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const eventTypes = [...new Set(events.map((event) => event.event_type))];
  const actorTypes = [...new Set(events.map((event) => event.actor_type))];
  const objectTypes = [...new Set(events.map((event) => event.object_type).filter(Boolean))];
  const filtered = events.filter((event) =>
    (eventType === "all" || event.event_type === eventType)
    && (actorType === "all" || event.actor_type === actorType)
    && (!actorId || (event.actor_id ?? "").includes(actorId))
    && (objectType === "all" || event.object_type === objectType)
    && (!correlationId || event.correlation_id.includes(correlationId))
    && (!objectId || (event.object_id ?? "").includes(objectId))
    && `${event.event_type} ${event.actor_type} ${event.object_type} ${event.correlation_id}`.toLowerCase().includes(query.toLowerCase()));
  const filters = { eventType, actorType, actorId, objectType, correlationId, objectId, from, to };
  const exportSearch = auditQueryParams(filters);
  async function runAction(key: string, action: () => Promise<void>, success: string) {
    setBusyAction(key);
    setNotice(null);
    try {
      await action();
      setNotice({ kind: "success", text: success });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Operace auditu selhala." });
    } finally {
      setBusyAction(null);
    }
  }
  async function showDetail(id: number) {
    await runAction(`detail:${id}`, async () => setSelectedEvent(await onLoadDetail(id)), "Detail auditní události byl načten.");
  }
  return (
    <>
      <PageHeader title="Audit" description="Záznam systémových, tokenových a bezpečnostních událostí.">
        <label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hledat v auditu..." aria-label="Hledat v auditu" /></label>
        <button className="secondary" disabled={busyAction !== null} onClick={() => { void runAction("refresh", () => onRefresh(filters), "Auditní události byly obnoveny."); }}><RefreshCw size={16} /> Obnovit</button>
        <button className="secondary" disabled={busyAction !== null} onClick={() => { void runAction("integrity", onRefreshIntegrity, "Kontrola integrity auditu byla dokončena."); }}><ShieldCheck size={16} /> Ověřit integritu</button>
        <button className="secondary" onClick={() => { window.location.href = `/api/audit/export${exportSearch.size ? `?${exportSearch.toString()}` : ""}`; }}><Download size={16} /> Export</button>
        <button className="secondary" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((current) => !current)}><SlidersHorizontal size={16} /> Filtry</button>
      </PageHeader>
      {notice ? <div className={`notice ${notice.kind}`}>{notice.kind === "success" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}<span>{notice.text}</span></div> : null}
      {integrity ? <div className={`notice ${integrity.valid ? "success" : "error"}`}><span><strong>{integrity.valid ? "Hash-chain auditu je v pořádku" : "Integrita auditu je porušená"}</strong><br />Událostí: {integrity.eventCount}. Poslední ID: {integrity.latestEventId ?? "-"}. {integrity.brokenEventId ? `První chybná událost: ${integrity.brokenEventId}.` : "Řetězec je souvislý."}</span></div> : null}
      {filtersOpen ? <section className="filter-bar"><label>Typ události<select value={eventType} onChange={(event) => setEventType(event.target.value)}><option value="all">Všechny události</option>{eventTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label><label>Typ aktéra<select value={actorType} onChange={(event) => setActorType(event.target.value)}><option value="all">Všichni aktéři</option>{actorTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label><label>ID aktéra<input value={actorId} onChange={(event) => setActorId(event.target.value)} placeholder="actor_id" /></label><label>Typ objektu<select value={objectType} onChange={(event) => setObjectType(event.target.value)}><option value="all">Všechny objekty</option>{objectTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label><label>Correlation ID<input value={correlationId} onChange={(event) => setCorrelationId(event.target.value)} placeholder="Correlation ID" /></label><label>ID objektu<input value={objectId} onChange={(event) => setObjectId(event.target.value)} placeholder="object_id" /></label><label>Od<input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>Do<input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} /></label><button className="secondary" disabled={busyAction !== null} onClick={() => { setQuery(""); setEventType("all"); setActorType("all"); setActorId(""); setObjectType("all"); setCorrelationId(""); setObjectId(""); setFrom(""); setTo(""); }}>Vymazat filtry</button><button className="secondary" disabled={busyAction !== null} onClick={() => { void runAction("filters", () => onRefresh(filters), "Filtry auditu byly použity."); }}>Použít</button></section> : null}
      <section className="panel table-panel">
        <table><thead><tr><th>Čas</th><th>Uživatel</th><th>Akce</th><th>Objekt</th><th>Correlation ID</th><th>Detail</th></tr></thead>
          <tbody>{filtered.map((event) => <tr key={event.id}><td>{formatDate(event.created_at)}</td><td>{event.actor_type}</td><td><span className="badge neutral">{event.event_type}</span></td><td>{event.object_type ?? ""}</td><td><code>{event.correlation_id}</code></td><td><button className="secondary" disabled={busyAction !== null} onClick={() => { void showDetail(event.id); }}>{busyAction === `detail:${event.id}` ? "Načítám..." : "Zobrazit"}</button></td></tr>)}</tbody></table>
        {nextCursor ? <div className="modal-actions"><button className="secondary" disabled={busyAction !== null} onClick={() => { void runAction("more", () => onLoadMore(filters), "Další auditní události byly načteny."); }}>{busyAction === "more" ? "Načítám..." : "Načíst další"}</button></div> : null}
        {filtered.length === 0 ? <div className="empty-state"><Terminal size={34} /><strong>Žádné auditní události k zobrazení</strong></div> : null}
      </section>
      {selectedEvent ? <Modal title="Detail auditní události" onClose={() => setSelectedEvent(null)}><div className="server-detail"><dl><dt>Čas</dt><dd>{formatDate(selectedEvent.created_at)}</dd><dt>Uživatel</dt><dd>{selectedEvent.actor_type}{selectedEvent.actor_id ? ` · ${selectedEvent.actor_id}` : ""}</dd><dt>Akce</dt><dd>{selectedEvent.event_type}</dd><dt>Objekt</dt><dd>{selectedEvent.object_type ?? "-"} · {selectedEvent.object_id ?? "-"}</dd><dt>Correlation ID</dt><dd><code>{selectedEvent.correlation_id}</code></dd><dt>Pořadí v řetězci</dt><dd>{selectedEvent.chain.sequence ?? "-"}</dd><dt>Předchozí hash</dt><dd><code>{selectedEvent.chain.previousHash ?? "-"}</code></dd><dt>Hash události</dt><dd><code>{selectedEvent.chain.eventHash ?? "-"}</code></dd></dl><details><summary>Before</summary><pre className="test-output">{JSON.stringify(selectedEvent.before_json ?? null, null, 2)}</pre></details><details><summary>After</summary><pre className="test-output">{JSON.stringify(selectedEvent.after_json ?? null, null, 2)}</pre></details></div></Modal> : null}
    </>
  );
}
