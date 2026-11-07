"use client";

import React from "react";
import { Badge } from "./primitives";

export interface NavItem { id: string; label: string; }

export const AppShell = ({ nav, active, onNavigate, children }: { nav: NavItem[]; active: string; onNavigate: (id: string) => void; children: React.ReactNode }) => (
  <div className="fx-shell">
    <nav className="fx-side" aria-label="FluxMandate">
      <strong className="fx-wordmark">FluxMandate</strong>
      {nav.map((item) => <button key={item.id} className="fx-btn" aria-current={item.id === active ? "page" : undefined} data-variant={item.id === active ? "primary" : undefined} onClick={() => onNavigate(item.id)}>{item.label}</button>)}
    </nav>
    <div className="fx-main fx-grid">
      <header role="status" className="fx-statusbar"><Badge tone="warn">Devnet, synthetic data</Badge><Badge tone="ok">AI holds no treasury keys</Badge><Badge>Mock backend</Badge></header>
      <main className="fx-content">{children}</main>
    </div>
  </div>
);
