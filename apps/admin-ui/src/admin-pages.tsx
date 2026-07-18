import React, { useEffect, useState } from "react";
import {
  CheckCircle2,
  Copy,
  LockKeyhole,
  LogOut,
  Plus,
  QrCode,
  RefreshCw,
  Save,
  ShieldCheck
} from "lucide-react";
import QRCode from "qrcode";
import { Modal, PageHeader } from "./common.js";
import { formatDate } from "./ui-helpers.js";
import type { AdminAccount, AdminRole, AdminSecurity } from "./types.js";

type ActionNotice = { tone: "success" | "error"; text: string };
type RecoveryCodesState = { username: string; codes: string[] } | null;
type MfaEnrollment = {
  enrollmentToken: string;
  otpauthUri: string;
  manualSecret: string;
  expiresAt: string;
};

function RecoveryCodesModal({ state, onClose }: { state: RecoveryCodesState; onClose: () => void }) {
  if (!state) return null;
  return <Modal title={`Recovery kódy: ${state.username}`} onClose={onClose}>
    <div className="secret-dialog">
      <div className="notice success"><CheckCircle2 size={18} /><span>Tyto recovery kódy si uložte. Předchozí nepoužité kódy už neplatí.</span></div>
      <pre className="test-output">{state.codes.join("\n")}</pre>
      <footer className="modal-actions"><button className="secondary" onClick={onClose}>Zavřít</button></footer>
    </div>
  </Modal>;
}

