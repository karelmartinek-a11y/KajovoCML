import React, { useState } from "react";
import {
  CheckCircle2,
  LockKeyhole,
  LogOut,
  Plus,
  RefreshCw,
  Save,
} from "lucide-react";
import { Modal, PageHeader } from "./common.js";
import { formatDate } from "./ui-helpers.js";
import type { AdminAccount, AdminRole, AdminSecurity } from "./types.js";

type ActionNotice = { tone: "success" | "error"; text: string };

export function SecurityPage({
  security,
  onRefresh,
  onChangePassword,
  onRevokeOtherSessions,
  onRevokeSession,
  onRevokeAllSessions
}: {
  security: AdminSecurity | null;
  onRefresh: () => Promise<void>;
  onChangePassword: (currentPassword: string, nextPassword: string) => Promise<void>;
  onRevokeOtherSessions: () => Promise<void>;
  onRevokeSession: (sessionId: string) => Promise<void>;
  onRevokeAllSessions: () => Promise<void>;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [passwordNotice, setPasswordNotice] = useState<ActionNotice | null>(null);
  const [sessionNotice, setSessionNotice] = useState<ActionNotice | null>(null);
  const deploymentManaged = Boolean(security?.deploymentManaged);

  async function submitPassword(event: React.FormEvent) {
    event.preventDefault();
    if (nextPassword.length < 12) {
      setPasswordNotice({ tone: "error", text: "Nové heslo musí mít alespoň 12 znaků." });
      return;
    }
    if (nextPassword !== confirmPassword) {
      setPasswordNotice({ tone: "error", text: "Potvrzení hesla se neshoduje." });
      return;
    }
    setBusy(true);
    setPasswordNotice(null);
    try {
      await onChangePassword(currentPassword, nextPassword);
      setCurrentPassword("");
      setNextPassword("");
      setConfirmPassword("");
      setPasswordNotice({ tone: "success", text: "Heslo bylo změněno a ostatní relace byly odhlášeny." });
    } catch (err) {
      setPasswordNotice({ tone: "error", text: err instanceof Error ? err.message : "Změna hesla selhala." });
    } finally {
      setBusy(false);
    }
  }

  async function revokeOthers() {
    setBusy(true);
    setSessionNotice(null);
    try {
      await onRevokeOtherSessions();
      setSessionNotice({ tone: "success", text: "Ostatní aktivní relace byly revokovány." });
    } catch (err) {
      setSessionNotice({ tone: "error", text: err instanceof Error ? err.message : "Revokace relací selhala." });
    } finally {
      setBusy(false);
    }
  }

  async function revokeAll() {
    setBusy(true);
    setSessionNotice(null);
    try {
      await onRevokeAllSessions();
      setSessionNotice({ tone: "success", text: "Všechny relace byly revokovány." });
    } catch (err) {
      setSessionNotice({ tone: "error", text: err instanceof Error ? err.message : "Revokace všech relací selhala." });
    } finally {
      setBusy(false);
    }
  }

  async function revokeSession(sessionId: string) {
    setBusy(true);
    setSessionNotice(null);
    try {
      await onRevokeSession(sessionId);
      setSessionNotice({ tone: "success", text: `Relace ${sessionId} byla revokována.` });
    } catch (err) {
      setSessionNotice({ tone: "error", text: err instanceof Error ? err.message : "Revokace relace selhala." });
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
            {deploymentManaged ? <div className="notice"><LockKeyhole size={18} /><span>Heslo a MFA tohoto účtu synchronizuje výhradně produkční deployment z chráněného PASS.</span></div> : <form className="security-form" onSubmit={(event) => { void submitPassword(event); }}>
              <label>Současné heslo<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
              <label>Nové heslo<input type="password" autoComplete="new-password" value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} /></label>
              <label>Potvrzení nového hesla<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
              {passwordNotice ? <div className={`notice ${passwordNotice.tone === "success" ? "success" : "error"}`}><CheckCircle2 size={18} /><span>{passwordNotice.text}</span></div> : null}
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
            <button className="danger-button" disabled={busy || !security?.sessions.length} onClick={() => { void revokeAll(); }}><LogOut size={16} /> Odhlásit všechna zařízení</button>
          </div>
          {sessionNotice ? <div className={`notice ${sessionNotice.tone === "success" ? "success" : "error"}`}><CheckCircle2 size={18} /><span>{sessionNotice.text}</span></div> : null}
          {!security ? <div className="empty-state"><LockKeyhole size={34} /><strong>Načítám bezpečnostní profil</strong></div> : (
            <div className="table-scroll">
              <table>
                <thead><tr><th>Relace</th><th>Vznik</th><th>Expirace</th><th>Stav</th><th>Akce</th></tr></thead>
                <tbody>
                  {security.sessions.map((session) => (
                    <tr key={session.id}>
                      <td><code>{session.id}</code></td>
                      <td>{formatDate(session.createdAt)}</td>
                      <td>{formatDate(session.expiresAt)}</td>
                      <td><span className={`badge ${session.current ? "ok" : "neutral"}`}>{session.current ? "Aktuální zařízení" : "Aktivní"}</span></td>
                      <td>{session.current ? "-" : <button className="small-button" disabled={busy} onClick={() => { void revokeSession(session.id); }}>Odvolat</button>}</td>
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
  onRotateRecovery,
  onUpdate
}: {
  accounts: AdminAccount[];
  onRefresh: () => Promise<void>;
  onCreate: (input: { username: string; password: string; mfaSecret: string; role: AdminRole }) => Promise<void>;
  onSetPassword: (accountId: string, nextPassword: string) => Promise<void>;
  onSetMfa: (accountId: string, enabled: boolean, secret: string) => Promise<void>;
  onRevokeSessions: (accountId: string) => Promise<void>;
  onRotateRecovery: (accountId: string) => Promise<string[]>;
  onUpdate: (accountId: string, input: { role?: AdminRole; active?: boolean }) => Promise<void>;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mfaSecret, setMfaSecret] = useState("");
  const [role, setRole] = useState<AdminRole>("ADMIN");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({});
  const [mfaDrafts, setMfaDrafts] = useState<Record<string, string>>({});
  const [recoveryCodes, setRecoveryCodes] = useState<{ username: string; codes: string[] } | null>(null);
  const [actionNotice, setActionNotice] = useState<ActionNotice | null>(null);

  async function submitCreate(event: React.FormEvent) {
    event.preventDefault();
    if (username.trim().length < 3) {
      setError("Uživatelské jméno musí mít alespoň 3 znaky.");
      return;
    }
    if (password.length < 12) {
      setError("Počáteční heslo musí mít alespoň 12 znaků.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    setActionNotice(null);
    try {
      await onCreate({ username: username.trim(), password, mfaSecret: mfaSecret.trim(), role });
      setUsername("");
      setPassword("");
      setMfaSecret("");
      setRole("ADMIN");
      setMessage("Administrátorský účet byl založen.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Založení účtu selhalo.");
    } finally {
      setBusy(false);
    }
  }

  async function runAccountAction(action: () => Promise<void>, successMessage: string, failureMessage: string) {
    setBusy(true);
    setError("");
    setMessage("");
    setActionNotice(null);
    try {
      await action();
      setActionNotice({ tone: "success", text: successMessage });
    } catch (err) {
      setActionNotice({ tone: "error", text: err instanceof Error ? err.message : failureMessage });
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
            <label>MFA tajemství (volitelné)<input type="password" value={mfaSecret} onChange={(event) => setMfaSecret(event.target.value)} autoComplete="new-password" placeholder="Base32 seed pro TOTP" /></label>
            <label>Role<select value={role} onChange={(event) => setRole(event.target.value as AdminRole)}><option value="ADMIN">Administrátor</option><option value="AUDITOR">Auditor</option><option value="OWNER">Vlastník</option></select></label>
            {error ? <p className="error">{error}</p> : null}
            {message ? <div className="notice success"><CheckCircle2 size={18} /><span>{message}</span></div> : null}
            <div className="modal-actions"><button type="submit" disabled={busy}><Plus size={16} /> Založit účet</button></div>
          </form>
        </article>
        <article className="panel security-panel">
          <div className="panel-head">
            <div><h2>Existující účty</h2><p>Reset hesla, zapnutí nebo vypnutí MFA a revokace všech relací účtu.</p></div>
          </div>
          {actionNotice ? <div className={`notice ${actionNotice.tone === "success" ? "success" : "error"}`}><CheckCircle2 size={18} /><span>{actionNotice.text}</span></div> : null}
          <div className="admin-account-list">
            {accounts.map((account) => {
              const deploymentManaged = account.deploymentManaged;
              return <article key={account.id} className="admin-account-card">
                <div className="admin-account-head">
                  <div><strong>{account.username}</strong><small>{account.current ? "Aktuální účet" : "Administrátor"}</small></div>
                  <div className="row-actions">
                    <span className={`badge ${account.active ? "ok" : "danger"}`}>{account.active ? "Aktivní" : "Deaktivován"}</span>
                    <span className="badge neutral">{account.role}</span>
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
                  <label>Role<select value={account.role} disabled={busy} onChange={(event) => { void runAccountAction(() => onUpdate(account.id, { role: event.target.value as AdminRole }), `Role účtu ${account.username} byla změněna.`, "Změna role selhala."); }}><option value="OWNER">Vlastník</option><option value="ADMIN">Administrátor</option><option value="AUDITOR">Auditor</option></select></label>
                  <div className="row-actions"><button className={`secondary ${account.active ? "danger-link" : ""}`} disabled={busy} onClick={() => { void runAccountAction(() => onUpdate(account.id, { active: !account.active }), account.active ? `Účet ${account.username} byl deaktivován.` : `Účet ${account.username} byl aktivován.`, "Změna aktivity selhala."); }}>{account.active ? "Deaktivovat účet" : "Aktivovat účet"}</button></div>
                  {deploymentManaged ? <div className="notice"><LockKeyhole size={18} /><span>Heslo a MFA spravuje deployment; v UI je nelze přepsat.</span></div> : <><label>Nové heslo účtu<input type="password" value={passwordDrafts[account.id] ?? ""} onChange={(event) => setPasswordDrafts((current) => ({ ...current, [account.id]: event.target.value }))} /></label>
                  <div className="row-actions">
                    <button className="secondary" disabled={busy || (passwordDrafts[account.id] ?? "").length < 12} onClick={() => { void runAccountAction(() => onSetPassword(account.id, passwordDrafts[account.id] ?? ""), `Heslo účtu ${account.username} bylo změněno.`, "Změna hesla selhala."); }}>Nastavit heslo</button>
                  </div>
                  <label>MFA seed<input type="password" value={mfaDrafts[account.id] ?? ""} onChange={(event) => setMfaDrafts((current) => ({ ...current, [account.id]: event.target.value }))} autoComplete="new-password" placeholder="Vyplňte pro zapnutí nebo rotaci MFA" /></label>
                  <div className="row-actions">
                    <button className="secondary" disabled={busy || !(mfaDrafts[account.id] ?? "").trim()} onClick={() => { void runAccountAction(() => onSetMfa(account.id, true, mfaDrafts[account.id] ?? ""), `MFA účtu ${account.username} bylo nastaveno.`, "Nastavení MFA selhalo."); }}>Zapnout/rotovat MFA</button>
                    <button className="secondary danger-link" disabled={busy} onClick={() => { void runAccountAction(() => onSetMfa(account.id, false, ""), `MFA účtu ${account.username} bylo vypnuto.`, "Vypnutí MFA selhalo."); }}>Vypnout MFA</button>
                  </div></>}
                  <div className="row-actions">
                    <button className="secondary" disabled={busy} onClick={() => { void runAccountAction(() => onRevokeSessions(account.id), `Relace účtu ${account.username} byly revokovány.`, "Revokace relací selhala."); }}>Revokovat relace</button>
                    <button className="secondary" disabled={busy} onClick={() => { void (async () => {
                      setBusy(true);
                      setError("");
                      setMessage("");
                      setActionNotice(null);
                      try {
                        const codes = await onRotateRecovery(account.id);
                        setRecoveryCodes({ username: account.username, codes });
                        setActionNotice({ tone: "success", text: `Recovery kódy účtu ${account.username} byly rotovány.` });
                      } catch (err) {
                        setActionNotice({ tone: "error", text: err instanceof Error ? err.message : "Rotace recovery kódů selhala." });
                      } finally {
                        setBusy(false);
                      }
                    })(); }}>Rotovat recovery kódy</button>
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
