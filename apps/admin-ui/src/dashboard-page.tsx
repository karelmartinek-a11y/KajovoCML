import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  CircleHelp,
  Cloud,
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

type PortDragPreview = {
  source: DashboardPort;
  x: number;
  y: number;
  targetId: string | null;
  status: "LOADING" | "COMPATIBLE" | "INCOMPATIBLE" | "UNKNOWN" | "FORBIDDEN";
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

type ActionDialogState = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  details?: string[];
  confirmLabel: string;
  danger?: boolean;
  reason?: {
    label: string;
    initialValue: string;
    minLength: number;
  };
  onConfirm: (reason: string) => Promise<string | void>;
};

type DashboardNotice = {
  kind: "success" | "warning";
  message: string;
};

const NODE_WIDTH = 294;
const NODE_HEADER_HEIGHT = 92;
const EXTERNAL_NODE_HEADER_HEIGHT = 64;

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

function edgePath(source: DashboardNode, target: DashboardNode): string {
  const sx = source.position.x + NODE_WIDTH;
  const sy = source.position.y + NODE_HEADER_HEIGHT;
  const tx = target.position.x;
  const ty = target.position.y + NODE_HEADER_HEIGHT;
  const bend = Math.max(90, Math.abs(tx - sx) * 0.45);
  return `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`;
}

function externalEdgePath(source: DashboardNode, target: { position: { x: number; y: number } }): string {
  const sx = source.position.x + NODE_WIDTH;
  const sy = source.position.y + NODE_HEADER_HEIGHT;
  const tx = target.position.x;
  const ty = target.position.y + EXTERNAL_NODE_HEADER_HEIGHT;
  const bend = Math.max(100, Math.abs(tx - sx) * 0.45);
  return `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`;
}

function portDragPath(source: DashboardNode, targetX: number, targetY: number): string {
  const sx = source.position.x + NODE_WIDTH;
  const sy = source.position.y + NODE_HEADER_HEIGHT;
  const bend = Math.max(70, Math.abs(targetX - sx) * 0.4);
  return `M ${sx} ${sy} C ${sx + bend} ${sy}, ${targetX - bend} ${targetY}, ${targetX} ${targetY}`;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return reduced;
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

function DashboardActionModal({ state, onClose, onCompleted }: {
  state: ActionDialogState;
  onClose: () => void;
  onCompleted: (message?: string) => void;
}) {
  const [reason, setReason] = useState(state.reason?.initialValue ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, submitting]);

  const submit = async () => {
    setSubmitting(true);
    setError("");
    try {
      const message = await state.onConfirm(reason.trim());
      onCompleted(typeof message === "string" ? message : undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Operaci se nepodařilo dokončit.");
    } finally {
      setSubmitting(false);
    }
  };

  const reasonValid = !state.reason || reason.trim().length >= state.reason.minLength;
  return (
    <div className="modal-backdrop dashboard-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose(); }}>
      <section className="modal dashboard-action-modal" role="dialog" aria-modal="true" aria-labelledby={`dashboard-action-${state.id}`}>
        <header><div><span className="eyebrow">{state.eyebrow}</span><h2 id={`dashboard-action-${state.id}`}>{state.title}</h2></div><button className="icon-only" aria-label="Zavřít" disabled={submitting} onClick={onClose}><XCircle size={20} /></button></header>
        <p>{state.description}</p>
        {state.details?.length ? <ul className="dashboard-action-details">{state.details.map((detail, index) => <li key={`${state.id}-${index}`}>{detail}</li>)}</ul> : null}
        {state.reason ? <label>{state.reason.label}<textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} autoFocus placeholder={`Uveďte konkrétní důvod (min. ${state.reason.minLength} znaků).`} /></label> : null}
        {error ? <div className="notice error" role="alert"><AlertTriangle size={17} />{error}</div> : null}
        <div className="modal-actions"><button disabled={submitting} onClick={onClose}>Zrušit</button><button ref={confirmRef} className={state.danger ? "danger-button" : "primary"} disabled={submitting || !reasonValid} onClick={() => { void submit(); }}>{submitting ? "Provádím…" : state.confirmLabel}</button></div>
      </section>
    </div>
  );
}

