import { useEffect, useRef, useState, type ReactNode } from "react";
import { dayOfMonth, shortWeekday } from "../lib/dates";
import { initials } from "../lib/people";

export { Icon, type IconName } from "./icons";

export function Avatar(props: { name?: string | null; email?: string | null; size?: "md" | "lg" | "xl" }) {
  const cls = props.size === "lg" ? "avatar avatar-lg" : props.size === "xl" ? "avatar avatar-xl" : "avatar";
  return (
    <span className={cls} aria-hidden="true">
      {initials(props.name, props.email)}
    </span>
  );
}

/** The weekday in small plum caps over a large condensed day number. Never a colored square. */
export function DateMark(props: { date: string; muted?: boolean }) {
  return (
    <span className="datemark">
      <span className="wd" style={props.muted ? { color: "var(--muted-2)" } : undefined}>
        {shortWeekday(props.date)}
      </span>
      <span className="n">{dayOfMonth(props.date)}</span>
    </span>
  );
}

export function Progress(props: { parts: { value: number; tone?: "soft" }[]; total: number; large?: boolean; label?: string }) {
  return (
    <div
      className={props.large ? "progress progress-lg" : "progress"}
      role="progressbar"
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={props.total}
      aria-valuenow={props.parts[0]?.value ?? 0}
    >
      {props.parts.map((p, i) => (
        <span key={i} className={p.tone} style={{ width: `${props.total ? (100 * p.value) / props.total : 0}%` }} />
      ))}
    </div>
  );
}

export function Loading(props: { label?: string }) {
  return (
    <p className="loading" role="status">
      {props.label ?? "Loading..."}
    </p>
  );
}

export function ErrorView(props: { message: string; onRetry?: () => void }) {
  return (
    <div className="page page-narrow stack">
      <p className="form-error">{props.message}</p>
      {props.onRetry && (
        <button className="btn" onClick={props.onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

/** Centered dialog on web; full screen on phone. */
export function Dialog(props: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEscape(props.onClose);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={props.title} style={props.wide ? { maxWidth: 720 } : undefined}>
        <h2 className="title-md">{props.title}</h2>
        {props.children}
      </div>
    </div>
  );
}

/** Bottom sheet for phone layouts. */
export function Sheet(props: { title?: string; onClose: () => void; children: ReactNode }) {
  useEscape(props.onClose);
  return (
    <div className="scrim scrim-sheet" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={props.title}>
        <div className="sheet-grip" />
        {props.title && <h2 className="title-sm">{props.title}</h2>}
        {props.children}
      </div>
    </div>
  );
}

/** A short confirmation that fades on its own. */
export function useToast(): [ReactNode, (message: string) => void] {
  const [message, setMessage] = useState<string>();
  const timer = useRef<number>(undefined);
  const show = (m: string) => {
    setMessage(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(undefined), 3200);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [
    message ? (
      <div className="toast" role="status">
        {message}
      </div>
    ) : null,
    show,
  ];
}

export function FormError(props: { error?: string }) {
  return props.error ? (
    <p className="form-error" role="alert">
      {props.error}
    </p>
  ) : null;
}
