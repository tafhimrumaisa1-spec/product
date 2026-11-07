"use client";

import { useEffect, useMemo, useState } from "react";
import type { ExtractionResult } from "@/lib/flux-contracts";
import { DEVNET_EVIDENCE, devnetTransaction } from "@/lib/devnet-evidence";
import { WalletConnect } from "./wallet-connect";
import { simulateTwin } from "../../../../packages/twin/src/index";

const steps = ["Contract", "Review", "Twin", "Mandate", "Agent", "Proof"];

const obligations = [
  { label: "Counterparty", value: "Axiom Compute Labs", source: "Page 1 · Parties", confidence: "99%" },
  { label: "Commitment", value: "$12,000 total", source: "§3.1 · Fees", confidence: "98%" },
  { label: "Payment limit", value: "$4,000 / 30 days", source: "§3.2 · Schedule", confidence: "97%" },
  { label: "Term", value: "3 months", source: "§2.1 · Term", confidence: "96%" },
  { label: "Renewal", value: "Human approval required", source: "§7.2 · Renewal", confidence: "Review" },
];

const trace = [
  ["Contract", "AX-104 · v1"],
  ["Obligation", "$4,000 monthly cap"],
  ["Mandate", "FM-8842 · active"],
  ["Agent", "Compute Buyer 01"],
  ["Settlement", "1,260 DemoUSD"],
  ["Ledger", "Infrastructure · posted"],
];

interface DemoPaymentEvidence {
  outcome: "settled" | "rejected";
  sentTransactions: number;
  onchain: false;
  notice: string;
  rejection?: { code: string; message: string };
}

interface DemoProofEvidence {
  notice: string;
  trace: {
    complete: boolean;
    headline: string;
    steps: Array<{ kind: string; status: string; entries: Array<{ summary: string }> }>;
  };
}

const twinScenario = simulateTwin({
  cashMinor: 8_420_000n,
  monthlyRevenueMinor: 5_000_000n,
  monthlyBurnMinor: 5_880_000n,
  existingCommittedMinor: 1_540_000n,
  proposedMonthlyObligationMinor: 400_000n,
  proposedPeriods: 3,
  reserveMonths: 3,
});

