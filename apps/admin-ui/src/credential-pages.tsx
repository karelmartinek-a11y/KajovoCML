import React, { useState } from "react";
import { CalendarDays, ChevronDown, CircleHelp, ClipboardCopy, KeyRound, LockKeyhole, Plus, RefreshCw, Save, Search, Server as ServerIcon } from "lucide-react";
import { IconButton, Modal, PageHeader } from "./common.js";
import { accessLabels, type KajaCredential, type KajaPermission, type SecretResult, type Server } from "./types.js";
import { api, csrf, formatDate, statusClass } from "./ui-helpers.js";

export function CreateCredentialModal({ serverCount, onClose, onCreated }: { serverCount: number; onClose: () => void; onCreated: (secret: SecretResult) => void }) {
  const [label, setLabel] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const submittedLabel = label.trim();
    if (!submittedLabel) { setError("Zadej označení pověření."); return; }
    setError("");
    try {
      const secret = await api<SecretResult>("/api/kaja", {
        method: "POST",
        headers: { "x-csrf-token": csrf() },
        body: JSON.stringify({ label: submittedLabel, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null })
      });
      onCreated(secret);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pověření se nepodařilo vytvořit");
    }
  }
  return (
    <Modal title="Založit klientské pověření Kaja" onClose={onClose}>
      <form className="modal-form" onSubmit={(event) => { void submit(event); }}>
        <div className="form-intro"><span className="modal-icon"><KeyRound size={20} /></span><p>Vytvoř nové pověření pro aplikaci nebo integrační službu. Přístup k serverům nastavíš ve správě oprávnění.</p></div>
        <label>Označení pověření<span className="field-hint">Srozumitelný název podle účelu nebo aplikace</span><input autoFocus value={label} onChange={(event) => setLabel(event.target.value)} maxLength={120} placeholder="Např. CI/CD pipeline" /></label>
        <label>Expirace pověření<span className="field-hint">Nepovinné, bez data zůstane pověření bez časového omezení</span><div className="input-with-icon"><CalendarDays size={16} /><input value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} type="datetime-local" /></div></label>
        <div className="permission-preview"><div className="preview-title"><LockKeyhole size={16} /><strong>Přehled oprávnění</strong></div><span>Nové pověření vznikne bezpečně bez přístupu.</span><dl><dt>Dostupné MCP servery</dt><dd>{serverCount}</dd><dt>Výchozí přístup</dt><dd>Bez oprávnění</dd></dl></div>
        {error ? <p className="error">{error}</p> : null}
        <footer className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Zrušit</button><button type="submit"><KeyRound size={16} /> Vygenerovat pověření</button></footer>
      </form>
    </Modal>
  );
}

