import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  CircleHelp,
  Eye,
  EyeOff,
  Focus,
  KeyRound,
  Link2,
  Link2Off,
  List,
  Lock,
  LockKeyhole,
  Maximize2,
  Minus,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  Unplug,
  XCircle,
  Zap
} from "lucide-react";
import { PageHeader } from "./common.js";
import {
  auditDashboardSecretRevealEvent,
  bulkGrantDashboardSecret,
  createDashboardConnection,
  createDashboardSecretRevealGrant,
  deregisterDashboardNode,
  disconnectDashboardConnection,
  grantDashboardSecret,
  loadDashboardTopology,
  loadDashboardDeregistrationPreview,
  previewBulkDashboardSecret,
  previewDashboardConnection,
  revealDashboardSecret,
  revokeDashboardSecret,
  runDashboardComponentE2E,
  runDashboardComponentHeartbeatChallenge,
  runDashboardComponentStateQuery,
  saveDashboardLayout,
  setDashboardComponentEnabled,
  setDashboardComponentLifecycle,
  setDashboardConnectionAuthorization,
  setDashboardNodeSuspension
} from "./server-api.js";
import type {
  DashboardConnection,
  DashboardDeregistrationPreview,
  DashboardNode,
  DashboardPort,
  DashboardRuntimeEvent,
  DashboardSecret,
  DashboardTopology,
  ReleaseInfo
} from "./types.js";

type ConnectionPreview = {
  preview: {
    compatibility: {
      status: string;
      checks: Array<{ field: string; result: string; reason: string }>;
    };
    source: DashboardPort;
    target: DashboardPort;
  };
};

type RuntimeMotion = {
  event: DashboardRuntimeEvent;
  phase: "travelling" | "success" | "failure";
  expiresAt: number;
};

type RevealState = {
  secret: DashboardSecret;
  password: string;
  totp: string;
  loading: boolean;
  error: string;
  value: string | null;
  revealGrantId: string | null;
  expiresAt: string | null;
};

const NODE_WIDTH = 294;
const NODE_HEADER_HEIGHT = 92;
type CanvasPoint = { x: number; y: number };

function formatDate(value: string | null): string {
  if (!value) return "není k dispozici";
  return new Intl.DateTimeFormat("cs-CZ", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value));
}

function compatibilityLabel(status: DashboardConnection["compatibilityStatus"]): string {
  if (status === "EXACT_MATCH") return "Kompatibilní";
  if (status === "COMPATIBLE_WITH_DIFFERENCES") return "Kompatibilní s rozdíly";
  if (status === "INCOMPATIBLE") return "Nekompatibilní";
  if (status === "STALE") return "Vyžaduje přepočet";
  return "Neověřeno";
}

function compatibilityClass(status: DashboardConnection["compatibilityStatus"]): string {
  if (status === "EXACT_MATCH" || status === "COMPATIBLE_WITH_DIFFERENCES") return "compatible";
  if (status === "INCOMPATIBLE") return "incompatible";
  return "unknown";
}

function authorizationLabel(edge: DashboardConnection): string {
  if (edge.effectiveAuthorization === "GRANTED") return "Oprávnění účinné";
  if (edge.authorizationReason === "IDENTITY_SUSPENDED") return "Identita suspendována";
  if (edge.authorizationReason === "EDGE_PERMISSION_REVOKED") return "Oprávnění odebráno";
  return "Oprávnění neúčinné";
}

function nodeStatusClass(node: DashboardNode): string {
  if (node.critical) return "critical";
  if (node.suspended) return "suspended";
  if (node.lifecyclePhase === "PRE_REGISTRATION") return "preregistration";
  if (node.operationalState === "HEALTHY") return "healthy";
  return "neutral";
}

function portHelp(port: DashboardPort): string {
  return `${port.direction === "OUTGOING" ? "Odchozí konektor" : "Příchozí zásuvka"}. PULSE ${port.pulseType}. Cesty: ${port.routes.join(", ") || "neuvedeny"}. Rozsahy oprávnění: ${port.scopes.join(", ") || "neuvedeny"}.`;
}

function portCompatibilityClass(port: DashboardPort, edges: DashboardConnection[]): string {
  const statuses = edges.filter((edge) => port.direction === "OUTGOING"
    ? edge.sourceComponentId === port.componentId && edge.sourcePortKey === port.key
    : edge.targetComponentId === port.componentId && edge.targetPortKey === port.key).map((edge) => edge.compatibilityStatus);
  if (!statuses.length) return "unconnected";
  if (statuses.includes("INCOMPATIBLE")) return "incompatible";
  if (statuses.some((status) => status === "UNKNOWN" || status === "STALE")) return "unknown";
  return "compatible";
}

function externalPortHelp(port: DashboardPort): string | null {
  const sources = port.source.externalSources;
  if (!sources?.length) return null;
  return `Externí vstup: ${sources.map((source) => source.publicId).join(", ")}.`;
}

function edgePath(source: DashboardNode, target: DashboardNode, sourceAnchor?: CanvasPoint, targetAnchor?: CanvasPoint): string {
  const sx = sourceAnchor?.x ?? source.position.x + NODE_WIDTH;
  const sy = sourceAnchor?.y ?? source.position.y + NODE_HEADER_HEIGHT;
  const tx = targetAnchor?.x ?? target.position.x;
  const ty = targetAnchor?.y ?? target.position.y + NODE_HEADER_HEIGHT;
  const bend = Math.max(90, Math.abs(tx - sx) * 0.45);
  return `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`;
}