function CurrentUserMfaCard({
  security,
  busy,
  onStartEnrollment,
  onVerifyEnrollment,
  onShowRecoveryCodes
}: {
  security: AdminSecurity | null;
  busy: boolean;
  onStartEnrollment: () => Promise<MfaEnrollment>;
  onVerifyEnrollment: (input: { enrollmentToken: string; code: string }) => Promise<string[]>;
  onShowRecoveryCodes: (state: RecoveryCodesState) => void;
}) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<ActionNotice | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!enrollment) {
      setQrDataUrl("");
      return;
    }
    void QRCode.toDataURL(enrollment.otpauthUri, {
      margin: 1,
      width: 220,
      color: { dark: "#18212d", light: "#ffffff" }
    }).then((value: string) => {
      if (!cancelled) setQrDataUrl(value);
    }).catch(() => {
      if (!cancelled) setQrDataUrl("");
    });
    return () => { cancelled = true; };
  }, [enrollment]);

  async function startEnrollment() {
    setLoading(true);
    setError("");
    setNotice(null);
    try {
      const next = await onStartEnrollment();
      setEnrollment(next);
      setVerificationCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Spuštění registrace MFA selhalo.");
    } finally {
      setLoading(false);
    }
  }

  async function verifyEnrollment(event: React.FormEvent) {
    event.preventDefault();
    if (!enrollment) return;
    setVerifying(true);
    setError("");
    setNotice(null);
    try {
      const codes = await onVerifyEnrollment({ enrollmentToken: enrollment.enrollmentToken, code: verificationCode.trim() });
      setEnrollment(null);
      setVerificationCode("");
      setNotice({ tone: "success", text: "MFA bylo úspěšně aktivováno. Toto zařízení je důvěryhodné na 48 hodin." });
      onShowRecoveryCodes({ username: security?.username ?? "uživatel", codes });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ověření MFA registrace selhalo.");
    } finally {
      setVerifying(false);
    }
  }

  return <article className="panel security-panel">
    <div className="panel-head">
      <div><h2>MFA a autentifikátor</h2><p>Aktivace nebo obnova MFA probíhá zde v nastavení uživatele. Přihlášení pak vyžádá druhý krok jen na nedůvěryhodném zařízení.</p></div>
      <button className="secondary" disabled={busy || loading} onClick={() => { void startEnrollment(); }}>
        <QrCode size={16} /> {security?.mfaEnabled ? "Registrovat znovu" : "Zapnout MFA"}
      </button>
    </div>
    <div className="security-stack">
      <dl className="security-meta">
        <div><dt>Stav MFA</dt><dd>{security?.mfaEnabled ? "Aktivní" : "Vypnuto"}</dd></div>
        <div><dt>Důvěryhodné zařízení</dt><dd>MFA se znovu vyžádá nejpozději po 48 hodinách.</dd></div>
      </dl>
      {notice ? <div className={`notice ${notice.tone === "success" ? "success" : "error"}`}><CheckCircle2 size={18} /><span>{notice.text}</span></div> : null}
      {error ? <div className="notice error"><LockKeyhole size={18} /><span>{error}</span></div> : null}
      {enrollment ? <form className="security-stack security-form" onSubmit={(event) => { void verifyEnrollment(event); }}>
        <div className="mfa-enrollment">
          {qrDataUrl ? <img className="mfa-qr-image" src={qrDataUrl} alt="QR kód pro registraci MFA" /> : <div className="mfa-qr-fallback"><QrCode size={44} /></div>}
          <div className="mfa-enrollment-copy">
            <strong>1. Naskenujte QR kód v autentifikátoru</strong>
            <span>Podporované jsou běžné TOTP aplikace jako Google Authenticator, Microsoft Authenticator, 1Password nebo Aegis.</span>
            <label>Ruční seed pro případ ručního zadání
              <input value={enrollment.manualSecret} readOnly />
            </label>
            <button type="button" className="secondary" onClick={() => { void navigator.clipboard.writeText(enrollment.manualSecret); }}>
              <Copy size={16} /> Zkopírovat seed
            </button>
          </div>
        </div>
        <label>2. Ověřovací kód z aplikace
          <input value={verificationCode} onChange={(event) => setVerificationCode(event.target.value)} autoComplete="one-time-code" inputMode="numeric" placeholder="123456" />
        </label>
        <div className="field-hint">Registrace je platná do {formatDate(enrollment.expiresAt)}.</div>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={() => { setEnrollment(null); setVerificationCode(""); setError(""); }}>Zrušit</button>
          <button type="submit" disabled={verifying || verificationCode.trim().length < 6}><ShieldCheck size={16} /> Potvrdit a aktivovat</button>
        </div>
      </form> : <div className="notice">
        <ShieldCheck size={18} />
        <span>{security?.mfaEnabled ? "MFA je aktivní. Pokud měníte telefon nebo autentifikátor, spusťte novou registraci." : "MFA zatím není aktivní. Doporučený postup je zaregistrovat autentifikátor hned po prvním přihlášení."}</span>
      </div>}
    </div>
  </article>;
}

export function SecurityPage({
  security,
  onRefresh,
  onChangePassword,
  onRevokeOtherSessions,
  onRevokeSession,
  onRevokeAllSessions,
  onStartMfaEnrollment,
  onVerifyMfaEnrollment
}: {
  security: AdminSecurity | null;
  onRefresh: () => Promise<void>;
  onChangePassword: (currentPassword: string, nextPassword: string) => Promise<void>;
  onRevokeOtherSessions: () => Promise<void>;
  onRevokeSession: (sessionId: string) => Promise<void>;
  onRevokeAllSessions: () => Promise<void>;
  onStartMfaEnrollment: () => Promise<MfaEnrollment>;
  onVerifyMfaEnrollment: (input: { enrollmentToken: string; code: string }) => Promise<string[]>;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [passwordNotice, setPasswordNotice] = useState<ActionNotice | null>(null);
  const [sessionNotice, setSessionNotice] = useState<ActionNotice | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<RecoveryCodesState>(null);
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
      <PageHeader title="Bezpečnost" description="Správa hesla, MFA a aktivních administrátorských relací.">
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

        <CurrentUserMfaCard
          security={security}
          busy={busy}
          onStartEnrollment={onStartMfaEnrollment}
          onVerifyEnrollment={onVerifyMfaEnrollment}
          onShowRecoveryCodes={setRecoveryCodes}
        />

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
      <RecoveryCodesModal state={recoveryCodes} onClose={() => setRecoveryCodes(null)} />
    </>
  );
}

