"use client";

import React, { useId } from "react";

type Tone = "ok" | "warn" | "bad" | "neutral";

export const Panel = ({ title, children }: { title?: string; children: React.ReactNode }) => (
  <section className="fx-panel" aria-label={title}>
    {title && <h3 className="fx-panel-title">{title}</h3>}
    {children}
  </section>
);

export const Button = ({ variant = "default", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" }) => (
  <button className="fx-btn" data-variant={variant} {...props} />
);

export const Badge = ({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) => (
  <span className="fx-badge" data-tone={tone}>{children}</span>
);

export const Field = ({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) => {
  const id = useId();
  return <div className="fx-field"><label htmlFor={id}>{label}</label><input id={id} {...props} /></div>;
};

export const Meter = ({ value, max, label, tone }: { value: number; max: number; label: string; tone?: "bad" }) => {
  const percentage = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return <div role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} className="fx-meter" data-tone={tone}><i style={{ width: `${percentage}%` }} /></div>;
};

export const Stat = ({ label, value, note }: { label: string; value: string; note?: string }) => (
  <div><div className="fx-stat-label">{label}</div><div className="fx-data fx-stat-value">{value}</div>{note && <div className="fx-stat-label">{note}</div>}</div>
);

export const ProofDrawer = ({ summary, children }: { summary: string; children: React.ReactNode }) => (
  <details><summary className="fx-summary">{summary}</summary><div className="fx-data fx-proof-body">{children}</div></details>
);

export type StateKind = "loading" | "empty" | "success" | "warning" | "error";
export const StateView = ({ kind, title, body, action }: { kind: StateKind; title: string; body: string; action?: React.ReactNode }) => (
  <div className="fx-state" data-kind={kind} role={kind === "error" ? "alert" : "status"} aria-busy={kind === "loading"}>
    {kind === "loading" ? <><div className="fx-skel fx-skel-short" /><div className="fx-skel fx-skel-long" /><span className="sr-only">{title}</span></> : <><h3>{title}</h3><p>{body}</p>{action}</>}
  </div>
);