export function CredentialSecretModal({ secret, onClose }: { secret: SecretResult; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() { await navigator.clipboard.writeText(secret.clientSecret); setCopied(true); }
  return (
    <Modal title="Pověření bylo vytvořeno" onClose={onClose}>
      <div className="secret-dialog">
        <p>Klientský secret se zobrazuje pouze jednou. Po zavření už jej nepůjde znovu zobrazit.</p>
        <div className="secret-once"><strong>{secret.label} · {secret.publicId}</strong><code>{secret.clientSecret}</code><span>Fingerprint {secret.fingerprint}. Expirace {secret.expiresAt ? formatDate(secret.expiresAt) : "bez omezení"}.</span></div>
        <footer className="modal-actions"><button className="secondary" onClick={onClose}>Zavřít</button><button onClick={() => { void copy(); }}><ClipboardCopy size={16} /> {copied ? "Zkopírováno" : "Zkopírovat secret"}</button></footer>
      </div>
    </Modal>
  );
}

export function CredentialConfirmModal({ credential, action, onClose, onConfirm }: { credential: KajaCredential; action: "revoke" | "delete"; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const isRevoke = action === "revoke";
  async function confirm() { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }
  return (
    <Modal title={isRevoke ? "Revokovat klientské pověření?" : "Smazat záznam pověření?"} onClose={onClose}>
      <div className="modal-form">
        <p className="destructive-copy">{isRevoke ? "Aplikace používající toto pověření okamžitě ztratí přístup a všechny vydané přístupové tokeny budou zneplatněny." : "Záznam zmizí z běžného přehledu. Auditní stopa zůstane zachovaná."}</p>
        <label>Pro potvrzení opiš označení pověření<input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={credential.label} /></label>
        <footer className="modal-actions"><button className="secondary" onClick={onClose}>Zrušit</button><button className="danger-button" disabled={typed !== credential.label || busy} onClick={() => { void confirm(); }}>{isRevoke ? "Revokovat pověření" : "Smazat záznam"}</button></footer>
      </div>
    </Modal>
  );
}

export function RenameCredentialModal({ credential, onClose, onRename }: { credential: KajaCredential; onClose: () => void; onRename: (label: string) => Promise<void> }) {
  const [label, setLabel] = useState(credential.label);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const normalized = label.trim();
    if (!normalized || normalized.length > 120) { setError("Označení musí mít 1 až 120 znaků."); return; }
    setBusy(true); setError("");
    try { await onRename(normalized); } catch (err) { setError(err instanceof Error ? err.message : "Pověření se nepodařilo přejmenovat."); } finally { setBusy(false); }
  }
  return (
    <Modal title="Přejmenovat klientské pověření Kaja" onClose={onClose}>
      <form className="modal-form" onSubmit={(event) => { void submit(event); }}>
        <label>Označení pověření<input autoFocus value={label} maxLength={120} onChange={(event) => setLabel(event.target.value)} /></label>
        {error ? <p className="error">{error}</p> : null}
        <footer className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Zrušit</button><button type="submit" disabled={busy || label.trim() === credential.label}>Uložit označení</button></footer>
      </form>
    </Modal>
  );
}

export function CredentialsPage({ credentials, onOpenCreate, onEditPermissions, onRename, onConfirm, onRefresh }: { credentials: KajaCredential[]; onOpenCreate: () => void; onEditPermissions: (id: string) => void; onRename: (credential: KajaCredential) => void; onConfirm: (credential: KajaCredential, action: "revoke" | "delete") => void; onRefresh: () => void }) {
  const [query, setQuery] = useState("");
  const filtered = credentials.filter((credential) => `${credential.label} ${credential.publicId}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <>
      <PageHeader title="Klientská pověření Kaja" description="Správa klientských pověření a jejich oddělených krátkodobých přístupových tokenů.">
        <label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hledat pověření..." aria-label="Hledat pověření" /></label>
        <button onClick={onOpenCreate}><Plus size={17} /> Založit pověření</button><IconButton label="Obnovit pověření" onClick={onRefresh}><RefreshCw size={17} /></IconButton>
      </PageHeader>
      <section className="panel table-panel"><div className="panel-head"><div className="heading-with-help"><h2>Přehled pověření</h2><CircleHelp size={15} /></div><span className="panel-count">{filtered.length} záznamů</span></div>
        {filtered.length === 0 ? <div className="empty-state"><KeyRound size={34} /><strong>Žádná pověření k zobrazení</strong><p>Vytvoř první pověření přes primární akci nahoře.</p></div> : <table><thead><tr><th>Označení</th><th>Kaja ID</th><th>Fingerprint</th><th>Stav</th><th>Oprávnění</th><th>Expirace</th><th>Poslední vydání přístupového tokenu</th><th>Poslední použití</th><th>Akce</th></tr></thead><tbody>{filtered.map((credential) => <tr key={credential.id}><td><strong>{credential.label}</strong></td><td>{credential.publicId}</td><td><code>{credential.fingerprint}</code></td><td><span className={`badge ${statusClass(credential)}`}>{credential.active && !credential.revokedAt ? "Aktivní" : "Revokováno"}</span></td><td>{credential.permissionCount}</td><td>{credential.expiresAt ? formatDate(credential.expiresAt) : "Bez omezení"}</td><td>{formatDate(credential.lastTokenIssuedAt)}</td><td>{formatDate(credential.lastUsedAt)}</td><td><div className="row-actions"><button className="small-button" disabled={!credential.active || Boolean(credential.revokedAt)} onClick={() => onRename(credential)}>Přejmenovat</button><button className="small-button" onClick={() => onEditPermissions(credential.id)}>Oprávnění</button><button className="small-button" disabled={!credential.active || Boolean(credential.revokedAt)} onClick={() => onConfirm(credential, "revoke")}>Revokovat</button><button className="small-button danger-link" onClick={() => onConfirm(credential, "delete")}>Smazat</button></div></td></tr>)}</tbody></table>}
      </section>
    </>
  );
}

export function PermissionsPage({ credentials, servers, selectedId, permissions, saving, onSelect, onChange, onSave }: { credentials: KajaCredential[]; servers: Server[]; selectedId: string | null; permissions: KajaPermission[]; saving: boolean; onSelect: (id: string) => void; onChange: (items: KajaPermission[]) => void; onSave: () => void }) {
  const [query, setQuery] = useState("");
  const selected = credentials.find((credential) => credential.id === selectedId) ?? null;
  const grantedCount = permissions.filter((permission) => permission.granted).length;
  const filteredCredentials = credentials.filter((credential) => `${credential.label} ${credential.publicId}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <>
      <PageHeader title="Správa oprávnění" description="Nastavení přístupu pověření k MCP serverům"><button disabled={!selectedId || saving || servers.length === 0} onClick={onSave}><Save size={16} /> Uložit změny</button></PageHeader>
      <section className="permissions-layout">
        <aside className="token-list-panel"><div className="token-list-heading"><strong>Vyberte pověření</strong><span>{credentials.length}</span></div><label className="search-box full"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hledat pověření..." aria-label="Hledat pověření" /></label><div className="token-list-scroll">{filteredCredentials.length === 0 ? <p className="list-empty">Žádné pověření neodpovídá hledání.</p> : filteredCredentials.map((credential) => <button key={credential.id} className={`token-list-item ${credential.id === selectedId ? "active" : ""}`} onClick={() => onSelect(credential.id)}><span className={`status-dot ${statusClass(credential)}`} /><span className="token-list-copy"><strong>{credential.label}</strong><small>{credential.publicId} · {credential.active && !credential.revokedAt ? "Aktivní" : "Revokováno"}</small></span><ChevronDown className="item-chevron" size={15} /></button>)}</div></aside>
        <section className="panel permissions-panel"><div className="panel-head"><div><div className="heading-with-help"><h2>Oprávnění k MCP serverům</h2><CircleHelp size={15} /></div><p>{selected ? `${selected.label} má přístup k ${grantedCount} z ${servers.length} serverů.` : "Vyber pověření v levém panelu."}</p></div>{selected ? <span className="credential-reference">{selected.publicId}</span> : null}</div>
          {!selected ? <div className="empty-state"><LockKeyhole size={34} /><strong>Vyber pověření pro úpravu práv</strong></div> : servers.length === 0 ? <div className="empty-state"><ServerIcon size={34} /><strong>Nejsou dostupné MCP servery pro přiřazení oprávnění</strong></div> : <table><thead><tr><th>Přístup</th><th>MCP server</th><th>Hostname</th><th>Účinek</th><th>Uděleno</th></tr></thead><tbody>{permissions.map((permission) => <tr key={permission.serverId}><td><input type="checkbox" checked={permission.granted} onChange={(event) => onChange(permissions.map((item) => item.serverId === permission.serverId ? { ...item, granted: event.target.checked, accessLevel: event.target.checked ? "EXECUTE" : null } : item))} /></td><td>{permission.displayName}</td><td>{permission.hostname}</td><td><span className="badge neutral">{permission.granted ? accessLabels.EXECUTE : "Bez přístupu"}</span></td><td>{formatDate(permission.grantedAt)}</td></tr>)}</tbody></table>}
          <footer className="permissions-foot"><CircleHelp size={15} /><span>Změny se projeví okamžitě. Jediná vynucovaná úroveň je spouštění nástroje.</span></footer>
        </section>
      </section>
    </>
  );
}
