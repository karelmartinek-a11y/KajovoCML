import React, { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Boxes, Download, RefreshCw, Search, Terminal } from "lucide-react";
import { PageHeader } from "./common.js";
import { loadDashboardTopology } from "./server-api.js";
import type { DashboardRuntimeEvent, DashboardTopology, Page } from "./types.js";

function formatDate(value: string | null): string {
  if (!value) return "není k dispozici";
  return new Intl.DateTimeFormat("cs-CZ", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value));
}

export function RegisteredElementsPage({ onOpenPage }: { onOpenPage: (page: Page) => void }) {
  const [topology, setTopology] = useState<DashboardTopology | null>(null);
  const [selectedComponentId, setSelectedComponentId] = useState<string>("");
  const [query, setQuery] = useState("");
  const [resultFilter, setResultFilter] = useState<"ALL" | "SUCCESS" | "FAILED">("ALL");
  const [error, setError] = useState("");
  const refresh = async () => {
    setError("");
    try { setTopology(await loadDashboardTopology()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Přehled prvků se nepodařilo načíst."); }
  };
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    const stream = new EventSource("/api/dashboard/events");
    stream.addEventListener("runtime", (event) => {
      try {
        const runtime = JSON.parse(event.data) as DashboardRuntimeEvent;
        setTopology((current) => current ? { ...current, events: [runtime, ...current.events.filter((item) => item.id !== runtime.id)].slice(0, 500) } : current);
      } catch { /* Nevalidní payload se nezobrazuje. */ }
    });
    return () => stream.close();
  }, []);
  const nodes = useMemo(() => (topology?.nodes ?? []).filter((node) => node.lifecyclePhase === "REGISTERED"), [topology]);
  useEffect(() => {
    if (!selectedComponentId && nodes[0]?.componentId) setSelectedComponentId(nodes[0].componentId);
  }, [nodes, selectedComponentId]);
  const selected = nodes.find((node) => node.componentId === selectedComponentId) ?? null;
  const events = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (topology?.events ?? []).filter((event) => {
      if (selectedComponentId && event.componentId !== selectedComponentId) return false;
      if (resultFilter === "SUCCESS" && !event.success) return false;
      if (resultFilter === "FAILED" && event.success) return false;
      return !normalized || `${event.operationKey} ${event.pulseType ?? ""} ${event.direction ?? ""} ${event.correlationId} ${event.traceId ?? ""}`.toLowerCase().includes(normalized);
    });
  }, [topology, selectedComponentId, resultFilter, query]);
  const exportLog = () => {
    const body = JSON.stringify({ exportedAt: new Date().toISOString(), component: selected?.code ?? null, redacted: true, events }, null, 2);
    const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `kcml-${selected?.code ?? "registered-elements"}-debug-log.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return <div className="registered-elements-page">
    <PageHeader title="Registrované prvky" description="Přesný provozní přehled registrovaných komponent, jejich identit, statistik, Secret grantů a bezpečně redigovaných runtime událostí.">
      <button onClick={() => { void refresh(); }}><RefreshCw size={17} /> Obnovit</button>
      <button onClick={() => onOpenPage("dashboard")}><Boxes size={17} /> Ukázat v Dashboardu</button>
    </PageHeader>
    {error ? <div className="notice error"><AlertTriangle size={18} />{error}</div> : null}
    <section className="registered-elements-grid">
      <aside className="panel registered-elements-list"><h2>Prvky ({nodes.length})</h2>{nodes.map((node) => <button key={node.id} className={selectedComponentId === node.componentId ? "active" : ""} onClick={() => setSelectedComponentId(node.componentId ?? "")}><span className={`status-dot ${node.critical ? "danger" : node.suspended ? "warn" : "ok"}`} /><span><strong>{node.code}</strong><small>{node.displayName}</small></span><span><strong>{node.statistics.callCount}</strong><small>volání / 24 h</small></span></button>)}</aside>
      <div className="registered-elements-detail">
        {selected ? <>
          <section className="panel"><div className="panel-head"><div><span className="eyebrow">Identita a provoz</span><h2>{selected.code} · {selected.displayName}</h2></div><button onClick={() => onOpenPage("components")}>Otevřít úplný detail</button></div><div className="registered-element-metrics"><div><small>Lifecycle</small><strong>{selected.lifecycleState}</strong></div><div><small>Aktivace</small><strong>{selected.activationState}</strong></div><div><small>Provoz</small><strong>{selected.operationalState}</strong></div><div><small>Monitoring</small><strong>{selected.monitoringState}</strong></div><div><small>Chybovost</small><strong>{Math.round(selected.statistics.errorRate * 100)} %</strong></div><div><small>Secrets</small><strong>{selected.secrets.length}</strong></div></div><dl className="dashboard-detail-list"><div><dt>Principal</dt><dd><code>{selected.principalId}</code></dd></div><div><dt>Credential fingerprint</dt><dd><code>{selected.tokenFingerprint ?? "není k dispozici"}</code></dd></div><div><dt>Poslední běh</dt><dd>{formatDate(selected.statistics.lastRunAt)}</dd></div><div><dt>Poslední chyba</dt><dd>{formatDate(selected.statistics.lastFailureAt)}</dd></div></dl></section>
          <section className="panel registered-debug-log"><div className="panel-head"><div><span className="eyebrow">Persistovaný per-prvek log</span><h2><Terminal size={18} /> Debug události</h2></div><button onClick={exportLog}><Download size={16} /> Export redigovaného výřezu</button></div><div className="registered-log-filters"><label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Operace, PULSE, correlation ID…" /></label><label>Výsledek<select value={resultFilter} onChange={(event) => setResultFilter(event.target.value as typeof resultFilter)}><option value="ALL">Všechny</option><option value="SUCCESS">Úspěšné</option><option value="FAILED">Chyby</option></select></label><button onClick={() => onOpenPage("audit")}><Activity size={16} /> Související audit</button></div><div className="dashboard-event-list">{events.length ? events.map((event) => <article key={event.id}><span className={`dashboard-event-result ${event.success ? "ok" : "danger"}`}>{event.success ? "OK" : "ERR"}</span><div><strong>{event.operationKey}</strong><small>{event.direction ?? "směr neuveden"} · {event.pulseType ?? "PULSE typ neuveden"} · {formatDate(event.occurredAt)}</small></div><code>{event.correlationId}</code></article>) : <p>Pro zvolený filtr nejsou dostupné žádné persistované události.</p>}</div></section>
        </> : <div className="panel">Žádný registrovaný prvek není dostupný.</div>}
      </div>
    </section>
  </div>;
}
