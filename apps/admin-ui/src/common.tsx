import React, { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { nextDialogFocusIndex } from "./dialog-focus.js";

const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function focusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
    .filter((item) => !item.hasAttribute("disabled") && item.getAttribute("aria-hidden") !== "true");
}

export function Modal({
  title,
  children,
  onClose,
  className
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null
  );
  const labelId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const activeDialog = dialog;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const alreadyFocused = document.activeElement instanceof HTMLElement && activeDialog.contains(document.activeElement)
      ? document.activeElement
      : null;
    const initialFocus = alreadyFocused ?? activeDialog.querySelector<HTMLElement>("[autofocus]") ?? focusableElements(activeDialog)[0] ?? activeDialog;
    initialFocus.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusableElements(activeDialog);
      const nextIndex = nextDialogFocusIndex(items.length, items.indexOf(document.activeElement as HTMLElement), event.shiftKey);
      if (nextIndex === null) return;
      event.preventDefault();
      items[nextIndex]?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      lastFocusedRef.current?.focus();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" role="presentation">
      <section ref={dialogRef} className={`modal${className ? ` ${className}` : ""}`} role="dialog" aria-modal="true" aria-labelledby={labelId} aria-describedby={descriptionId} tabIndex={-1}>
        <header className="modal-head">
          <h2 id={labelId}>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Zavřít"><X size={18} /></button>
        </header>
        <p id={descriptionId} className="sr-only">Dialog: {title}</p>
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
