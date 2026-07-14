import React, { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  LockKeyhole,
  LogOut,
  Plus,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal
} from "lucide-react";
import { Modal, PageHeader } from "./common.js";
import { formatDate } from "./ui-helpers.js";
import type { AdminAccount, AdminSecurity, OperationalConfigSetting } from "./types.js";

export function SecurityPage({
  security,
  onRefresh,
  onChangePassword,
  onRevokeOtherSessions
}: {
  security: AdminSecurity | null;
  onRefresh: () => Promise<void>;
  onChangePassword: (currentPassword: string, nextPassword: string) => Promise<void>;
  onRevokeOtherSessions: () => Promise<void>;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const deploymentManaged = security?.username === "karmar78";

  async function submitPassword(event: React.FormEvent) {
    event.preventDefault();
    if (nextPassword.length < 12) {
      setError("Nové heslo musí mít alespoň 12 znaků.");
      return;
    }
    if (nextPassword !== confirmPassword) {
      setError("Potvrzení hesla se neshoduje.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await onChangePassword(currentPassword, nextPassword);
      setCurrentPassword("");
      setNextPassword("");
      setConfirmPassword("");
      setMessage("Heslo bylo změněno a ostatní relace byly odhlášeny.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Změna hesla selhala.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeOthers() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await onRevokeOtherSessions();
      setMessage("Ostatní aktivní relace byly revokovány.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Revokace relací selhala.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Bezpečnost" description="Správa hesla a aktivních administrátorských relací.">
        <button className="secondary" onClick={() => { void onRefresh(); }}><RefreshCw size={16} /> Obnovit</button>
      </PageHeader>
      <section className="security-grid">
        <article className="panel security-panel">
          <div className="panel-head">
            <div><h2>Přihlášení a heslo</h2><p>Účet, poslední změna hesla a bezpečná rotace přístupu.</p></div>
          </div>
          <div className="security-stack">
            <dl className="security-meta">
              <div><dt>Uživatel</dt><dd>{security?.username ?? "Načítám…"}</dd></div>
              <div><dt>Heslo změněno</dt><dd>{security ? formatDate(security.passwordChangedAt) : "Načítám…"}</dd></div>
            </dl>
            {deploymentManaged ? <div className="notice"><LockKeyhole size={18} /><span>Heslo a MFA účtu karmar78 synchronizuje výhradně produkční deployment z chráněného PASS.</span></div> : <form className="security-form" onSubmit={(event) => { void submitPassword(event); }}>
              <label>Současné heslo<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
              <label>Nové heslo<input type="password" autoComplete="new-password" value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} /></label>
              <label>Potvrzení nového hesla<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
              {error ? <p className="error">{error}</p> : null}
              {message ? <div className="notice success"><CheckCircle2 size={18} /><span>{message}</span></div> : null}
              <div className="modal-actions">
                <button type="submit" disabled={busy}><Save size={16} /> Změnit heslo</button>
              </div>
            </form>}
          </div>
        </article>
        <article className="panel security-panel">
          <div className="panel-head">
            <div><h2>Aktivní relace</h2><p>Přehled otevřených relací tohoto účtu a možnost odhlásit ostatní zařízení.</p></div>
            <button className="secondary" disabled={busy || !security || security.sessions.length <= 1} onClick={() => { void revokeOthers(); }}><LogOut size={16} /> Odhlásit ostatní</button>
          </div>
          {!security ? <div className="empty-state"><LockKeyhole size={34} /><strong>Načítám bezpečnostní profil</strong></div> : (
            <div className="table-scroll">
              <table>
                <thead><tr><th>Relace</th><th>Vznik</th><th>Expirace</th><th>Stav</th></tr></thead>
                <tbody>
                  {security.sessions.map((session) => (
                    <tr key={session.id}>
                      <td><code>{session.id}</code></td>
                      <td>{formatDate(session.createdAt)}</td>
                      <td>{formatDate(session.expiresAt)}</td>
                      <td><span className={`badge ${session.current ? "ok" : "neutral"}`}>{session.current ? "Aktuální zařízení" : "Aktivní"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </section>
    </>
  );
}

export function AdminAccountsPage({
  accounts,
  onRefresh,
  onCreate,
  onSetPassword,
  onSetMfa,
  onRevokeSessions,
  onRotateRecovery
}: {
  accounts: AdminAccount[];
  onRefresh: () => Promise<void>;
  onCreate: (input: { username: string; password: string; mfaSecret: string }) => Promise<void>;
  onSetPassword: (accountId: string, nextPassword: string) => Promise<void>;
  onSetMfa: (accountId: string, enabled: boolean, secret: string) => Promise<void>;
  onRevokeSessions: (accountId: string) => Promise<void>;
  onRotateRecovery: (accountId: string) => Promise<string[]>;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mfaSecret, setMfaSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({});
  const [mfaDrafts, setMfaDrafts] = useState<Record<string, string>>({});
  const [recoveryCodes, setRecoveryCodes] = useState<{ username: string; codes: string[] } | null>(null);

  async function submitCreate(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await onCreate({ username, password, mfaSecret });
      setUsername("");
      setPassword("");
      setMfaSecret("");
      setMessage("Administrátorský účet byl založen.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Založení účtu selhalo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Administrátoři" description="Správa administrátorských účtů, hesel, MFA a aktivních relací.">
        <button className="secondary" onClick={() => { void onRefresh(); }}><RefreshCw size={16} /> Obnovit</button>
      </PageHeader>
      <section className="security-grid">
        <article className="panel security-panel">
          <div className="panel-head">
            <div><h2>Založit administrátora</h2><p>Vytvoření dalšího účtu včetně počátečního hesla a volitelného MFA seedu.</p></div>
          </div>
          <form className="security-stack security-form" onSubmit={(event) => { void submitCreate(event); }}>
            <label>Uživatelské jméno<input value={username} onChange={(event) => setUsername(event.target.value)} /></label>
            <label>Počáteční heslo<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <label>MFA tajemství (volitelné)<textarea rows={3} value={mfaSecret} onChange={(event) => setMfaSecret(event.target.value)} placeholder="Base32 seed pro TOTP" /></label>
            {error ? <p className="error">{error}</p> : null}
            {message ? <div className="notice success"><CheckCircle2 size={18} /><span>{message}</span></div> : null}
            <div className="modal-actions"><button type="submit" disabled={busy}><Plus size={16} /> Založit účet</button></div>
          </form>
        </article>
        <article className="panel security-panel">
          <div className="panel-head">
            <div><h2>Existující účty</h2><p>Reset hesla, zapnutí nebo vypnutí MFA a revokace všech relací účtu.</p></div>
          </div>
          <div className="admin-account-list">
            {accounts.map((account) => {
              const deploymentManaged = account.username === "karmar78";
              return <article key={account.id} className="admin-account-card">
                <div className="admin-account-head">
                  <div><strong>{account.username}</strong><small>{account.current ? "Aktuální účet" : "Administrátor"}</small></div>
                  <div className="row-actions">
                    <span className={`badge ${account.mfaEnabled ? "ok" : "warn"}`}>{account.mfaEnabled ? "MFA zapnuto" : "Bez MFA"}</span>
                    {deploymentManaged ? <span className="badge ok">Řízeno deploymentem</span> : null}
                    <span className="badge neutral">{account.activeSessionCount} relací</span>
                    <span className="badge neutral">{account.recoveryCodeCount} recovery</span>
                  </div>
                </div>
                <dl className="security-meta">
                  <div><dt>Založen</dt><dd>{formatDate(account.createdAt)}</dd></div>
                  <div><dt>Heslo změněno</dt><dd>{formatDate(account.passwordChangedAt)}</dd></div>
                </dl>
                <div className="security-stack">
                  {deploymentManaged ? <div className="notice"><LockKeyhole size={18} /><span>Heslo a MFA spravuje deployment; v UI je nelze přepsat.</span></div> : <><label>Nové heslo účtu<input type="password" value={passwordDrafts[account.id] ?? ""} onChange={(event) => setPasswordDrafts((current) => ({ ...current, [account.id]: event.target.value }))} /></label>
                  <div className="row-actions">
                    <button className="secondary" onClick={() => { void onSetPassword(account.id, passwordDrafts[account.id] ?? ""); }}>Nastavit heslo</button>
                  </div>
                  <label>MFA seed<input value={mfaDrafts[account.id] ?? ""} onChange={(event) => setMfaDrafts((current) => ({ ...current, [account.id]: event.target.value }))} placeholder="Vyplňte pro zapnutí nebo rotaci MFA" /></label>
                  <div className="row-actions">
                    <button className="secondary" onClick={() => { void onSetMfa(account.id, true, mfaDrafts[account.id] ?? ""); }}>Zapnout/rotovat MFA</button>
                    <button className="secondary danger-link" onClick={() => { void onSetMfa(account.id, false, ""); }}>Vypnout MFA</button>
                  </div></>}
                  <div className="row-actions">
                    <button className="secondary" onClick={() => { void onRevokeSessions(account.id); }}>Revokovat relace</button>
                    <button className="secondary" onClick={() => { void onRotateRecovery(account.id).then((codes) => setRecoveryCodes({ username: account.username, codes })); }}>Rotovat recovery kódy</button>
                  </div>
                </div>
              </article>
            })}
          </div>
        </article>
      </section>
      {recoveryCodes ? <Modal title={`Recovery kódy: ${recoveryCodes.username}`} onClose={() => setRecoveryCodes(null)}>
        <div className="secret-dialog">
          <div className="notice success"><CheckCircle2 size={18} /><span>Nové recovery kódy byly vygenerovány. Předchozí nepoužité kódy už neplatí.</span></div>
          <pre className="test-output">{recoveryCodes.codes.join("\n")}</pre>
          <footer className="modal-actions"><button className="secondary" onClick={() => setRecoveryCodes(null)}>Zavřít</button></footer>
        </div>
      </Modal> : null}
    </>
  );
}

export function OperationalConfigPage({
  settings,
  onRefresh,
  onSave
}: {
  settings: OperationalConfigSetting[];
  onRefresh: () => Promise<void>;
  onSave: (setting: OperationalConfigSetting, value: string | number | boolean) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const filtered = settings.filter((setting) =>
    `${setting.key} ${setting.envKey} ${setting.label}`.toLowerCase().includes(query.toLowerCase())
  );

  async function save(setting: OperationalConfigSetting) {
    const raw = drafts[setting.key] ?? (setting.value === null ? "" : String(setting.value));
    const value = setting.kind === "number" ? Number(raw) : raw;
    setSavingKey(setting.key);
    setError("");
    setMessage("");
    try {
      await onSave(setting, value);
      setDrafts((current) => ({ ...current, [setting.key]: "" }));
      setMessage(`${setting.label} bylo uloženo. Změna se projeví po restartu příslušného procesu.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Uložení konfigurace selhalo.");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <>
      <PageHeader title="Konfigurace" description="Spravovaný registr provozních hodnot, který nahrazuje ruční úpravy .env pro běžné provozní změny.">
        <label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hledat konfiguraci..." aria-label="Hledat konfiguraci" /></label>
        <button className="secondary" onClick={() => { void onRefresh(); }}><RefreshCw size={16} /> Obnovit</button>
      </PageHeader>
      {message ? <div className="notice success"><CheckCircle2 size={18} /><span>{message}</span></div> : null}
      {error ? <div className="notice error"><AlertTriangle size={18} /><span>{error}</span></div> : null}
      <section className="config-grid">
        {filtered.map((setting) => {
          const draft = drafts[setting.key] ?? String(setting.value ?? "");
          return (
            <article key={setting.key} className={`panel config-card ${setting.bootstrapOnly ? "locked" : ""}`}>
              <div className="panel-head">
                <div>
                  <h2>{setting.label}</h2>
                  <p>{setting.envKey}</p>
                </div>
                <div className="row-actions">
                  <span className={`badge ${setting.source === "database" ? "ok" : "neutral"}`}>{setting.source === "database" ? "DB" : "Bootstrap"}</span>
                  {setting.restartRequired ? <span className="badge warn">Restart</span> : null}
                  {setting.bootstrapOnly ? <span className="badge danger">Bootstrap-only</span> : null}
                </div>
              </div>
              <div className="config-card-body">
                <label>Hodnota<input disabled={setting.bootstrapOnly} type={setting.kind === "number" ? "number" : "text"} value={draft} onChange={(event) => setDrafts((current) => ({ ...current, [setting.key]: event.target.value }))} /></label>
                <dl className="config-meta">
                  <div><dt>Klíč</dt><dd><code>{setting.key}</code></dd></div>
                  <div><dt>Typ</dt><dd>{setting.kind}</dd></div>
                  <div><dt>Upraveno</dt><dd>{formatDate(setting.updatedAt)}</dd></div>
                </dl>
                <footer className="modal-actions">
                  <button disabled={setting.bootstrapOnly || savingKey === setting.key} onClick={() => { void save(setting); }}><Save size={16} /> Uložit</button>
                </footer>
              </div>
            </article>
          );
        })}
      </section>
      {filtered.length === 0 ? <div className="empty-state"><SlidersHorizontal size={34} /><strong>Žádná konfigurační hodnota neodpovídá hledání</strong></div> : null}
    </>
  );
}
