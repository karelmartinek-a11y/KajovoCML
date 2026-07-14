import React, { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

export function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const labelId = useId();
  useEffect(() => {
    lastFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusables = dialog?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    focusables?.[0]?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter((item) => !item.hasAttribute("disabled"));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      lastFocusedRef.current?.focus();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" role="presentation">
      <section ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby={labelId}>
        <header className="modal-head">
          <h2 id={labelId}>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Zavřít"><X size={18} /></button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function PageHeader({ title, description, children }: { title: string; description: string; children?: React.ReactNode }) {
  return (
    <header className="page-header">
      <div><h1>{title}</h1><p>{description}</p></div>
      <div className="actions">{children}</div>
    </header>
  );
}

export function IconButton({ label, children, onClick }: { label: string; children: React.ReactNode; onClick?: () => void }) {
  return <button className="icon-button" type="button" title={label} aria-label={label} onClick={onClick}>{children}</button>;
}

export function MetricCard({ tone, icon, value, label }: { tone: "neutral" | "success" | "warning" | "danger"; icon: React.ReactNode; value: number; label: string }) {
  return <article className={`metric-card ${tone}`}><span className="metric-icon">{icon}</span><strong>{value}</strong><span>{label}</span></article>;
}
