import React, { useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, Save, Search, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "./common.js";
import type { OperationalConfigSetting } from "./types.js";
import { formatDate } from "./ui-helpers.js";

export function OperationalConfigPage({ settings, onRefresh, onSave }: {
  settings: OperationalConfigSetting[];
  onRefresh: () => Promise<void>;
  onSave: (setting: OperationalConfigSetting, value: string | number | boolean | string[]) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const filtered = settings.filter((setting) => `${setting.key} ${setting.envKey} ${setting.label}`.toLowerCase().includes(query.toLowerCase()));

  async function save(setting: OperationalConfigSetting) {
    const raw = drafts[setting.key] ?? (setting.value === null ? "" : String(setting.value));
    const value = setting.kind === "number" ? Number(raw)
      : setting.kind === "boolean" ? raw === "true"
        : setting.kind === "stringList" ? raw.split(",").map((item) => item.trim()).filter(Boolean)
          : raw;
    setSavingKey(setting.key); setError(""); setMessage("");
    try {
      await onSave(setting, value);
      setDrafts((current) => ({ ...current, [setting.key]: "" }));
      setMessage(`${setting.label} bylo uloženo.${setting.restartRequired ? " Změna se projeví po restartu příslušného procesu." : " Změna je dostupná bez restartu."}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Uložení konfigurace selhalo.");
    } finally {
      setSavingKey(null);
    }
  }

  async function refresh() {
    setRefreshing(true); setError(""); setMessage("");
    try {
      await onRefresh();
      setMessage("Provozní konfigurace byla obnovena.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Obnovení konfigurace selhalo.");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <>
      <PageHeader title="Konfigurace" description="Spravovaný DB registr provozních hodnot; bootstrap prostředí zůstává pouze pro DB, vault, roli a port.">
        <label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hledat konfiguraci..." aria-label="Hledat konfiguraci" /></label>
        <button className="secondary" disabled={refreshing || savingKey !== null} onClick={() => { void refresh(); }}><RefreshCw size={16} /> {refreshing ? "Obnovuji..." : "Obnovit"}</button>
      </PageHeader>
      {message ? <div className="notice success"><CheckCircle2 size={18} /><span>{message}</span></div> : null}
      {error ? <div className="notice error"><AlertTriangle size={18} /><span>{error}</span></div> : null}
      <section className="config-grid">
        {filtered.map((setting) => {
          const draft = drafts[setting.key] ?? String(setting.value ?? "");
          return <article key={setting.key} className={`panel config-card ${setting.bootstrapOnly ? "locked" : ""}`}>
            <div className="panel-head"><div><h2>{setting.label}</h2><p>{setting.envKey}</p><small>{setting.description}</small></div><div className="row-actions"><span className="badge neutral">{setting.category}</span><span className={`badge ${setting.source === "database" ? "ok" : "neutral"}`}>{setting.source === "database" ? "DB" : "Výchozí"}</span>{setting.restartRequired ? <span className="badge warn">Restart</span> : null}{setting.bootstrapOnly ? <span className="badge danger">Bootstrap-only</span> : null}</div></div>
            <div className="config-card-body">
              <label>{setting.kind === "secret" ? "Nová tajná hodnota" : "Hodnota"}<input disabled={setting.bootstrapOnly} type={setting.kind === "number" ? "number" : setting.kind === "secret" ? "password" : "text"} value={draft} placeholder={setting.kind === "secret" && setting.configured ? "Nastaveno, zadejte pouze při rotaci" : undefined} autoComplete={setting.kind === "secret" ? "new-password" : undefined} onChange={(event) => setDrafts((current) => ({ ...current, [setting.key]: event.target.value }))} /></label>
              <dl className="config-meta"><div><dt>Klíč</dt><dd><code>{setting.key}</code></dd></div><div><dt>Typ</dt><dd>{setting.kind}</dd></div><div><dt>Procesy</dt><dd>{setting.appliesTo.join(", ")}</dd></div><div><dt>Verze</dt><dd>{setting.version}</dd></div><div><dt>Upraveno</dt><dd>{formatDate(setting.updatedAt)}</dd></div></dl>
              {setting.restartPending ? <p className="list-empty">Databáze obsahuje novější hodnotu než běžící proces. Projev změny čeká na restart.</p> : null}
              <footer className="modal-actions"><button disabled={setting.bootstrapOnly || savingKey === setting.key || (setting.kind === "secret" && !draft)} onClick={() => { void save(setting); }}><Save size={16} /> {setting.kind === "secret" && setting.configured ? "Rotovat" : "Uložit"}</button></footer>
            </div>
          </article>;
        })}
      </section>
      {filtered.length === 0 ? <div className="empty-state"><SlidersHorizontal size={34} /><strong>Žádná konfigurační hodnota neodpovídá hledání</strong></div> : null}
    </>
  );
}
