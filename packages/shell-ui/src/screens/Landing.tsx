"use client";

import React from "react";
import { Badge, Button } from "../components/primitives";

export const Landing = ({ onStart }: { onStart: () => void }) => (
  <div className="fx-grid fx-landing">
    <h1>Turn contracts into safe financial authority for autonomous agents.</h1>
    <p className="fx-lead">Load a signed contract. FluxMandate turns each payment term into a spending limit an AI agent can use and cannot exceed.</p>
    <ol aria-label="How it works" className="fx-chip-list">
      {["AI interpreted", "Human approved", "Solana enforced"].map((step) => <li key={step}><Badge tone="ok">{step}</Badge></li>)}
    </ol>
    <div><Button variant="primary" onClick={onStart}>Start the guided demo</Button></div>
  </div>
);
