import React, { useState } from "react";
import { CheckCircle2, Clock3, KeyRound, ShieldCheck } from "lucide-react";
import { Modal } from "./common.js";
import { api, csrf } from "./ui-helpers.js";

export function Login({ notice, onLogin }: { notice?: string; onLogin: () => void }) {
  const [username, setUsername] = useState("");
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
  return <main className="login-shell"><section className="login-panel">
    <div className="brand-row"><ShieldCheck size={28} /><strong>KCML</strong></div>
    <h1>Správce MCP serverů</h1>
    {notice ? <div className="login-notice" role="status"><Clock3 size={18} /><span><strong>Je nutné se znovu přihlásit</strong>{notice}</span></div> : null}
    <form onSubmit={(event) => { void submit(event); }}>
      <label>Uživatel<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" /></label>
      <label>Heslo<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" /></label>
      <label>MFA nebo recovery kód<input value={totp} onChange={(event) => setTotp(event.target.value)} autoComplete="one-time-code" /></label>
      {error ? <p className="error">{error}</p> : null}
      <button type="submit"><KeyRound size={18} /> Přihlásit</button>
    </form>
  </section></main>;
}

export function BootstrapPage({ onComplete }: { onComplete: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mfaSecret, setMfaSecret] = useState("");
  const [bootstrapSecret, setBootstrapSecret] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const result = await api<{ recoveryCodes: string[] }>("/api/bootstrap", {
        method: "POST",
        body: JSON.stringify({ username, password, mfaSecret, bootstrapSecret: bootstrapSecret || undefined })
      });
      setRecoveryCodes(result.recoveryCodes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "První nastavení selhalo.");
    }
  }
  return <main className="login-shell"><section className="login-panel">
    <div className="brand-row"><ShieldCheck size={28} /><strong>KCML</strong></div>
    <h1>První bezpečné nastavení</h1>
    {recoveryCodes ? <div className="security-stack">
      <div className="notice success"><CheckCircle2 size={18} /><span>Vlastník byl vytvořen. Recovery kódy se zobrazují pouze nyní.</span></div>
      <pre className="test-output">{recoveryCodes.join("\n")}</pre>
      <button onClick={onComplete}>Pokračovat k přihlášení</button>
    </div> : <form onSubmit={(event) => { void submit(event); }}>
      <label>Uživatelské jméno vlastníka<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" /></label>
      <label>Heslo<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /></label>
      <label>MFA tajemství<input type="password" value={mfaSecret} onChange={(event) => setMfaSecret(event.target.value)} autoComplete="new-password" /></label>
      <label>Bootstrap secret pro vzdálené nastavení (volitelné)<input type="password" value={bootstrapSecret} onChange={(event) => setBootstrapSecret(event.target.value)} autoComplete="off" /></label>
      {error ? <p className="error">{error}</p> : null}
      <button type="submit"><ShieldCheck size={18} /> Vytvořit vlastníka</button>
    </form>}
  </section></main>;
}

export function ReauthModal({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api("/api/reauth", { method: "POST", headers: { "x-csrf-token": csrf() }, body: JSON.stringify({ password, totp }) });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Opětovné ověření selhalo.");
    }
  }
  return <Modal title="Potvrdit citlivou operaci" onClose={onClose}><form className="modal-form" onSubmit={(event) => { void submit(event); }}>
    <p>Zadejte znovu heslo a MFA kód. Ověření bude platit deset minut.</p>
    <label>Heslo<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label>
    <label>MFA kód<input value={totp} onChange={(event) => setTotp(event.target.value)} autoComplete="one-time-code" /></label>
    {error ? <p className="error">{error}</p> : null}
    <footer className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Zrušit</button><button type="submit">Ověřit</button></footer>
  </form></Modal>;
}