export function AdminAccountsPage({
  accounts,
  onRefresh,
  onCreate,
  onSetPassword,
  onRevokeSessions,
  onRotateRecovery,
  onUpdate
}: {
  accounts: AdminAccount[];
  onRefresh: () => Promise<void>;
  onCreate: (input: { username: string; password: string; role: AdminRole }) => Promise<void>;
  onSetPassword: (accountId: string, nextPassword: string) => Promise<void>;
  onRevokeSessions: (accountId: string) => Promise<void>;
  onRotateRecovery: (accountId: string) => Promise<string[]>;
  onUpdate: (accountId: string, input: { role?: AdminRole; active?: boolean }) => Promise<void>;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AdminRole>("ADMIN");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({});
  const [recoveryCodes, setRecoveryCodes] = useState<RecoveryCodesState>(null);
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
      await onCreate({ username: username.trim(), password, role });
      setUsername("");
      setPassword("");
      setRole("ADMIN");
      setMessage("Administrátorský účet byl založen. MFA si uživatel zapne ve svém nastavení.");
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

  return <>
    <PageHeader title="Administrátoři" description="Správa administrátorských účtů, hesel, recovery kódů a aktivních relací. MFA si každý uživatel aktivuje ve svém nastavení.">
      <button className="secondary" onClick={() => { void onRefresh(); }}><RefreshCw size={16} /> Obnovit</button>
    </PageHeader>
    <section className="security-grid">
      <article className="panel security-panel">
        <div className="panel-head">
          <div><h2>Založit administrátora</h2><p>Vytvoření dalšího účtu včetně počátečního hesla. MFA onboarding proběhne až po prvním přihlášení uživatele.</p></div>
        </div>
        <form className="security-stack security-form" onSubmit={(event) => { void submitCreate(event); }}>
          <label>Uživatelské jméno<input value={username} onChange={(event) => setUsername(event.target.value)} /></label>
          <label>Počáteční heslo<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <label>Role<select value={role} onChange={(event) => setRole(event.target.value as AdminRole)}><option value="ADMIN">Administrátor</option><option value="AUDITOR">Auditor</option><option value="OWNER">Vlastník</option></select></label>
          {error ? <p className="error">{error}</p> : null}
          {message ? <div className="notice success"><CheckCircle2 size={18} /><span>{message}</span></div> : null}
          <div className="modal-actions"><button type="submit" disabled={busy}><Plus size={16} /> Založit účet</button></div>
        </form>
      </article>

      <article className="panel security-panel">
        <div className="panel-head">
          <div><h2>Existující účty</h2><p>Reset hesla, revokace relací a správa recovery kódů. Stav MFA zde pouze přehledově zobrazujeme.</p></div>
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
                {deploymentManaged ? <div className="notice"><LockKeyhole size={18} /><span>Heslo a MFA spravuje deployment; v UI je nelze přepsat.</span></div> : <>
                  <label>Nové heslo účtu<input type="password" value={passwordDrafts[account.id] ?? ""} onChange={(event) => setPasswordDrafts((current) => ({ ...current, [account.id]: event.target.value }))} /></label>
                  <div className="row-actions">
                    <button className="secondary" disabled={busy || (passwordDrafts[account.id] ?? "").length < 12} onClick={() => { void runAccountAction(() => onSetPassword(account.id, passwordDrafts[account.id] ?? ""), `Heslo účtu ${account.username} bylo změněno.`, "Změna hesla selhala."); }}>Nastavit heslo</button>
                  </div>
                </>}
                <div className="notice"><ShieldCheck size={18} /><span>MFA seed se zde už ručně nezadává. Uživatel si MFA registruje sám přes QR kód ve svém nastavení.</span></div>
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
            </article>;
          })}
        </div>
      </article>
    </section>
    <RecoveryCodesModal state={recoveryCodes} onClose={() => setRecoveryCodes(null)} />
  </>;
}