function DeregistrationModal({ node, onClose, onCompleted }: {
  node: DashboardNode;
  onClose: () => void;
  onCompleted: (message: string) => Promise<void>;
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
      await onCompleted(`Prvek ${result.componentCode} byl destruktivně odregistrován. Correlation ID: ${result.correlationId}`);
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
  onOpenStandardPage: (page: "components" | "external" | "integration" | "identities" | "secrets" | "tokens" | "audit") => void;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const [topology, setTopology] = useState<DashboardTopology | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [zoom, setZoom] = useState(1);
  const [listMode, setListMode] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedExternalId, setSelectedExternalId] = useState<string | null>(null);
  const [selectedPortKey, setSelectedPortKey] = useState<string | null>(null);
  const [pendingSource, setPendingSource] = useState<DashboardPort | null>(null);
  const [busy, setBusy] = useState("");
  const [liveConnected, setLiveConnected] = useState(false);
  const [runtimeMotions, setRuntimeMotions] = useState<Record<string, RuntimeMotion>>({});
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [draggingExternalId, setDraggingExternalId] = useState<string | null>(null);
  const [dragTargetKey, setDragTargetKey] = useState<string | null>(null);
  const [portDragPreview, setPortDragPreview] = useState<PortDragPreview | null>(null);
  const [panning, setPanning] = useState(false);
  const [reveal, setReveal] = useState<RevealState | null>(null);
  const [deregistrationNode, setDeregistrationNode] = useState<DashboardNode | null>(null);
  const [actionDialog, setActionDialog] = useState<ActionDialogState | null>(null);
  const [notice, setNotice] = useState<DashboardNotice | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ kind: "node" | "external"; id: string; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);

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
        const motionKey = `${runtime.kind}:${runtime.correlationId}`;
        const phase: RuntimeMotion["phase"] = runtime.stage === "STARTED" ? "travelling" : runtime.success ? "success" : "failure";
        const lifetimeMs = runtime.stage === "STARTED" ? 65_000 : 3_200;
        const expiresAt = now + lifetimeMs;
        setRuntimeMotions((current) => ({ ...current, [motionKey]: { event: runtime, phase, expiresAt } }));
        window.setTimeout(() => setRuntimeMotions((current) => {
          const active = current[motionKey];
          if (!active || active.expiresAt !== expiresAt) return current;
          const next = { ...current };
          delete next[motionKey];
          return next;
        }), lifetimeMs);
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
  const selectedNode = topology?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedEdge = topology?.edges.find((edge) => edge.id === selectedEdgeId) ?? null;
  const selectedExternal = topology?.externalNodes.find((target) => target.id === selectedExternalId) ?? null;
  const selectedPort = topology?.ports.find((port) => `${port.componentId}:${port.key}` === selectedPortKey) ?? null;
  const motions = Object.values(runtimeMotions);
  const activeMotionForEdge = (edge: DashboardConnection): RuntimeMotion | undefined => motions.find(({ event }) => event.kind === "PULSE"
    && event.componentId === edge.sourceComponentId
    && (!event.targetComponentId || event.targetComponentId === edge.targetComponentId)
    && (!event.pulseType || event.pulseType === (portsByComponent.get(edge.sourceComponentId)?.find((port) => port.key === edge.sourcePortKey)?.pulseType ?? null)));
  const activeMotionForExternalEdge = (edge: DashboardTopology["externalEdges"][number]): RuntimeMotion | undefined => motions.find(({ event }) => event.kind === "EXTERNAL"
    && event.componentId === edge.sourceComponentId && event.externalTargetId === edge.externalTargetId);
  const activeMotionForNode = (node: DashboardNode): RuntimeMotion | undefined => node.componentId ? motions.find(({ event }) => event.componentId === node.componentId) : undefined;

  const startPortDrag = (event: React.DragEvent<HTMLButtonElement>, source: DashboardPort) => {
    const sourceNode = nodeByComponent.get(source.componentId);
    if (!sourceNode) return;
    event.dataTransfer.effectAllowed = "link";
    event.dataTransfer.setData("application/x-kcml-port", JSON.stringify(source));
    setPortDragPreview({
      source,
      x: sourceNode.position.x + NODE_WIDTH + 90,
      y: sourceNode.position.y + NODE_HEADER_HEIGHT,
      targetId: null,
      status: "UNKNOWN"
    });
  };

  const movePortDrag = (event: React.DragEvent<HTMLButtonElement>) => {
    if (!portDragPreview || !canvasRef.current || event.clientX <= 0 || event.clientY <= 0) return;
    const bounds = canvasRef.current.getBoundingClientRect();
    const x = (event.clientX - bounds.left + canvasRef.current.scrollLeft) / zoom;
    const y = (event.clientY - bounds.top + canvasRef.current.scrollTop) / zoom;
    setPortDragPreview((current) => current ? { ...current, x, y } : current);
  };

  const previewPortDragTarget = (target: DashboardPort) => {
    const source = portDragPreview?.source;
    if (!source) return;
    const targetId = `${target.componentId}:${target.key}`;
    setDragTargetKey(targetId);
    if (source.componentId === target.componentId) {
      setPortDragPreview((current) => current ? { ...current, targetId, status: "FORBIDDEN" } : current);
      return;
    }
    setPortDragPreview((current) => current ? { ...current, targetId, status: "LOADING" } : current);
    void previewDashboardConnection({
      sourceComponentId: source.componentId,
      sourcePortKey: source.key,
      targetComponentId: target.componentId,
      targetPortKey: target.key
    }).then((result) => {
      const status = (result as ConnectionPreview).preview.compatibility.status;
      const mapped: PortDragPreview["status"] = status === "INCOMPATIBLE"
        ? "INCOMPATIBLE"
        : status === "EXACT_MATCH" || status === "COMPATIBLE_WITH_DIFFERENCES"
          ? "COMPATIBLE"
          : "UNKNOWN";
      setPortDragPreview((current) => current?.targetId === targetId ? { ...current, status: mapped } : current);
    }).catch(() => {
      setPortDragPreview((current) => current?.targetId === targetId ? { ...current, status: "UNKNOWN" } : current);
    });
  };

  const finishPortDrag = () => {
    setDragTargetKey(null);
    setPortDragPreview(null);
  };

  const persistPositions = useCallback(async (next: DashboardTopology) => {
    try {
      const result = await saveDashboardLayout({
        expectedVersion: next.workspace.lockVersion,
        viewport: { ...next.workspace.viewport, zoom },
        positions: next.nodes.map((node) => ({ nodeId: node.id, ...node.position })),
        externalPositions: next.externalNodes.map((target) => ({ externalTargetId: target.id, ...target.position }))
      });
      setTopology((current) => current ? { ...current, workspace: { ...current.workspace, lockVersion: Number(result.lock_version), viewport: { ...current.workspace.viewport, zoom } } } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Rozložení se nepodařilo uložit.");
      void refresh();
    }
  }, [refresh, zoom]);

  const moveCanvasEntity = (kind: "node" | "external", id: string, x: number, y: number) => {
    setTopology((current) => current ? kind === "node"
      ? { ...current, nodes: current.nodes.map((node) => node.id === id ? { ...node, position: { x, y } } : node) }
      : { ...current, externalNodes: current.externalNodes.map((target) => target.id === id ? { ...target, position: { x, y } } : target) }
      : current);
  };

  useEffect(() => {
    const pointerMove = (event: PointerEvent) => {
      const pan = panRef.current;
      if (pan && canvasRef.current) {
        canvasRef.current.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX);
        canvasRef.current.scrollTop = pan.scrollTop - (event.clientY - pan.startY);
        return;
      }
      const drag = dragRef.current;
      if (!drag) return;
      moveCanvasEntity(drag.kind, drag.id, drag.originX + (event.clientX - drag.startX) / zoom, drag.originY + (event.clientY - drag.startY) / zoom);
    };
    const pointerUp = () => {
      if (panRef.current) { panRef.current = null; setPanning(false); }
      if (!dragRef.current) return;
      dragRef.current = null;
      setDraggingNodeId(null);
      setDraggingExternalId(null);
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
      setActionDialog({
        id: `connect-${source.componentId}-${target.componentId}`,
        eyebrow: "Autoritativní preview spojení",
        title: `${source.label} → ${target.label}`,
        description: compatibility.status === "INCOMPATIBLE"
          ? "Server prokázal nekompatibilitu kontraktů. Spojení lze vytvořit pouze vědomě; runtime bude nevalidní payload nadále odmítat fail-closed."
          : `Serverový výsledek kompatibility: ${compatibility.status}. Vytvoří se pouze jednosměrné spojení a přesně odvozené směrové oprávnění.`,
        details: compatibility.checks.map((check) => `${check.result} · ${check.field}: ${check.reason}`),
        confirmLabel: compatibility.status === "INCOMPATIBLE" ? "Vytvořit navzdory nekompatibilitě" : "Vytvořit spojení",
        danger: compatibility.status === "INCOMPATIBLE",
        onConfirm: async () => {
          await createDashboardConnection({
            sourceComponentId: source.componentId, sourcePortKey: source.key,
            targetComponentId: target.componentId, targetPortKey: target.key,
            grantAuthorization: true
          });
          setPendingSource(null);
          await refresh();
          return `Spojení ${source.label} → ${target.label} bylo autoritativně vytvořeno.`;
        }
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Náhled spojení se nepodařilo načíst.");
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

  const openBulkSecretDialog = async (secret: DashboardSecret) => {
    setBusy("bulk-secret");
    setError("");
    try {
      const preview = await previewBulkDashboardSecret(secret.id);
      setActionDialog({
        id: `bulk-secret-${secret.id}`,
        eyebrow: "Hromadný Secret grant",
        title: `Přidělit ${preview.stableName} všem způsobilým prvkům`,
        description: "Operace zahrne pouze aktuálně způsobilé prvky. Budoucím prvkům se Secret automaticky nepřidělí.",
        details: [
          `Způsobilé cíle: ${preview.eligibleCount}`,
          `Nové granty: ${preview.createCount}`,
          `Již přiděleno: ${preview.alreadyGrantedCount}`,
          ...preview.skipped.map((item) => `Vynecháno: ${item.label} — ${item.reason}`)
        ],
        confirmLabel: "Přidělit aktuálním prvkům",
        onConfirm: async () => {
          const result = await bulkGrantDashboardSecret(secret.id);
          const failed = result.results.filter((item) => item.status === "FAILED").length;
          const created = result.results.filter((item) => item.status === "CREATED").length;
          const existing = result.results.filter((item) => item.status === "ALREADY_GRANTED").length;
          await refresh();
          return `Secret granty: vytvořeno ${created}, již existovalo ${existing}, vynecháno ${result.skippedCount}, selhání ${failed}.`;
        }
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Náhled hromadného přidělení se nepodařilo načíst.");
    } finally {
      setBusy("");
    }
  };

  const openSuspensionDialog = (node: DashboardNode) => {
    const resume = node.suspended;
    setActionDialog({
      id: `suspension-${node.id}`,
      eyebrow: resume ? "Obnovení účinných oprávnění" : "Reverzibilní suspendace",
      title: resume ? `Obnovit oprávnění ${node.code ?? node.label}` : `Suspendovat oprávnění ${node.code ?? node.label}`,
      description: resume
        ? "Prvek i topologie zůstávají zachované. Obnoví se identita, nikoli dříve samostatně odebraná směrová oprávnění."
        : "Prvek a PULSE spojení zůstanou zachované, ale route permissions i Secret resolve budou fail-closed neúčinné.",
      confirmLabel: resume ? "Obnovit identitu" : "Suspendovat identitu",
      danger: !resume,
      reason: {
        label: resume ? "Důvod obnovení" : "Důvod suspendace",
        initialValue: resume ? "OWNER obnovil účinná oprávnění po ověření příčiny." : "OWNER dočasně pozastavil účinná oprávnění.",
        minLength: 10
      },
      onConfirm: async (reason) => {
        await setDashboardNodeSuspension(node.id, !resume, reason);
        await refresh();
        return resume ? "Účinná oprávnění identity byla obnovena." : "Identita byla reverzibilně suspendována; prvek i topologie zůstaly zachované.";
      }
    });
  };

  const openLifecycleDialog = (node: DashboardNode, operation: "QUARANTINE" | "RETIRE") => {
    const quarantine = operation === "QUARANTINE";
    setActionDialog({
      id: `lifecycle-${operation}-${node.id}`,
      eyebrow: quarantine ? "Ochranná změna lifecycle" : "Provozní vyřazení",
      title: quarantine ? `Přesunout ${node.code ?? node.label} do karantény` : `Vyřadit ${node.code ?? node.label}`,
      description: quarantine
        ? "Použije se existující lifecycle state machine. Prvek nebude odstraněn a změna zůstane auditovatelná."
        : "Retire prvek provozně vyřadí podle stávajícího lifecycle modelu. Nejde o destruktivní odregistraci.",
      confirmLabel: quarantine ? "Přesunout do karantény" : "Provést retire",
      danger: true,
      onConfirm: async () => {
        if (!node.componentId) throw new Error("Komponentová identita není dostupná.");
        await setDashboardComponentLifecycle(node.componentId, operation);
        await refresh();
        return quarantine ? "Komponenta byla přesunuta do karantény." : "Komponenta byla provozně vyřazena.";
      }
    });
  };

  const openDisconnectDialog = (edge: DashboardConnection) => {
    setActionDialog({
      id: `disconnect-${edge.id}`,
      eyebrow: "Topologická operace",
      title: `Rozpojit ${edge.sourceCode} → ${edge.targetCode}`,
      description: "Odstraní se pouze topologické spojení a oprávnění odvozené výhradně z tohoto spojení. Prvky ani celý dlouhodobý token se nesmažou.",
      details: [`Cesta volání: ${edge.route}`, `Rozsah oprávnění: ${edge.scope}`, `Cílová služba: ${edge.audience}`],
      confirmLabel: "Rozpojit spojení",
      danger: true,
      onConfirm: async () => {
        await disconnectDashboardConnection(edge.id);
        setSelectedEdgeId(null);
        await refresh();
        return `Spojení ${edge.sourceCode} → ${edge.targetCode} bylo odstraněno.`;
      }
    });
  };

  if (loading && !topology) return <div className="panel dashboard-loading"><RefreshCw className="spin" size={24} /> Načítám autoritativní topologii…</div>;
  if (!topology) return <div className="notice error"><AlertTriangle size={18} />{error || "Dashboard není dostupný."}<button onClick={() => { setLoading(true); void refresh(); }}>Zkusit znovu</button></div>;

  const contentWidth = Math.max(1400, ...topology.nodes.map((node) => node.position.x + 430), ...topology.externalNodes.map((target) => target.position.x + 360));
  const contentHeight = Math.max(850, ...topology.nodes.map((node) => node.position.y + 360), ...topology.externalNodes.map((target) => target.position.y + 260));
  const portDragSourceNode = portDragPreview ? nodeByComponent.get(portDragPreview.source.componentId) ?? null : null;
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

      {topology.alarms.length ? <section className="dashboard-alarm-strip" aria-label="Prioritní alarmy">{topology.alarms.map((alarm) => <button key={alarm.id} onClick={() => { if (alarm.objectKind === "EXTERNAL_TARGET") { setSelectedExternalId(alarm.objectId); setSelectedNodeId(null); setSelectedEdgeId(null); setSelectedPortKey(null); } else { setSelectedNodeId(alarm.objectId); setSelectedExternalId(null); setSelectedEdgeId(null); setSelectedPortKey(null); } }}><AlertTriangle size={19} /><span><strong>{alarm.severity}: {alarm.title}</strong><small>{alarm.impact} {alarm.recommendedAction}</small></span></button>)}</section> : null}
      {error ? <div className="notice error" role="alert"><AlertTriangle size={18} />{error}</div> : null}
      {notice ? <div className={`notice ${notice.kind === "success" ? "success" : "warning"}`} role="status">{notice.kind === "success" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}{notice.message}<button className="icon-only" aria-label="Skrýt oznámení" onClick={() => setNotice(null)}><XCircle size={16} /></button></div> : null}

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
              <div className="dashboard-secret-actions"><button disabled={secret.status !== "ACTIVE"} title={secret.status === "ACTIVE" ? "Hodnota se zobrazí pouze po čerstvém MFA ověření." : "Secret není aktivní."} onClick={() => setReveal({ secret, password: "", totp: "", loading: false, error: "", value: null, revealGrantId: null, expiresAt: null })}><Eye size={14} /> Zobrazit přes MFA</button><button disabled={secret.status !== "ACTIVE" || busy === "bulk-secret"} title={secret.status === "ACTIVE" ? "Přidělí Secret všem aktuálně způsobilým prvkům po potvrzení náhledu." : "Secret není aktivní."} onClick={() => { void openBulkSecretDialog(secret); }}><Zap size={14} /> Přidělit všem</button></div>
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

          {listMode ? <div className="dashboard-accessible-list">{nodes.map((node) => <article key={node.id}><header><strong>{node.code ?? node.label} · {node.displayName}</strong><span>{node.lifecyclePhase === "PRE_REGISTRATION" ? "Čeká na onboarding" : node.operationalState}</span></header><p>{node.description || "Popis není v manifestu uveden."}</p><button onClick={() => { setSelectedNodeId(node.id); setSelectedExternalId(null); setSelectedEdgeId(null); setSelectedPortKey(null); setListMode(false); }}>Otevřít na plátně</button></article>)}{topology.externalNodes.map((target) => <article key={target.id}><header><strong>{target.displayName}</strong><span>Externí služba · {target.status}</span></header><p>{target.baseUrl}</p><button onClick={() => { setSelectedExternalId(target.id); setSelectedNodeId(null); setSelectedEdgeId(null); setSelectedPortKey(null); setListMode(false); }}>Otevřít na plátně</button></article>)}</div> : <div className={`dashboard-canvas-viewport ${panning ? "panning" : ""}`} ref={canvasRef} onPointerDown={(event) => { if ((event.button === 1 || event.altKey) && canvasRef.current) { event.preventDefault(); panRef.current = { startX: event.clientX, startY: event.clientY, scrollLeft: canvasRef.current.scrollLeft, scrollTop: canvasRef.current.scrollTop }; setPanning(true); } }} title="Plátno posunete prostředním tlačítkem myši nebo Alt + tažením.">
            <div className="dashboard-canvas" style={{ width: contentWidth * zoom, height: contentHeight * zoom }}>
              <div className="dashboard-canvas-transform" style={{ width: contentWidth, height: contentHeight, transform: `scale(${zoom})` }}>
                <svg className="dashboard-edge-layer" width={contentWidth} height={contentHeight} aria-label="PULSE spojení">
                  {topology.edges.map((edge) => {
                    const source = nodeByComponent.get(edge.sourceComponentId);
                    const target = nodeByComponent.get(edge.targetComponentId);
                    if (!source || !target || !visibleNodeIds.has(source.id) || !visibleNodeIds.has(target.id)) return null;
                    const motion = liveConnected ? activeMotionForEdge(edge) : undefined;
                    const active = motion?.phase === "travelling";
                    return <g key={edge.id} className={`dashboard-edge ${edge.effectiveAuthorization === "GRANTED" ? "authorized" : "denied"} ${active ? "runtime-active" : ""} ${motion?.phase === "success" ? "runtime-success" : ""} ${motion?.phase === "failure" ? "runtime-failure" : ""}`} onClick={() => { setSelectedEdgeId(edge.id); setSelectedNodeId(null); setSelectedExternalId(null); setSelectedPortKey(null); }} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " " || (event.shiftKey && event.key === "F10") || event.key === "ContextMenu") { event.preventDefault(); setSelectedEdgeId(edge.id); setSelectedNodeId(null); setSelectedExternalId(null); setSelectedPortKey(null); } }} aria-label={`${edge.sourceCode} do ${edge.targetCode}. ${authorizationLabel(edge)}. ${compatibilityLabel(edge.compatibilityStatus)}.`}>
                      <path className="dashboard-edge-hit" d={edgePath(source, target)} /><path className="dashboard-edge-line" d={edgePath(source, target)} /><path className="dashboard-edge-flow" d={edgePath(source, target)} /><g className="dashboard-runtime-pulse" transform={active && reducedMotion ? `translate(${target.position.x - 22} ${target.position.y + NODE_HEADER_HEIGHT})` : undefined}><circle r="8" /><text x="0" y="3" textAnchor="middle">{motion?.phase === "failure" ? "!" : motion?.phase === "success" ? "✓" : "→"}</text>{active && !reducedMotion ? <animateMotion dur="1.45s" repeatCount="indefinite" path={edgePath(source, target)} /> : null}</g><circle className="dashboard-runtime-result" r="9" cx={target.position.x} cy={target.position.y + NODE_HEADER_HEIGHT} />
                    </g>;
                  })}
                  {topology.externalEdges.map((edge) => {
                    const source = nodeByComponent.get(edge.sourceComponentId);
                    const target = topology.externalNodes.find((item) => item.id === edge.externalTargetId);
                    if (!source || !target || !visibleNodeIds.has(source.id)) return null;
                    const motion = liveConnected ? activeMotionForExternalEdge(edge) : undefined;
                    const active = motion?.phase === "travelling";
                    const path = externalEdgePath(source, target);
                    return <g key={`external-${edge.id}`} className={`dashboard-edge external ${edge.effectiveAuthorization === "GRANTED" ? "authorized" : "denied"} ${active ? "runtime-active" : ""} ${motion?.phase === "success" ? "runtime-success" : ""} ${motion?.phase === "failure" ? "runtime-failure" : ""}`} onClick={() => { setSelectedExternalId(target.id); setSelectedNodeId(null); setSelectedEdgeId(null); setSelectedPortKey(null); }} role="button" tabIndex={0} aria-label={`${edge.sourceCode} do externí služby ${edge.targetDisplayName}. ${edge.effectiveAuthorization === "GRANTED" ? "Oprávnění účinné" : "Oprávnění neúčinné"}.`}>
                      <path className="dashboard-edge-hit" d={path} /><path className="dashboard-edge-line" d={path} /><path className="dashboard-edge-flow" d={path} />
                      <g className="dashboard-runtime-pulse" transform={active && reducedMotion ? `translate(${target.position.x - 22} ${target.position.y + EXTERNAL_NODE_HEADER_HEIGHT})` : undefined}><circle r="8" /><text x="0" y="3" textAnchor="middle">{motion?.phase === "failure" ? "!" : motion?.phase === "success" ? "✓" : "→"}</text>{active && !reducedMotion ? <animateMotion dur="1.35s" repeatCount="indefinite" path={path} /> : null}</g>
                      <circle className="dashboard-runtime-result" r="9" cx={target.position.x} cy={target.position.y + EXTERNAL_NODE_HEADER_HEIGHT} />
                    </g>;
                  })}
                  {portDragPreview && portDragSourceNode ? <g className={`dashboard-port-drag-preview ${portDragPreview.status.toLowerCase()}`} aria-hidden="true"><path d={portDragPath(portDragSourceNode, portDragPreview.x, portDragPreview.y)} /><circle cx={portDragPreview.x} cy={portDragPreview.y} r="7" /><text x={portDragPreview.x} y={portDragPreview.y + 3} textAnchor="middle">{portDragPreview.status === "COMPATIBLE" ? "✓" : portDragPreview.status === "INCOMPATIBLE" || portDragPreview.status === "FORBIDDEN" ? "!" : "?"}</text></g> : null}
                </svg>
                {nodes.map((node) => {
                  const componentPorts = node.componentId ? portsByComponent.get(node.componentId) ?? [] : [];
                  const incoming = componentPorts.filter((port) => port.direction === "INCOMING");
                  const outgoing = componentPorts.filter((port) => port.direction === "OUTGOING");
                  return <article key={node.id} className={`dashboard-node ${nodeStatusClass(node)} ${selectedNodeId === node.id ? "selected" : ""} ${draggingNodeId === node.id ? "dragging" : ""} ${activeMotionForNode(node)?.phase ? `process-${activeMotionForNode(node)?.phase}` : ""}`} style={{ left: node.position.x, top: node.position.y }} onClick={() => { setSelectedNodeId(node.id); setSelectedEdgeId(null); setSelectedExternalId(null); setSelectedPortKey(null); }} onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-kcml-secret")) event.preventDefault(); }} onDrop={(event) => { const secretId = event.dataTransfer.getData("application/x-kcml-secret"); if (secretId) { event.preventDefault(); void dropSecret(secretId, node.id); } }}>
                    <header className="dashboard-node-header" onPointerDown={(event) => {
                      if ((event.target as HTMLElement).closest("button,input,select,a")) return;
                      dragRef.current = { kind: "node", id: node.id, startX: event.clientX, startY: event.clientY, originX: node.position.x, originY: node.position.y }; setDraggingNodeId(node.id);
                    }}>
                      <div className="dashboard-node-title"><span className={`dashboard-node-icon ${node.lifecyclePhase === "PRE_REGISTRATION" ? "token" : "component"}`}>{node.lifecyclePhase === "PRE_REGISTRATION" ? <KeyRound size={19} /> : <Boxes size={19} />}</span><div><span className="eyebrow">{node.lifecyclePhase === "PRE_REGISTRATION" ? "Čeká na onboarding" : node.category}</span><h3>{node.code ?? node.label}</h3><p>{node.displayName}</p></div></div>
                      <span className={`dashboard-node-health ${node.critical ? "danger" : node.suspended ? "warn" : "ok"}`} title={node.critical ? "Kritický stav" : node.suspended ? "Suspendováno" : "Bez kritického alarmu"} />
                    </header>
                    {activeMotionForNode(node) ? <div className={`dashboard-process-indicator ${activeMotionForNode(node)?.phase}`} role="status" aria-live="polite"><span className="dashboard-process-spinner" /><div><strong>{activeMotionForNode(node)?.event.operationKey}</strong><small>{activeMotionForNode(node)?.phase === "travelling" ? "Probíhá korelovaná operace" : activeMotionForNode(node)?.phase === "success" ? "Operace úspěšně dokončena" : "Operace skončila chybou"}</small></div></div> : topology.activeProcesses.find((process) => process.componentId === node.componentId) ? <div className="dashboard-process-indicator travelling" role="status" aria-live="polite"><span className="dashboard-process-spinner" /><div><strong>{topology.activeProcesses.find((process) => process.componentId === node.componentId)?.name}</strong><small>Probíhá autoritativně evidovaný proces</small></div></div> : null}
                    <div className="dashboard-node-state"><span><strong>{node.operationalState}</strong><small>provoz</small></span><span><strong>{node.statistics.callCount}</strong><small>volání / 24 h</small></span><span><strong>{Math.round(node.statistics.errorRate * 100)} %</strong><small>chybovost</small></span></div>
                    {node.lifecyclePhase === "PRE_REGISTRATION" ? <div className="dashboard-node-locked"><PauseCircle size={16} /> Provozní akce jsou neaktivní do dokončení onboardingu.</div> : null}
                    <div className="dashboard-node-secrets" aria-label="Připnuté Secrets">{node.secrets.slice(0, 4).map((secret) => <button key={secret.secretId} title={`Secret ${secret.stableName}; zdroj grantu ${secret.source}`} onClick={(event) => { event.stopPropagation(); void mutate("revoke-secret", () => revokeDashboardSecret(secret.secretId, node.id)); }}><Lock size={12} />{secret.stableName}<span aria-hidden="true">×</span></button>)}{node.secrets.length > 4 ? <span>+{node.secrets.length - 4} dalších</span> : null}{node.secrets.length === 0 ? <small>Přetáhněte sem Secret kartičku</small> : null}</div>
                    {node.lifecyclePhase === "REGISTERED" ? <div className="dashboard-node-ports">
                      <div className="dashboard-port-column incoming"><span>Příchozí</span>{incoming.map((port) => {
                        const targetId = `${port.componentId}:${port.key}`;
                        const dragStatus = portDragPreview?.targetId === targetId ? portDragPreview.status.toLowerCase() : "";
                        return <button key={port.key} className={`dashboard-port ${portCompatibilityClass(port, topology.edges)} ${pendingSource || portDragPreview ? "target-candidate" : ""} ${dragTargetKey === targetId ? `drag-over drag-${dragStatus}` : ""}`} title={portHelp(port)} aria-label={portHelp(port)} onDragEnter={(event) => { if (event.dataTransfer.types.includes("application/x-kcml-port")) { event.preventDefault(); previewPortDragTarget(port); } }} onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-kcml-port")) event.preventDefault(); }} onDragLeave={() => { setDragTargetKey((current) => current === targetId ? null : current); setPortDragPreview((current) => current?.targetId === targetId ? { ...current, targetId: null, status: "UNKNOWN" } : current); }} onDrop={(event) => { const raw = event.dataTransfer.getData("application/x-kcml-port"); if (!raw) return; event.preventDefault(); const source = JSON.parse(raw) as DashboardPort; finishPortDrag(); void connect(source, port); }} onClick={(event) => { event.stopPropagation(); if (pendingSource) { void connect(pendingSource, port); } else { setSelectedPortKey(targetId); setSelectedNodeId(null); setSelectedEdgeId(null); setSelectedExternalId(null); } }}><span className="port-socket" />{port.pulseType}</button>;
                      })}</div>
                      <div className="dashboard-port-column outgoing"><span>Odchozí</span>{outgoing.map((port) => <button key={port.key} className={`dashboard-port ${portCompatibilityClass(port, topology.edges)}`} draggable title={portHelp(port)} aria-label={portHelp(port)} onDragStart={(event) => startPortDrag(event, port)} onDrag={(event) => movePortDrag(event)} onDragEnd={finishPortDrag} onClick={(event) => { event.stopPropagation(); setPendingSource(port); setSelectedPortKey(`${port.componentId}:${port.key}`); setSelectedNodeId(null); setSelectedEdgeId(null); setSelectedExternalId(null); }}><span className="port-connector" />{port.pulseType}</button>)}</div>
                    </div> : null}
                    <footer><code>{node.tokenFingerprint ?? "credential zatím nevydán"}</code><button onClick={(event) => { event.stopPropagation(); setSelectedNodeId(node.id); setSelectedEdgeId(null); setSelectedExternalId(null); setSelectedPortKey(null); }} aria-label={`Otevřít detail ${node.code ?? node.label}`}><Focus size={14} /></button></footer>
                  </article>;
                })}
                {topology.externalNodes.map((target) => {
                  const motion = motions.find(({ event }) => event.kind === "EXTERNAL" && event.externalTargetId === target.id);
                  return <article key={`external-node-${target.id}`} className={`dashboard-external-node ${target.status.toLowerCase()} ${target.circuitState.toLowerCase()} ${selectedExternalId === target.id ? "selected" : ""} ${draggingExternalId === target.id ? "dragging" : ""}`} style={{ left: target.position.x, top: target.position.y }} onClick={() => { setSelectedExternalId(target.id); setSelectedNodeId(null); setSelectedEdgeId(null); setSelectedPortKey(null); }}>
                    <header onPointerDown={(event) => { if ((event.target as HTMLElement).closest("button,a")) return; dragRef.current = { kind: "external", id: target.id, startX: event.clientX, startY: event.clientY, originX: target.position.x, originY: target.position.y }; setDraggingExternalId(target.id); }}>
                      <span className="dashboard-external-icon"><Cloud size={20} /></span><div><span className="eyebrow">Externí hranice</span><h3>{target.displayName}</h3><code>{target.targetKey}</code></div><span className={`badge ${target.status === "ACTIVE" && target.circuitState === "CLOSED" ? "ok" : "danger"}`}>{target.circuitState}</span>
                    </header>
                    {motion ? <div className={`dashboard-process-indicator ${motion.phase}`} role="status"><span className="dashboard-process-spinner" /><div><strong>{motion.event.operationKey}</strong><small>{motion.phase === "travelling" ? "Probíhá externí volání" : motion.phase === "success" ? "Externí volání dokončeno" : "Externí volání selhalo nebo bylo zablokováno"}</small></div></div> : null}
                    <div className="dashboard-node-state"><span><strong>{target.statistics.callCount}</strong><small>volání / 24 h</small></span><span><strong>{target.statistics.blockedCount}</strong><small>blokováno</small></span><span><strong>{Math.round(target.statistics.errorRate * 100)} %</strong><small>chybovost</small></span></div>
                    <p className="dashboard-external-url">{target.baseUrl}</p>
                    <footer><span>{target.status}</span><button onClick={(event) => { event.stopPropagation(); setSelectedExternalId(target.id); setSelectedNodeId(null); setSelectedEdgeId(null); setSelectedPortKey(null); }} aria-label={`Otevřít detail externí služby ${target.displayName}`}><Focus size={14} /></button></footer>
                  </article>;
                })}
              </div>
            </div>
          </div>}
          <div className="dashboard-minimap" aria-hidden="true">{nodes.map((node) => <span key={node.id} className={nodeStatusClass(node)} style={{ left: `${Math.min(94, node.position.x / contentWidth * 100)}%`, top: `${Math.min(90, node.position.y / contentHeight * 100)}%` }} />)}{topology.externalNodes.map((target) => <span key={`external-${target.id}`} className="external" style={{ left: `${Math.min(94, target.position.x / contentWidth * 100)}%`, top: `${Math.min(90, target.position.y / contentHeight * 100)}%` }} />)}</div>
        </section>

        <aside className="dashboard-context-panel" aria-label="Kontextový detail">
          <div className="dashboard-pane-head"><div><span className="eyebrow">Kontextový panel</span><h2>{selectedEdge ? "PULSE spojení" : selectedNode ? "Detail prvku" : selectedExternal ? "Externí systém" : "Vyberte objekt"}</h2></div><CircleHelp size={19} /></div>
          {!selectedNode && !selectedEdge && !selectedExternal && !selectedPort ? <div className="dashboard-context-empty"><Focus size={30} /><p>Klikněte na prvek, port, PULSE vlákno nebo externí službu. Technický detail i akce používají stejná API jako přesné sekce.</p></div> : null}
          {selectedNode ? <div className="dashboard-context-content">
            <h3>{selectedNode.code ?? selectedNode.label}</h3><p>{selectedNode.description || "Popis není v manifestu uveden."}</p>
            <dl className="dashboard-detail-list"><div><dt>Lifecycle</dt><dd>{selectedNode.lifecycleState}</dd></div><div><dt>Aktivace</dt><dd>{selectedNode.activationState}</dd></div><div><dt>Monitoring</dt><dd>{selectedNode.monitoringState}</dd></div><div><dt>Recertifikace</dt><dd>{selectedNode.recertificationState}</dd></div><div><dt>Poslední běh</dt><dd>{formatDate(selectedNode.statistics.lastRunAt)}</dd></div><div><dt>Secrets</dt><dd>{selectedNode.secrets.length}</dd></div></dl>
            {selectedNode.secrets.length ? <details className="dashboard-secret-detail"><summary>Připnuté Secret proměnné ({selectedNode.secrets.length})</summary><div>{selectedNode.secrets.map((grant) => { const secret = topology.secrets.find((item) => item.id === grant.secretId); return <article key={`${grant.secretId}-${grant.source}`}><div><strong>{grant.stableName}</strong><small>{grant.source}</small></div><div>{secret ? <button onClick={() => setReveal({ secret, password: "", totp: "", loading: false, error: "", value: null, revealGrantId: null, expiresAt: null })}><Eye size={14} /> MFA reveal</button> : null}<button onClick={() => void mutate("revoke-secret", () => revokeDashboardSecret(grant.secretId, selectedNode.id))}><Unplug size={14} /> Odebrat grant</button></div></article>; })}</div></details> : null}
            {selectedNode.lifecyclePhase === "REGISTERED" && selectedNode.componentId ? <div className="dashboard-context-actions">
              <button disabled={busy === "activation"} onClick={() => void mutate("activation", () => setDashboardComponentEnabled(selectedNode.componentId!, !selectedNode.enabled))}>{selectedNode.enabled ? <><PauseCircle size={16} /> Vypnout komponentu</> : <><PlayCircle size={16} /> Zapnout komponentu</>}</button>
              <button disabled={busy === "suspension"} onClick={() => openSuspensionDialog(selectedNode)}>{selectedNode.suspended ? <><PlayCircle size={16} /> Obnovit oprávnění</> : <><PauseCircle size={16} /> Suspendovat oprávnění</>}</button>
              <button onClick={() => void mutate("e2e", () => runDashboardComponentE2E(selectedNode.componentId!))}><Zap size={16} /> Spustit E2E</button>
              <button onClick={() => void mutate("state-query", () => runDashboardComponentStateQuery(selectedNode.componentId!))}><Search size={16} /> Full state query</button>
              <button onClick={() => void mutate("heartbeat", () => runDashboardComponentHeartbeatChallenge(selectedNode.componentId!))}><Activity size={16} /> Heartbeat challenge</button>
              {selectedNode.lifecycleState === "QUARANTINED" ? <button onClick={() => void mutate("lifecycle", () => setDashboardComponentLifecycle(selectedNode.componentId!, "RESTORE"))}><PlayCircle size={16} /> Obnovit z karantény</button> : <button onClick={() => openLifecycleDialog(selectedNode, "QUARANTINE")}><ShieldAlert size={16} /> Karanténa</button>}
              <button onClick={() => openLifecycleDialog(selectedNode, "RETIRE")}><PauseCircle size={16} /> Retire</button>
              <button onClick={() => onOpenStandardPage("components")}><Boxes size={16} /> Přesný detail komponenty</button><button onClick={() => onOpenStandardPage("identities")}><KeyRound size={16} /> Tokenová identita</button><button onClick={() => onOpenStandardPage("audit")}><Activity size={16} /> Audit a události</button><button className="danger-link" onClick={() => setDeregistrationNode(selectedNode)}><Trash2 size={16} /> Smazat prvek a registraci</button>
            </div> : <div className="dashboard-context-actions"><button onClick={() => onOpenStandardPage("identities")}><KeyRound size={16} /> Otevřít integrační token</button></div>}
          </div> : null}
          {selectedPort ? <div className="dashboard-context-content dashboard-port-detail">
            <h3>{selectedPort.direction === "OUTGOING" ? "Odchozí konektor" : "Příchozí zásuvka"}: {selectedPort.label}</h3>
            <p>PULSE – provozní impuls/volání <strong>{selectedPort.pulseType}</strong>. Údaje pocházejí z aktivní revize uloženého kontraktu; chybějící popis není v UI domýšlen.</p>
            <dl className="dashboard-detail-list"><div><dt>Směr</dt><dd>{selectedPort.direction === "OUTGOING" ? "Odchozí" : "Příchozí"}</dd></div><div><dt>Protokol</dt><dd>{selectedPort.protocol}</dd></div><div><dt>Transport</dt><dd>{selectedPort.transport}</dd></div><div><dt>Autentizační režim</dt><dd>{selectedPort.authMode}</dd></div><div><dt>Zdrojová revize</dt><dd><code>{selectedPort.revisionId}</code></dd></div><div><dt>Canonical digest</dt><dd><code>{selectedPort.contractDigest}</code></dd></div></dl>
            <section><h4>Cesty volání (route)</h4><div className="dashboard-chip-list">{selectedPort.routes.length ? selectedPort.routes.map((route) => <code key={route}>{route}</code>) : <span>Kontrakt žádnou cestu neuvádí.</span>}</div></section>
            <section><h4>Rozsahy oprávnění (scope)</h4><div className="dashboard-chip-list">{selectedPort.scopes.length ? selectedPort.scopes.map((scope) => <code key={scope}>{scope}</code>) : <span>Kontrakt žádný rozsah neuvádí.</span>}</div></section>
            <details open><summary>Požadované schéma</summary><pre>{JSON.stringify(selectedPort.requestSchema, null, 2)}</pre></details>
            <details><summary>Odpovědní schéma</summary><pre>{JSON.stringify(selectedPort.responseSchema, null, 2)}</pre></details>
            <details><summary>Úplný autoritativní kontrakt</summary><pre>{JSON.stringify(selectedPort.source, null, 2)}</pre></details>
            <div className="dashboard-context-actions">{selectedPort.direction === "OUTGOING" ? <button onClick={() => setPendingSource(selectedPort)}><Link2 size={16} /> Připojit tento konektor</button> : null}<button onClick={() => onOpenStandardPage("components")}><Boxes size={16} /> Otevřít detail komponenty</button></div>
          </div> : null}
          {selectedEdge ? <div className="dashboard-context-content">
            <h3>{selectedEdge.sourceCode} → {selectedEdge.targetCode}</h3>
            <div className={`dashboard-edge-status ${compatibilityClass(selectedEdge.compatibilityStatus)}`}><span className="port-state-icon">{selectedEdge.compatibilityStatus === "INCOMPATIBLE" ? <XCircle size={17} /> : selectedEdge.compatibilityStatus === "UNKNOWN" ? <CircleHelp size={17} /> : <CheckCircle2 size={17} />}</span><span><strong>{compatibilityLabel(selectedEdge.compatibilityStatus)}</strong><small>stav konektoru a zásuvky</small></span></div>
            <div className={`dashboard-edge-status ${selectedEdge.effectiveAuthorization === "GRANTED" ? "authorized" : "denied"}`}><span>{selectedEdge.effectiveAuthorization === "GRANTED" ? <Link2 size={17} /> : <Link2Off size={17} />}</span><span><strong>{authorizationLabel(selectedEdge)}</strong><small>stav samotného vlákna</small></span></div>
            <dl className="dashboard-detail-list"><div><dt>Cesta volání (route)</dt><dd><code>{selectedEdge.route}</code></dd></div><div><dt>Rozsah oprávnění (scope)</dt><dd><code>{selectedEdge.scope}</code></dd></div><div><dt>Cílová služba (audience)</dt><dd><code>{selectedEdge.audience}</code></dd></div><div><dt>Correlation ID</dt><dd><code>{selectedEdge.correlationId}</code></dd></div></dl>
            <div className="dashboard-context-actions"><button disabled={busy === "edge-auth"} onClick={() => void mutate("edge-auth", () => setDashboardConnectionAuthorization(selectedEdge.id, selectedEdge.effectiveAuthorization !== "GRANTED"))}>{selectedEdge.effectiveAuthorization === "GRANTED" ? <><Lock size={16} /> Odebrat oprávnění</> : <><LockKeyhole size={16} /> Udělit oprávnění</>}</button><button className="danger-link" disabled={busy === "disconnect"} onClick={() => openDisconnectDialog(selectedEdge)}><Unplug size={16} /> Rozpojit</button><button onClick={() => onOpenStandardPage("audit")}><Activity size={16} /> Otevřít audit</button></div>
            <details><summary>Technický důkaz kompatibility</summary><pre>{JSON.stringify(selectedEdge.compatibilityEvidence, null, 2)}</pre></details>
          </div> : null}
          {selectedExternal ? <div className="dashboard-context-content">
            <h3>{selectedExternal.displayName}</h3><p><code>{selectedExternal.baseUrl}</code></p>
            <div className={`dashboard-edge-status ${selectedExternal.status === "ACTIVE" ? "authorized" : "denied"}`}><Cloud size={18} /><span><strong>{selectedExternal.status}</strong><small>stav externího cíle</small></span></div>
            <div className={`dashboard-edge-status ${selectedExternal.circuitState === "CLOSED" ? "authorized" : "denied"}`}><Activity size={18} /><span><strong>Jistič {selectedExternal.circuitState}</strong><small>{selectedExternal.circuitFailureCount} / {selectedExternal.circuitFailureThreshold} selhání</small></span></div>
            <dl className="dashboard-detail-list"><div><dt>Volání za 24 h</dt><dd>{selectedExternal.statistics.callCount}</dd></div><div><dt>Úspěchy</dt><dd>{selectedExternal.statistics.successCount}</dd></div><div><dt>Selhání</dt><dd>{selectedExternal.statistics.failureCount}</dd></div><div><dt>Blokováno</dt><dd>{selectedExternal.statistics.blockedCount}</dd></div><div><dt>Poslední volání</dt><dd>{formatDate(selectedExternal.statistics.lastRunAt)}</dd></div><div><dt>Audit povinný</dt><dd>{selectedExternal.auditRequired ? "ano" : "ne"}</dd></div></dl>
            <details><summary>Povolené cesty</summary><pre>{selectedExternal.allowedPathPrefixes.join("\n") || "Nebyly deklarovány."}</pre></details>
            <div className="dashboard-context-actions"><button onClick={() => onOpenStandardPage("external")}><Cloud size={16} /> Přesná správa externích stran</button><button onClick={() => onOpenStandardPage("audit")}><Activity size={16} /> Audit externích volání</button></div>
          </div> : null}
        </aside>
      </section>

      <section className="dashboard-timeline panel"><div className="panel-head"><div><span className="eyebrow">Persistovaná runtime pravda</span><h2>Živá timeline</h2></div><span className={`badge ${liveConnected ? "ok" : "danger"}`}>{liveConnected ? "LIVE" : "ODPOJENO"}</span></div><div className="dashboard-event-list">{topology.events.slice(0, 30).map((event) => <article key={`${event.kind}-${event.id}-${event.stage}`}><span className={`dashboard-event-result ${event.stage === "STARTED" ? "running" : event.success ? "ok" : "danger"}`}>{event.stage === "STARTED" ? <PlayCircle size={15} /> : event.success ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}</span><div><strong>{event.componentCode} · {event.operationKey}</strong><small>{event.kind} · {event.stage} · {event.status} · {event.direction ?? event.externalTargetKey ?? "směr neuveden"} · {formatDate(event.occurredAt)}</small></div><code>{event.correlationId}</code></article>)}</div></section>
      {reveal ? <RevealedSecretModal state={reveal} onChange={setReveal} onClose={() => setReveal(null)} /> : null}
      {actionDialog ? <DashboardActionModal key={actionDialog.id} state={actionDialog} onClose={() => setActionDialog(null)} onCompleted={(message) => { setActionDialog(null); if (message) setNotice({ kind: "success", message }); }} /> : null}
      {deregistrationNode ? <DeregistrationModal node={deregistrationNode} onClose={() => setDeregistrationNode(null)} onCompleted={async (message) => { setSelectedNodeId(null); setNotice({ kind: "warning", message }); await refresh(); }} /> : null}
    </div>
  );
}
