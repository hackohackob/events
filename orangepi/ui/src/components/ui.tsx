import { useState, type ReactNode } from "react";
import { AlertIcon, CheckIcon, ChevronIcon, InfoIcon } from "../lib/icons";

/** The shared shapes the console is assembled from. */

export function Card({
  title,
  action,
  children,
  tight,
  collapsible,
  defaultOpen = false,
  badge,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  tight?: boolean;
  /** Fold the card away behind its heading. */
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** A word shown beside the heading while folded, e.g. the current setting. */
  badge?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const folded = collapsible && !open;

  return (
    <section className="card enter">
      {title &&
        (collapsible ? (
          // The setup screen is long, and on a phone that means the thing you
          // came for is usually several scrolls away. Folded sections make it a
          // list you can see at once.
          <button
            className="card-head card-head-toggle"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
          >
            <h2>{title}</h2>
            {badge && <span className="tag">{badge}</span>}
            <ChevronIcon
              size={16}
              style={{
                color: "var(--text-ghost)",
                transform: open ? "rotate(180deg)" : "none",
                transition: "transform 200ms ease",
              }}
            />
          </button>
        ) : (
          <div className="card-head">
            <h2>{title}</h2>
            {action}
          </div>
        ))}
      {!folded && <div className={`card-body${tight ? " tight" : ""}`}>{children}</div>}
    </section>
  );
}

export function Banner({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "ok" | "warn" | "bad";
  title?: string;
  children: ReactNode;
}) {
  const Icon = tone === "ok" ? CheckIcon : tone === "info" ? InfoIcon : AlertIcon;
  return (
    <div className={`banner ${tone} enter`}>
      <Icon size={17} />
      <div>
        {title && <strong>{title}</strong>}
        {children}
      </div>
    </div>
  );
}

export function Toggle({
  on,
  onChange,
  label,
  hint,
  disabled,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div className="switch">
      <div className="switch-text">
        <strong>{label}</strong>
        {hint && <span>{hint}</span>}
      </div>
      <button
        className={`toggle${on ? " on" : ""}`}
        disabled={disabled}
        aria-pressed={on}
        aria-label={label}
        onClick={() => onChange(!on)}
        style={disabled ? { opacity: 0.4 } : undefined}
      />
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

/** A slider that shows its value in the units the operator thinks in. */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  hint?: string;
  onChange: (next: number) => void;
}) {
  return (
    <div className="field">
      <label style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{label}</span>
        <span style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{format(value)}</span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function SignalBars({ signal }: { signal?: number }) {
  const bars = signal === undefined ? 0 : Math.ceil((signal / 100) * 4);
  return (
    <div className="bars" title={signal !== undefined ? `${signal}%` : undefined}>
      {[1, 2, 3, 4].map((n) => (
        <i key={n} className={n <= bars ? "on" : ""} />
      ))}
    </div>
  );
}

export function Empty({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <div>{children}</div>
    </div>
  );
}