function RevealedSecretModal({ state, onChange, onClose }: {
  state: RevealState;
  onChange: (next: RevealState) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!state.value || !state.expiresAt) return;
    const delay = Math.max(0, new Date(state.expiresAt).getTime() - Date.now());
    const timer = window.setTimeout(() => {
      void auditDashboardSecretRevealEvent(state.secret.id, "expired", state.revealGrantId).catch(() => undefined);
      onChange({ ...state, value: null, revealGrantId: null, expiresAt: null });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [state, onChange]);

  useEffect(() => {
    const hide = () => {
      if (document.visibilityState === "hidden" && state.value) {
        void auditDashboardSecretRevealEvent(state.secret.id, "visibility_hidden", state.revealGrantId).catch(() => undefined);
        onChange({ ...state, value: null, revealGrantId: null, expiresAt: null });
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, [state, onChange]);

  const reveal = async () => {
    onChange({ ...state, loading: true, error: "" });
    try {
      const grant = await createDashboardSecretRevealGrant(state.secret.id, {
        password: state.password,
        totp: state.totp,
        purpose: `Dashboard reveal ${state.secret.stableName}`
      });
      const revealed = await revealDashboardSecret(state.secret.id, grant.revealGrantId);
      onChange({ ...state, loading: false, password: "", totp: "", value: revealed.value, revealGrantId: grant.revealGrantId, expiresAt: revealed.expiresAt });
    } catch (error) {
      onChange({ ...state, loading: false, error: error instanceof Error ? error.message : "Zobrazení Secretu selhalo." });
    }
  };
  const close = () => {
    if (state.value) void auditDashboardSecretRevealEvent(state.secret.id, "cleared", state.revealGrantId).catch(() => undefined);
    onClose();
  };
  return (
    <div className="modal-backdrop dashboard-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="modal dashboard-reveal-modal" role="dialog" aria-modal="true" aria-labelledby="dashboard-reveal-title">
        <header><div><span className="eyebrow">Bezpečné zobrazení hodnoty</span><h2 id="dashboard-reveal-title">{state.secret.stableName}</h2></div><button className="icon-only" aria-label="Zavřít" onClick={close}><XCircle size={20} /></button></header>
        {!state.value ? <>
          <p>Hodnota se načte jednorázově až po čerstvém ověření heslem a MFA. Nebude uložena do prohlížeče.</p>
          <label>Heslo<input type="password" autoComplete="current-password" value={state.password} onChange={(event) => onChange({ ...state, password: event.target.value })} /></label>
          <label>MFA kód<input inputMode="numeric" autoComplete="one-time-code" value={state.totp} onChange={(event) => onChange({ ...state, totp: event.target.value })} /></label>
          {state.error ? <div className="notice error"><AlertTriangle size={17} />{state.error}</div> : null}
          <div className="modal-actions"><button onClick={close}>Zrušit</button><button className="primary" disabled={state.loading || !state.password || state.totp.length < 6} onClick={() => { void reveal(); }}><Eye size={17} />{state.loading ? "Ověřuji…" : "Bezpečně zobrazit"}</button></div>
        </> : <>
          <div className="dashboard-revealed-value" onBlur={() => {
            void auditDashboardSecretRevealEvent(state.secret.id, "blur", state.revealGrantId).catch(() => undefined);
            onChange({ ...state, value: null, revealGrantId: null, expiresAt: null });
          }} tabIndex={0}>
            <EyeOff size={19} /><code>{state.value}</code>
          </div>
          <p>Hodnota se automaticky skryje {formatDate(state.expiresAt)} nebo při opuštění tohoto pole.</p>
          <div className="modal-actions"><button className="primary" onClick={close}>Skrýt nyní</button></div>
        </>}
      </section>
    </div>
  );
}

function DeregistrationModal({ node, onClose, onCompleted }: {
  node: DashboardNode;
  onClose: () => void;
  onCompleted: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<DashboardDeregistrationPreview | null>(null);
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [reason, setReason] = useState("");
  const [confirmedCode, setConfirmedCode] = useState("");
  const [idempotencyKey] = useState(() => globalThis.crypto?.randomUUID?.() ?? `deregister-${Date.now()}`);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    void loadDashboardDeregistrationPreview(node.id).then((next) => {
      if (active) setPreview(next);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "Impact preview se nepodařilo načíst.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [node.id]);

  const submit = async () => {
    if (!preview) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await deregisterDashboardNode(node.id, { password, totp, reason, confirmedCode, idempotencyKey });
      window.alert(`Prvek ${result.componentCode} byl destruktivně odregistrován. Correlation ID: ${result.correlationId}`);
      await onCompleted();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Odregistrace selhala.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop dashboard-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose(); }}>
      <section className="modal dashboard-deregistration-modal" role="dialog" aria-modal="true" aria-labelledby="dashboard-deregister-title">
        <header><div><span className="eyebrow">Vysoce destruktivní operace</span><h2 id="dashboard-deregister-title">Smazat prvek a registraci</h2></div><button className="icon-only" aria-label="Zavřít" disabled={submitting} onClick={onClose}><XCircle size={20} /></button></header>
        <div className="notice error"><ShieldAlert size={18} /><span>Prvek zmizí z aktivního Dashboardu, credentialy a Secret granty budou zneplatněny a obnova bude vyžadovat kompletní nový onboarding.</span></div>
        {loading ? <div className="dashboard-loading"><RefreshCw className="spin" size={18} /> Načítám autoritativní dopad…</div> : null}
        {preview ? <>
          <div className="dashboard-impact-grid" aria-label="Přehled dopadu odregistrace">
            <div><strong>{preview.token_count}</strong><span>aktivních tokenů</span></div>
            <div><strong>{preview.connection_count}</strong><span>PULSE spojení</span></div>
            <div><strong>{preview.direct_secret_grant_count}</strong><span>přímých Secret grantů</span></div>
            <div><strong>{preview.transferred_secret_grant_count}</strong><span>přenesených grantů</span></div>
          </div>
          <label>Důvod odregistrace<textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Uveďte konkrétní provozní nebo bezpečnostní důvod (min. 10 znaků)." /></label>
          <label>Pro potvrzení napište přesný kód <code>{preview.typedConfirmation}</code><input value={confirmedCode} onChange={(event) => setConfirmedCode(event.target.value)} autoComplete="off" /></label>
          <label>Heslo<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <label>MFA kód<input inputMode="numeric" autoComplete="one-time-code" value={totp} onChange={(event) => setTotp(event.target.value)} /></label>
        </> : null}
        {error ? <div className="notice error"><AlertTriangle size={17} />{error}</div> : null}
        <div className="modal-actions"><button disabled={submitting} onClick={onClose}>Zrušit</button><button className="danger-button" disabled={!preview || submitting || reason.trim().length < 10 || confirmedCode !== preview.typedConfirmation || !password || totp.trim().length < 6} onClick={() => { void submit(); }}><Trash2 size={17} />{submitting ? "Odregistruji…" : "Nevratně odregistrovat"}</button></div>
      </section>
    </div>
  );
}

export function DashboardPage({ releaseInfo, onOpenStandardPage }: {
  releaseInfo: ReleaseInfo | null;
  onOpenStandardPage: (page: "components" | "integration" | "identities" | "secrets" | "tokens" | "audit") => void;
}) {
  const [topology, setTopology] = useState<DashboardTopology | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [zoom, setZoom] = useState(1);
  const [listMode, setListMode] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [pendingSource, setPendingSource] = useState<DashboardPort | null>(null);
  const [busy, setBusy] = useState("");
  const [liveConnected, setLiveConnected] = useState(false);
  const [runtimeMotions, setRuntimeMotions] = useState<Record<string, RuntimeMotion>>({});
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragTargetKey, setDragTargetKey] = useState<string | null>(null);
  const [reveal, setReveal] = useState<RevealState | null>(null);
  const [deregistrationNode, setDeregistrationNode] = useState<DashboardNode | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const canvasTransformRef = useRef<HTMLDivElement | null>(null);
  const portAnchorRefs = useRef(new Map<string, HTMLSpanElement>());
  const [portAnchorPoints, setPortAnchorPoints] = useState<Map<string, CanvasPoint>>(new Map());
  const dragRef = useRef<{ nodeId: string; startX: number; startY: number; originX: number; originY: number } | null>(null);

  const refresh = useCallback(async () => {
    setError("");
    try {
      const next = await loadDashboardTopology();
      setTopology(next);
      setZoom(next.workspace.viewport.zoom || 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Dashboard se nepodařilo načíst.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const stream = new EventSource("/api/dashboard/events");
    stream.addEventListener("ready", () => setLiveConnected(true));
    stream.addEventListener("runtime", (event) => {
      try {
        const runtime = JSON.parse(event.data) as DashboardRuntimeEvent;
        const now = Date.now();
        setRuntimeMotions((current) => ({ ...current, [runtime.id]: { event: runtime, phase: "travelling", expiresAt: now + 4200 } }));
        window.setTimeout(() => setRuntimeMotions((current) => {
          const existing = current[runtime.id];
          return existing ? { ...current, [runtime.id]: { ...existing, phase: runtime.success ? "success" : "failure" } } : current;
        }), 1700);
        window.setTimeout(() => setRuntimeMotions((current) => { const next = { ...current }; delete next[runtime.id]; return next; }), 4200);
        setTopology((current) => current ? { ...current, live: { ...current.live, connected: true, lastEventAt: runtime.occurredAt }, events: [runtime, ...current.events.filter((item) => item.id !== runtime.id)].slice(0, 100) } : current);
      } catch { /* invalid stream payload is ignored and never rendered */ }
    });
    stream.onerror = () => setLiveConnected(false);
    return () => stream.close();
  }, []);

  const nodes = useMemo(() => {
    if (!topology) return [];
    const normalized = query.trim().toLowerCase();
    return topology.nodes.filter((node) => {
      const matchesText = !normalized || `${node.code ?? ""} ${node.displayName} ${node.category} ${node.operationalState}`.toLowerCase().includes(normalized);
      const matchesStatus = statusFilter === "ALL"
        || (statusFilter === "PRE_REGISTRATION" && node.lifecyclePhase === "PRE_REGISTRATION")
        || (statusFilter === "CRITICAL" && node.critical)
        || (statusFilter === "SUSPENDED" && node.suspended)
        || node.operationalState === statusFilter;
      return matchesText && matchesStatus;
    });
  }, [topology, query, statusFilter]);
  const visibleNodeIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
  const nodeByComponent = useMemo(() => new Map((topology?.nodes ?? []).filter((node) => node.componentId).map((node) => [node.componentId as string, node])), [topology]);
  const portsByComponent = useMemo(() => {
    const map = new Map<string, DashboardPort[]>();
    for (const port of topology?.ports ?? []) map.set(port.componentId, [...(map.get(port.componentId) ?? []), port]);
    return map;
  }, [topology]);

  useLayoutEffect(() => {
    const transform = canvasTransformRef.current;
    if (!transform) return;
    const transformBounds = transform.getBoundingClientRect();
    const next = new Map<string, CanvasPoint>();
    for (const [key, anchor] of portAnchorRefs.current) {
      const bounds = anchor.getBoundingClientRect();
      next.set(key, {
        x: (bounds.left + bounds.width / 2 - transformBounds.left) / zoom,
        y: (bounds.top + bounds.height / 2 - transformBounds.top) / zoom
      });
    }
    setPortAnchorPoints((current) => {
      if (current.size === next.size && [...next].every(([key, point]) => {
        const previous = current.get(key);
        return previous && Math.abs(previous.x - point.x) < 0.5 && Math.abs(previous.y - point.y) < 0.5;
      })) return current;
      return next;
    });
  }, [nodes, topology?.ports, zoom, draggingNodeId, runtimeMotions]);
  const selectedNode = topology?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedEdge = topology?.edges.find((edge) => edge.id === selectedEdgeId) ?? null;
  const motions = Object.values(runtimeMotions);
  const activeMotionForEdge = (edge: DashboardConnection): RuntimeMotion | undefined => motions.find(({ event }) => event.pulseType && event.pulseType === (portsByComponent.get(edge.sourceComponentId)?.find((port) => port.key === edge.sourcePortKey)?.pulseType ?? null));
  const activeMotionForNode = (node: DashboardNode): RuntimeMotion | undefined => node.componentId ? motions.find(({ event }) => event.componentId === node.componentId) : undefined;

  const persistPositions = useCallback(async (next: DashboardTopology) => {
    try {
      const result = await saveDashboardLayout({
        expectedVersion: next.workspace.lockVersion,
        viewport: { ...next.workspace.viewport, zoom },
        positions: next.nodes.map((node) => ({ nodeId: node.id, ...node.position }))
      });
      setTopology((current) => current ? { ...current, workspace: { ...current.workspace, lockVersion: Number(result.lock_version), viewport: { ...current.workspace.viewport, zoom } } } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Rozložení se nepodařilo uložit.");
      void refresh();
    }
  }, [refresh, zoom]);

  const moveNode = (nodeId: string, x: number, y: number) => {
    setTopology((current) => current ? { ...current, nodes: current.nodes.map((node) => node.id === nodeId ? { ...node, position: { x, y } } : node) } : current);
  };

  useEffect(() => {
    const pointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      moveNode(drag.nodeId, drag.originX + (event.clientX - drag.startX) / zoom, drag.originY + (event.clientY - drag.startY) / zoom);
    };
    const pointerUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      setDraggingNodeId(null);
      setTopology((current) => { if (current) void persistPositions(current); return current; });
    };
    window.addEventListener("pointermove", pointerMove);
    window.addEventListener("pointerup", pointerUp);
    return () => { window.removeEventListener("pointermove", pointerMove); window.removeEventListener("pointerup", pointerUp); };
  }, [persistPositions, zoom]);

  const connect = async (source: DashboardPort, target: DashboardPort) => {
    if (source.componentId === target.componentId) { setError("Běžné self-spojení není povoleno."); return; }
    setBusy("connection");
    setError("");
    try {
      const result = await previewDashboardConnection({
        sourceComponentId: source.componentId, sourcePortKey: source.key,
        targetComponentId: target.componentId, targetPortKey: target.key
      }) as ConnectionPreview;
      const compatibility = result.preview.compatibility;
      const explanation = compatibility.checks.map((check) => `${check.result}: ${check.reason}`).join("\n");
      const proceed = window.confirm(`${compatibility.status === "INCOMPATIBLE" ? "Kontrakty jsou nekompatibilní." : "Výsledek kompatibility: " + compatibility.status}\n\n${explanation}\n\nVytvořit jednosměrné spojení a udělit jeho směrové oprávnění?`);
      if (!proceed) return;
      await createDashboardConnection({
        sourceComponentId: source.componentId, sourcePortKey: source.key,
        targetComponentId: target.componentId, targetPortKey: target.key,
        grantAuthorization: true
      });
      setPendingSource(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Spojení se nepodařilo vytvořit.");
    } finally {
      setBusy("");
    }
  };

  const mutate = async (key: string, action: () => Promise<void>) => {
    setBusy(key); setError("");
    try { await action(); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Operace selhala."); }
    finally { setBusy(""); }
  };

  const dropSecret = (secretId: string, nodeId: string) => mutate("secret", () => grantDashboardSecret(secretId, nodeId));

  if (loading && !topology) return <div className="panel dashboard-loading"><RefreshCw className="spin" size={24} /> Načítám autoritativní topologii…</div>;
  if (!topology) return <div className="notice error"><AlertTriangle size={18} />{error || "Dashboard není dostupný."}<button onClick={() => { setLoading(true); void refresh(); }}>Zkusit znovu</button></div>;

  const contentWidth = Math.max(1400, ...topology.nodes.map((node) => node.position.x + 430));
  const contentHeight = Math.max(850, ...topology.nodes.map((node) => node.position.y + 360));
  return (
    <div className="dashboard-page">
      <PageHeader title="Aktivní Dashboard" description="Živá operační topologie, tokenový lifecycle, PULSE oprávnění a Secret granty nad jedním autoritativním backendem.">
        <label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hledat prvek, kód nebo stav…" aria-label="Hledat v Dashboardu" /></label>
        <button onClick={() => { void refresh(); }}><RefreshCw size={17} /> Obnovit</button>
      </PageHeader>

      <section className="dashboard-global-status" aria-label="Globální stav Dashboardu">
        <div><span className={`status-dot ${liveConnected ? "ok" : "danger"}`} /><strong>{liveConnected ? "Živý stream připojen" : "Živé spojení přerušeno"}</strong><small>{liveConnected ? `Poslední událost ${formatDate(topology.live.lastEventAt)}` : "Zobrazen poslední potvrzený stav; animace jsou zastaveny."}</small></div>
        <div><Activity size={18} /><strong>{topology.events.length}</strong><small>korelovaných událostí</small></div>
        <div><ShieldAlert size={18} /><strong>{topology.alarms.length}</strong><small>situací vyžadujících zásah</small></div>
        <div><KeyRound size={18} /><strong>{releaseInfo?.commitSha?.slice(0, 8) ?? "neznámý"}</strong><small>{releaseInfo?.buildId ?? "build neuveden"}</small></div>
      </section>

      {topology.alarms.length ? <section className="dashboard-alarm-strip" aria-label="Prioritní alarmy">{topology.alarms.map((alarm) => <button key={alarm.id} onClick={() => setSelectedNodeId(alarm.objectId)}><AlertTriangle size={19} /><span><strong>{alarm.severity}: {alarm.title}</strong><small>{alarm.impact} {alarm.recommendedAction}</small></span></button>)}</section> : null}
      {error ? <div className="notice error"><AlertTriangle size={18} />{error}</div> : null}

      <section className="dashboard-workbench">
        <aside className="dashboard-secret-library" aria-label="Knihovna Secret proměnných">
          <div className="dashboard-pane-head"><div><span className="eyebrow">Bezedná knihovna</span><h2>Secret proměnné</h2></div><Lock size={19} /></div>
          <p>Přetažení vytvoří grant. Kartička zůstane v knihovně a nikdy neobsahuje hodnotu Secretu.</p>
          <div className="dashboard-secret-list">
            {topology.secrets.map((secret) => <article key={secret.id} className={`dashboard-secret-card ${secret.status.toLowerCase()}`} draggable={secret.status === "ACTIVE"} onDragStart={(event) => event.dataTransfer.setData("application/x-kcml-secret", secret.id)}>
              <header><LockKeyhole size={16} /><strong>{secret.stableName}</strong><span className={`badge ${secret.status === "ACTIVE" ? "ok" : "warn"}`}>{secret.status}</span></header>
              <p>{secret.description || "Účel není v evidenci popsán."}</p>
              <dl><div><dt>Verze</dt><dd>{secret.version ?? "—"}</dd></div><div><dt>Granty</dt><dd>{secret.grantCount}</dd></div></dl>
              <code>{secret.fingerprint ?? "fingerprint není dostupný"}</code>
              <div className="dashboard-secret-actions"><button disabled={secret.status !== "ACTIVE"} title={secret.status === "ACTIVE" ? "Hodnota se zobrazí pouze po čerstvém MFA ověření." : "Secret není aktivní."} onClick={() => setReveal({ secret, password: "", totp: "", loading: false, error: "", value: null, revealGrantId: null, expiresAt: null })}><Eye size={14} /> Zobrazit přes MFA</button><button disabled={secret.status !== "ACTIVE"} title={secret.status === "ACTIVE" ? "Přidělí Secret všem aktuálně způsobilým prvkům po potvrzení náhledu." : "Secret není aktivní."} onClick={() => { void mutate("bulk-secret", async () => {
                const preview = await previewBulkDashboardSecret(secret.id);
                const skipped = preview.skipped.length ? `\nVynecháno ${preview.skipped.length}: ${preview.skipped.map((item) => `${item.label} (${item.reason})`).join(", ")}` : "";
                const confirmed = window.confirm(`Secret ${preview.stableName}: způsobilých ${preview.eligibleCount}, nových grantů ${preview.createCount}, již přiděleno ${preview.alreadyGrantedCount}.${skipped}\nBudoucí prvky zahrnuty nebudou. Pokračovat?`);
                if (!confirmed) return;
                const result = await bulkGrantDashboardSecret(secret.id);
                const failed = result.results.filter((item) => item.status === "FAILED").length;
                const created = result.results.filter((item) => item.status === "CREATED").length;
                const existing = result.results.filter((item) => item.status === "ALREADY_GRANTED").length;
                window.alert(`Vytvořeno ${created}, již existovalo ${existing}, vynecháno ${result.skippedCount}, selhání ${failed}.`);
              }); }}><Zap size={14} /> Přidělit všem</button></div>
            </article>)}
          </div>
          <button className="dashboard-standard-link" onClick={() => onOpenStandardPage("secrets")}>Otevřít přesný Secret Manager</button>
        </aside>

        <section className="dashboard-canvas-shell">
          <div className="dashboard-canvas-toolbar">
            <label>Stav<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="ALL">Všechny prvky</option><option value="PRE_REGISTRATION">Čeká na onboarding</option><option value="HEALTHY">Zdravé</option><option value="CRITICAL">Kritické</option><option value="SUSPENDED">Suspendované</option></select></label>
            <div className="dashboard-zoom-controls" aria-label="Ovládání zobrazení"><button aria-label="Oddálit" onClick={() => setZoom((value) => Math.max(0.35, value - 0.1))}><Minus size={16} /></button><span>{Math.round(zoom * 100)} %</span><button aria-label="Přiblížit" onClick={() => setZoom((value) => Math.min(2, value + 0.1))}><Plus size={16} /></button><button aria-label="Přizpůsobit prvky" onClick={() => { setZoom(0.75); canvasRef.current?.scrollTo({ top: 0, left: 0, behavior: "smooth" }); }}><Maximize2 size={16} /></button></div>
            <button className={listMode ? "active" : ""} onClick={() => setListMode((value) => !value)}><List size={16} /> Přístupný seznam</button>
            {pendingSource ? <div className="dashboard-connect-notice"><Link2 size={15} /> Vybrán {pendingSource.label}. Zvolte příchozí zásuvku.<button onClick={() => setPendingSource(null)}>Zrušit</button></div> : null}
          </div>

          {listMode ? <div className="dashboard-accessible-list">{nodes.map((node) => <article key={node.id}><header><strong>{node.code ?? node.label} · {node.displayName}</strong><span>{node.lifecyclePhase === "PRE_REGISTRATION" ? "Čeká na onboarding" : node.operationalState}</span></header><p>{node.description || "Popis není v manifestu uveden."}</p><button onClick={() => { setSelectedNodeId(node.id); setListMode(false); }}>Otevřít na plátně</button></article>)}</div> : <div className="dashboard-canvas-viewport" ref={canvasRef}>
            <div className="dashboard-canvas" style={{ width: contentWidth * zoom, height: contentHeight * zoom }}>
              <div className="dashboard-canvas-transform" ref={canvasTransformRef} style={{ width: contentWidth, height: contentHeight, transform: `scale(${zoom})` }}>
                <svg className="dashboard-edge-layer" width={contentWidth} height={contentHeight} aria-label="PULSE spojení">
                  {topology.edges.map((edge) => {
                    const source = nodeByComponent.get(edge.sourceComponentId);
                    const target = nodeByComponent.get(edge.targetComponentId);
                    if (!source || !target || !visibleNodeIds.has(source.id) || !visibleNodeIds.has(target.id)) return null;
                    const path = edgePath(source, target, portAnchorPoints.get(`outgoing:${edge.sourceComponentId}:${edge.sourcePortKey}`), portAnchorPoints.get(`incoming:${edge.targetComponentId}:${edge.targetPortKey}`));
                    const motion = liveConnected ? activeMotionForEdge(edge) : undefined;
                    const active = motion?.phase === "travelling";
                    return <g key={edge.id} className={`dashboard-edge ${edge.effectiveAuthorization === "GRANTED" ? "authorized" : "denied"} ${active ? "runtime-active" : ""} ${motion?.phase === "success" ? "runtime-success" : ""} ${motion?.phase === "failure" ? "runtime-failure" : ""}`} onClick={() => { setSelectedEdgeId(edge.id); setSelectedNodeId(null); }} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " " || (event.shiftKey && event.key === "F10") || event.key === "ContextMenu") { event.preventDefault(); setSelectedEdgeId(edge.id); setSelectedNodeId(null); } }} aria-label={`${edge.sourceCode} do ${edge.targetCode}. ${authorizationLabel(edge)}. ${compatibilityLabel(edge.compatibilityStatus)}.`}>
                      <path className="dashboard-edge-hit" d={path} /><path className="dashboard-edge-line" d={path} /><path className="dashboard-edge-flow" d={path} /><circle className="dashboard-runtime-pulse" r="6"><animateMotion dur="1.6s" repeatCount={active ? "2" : "0"} path={path} /></circle><circle className="dashboard-runtime-result" r="9" cx={portAnchorPoints.get(`incoming:${edge.targetComponentId}:${edge.targetPortKey}`)?.x ?? target.position.x} cy={portAnchorPoints.get(`incoming:${edge.targetComponentId}:${edge.targetPortKey}`)?.y ?? target.position.y + NODE_HEADER_HEIGHT} />
                    </g>;
                  })}
                </svg>
                {nodes.map((node) => {
                  const componentPorts = node.componentId ? portsByComponent.get(node.componentId) ?? [] : [];
                  const incoming = componentPorts.filter((port) => port.direction === "INCOMING");
                  const outgoing = componentPorts.filter((port) => port.direction === "OUTGOING");
                  return <article key={node.id} className={`dashboard-node ${nodeStatusClass(node)} ${selectedNodeId === node.id ? "selected" : ""} ${draggingNodeId === node.id ? "dragging" : ""} ${activeMotionForNode(node)?.phase ? `process-${activeMotionForNode(node)?.phase}` : ""}`} style={{ left: node.position.x, top: node.position.y }} onClick={() => { setSelectedNodeId(node.id); setSelectedEdgeId(null); }} onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-kcml-secret")) event.preventDefault(); }} onDrop={(event) => { const secretId = event.dataTransfer.getData("application/x-kcml-secret"); if (secretId) { event.preventDefault(); void dropSecret(secretId, node.id); } }}>
                    <header className="dashboard-node-header" onPointerDown={(event) => {
                      if ((event.target as HTMLElement).closest("button,input,select,a")) return;
                      dragRef.current = { nodeId: node.id, startX: event.clientX, startY: event.clientY, originX: node.position.x, originY: node.position.y }; setDraggingNodeId(node.id);
                    }}>
                      <div className="dashboard-node-title"><span className={`dashboard-node-icon ${node.lifecyclePhase === "PRE_REGISTRATION" ? "token" : "component"}`}>{node.lifecyclePhase === "PRE_REGISTRATION" ? <KeyRound size={19} /> : <Boxes size={19} />}</span><div><span className="eyebrow">{node.lifecyclePhase === "PRE_REGISTRATION" ? "Čeká na onboarding" : node.category}</span><h3>{node.code ?? node.label}</h3><p>{node.displayName}</p></div></div>
                      <span className={`dashboard-node-health ${node.critical ? "danger" : node.suspended ? "warn" : "ok"}`} title={node.critical ? "Kritický stav" : node.suspended ? "Suspendováno" : "Bez kritického alarmu"} />
                    </header>
                    {activeMotionForNode(node) ? <div className={`dashboard-process-indicator ${activeMotionForNode(node)?.phase}`} role="status" aria-live="polite"><span className="dashboard-process-spinner" /><div><strong>{activeMotionForNode(node)?.event.operationKey}</strong><small>{activeMotionForNode(node)?.phase === "travelling" ? "Probíhá korelovaná operace" : activeMotionForNode(node)?.phase === "success" ? "Operace úspěšně dokončena" : "Operace skončila chybou"}</small></div></div> : null}
                    <div className="dashboard-node-state"><span><strong>{node.operationalState}</strong><small>provoz</small></span><span><strong>{node.statistics.callCount}</strong><small>volání / 24 h</small></span><span><strong>{Math.round(node.statistics.errorRate * 100)} %</strong><small>chybovost</small></span></div>
                    {node.lifecyclePhase === "PRE_REGISTRATION" ? <div className="dashboard-node-locked"><PauseCircle size={16} /> Provozní akce jsou neaktivní do dokončení onboardingu.</div> : null}
                    <div className="dashboard-node-secrets" aria-label="Připnuté Secrets">{node.secrets.slice(0, 4).map((secret) => <button key={secret.secretId} title={`Secret ${secret.stableName}; zdroj grantu ${secret.source}`} onClick={(event) => { event.stopPropagation(); void mutate("revoke-secret", () => revokeDashboardSecret(secret.secretId, node.id)); }}><Lock size={12} />{secret.stableName}<span aria-hidden="true">×</span></button>)}{node.secrets.length > 4 ? <span>+{node.secrets.length - 4} dalších</span> : null}{node.secrets.length === 0 ? <small>Přetáhněte sem Secret kartičku</small> : null}</div>
                    {node.lifecyclePhase === "REGISTERED" ? <div className="dashboard-node-ports" aria-label="PULSE vstupy a výstupy"><div className="dashboard-port-column incoming"><span>Příchozí zásuvky</span>{incoming.length === 0 ? <div className="dashboard-port empty" title="Komponenta nemá deklarovaný příchozí PULSE kontrakt."><span className="port-socket" aria-hidden="true" /><small>Bez vstupu</small></div> : null}{incoming.map((port) => {
                      const anchorKey = `incoming:${port.componentId}:${port.key}`;
                      const externalHelp = externalPortHelp(port);
                      return <button key={port.key} className={`dashboard-port ${portCompatibilityClass(port, topology.edges)} ${externalHelp ? "external" : ""} ${pendingSource ? "target-candidate" : ""} ${dragTargetKey === port.key ? "drag-over" : ""}`} title={`${portHelp(port)}${externalHelp ? ` ${externalHelp}` : ""}`} aria-label={`${portHelp(port)}${externalHelp ? ` ${externalHelp}` : ""}`} onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-kcml-port")) { event.preventDefault(); setDragTargetKey(port.key); } }} onDragLeave={() => setDragTargetKey((current) => current === port.key ? null : current)} onDrop={(event) => { const raw = event.dataTransfer.getData("application/x-kcml-port"); if (!raw) return; event.preventDefault(); setDragTargetKey(null); void connect(JSON.parse(raw) as DashboardPort, port); }} onClick={(event) => { event.stopPropagation(); if (pendingSource) void connect(pendingSource, port); }}><span className="port-socket" ref={(element) => { if (element) portAnchorRefs.current.set(anchorKey, element); else portAnchorRefs.current.delete(anchorKey); }} aria-hidden="true" />{externalHelp ? <small className="port-external-label">EXTERNÍ</small> : null}{port.pulseType}</button>;
                    })}</div><div className="dashboard-port-column outgoing"><span>Odchozí zástrčky</span>{outgoing.length === 0 ? <div className="dashboard-port empty" title="Komponenta nemá deklarovaný odchozí PULSE kontrakt."><small>Bez výstupu</small><span className="port-connector" aria-hidden="true" /></div> : null}{outgoing.map((port) => {
                      const anchorKey = `outgoing:${port.componentId}:${port.key}`;
                      return <button key={port.key} className={`dashboard-port ${portCompatibilityClass(port, topology.edges)}`} draggable title={portHelp(port)} aria-label={portHelp(port)} onDragStart={(event) => event.dataTransfer.setData("application/x-kcml-port", JSON.stringify(port))} onClick={(event) => { event.stopPropagation(); setPendingSource(port); }}><span className="port-connector" ref={(element) => { if (element) portAnchorRefs.current.set(anchorKey, element); else portAnchorRefs.current.delete(anchorKey); }} aria-hidden="true" />{port.pulseType}</button>;
                    })}</div></div> : null}
                    <footer><code>{node.tokenFingerprint ?? "credential zatím nevydán"}</code><button onClick={(event) => { event.stopPropagation(); setSelectedNodeId(node.id); }} aria-label={`Otevřít detail ${node.code ?? node.label}`}><Focus size={14} /></button></footer>
                  </article>;
                })}
              </div>
            </div>
          </div>}
          <div className="dashboard-minimap" aria-hidden="true">{nodes.map((node) => <span key={node.id} className={nodeStatusClass(node)} style={{ left: `${Math.min(94, node.position.x / contentWidth * 100)}%`, top: `${Math.min(90, node.position.y / contentHeight * 100)}%` }} />)}</div>
        </section>

        <aside className="dashboard-context-panel" aria-label="Kontextový detail">
          <div className="dashboard-pane-head"><div><span className="eyebrow">Kontextový panel</span><h2>{selectedEdge ? "PULSE spojení" : selectedNode ? "Detail prvku" : "Vyberte objekt"}</h2></div><CircleHelp size={19} /></div>
          {!selectedNode && !selectedEdge ? <div className="dashboard-context-empty"><Focus size={30} /><p>Klikněte na prvek nebo PULSE vlákno. Technický detail i akce používají stejná API jako přesné sekce.</p></div> : null}
          {selectedNode ? <div className="dashboard-context-content">
            <h3>{selectedNode.code ?? selectedNode.label}</h3><p>{selectedNode.description || "Popis není v manifestu uveden."}</p>
            <dl className="dashboard-detail-list"><div><dt>Lifecycle</dt><dd>{selectedNode.lifecycleState}</dd></div><div><dt>Aktivace</dt><dd>{selectedNode.activationState}</dd></div><div><dt>Monitoring</dt><dd>{selectedNode.monitoringState}</dd></div><div><dt>Recertifikace</dt><dd>{selectedNode.recertificationState}</dd></div><div><dt>Poslední běh</dt><dd>{formatDate(selectedNode.statistics.lastRunAt)}</dd></div><div><dt>Secrets</dt><dd>{selectedNode.secrets.length}</dd></div></dl>
            {selectedNode.secrets.length ? <details className="dashboard-secret-detail"><summary>Připnuté Secret proměnné ({selectedNode.secrets.length})</summary><div>{selectedNode.secrets.map((grant) => { const secret = topology.secrets.find((item) => item.id === grant.secretId); return <article key={`${grant.secretId}-${grant.source}`}><div><strong>{grant.stableName}</strong><small>{grant.source}</small></div><div>{secret ? <button onClick={() => setReveal({ secret, password: "", totp: "", loading: false, error: "", value: null, revealGrantId: null, expiresAt: null })}><Eye size={14} /> MFA reveal</button> : null}<button onClick={() => void mutate("revoke-secret", () => revokeDashboardSecret(grant.secretId, selectedNode.id))}><Unplug size={14} /> Odebrat grant</button></div></article>; })}</div></details> : null}
            {selectedNode.lifecyclePhase === "REGISTERED" && selectedNode.componentId ? <div className="dashboard-context-actions">
              <button disabled={busy === "activation"} onClick={() => void mutate("activation", () => setDashboardComponentEnabled(selectedNode.componentId!, !selectedNode.enabled))}>{selectedNode.enabled ? <><PauseCircle size={16} /> Vypnout komponentu</> : <><PlayCircle size={16} /> Zapnout komponentu</>}</button>
              <button disabled={busy === "suspension"} onClick={() => { const reason = window.prompt(selectedNode.suspended ? "Důvod obnovení oprávnění:" : "Důvod dočasné suspendace oprávnění:", selectedNode.suspended ? "OWNER obnovil účinná oprávnění po ověření příčiny." : "OWNER dočasně pozastavil účinná oprávnění."); if (reason) void mutate("suspension", () => setDashboardNodeSuspension(selectedNode.id, !selectedNode.suspended, reason)); }}>{selectedNode.suspended ? <><PlayCircle size={16} /> Obnovit oprávnění</> : <><PauseCircle size={16} /> Suspendovat oprávnění</>}</button>
              <button onClick={() => void mutate("e2e", () => runDashboardComponentE2E(selectedNode.componentId!))}><Zap size={16} /> Spustit E2E</button>
              <button onClick={() => void mutate("state-query", () => runDashboardComponentStateQuery(selectedNode.componentId!))}><Search size={16} /> Full state query</button>
              <button onClick={() => void mutate("heartbeat", () => runDashboardComponentHeartbeatChallenge(selectedNode.componentId!))}><Activity size={16} /> Heartbeat challenge</button>
              {selectedNode.lifecycleState === "QUARANTINED" ? <button onClick={() => void mutate("lifecycle", () => setDashboardComponentLifecycle(selectedNode.componentId!, "RESTORE"))}><PlayCircle size={16} /> Obnovit z karantény</button> : <button onClick={() => { if (window.confirm(`Přesunout ${selectedNode.code ?? selectedNode.label} do karantény?`)) void mutate("lifecycle", () => setDashboardComponentLifecycle(selectedNode.componentId!, "QUARANTINE")); }}><ShieldAlert size={16} /> Karanténa</button>}
              <button onClick={() => { if (window.confirm(`Retire komponenty ${selectedNode.code ?? selectedNode.label} ji provozně vyřadí. Pokračovat?`)) void mutate("lifecycle", () => setDashboardComponentLifecycle(selectedNode.componentId!, "RETIRE")); }}><PauseCircle size={16} /> Retire</button>
              <button onClick={() => onOpenStandardPage("components")}><Boxes size={16} /> Přesný detail komponenty</button><button onClick={() => onOpenStandardPage("identities")}><KeyRound size={16} /> Tokenová identita</button><button onClick={() => onOpenStandardPage("audit")}><Activity size={16} /> Audit a události</button><button className="danger-link" onClick={() => setDeregistrationNode(selectedNode)}><Trash2 size={16} /> Smazat prvek a registraci</button>
            </div> : <div className="dashboard-context-actions"><button onClick={() => onOpenStandardPage("identities")}><KeyRound size={16} /> Otevřít integrační token</button></div>}
          </div> : null}
          {selectedEdge ? <div className="dashboard-context-content">
            <h3>{selectedEdge.sourceCode} → {selectedEdge.targetCode}</h3>
            <div className={`dashboard-edge-status ${compatibilityClass(selectedEdge.compatibilityStatus)}`}><span className="port-state-icon">{selectedEdge.compatibilityStatus === "INCOMPATIBLE" ? <XCircle size={17} /> : selectedEdge.compatibilityStatus === "UNKNOWN" ? <CircleHelp size={17} /> : <CheckCircle2 size={17} />}</span><span><strong>{compatibilityLabel(selectedEdge.compatibilityStatus)}</strong><small>stav konektoru a zásuvky</small></span></div>
            <div className={`dashboard-edge-status ${selectedEdge.effectiveAuthorization === "GRANTED" ? "authorized" : "denied"}`}><span>{selectedEdge.effectiveAuthorization === "GRANTED" ? <Link2 size={17} /> : <Link2Off size={17} />}</span><span><strong>{authorizationLabel(selectedEdge)}</strong><small>stav samotného vlákna</small></span></div>
            <dl className="dashboard-detail-list"><div><dt>Cesta volání (route)</dt><dd><code>{selectedEdge.route}</code></dd></div><div><dt>Rozsah oprávnění (scope)</dt><dd><code>{selectedEdge.scope}</code></dd></div><div><dt>Cílová služba (audience)</dt><dd><code>{selectedEdge.audience}</code></dd></div><div><dt>Correlation ID</dt><dd><code>{selectedEdge.correlationId}</code></dd></div></dl>
            <div className="dashboard-context-actions"><button disabled={busy === "edge-auth"} onClick={() => void mutate("edge-auth", () => setDashboardConnectionAuthorization(selectedEdge.id, selectedEdge.effectiveAuthorization !== "GRANTED"))}>{selectedEdge.effectiveAuthorization === "GRANTED" ? <><Lock size={16} /> Odebrat oprávnění</> : <><LockKeyhole size={16} /> Udělit oprávnění</>}</button><button className="danger-link" disabled={busy === "disconnect"} onClick={() => { if (window.confirm("Rozpojit topologické spojení? Tato akce nesmaže žádný prvek ani celý token.")) void mutate("disconnect", () => disconnectDashboardConnection(selectedEdge.id)); }}><Unplug size={16} /> Rozpojit</button><button onClick={() => onOpenStandardPage("audit")}><Activity size={16} /> Otevřít audit</button></div>
            <details><summary>Technický důkaz kompatibility</summary><pre>{JSON.stringify(selectedEdge.compatibilityEvidence, null, 2)}</pre></details>
          </div> : null}
        </aside>
      </section>

      <section className="dashboard-timeline panel"><div className="panel-head"><div><span className="eyebrow">Persistovaná runtime pravda</span><h2>Živá timeline</h2></div><span className={`badge ${liveConnected ? "ok" : "danger"}`}>{liveConnected ? "LIVE" : "ODPOJENO"}</span></div><div className="dashboard-event-list">{topology.events.slice(0, 30).map((event) => <article key={event.id}><span className={`dashboard-event-result ${event.success ? "ok" : "danger"}`}>{event.success ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}</span><div><strong>{event.componentCode} · {event.operationKey}</strong><small>{event.direction ?? "směr neuveden"} · {event.pulseType ?? "PULSE typ neuveden"} · {formatDate(event.occurredAt)}</small></div><code>{event.correlationId}</code></article>)}</div></section>
      {reveal ? <RevealedSecretModal state={reveal} onChange={setReveal} onClose={() => setReveal(null)} /> : null}
      {deregistrationNode ? <DeregistrationModal node={deregistrationNode} onClose={() => setDeregistrationNode(null)} onCompleted={async () => { setSelectedNodeId(null); await refresh(); }} /> : null}
    </div>
  );
}
