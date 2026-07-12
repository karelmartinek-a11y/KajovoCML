import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Activity, KeyRound, LogOut, RefreshCw, ShieldCheck, Terminal, TriangleAlert } from "lucide-react";
import "./styles.css";

type Session = { authenticated: boolean; account: string | null };
type Server = {
  id: string;
  code: string;
  hostname: string;
  displayName: string;
  registrationState: string;
  operationalState: string;
  enabled: boolean;
};
type AuditEvent = { id: number; event_type: string; actor_type: string; object_type: string; object_id: string; correlation_id: string; created_at: string };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "include", headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, ...init });
  if (!res.ok) {
    const body = await res.json().catch((): { error?: string } => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

function csrf(): string {
  return document.cookie.split("; ").find((row) => row.startsWith("__Host-kcml_csrf="))?.split("=")[1] ?? "";
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("karmar78");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api("/api/login", { method: "POST", body: JSON.stringify({ username, password, totp }) });
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Přihlášení selhalo");
    }
  }
  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="brand-row"><ShieldCheck size={28} /><strong>KCML</strong></div>
        <h1>Správce MCP serverů</h1>
        <form onSubmit={(event) => { void submit(event); }}>
          <label>Uživatel<input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" /></label>
          <label>Heslo<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" /></label>
          <label>MFA kód<input value={totp} onChange={(e) => setTotp(e.target.value)} inputMode="numeric" autoComplete="one-time-code" /></label>
          {error && <p className="error">{error}</p>}
          <button type="submit"><KeyRound size={18} /> Přihlásit</button>
        </form>
      </section>
    </main>
  );
}

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [servers, setServers] = useState<Server[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [secret, setSecret] = useState<{ publicId: string; clientSecret: string; fingerprint: string } | null>(null);
  const [error, setError] = useState("");
  async function load() {
    setError("");
    try {
      const [serverRes, auditRes] = await Promise.all([
        api<{ servers: Server[] }>("/api/mcp-servers"),
        api<{ events: AuditEvent[] }>("/api/audit")
      ]);
      setServers(serverRes.servers);
      setEvents(auditRes.events);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Načtení selhalo");
    }
  }
  useEffect(() => { void load(); }, []);
  async function createKaja() {
    setSecret(await api("/api/kaja", { method: "POST", headers: { "x-csrf-token": csrf() }, body: "{}" }));
    await load();
  }
  async function logout() {
    await api("/api/logout", { method: "POST", body: "{}" });
    onLogout();
  }
  return (
    <main className="app-shell">
      <aside>
        <div className="brand-row"><ShieldCheck size={24} /><strong>KCML</strong></div>
        <nav>
          <a className="active"><Activity size={18} /> Monitoring</a>
          <a><Terminal size={18} /> Audit</a>
          <a><KeyRound size={18} /> Kaja</a>
        </nav>
      </aside>
      <section className="workspace">
        <header>
          <div><h1>Produkční správa</h1><p>Nultá verze bez registrovaných MCP serverů je platný bezpečný stav.</p></div>
          <div className="actions">
            <button onClick={() => { void load(); }}><RefreshCw size={17} /> Obnovit</button>
            <button onClick={() => { void logout(); }}><LogOut size={17} /> Odhlásit</button>
          </div>
        </header>
        {error && <div className="notice error"><TriangleAlert size={18} /> {error}</div>}
        <section className="metrics">
          <article><span>Katalog</span><strong>{servers.length}</strong><small>registrovaných KCML serverů</small></article>
          <article><span>Audit</span><strong>{events.length}</strong><small>posledních událostí</small></article>
          <article><span>Fail-closed</span><strong>ON</strong><small>neznámé hosty se odmítají</small></article>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>MCP katalog</h2><button onClick={() => { void createKaja(); }}><KeyRound size={16} /> Vytvořit Kaja pověření</button></div>
          {secret && <div className="secret-once"><strong>{secret.publicId}</strong><code>{secret.clientSecret}</code><span>Fingerprint {secret.fingerprint}. Tato hodnota se zobrazuje přesně jednou.</span></div>}
          {servers.length === 0 ? <div className="empty">Katalog je prázdný. Žádná demo data nebyla vytvořena.</div> : (
            <table><thead><tr><th>Kód</th><th>Hostname</th><th>Registrace</th><th>Provoz</th><th>Zapnuto</th></tr></thead>
              <tbody>{servers.map((server) => <tr key={server.id}><td>{server.code}</td><td>{server.hostname}</td><td>{server.registrationState}</td><td>{server.operationalState}</td><td>{server.enabled ? "Ano" : "Ne"}</td></tr>)}</tbody></table>
          )}
        </section>
        <section className="panel">
          <h2>Audit</h2>
          <table><thead><tr><th>ID</th><th>Událost</th><th>Objekt</th><th>Čas UTC</th><th>Correlation ID</th></tr></thead>
            <tbody>{events.map((event) => <tr key={event.id}><td>{event.id}</td><td>{event.event_type}</td><td>{event.object_type ?? ""}</td><td>{new Date(event.created_at).toISOString()}</td><td><code>{event.correlation_id}</code></td></tr>)}</tbody></table>
        </section>
      </section>
    </main>
  );
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => { void api<Session>("/api/session").then(setSession).catch(() => setSession({ authenticated: false, account: null })); }, []);
  if (!session) return <main className="loading">Načítám</main>;
  return session.authenticated ? <Dashboard onLogout={() => setSession({ authenticated: false, account: null })} /> : <Login onLogin={() => setSession({ authenticated: true, account: "karmar78" })} />;
}

createRoot(document.getElementById("root")!).render(<App />);