export function FluxExperience() {
  const [demoOpen, setDemoOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [approved, setApproved] = useState(false);
  const [paymentState, setPaymentState] = useState<"idle" | "settled" | "blocked">("idle");
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [demoMode, setDemoMode] = useState<"live" | "replay">("live");
  const [paymentEvidence, setPaymentEvidence] = useState<DemoPaymentEvidence | null>(null);
  const [paymentPending, setPaymentPending] = useState(false);

  const progress = useMemo(() => `${Math.round(((step + 1) / steps.length) * 100)}%`, [step]);

  function launchDemo() {
    setDemoOpen(true);
    setStep(0);
    requestAnimationFrame(() => document.querySelector("#demo")?.scrollIntoView({ behavior: "smooth" }));
  }

  function advance() {
    if (step === 1) setApproved(true);
    setStep((current) => Math.min(current + 1, steps.length - 1));
  }

  async function extractContract() {
    setExtracting(true);
    try {
      const response = await fetch("/api/contracts/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: demoMode, contractText: syntheticContract }),
      });
      if (!response.ok) throw new Error("Extraction request failed");
      setExtraction(await response.json() as ExtractionResult);
      setStep(1);
    } finally {
      setExtracting(false);
    }
  }

  async function runPayment(scenario: "authorized" | "over_cap") {
    setPaymentPending(true);
    try {
      const response = await fetch("/api/demo/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario }),
      });
      if (!response.ok) throw new Error("Payment simulation request failed");
      const evidence = await response.json() as DemoPaymentEvidence;
      setPaymentEvidence(evidence);
      setPaymentState(evidence.outcome === "settled" ? "settled" : "blocked");
    } catch {
      setPaymentEvidence({ outcome: "rejected", sentTransactions: 0, onchain: false, notice: "The deterministic demo service is unavailable.", rejection: { code: "DEMO_UNAVAILABLE", message: "Retry the request." } });
      setPaymentState("blocked");
    } finally {
      setPaymentPending(false);
    }
  }

  return (
    <main>
      <nav className="topbar">
        <a className="brand" href="#top" aria-label="FluxMandate home">
          <span className="brand-mark" aria-hidden="true">FM</span>
          <span>FluxMandate</span>
        </a>
        <div className="nav-links">
          <a href="#system">System</a>
          <a href="#proof">Proof</a>
          <span className="network-pill"><i /> Devnet ready</span>
          <WalletConnect />
        </div>
      </nav>

      <section id="top" className="hero shell-grid">
        <div className="hero-copy">
          <div className="eyebrow"><span>01</span> Financial authority infrastructure</div>
          <h1>Contracts become<br /><em>bounded authority.</em></h1>
          <p className="hero-lede">FluxMandate turns commercial agreements into reviewed obligations, living financial simulations, and enforceable spending limits for autonomous agents.</p>
          <div className="hero-actions">
            <button className="button button-primary" onClick={launchDemo}>Launch live demo <span>↗</span></button>
            <a className="text-link" href="#system">Inspect the system <span>↓</span></a>
          </div>
          <div className="trust-line" aria-label="Trust flow">
            <span>AI interpreted</span><b>→</b><span>Human approved</span><b>→</b><span>Solana enforced</span>
          </div>
        </div>

        <div className="hero-instrument" aria-label="FluxMandate authority preview">
          <div className="instrument-head">
            <span>LIVE AUTHORITY MAP</span><span className="mono">FM / 2026</span>
          </div>
          <div className="orbit-map">
            <div className="orbit orbit-a" /><div className="orbit orbit-b" />
            <div className="core"><small>SAFE TO DEPLOY</small><strong>$18.4K</strong><span>verified capacity</span></div>
            <article className="floating-card card-contract"><small>CONTRACT</small><strong>Axiom Compute</strong><span>$12K · 3 months</span></article>
            <article className="floating-card card-agent"><small>AGENT 01</small><strong>$2.74K left</strong><span>mandate active</span></article>
            <article className="floating-card card-proof"><small>LIVE PROOF</small><strong>Settle + reject</strong><span>verified on Devnet</span></article>
          </div>
          <div className="instrument-foot"><span><i className="signal" /> Registry verified</span><a className="mono" href="https://explorer.solana.com/address/E7MjFsDybvfCaoNWopicKzB4oAtHBWTVAC5ZX9ajWJRq?cluster=devnet" target="_blank" rel="noreferrer">E7Mj…WJRq ↗</a></div>
        </div>
      </section>

      <section id="system" className="system-section">
        <header className="section-heading">
          <div><span className="section-index">02</span><p className="eyebrow-text">One governed financial loop</p></div>
          <h2>A company can see why money moves<br />before an agent moves it.</h2>
        </header>
        <div className="system-flow">
          {[
            ["FluxContracts", "Interpret", "Evidence-backed obligations from private agreements."],
            ["FluxTwin", "Simulate", "Deterministic impact on cash, burn, and runway."],
            ["FluxMandate", "Authorize", "Human-reviewed limits linked to commercial intent."],
            ["FluxFlow", "Execute", "Agent payments routed through bounded authority."],
            ["FluxProof", "Explain", "Contract-to-settlement evidence in one trace."],
          ].map(([name, verb, copy], index) => (
            <article className="system-card" key={name}>
              <span className="mono">0{index + 1}</span><small>{verb}</small><h3>{name}</h3><p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="demo" className={`demo-section ${demoOpen ? "demo-open" : ""}`}>
        <div className="demo-frame">
          <aside className="demo-sidebar">
            <div className="mini-brand"><span className="brand-mark">FM</span><b>Command</b></div>
            <div className="company-chip"><small>DEMO COMPANY</small><strong>Northstar AI</strong><span>Runway before · {twinScenario.runwayBeforeMonths?.toFixed(1)} mo</span></div>
            <nav>
              {steps.map((name, index) => (
                <button key={name} className={index === step ? "active" : index < step ? "complete" : ""} onClick={() => setStep(index)}>
                  <span>{index < step ? "✓" : index + 1}</span>{name}
                </button>
              ))}
            </nav>
            <div className="sidebar-proof"><small>SYSTEM STATUS</small><span><i className="signal" /> Devnet registry live</span><span><i className="signal" /> No real funds</span></div>
          </aside>

          <div className="demo-workspace">
            <header className="demo-header">
              <div><small>GUIDED DEMO / {steps[step].toUpperCase()}</small><h2>{demoTitle(step)}</h2></div>
              <div className="demo-controls">
                <div className="mode-switch" aria-label="Demo mode"><button className={demoMode === "live" ? "active" : ""} onClick={() => setDemoMode("live")}>Live AI</button><button className={demoMode === "replay" ? "active" : ""} onClick={() => setDemoMode("replay")}>Replay</button></div>
                <div className="progress-wrap"><span>{progress}</span><div><i style={{ width: progress }} /></div></div>
              </div>
            </header>

            <div className="demo-content">
              {step === 0 && <ContractStage onNext={extractContract} extracting={extracting} />}
              {step === 1 && <ReviewStage approved={approved} extraction={extraction} onNext={advance} />}
              {step === 2 && <TwinStage onNext={advance} />}
              {step === 3 && <MandateStage onNext={advance} />}
              {step === 4 && <AgentStage state={paymentState} evidence={paymentEvidence} pending={paymentPending} onPayment={runPayment} onNext={advance} />}
              {step === 5 && <ProofStage state={paymentState} />}
            </div>
          </div>
        </div>
      </section>

      <section id="proof" className="proof-section shell-grid">
        <div>
          <span className="section-index">03</span>
          <h2>Not another finance dashboard.</h2>
          <p>FluxMandate is the authority layer connecting private agreements, human intent, autonomous software, and public settlement evidence.</p>
        </div>
        <div className="principles">
          {[
            ["AI proposes", "Models extract and explain; they never receive treasury keys."],
            ["Humans authorize", "Material terms become active only after explicit review."],
            ["Code calculates", "Runway, limits, and reconciliation are deterministic."],
            ["Solana proves", "Authority state and settlement receipts are independently verifiable."],
          ].map(([title, copy]) => <article key={title}><i /><div><h3>{title}</h3><p>{copy}</p></div></article>)}
        </div>
      </section>

      <footer><span>FluxMandate / Solana Hackathon 2026</span><span>Private contracts · Public proof · Bounded machines</span></footer>
    </main>
  );
}

function demoTitle(step: number) {
  return ["Load a commercial agreement", "Review economic obligations", "See the future before committing", "Deploy bounded authority", "Let the agent act—safely", "Follow every reason and receipt"][step];
}

function StageShell({ tag, title, copy, children, action, onNext }: { tag: string; title: string; copy: string; children: React.ReactNode; action: string; onNext: () => void }) {
  return <div className="stage"><div className="stage-intro"><span className="stage-tag">{tag}</span><h3>{title}</h3><p>{copy}</p></div>{children}<button className="button button-primary stage-action" onClick={onNext}>{action} <span>→</span></button></div>;
}

function ContractStage({ onNext, extracting }: { onNext: () => void; extracting: boolean }) {
  return <StageShell tag="FluxContracts" title="A synthetic agreement is ready." copy="The complete document remains private. Only reviewed economic meaning can become authority." action={extracting ? "Extracting with Groq…" : "Extract obligations"} onNext={onNext}>
    <div className="document-card"><div className="document-icon">PDF</div><div><small>SYNTHETIC CONTRACT</small><h4>Axiom Compute Services Agreement</h4><p>3 pages · signed · SHA-256 commitment ready</p></div><span className="status status-neutral">Private</span></div>
    <div className="notice"><b>What AI will do</b><span>Propose structured terms with clause-level evidence. It cannot approve or sign.</span></div>
  </StageShell>;
}

function ReviewStage({ approved, extraction, onNext }: { approved: boolean; extraction: ExtractionResult | null; onNext: () => void }) {
  const proposed = extraction ? proposalRows(extraction) : obligations;
  return <StageShell tag="Human checkpoint" title={approved ? "Material terms approved." : "Every claim carries its evidence."} copy="Review the commercial meaning before it becomes financial authority." action={approved ? "Continue to Twin" : "Approve all terms"} onNext={onNext}>
    {extraction && <div className="extraction-mode"><i className="signal" /><b>{extraction.mode === "live" ? "Live Groq extraction" : "Verified deterministic replay"}</b><span>Human approval required</span></div>}
    <div className="obligation-grid">{proposed.map((item) => <article key={item.label}><small>{item.label}</small><strong>{item.value}</strong><span>{item.source}</span><i className="confidence">{item.confidence}</i></article>)}</div>
  </StageShell>;
}

function proposalRows(result: ExtractionResult) {
  const proposal = result.proposal;
  const confidence = proposal.evidence[0] ? `${Math.round(proposal.evidence[0].confidenceBps / 100)}%` : "Review";
  return [
    { label: "Counterparty", value: proposal.counterparty, source: proposal.evidence[0]?.clause || "AI proposal", confidence },
    { label: "Commitment", value: `${formatMinor(proposal.totalAmountMinor)} ${proposal.currency}`, source: proposal.evidence[1]?.clause || "AI proposal", confidence },
    { label: "Payment limit", value: `${formatMinor(proposal.paymentAmountMinor)} / ${proposal.intervalDays} days`, source: proposal.evidence[2]?.clause || "AI proposal", confidence },
    { label: "Term", value: `${proposal.termMonths} months`, source: `${proposal.startsAt} → ${proposal.expiresAt}`, confidence },
    { label: "Renewal", value: proposal.renewalRequiresApproval ? "Human approval required" : "Review required", source: "Never auto-authorized", confidence: "Review" },
  ];
}

function formatMinor(value: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(value) / 100);
}

function compactUsd(value: bigint) {
  return `$${(Number(value) / 100_000).toFixed(1)}K`;
}

const syntheticContract = `SYNTHETIC DEMO AGREEMENT. Northstar AI appoints Axiom Compute Labs to provide managed inference services. The initial term begins December 1, 2026 and ends February 28, 2027. Total fees are USD 12,000, payable as USD 4,000 every 30 days for three months. Renewal requires written human approval.`;

function TwinStage({ onNext }: { onNext: () => void }) {
  return <StageShell tag="FluxTwin" title="The commitment is safe—under current assumptions." copy="Forecasts are deterministic. AI explains the result but never invents the numbers." action="Create mandate draft" onNext={onNext}>
    <div className="metric-grid"><Metric label="Cash" value={compactUsd(twinScenario.assumptions.cashMinor)} delta="unchanged" /><Metric label="Committed" value={compactUsd(twinScenario.contractuallyCommittedMinor)} delta="+$12K" tone="warn" /><Metric label="Runway" value={`${twinScenario.runwayAfterMonths?.toFixed(1)} mo`} delta={`${((twinScenario.runwayAfterMonths || 0) - (twinScenario.runwayBeforeMonths || 0)).toFixed(1)} mo`} tone="warn" /><Metric label="Safe to deploy" value={compactUsd(twinScenario.safeToDeployMinor)} delta="within reserve policy" tone="good" /></div>
    <div className="timeline"><div className="timeline-labels"><span>NOW</span><span>30D</span><span>60D</span><span>90D</span></div><div className="timeline-track"><i style={{ left: "18%" }} /><i style={{ left: "50%" }} /><i style={{ left: "82%" }} /></div><div className="timeline-obligations"><span style={{ left: "12%" }}>$4K</span><span style={{ left: "44%" }}>$4K</span><span style={{ left: "76%" }}>$4K</span></div></div>
  </StageShell>;
}

function Metric({ label, value, delta, tone = "" }: { label: string; value: string; delta: string; tone?: string }) { return <article className={`metric ${tone}`}><small>{label}</small><strong>{value}</strong><span>{delta}</span></article>; }

function MandateStage({ onNext }: { onNext: () => void }) {
  return <StageShell tag="FluxMandate" title="Commercial intent, translated into limits." copy="The company signs one bounded authority envelope. It can pause or revoke it at any time." action="Deploy demo mandate" onNext={onNext}>
    <div className="mandate-sentence">Compute Buyer 01 may spend <b>up to 4,000 DemoUSD</b> every 30 days with <b>Axiom Compute Labs</b> until <b>February 28, 2027</b>.</div>
    <div className="mandate-fields"><span><small>CONTRACT</small>AX-104 / v1</span><span><small>ASSET</small>DemoUSD</span><span><small>CONTROL</small>Revocable</span><span><small>NETWORK</small>Solana Devnet</span></div>
  </StageShell>;
}

function AgentStage({ state, evidence, pending, onPayment, onNext }: { state: "idle" | "settled" | "blocked"; evidence: DemoPaymentEvidence | null; pending: boolean; onPayment: (scenario: "authorized" | "over_cap") => Promise<void>; onNext: () => void }) {
  return <StageShell tag="FluxFlow" title="The agent can act without unlimited access." copy="Test both sides of the boundary. The final build will submit these attempts against localnet and Devnet." action="Inspect full proof" onNext={onNext}>
    <div className="agent-panel"><div className="agent-identity"><span className="agent-avatar">A1</span><div><small>AUTONOMOUS BUYER</small><strong>Compute Buyer 01</strong><span>Mandate FM-8842</span></div></div><div className="allowance"><small>PERIOD ALLOWANCE</small><strong>$4,000</strong><div><i style={{ width: state === "settled" ? "31.5%" : "0%" }} /></div><span>{state === "settled" ? "$1,260 consumed · $2,740 available" : "$4,000 available"}</span></div></div>
    <div className="payment-actions"><button disabled={pending} onClick={() => void onPayment("authorized")}><span>01</span><b>Pay $1,260</b><small>Within mandate</small></button><button disabled={pending} onClick={() => void onPayment("over_cap")}><span>02</span><b>Pay $5,200</b><small>Exceeds cap</small></button></div>
    {pending && <div className="decision"><b>Evaluating authority…</b><span>FluxFlow is checking the deterministic mandate boundary.</span></div>}
    {!pending && state !== "idle" && <div className={`decision ${state}`}><b>{state === "settled" ? "Payment authorized" : "Payment blocked"}</b><span>{state === "settled" ? "Recipient, asset, period, and remaining allowance match." : evidence?.rejection?.message || "Requested amount exceeds the period cap."}</span></div>}
    {evidence && <div className="evidence-note"><b>Deterministic mock</b><span>{evidence.notice}</span><small>{evidence.sentTransactions} synthetic transaction{evidence.sentTransactions === 1 ? "" : "s"} submitted</small></div>}
  </StageShell>;
}

function ProofStage({ state }: { state: "idle" | "settled" | "blocked" }) {
  const [proof, setProof] = useState<DemoProofEvidence | null>(null);
  const [proofError, setProofError] = useState(false);

  useEffect(() => {
    const scenario = state === "blocked" ? "over_limit" : "success";
    setProofError(false);
    fetch(`/api/demo/proof?scenario=${scenario}`)
      .then((response) => {
        if (!response.ok) throw new Error("Proof request failed");
        return response.json() as Promise<DemoProofEvidence>;
      })
      .then(setProof)
      .catch(() => setProofError(true));
  }, [state]);

  const visibleTrace = proof?.trace.steps.map((step) => [humanize(step.kind), step.entries[0]?.summary || step.status]) || trace;
  return <div className="stage"><div className="stage-intro"><span className="stage-tag">FluxProof</span><h3>One trace. Every reason.</h3><p>This public trace comes from the deterministic ledger package. Synthetic fixture signatures intentionally have no Explorer links.</p></div>
    <div className="evidence-note live-evidence"><b>Recorded Devnet golden path</b><span>One authorized settlement finalized; one over-cap attempt failed on-chain with 6017 CapExceeded.</span><small>Run {DEVNET_EVIDENCE.runId}</small><div><a href={devnetTransaction(DEVNET_EVIDENCE.authorized.signature)} target="_blank" rel="noreferrer">Authorized {DEVNET_EVIDENCE.authorized.amount} ↗</a><a href={devnetTransaction(DEVNET_EVIDENCE.rejected.signature)} target="_blank" rel="noreferrer">Rejected {DEVNET_EVIDENCE.rejected.amount} ↗</a></div></div>
    <div className="trace">{visibleTrace.map(([label, value], index) => <article key={`${label}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><div><small>{label}</small><strong>{value}</strong></div>{index < visibleTrace.length - 1 && <i />}</article>)}</div>
    <div className="proof-receipt"><div><small>DEMO OUTCOME</small><strong>{proofError ? "Proof service unavailable" : proof?.trace.headline || (state === "blocked" ? "Rejected before settlement" : "Building evidence trace…")}</strong><span>{proof?.notice}</span></div><span className={`status ${state === "blocked" || proofError ? "status-danger" : "status-good"}`}>{proof?.trace.complete ? "Trace complete" : state === "blocked" ? "Policy blocked" : "Replay evidence"}</span></div>
  </div>;
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

