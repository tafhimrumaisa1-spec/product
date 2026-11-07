"use client";

import { useMemo, useState } from "react";

const steps = ["Contract", "Review", "Twin", "Mandate", "Agent", "Proof"];

const obligations = [
  { label: "Counterparty", value: "Axiom Compute Labs", source: "Page 1 · Parties" },
  { label: "Commitment", value: "$12,000 total", source: "§3.1 · Fees" },
  { label: "Payment limit", value: "$4,000 / 30 days", source: "§3.2 · Schedule" },
  { label: "Term", value: "3 months", source: "§2.1 · Term" },
  { label: "Renewal", value: "Human approval required", source: "§7.2 · Renewal" },
];

const trace = [
  ["Contract", "AX-104 · v1"],
  ["Obligation", "$4,000 monthly cap"],
  ["Mandate", "FM-8842 · active"],
  ["Agent", "Compute Buyer 01"],
  ["Settlement", "1,260 DemoUSD"],
  ["Ledger", "Infrastructure · posted"],
];

export function FluxExperience() {
  const [demoOpen, setDemoOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [approved, setApproved] = useState(false);
  const [paymentState, setPaymentState] = useState<"idle" | "settled" | "blocked">("idle");

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
          <button className="button button-small" onClick={launchDemo}>Launch demo</button>
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
            <article className="floating-card card-proof"><small>PROOF</small><strong>6 linked records</strong><span>settled on Devnet</span></article>
          </div>
          <div className="instrument-foot"><span><i className="signal" /> Authority healthy</span><span className="mono">slot 418,920,114</span></div>
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
            <div className="company-chip"><small>DEMO COMPANY</small><strong>Northstar AI</strong><span>Runway · 14.2 mo</span></div>
            <nav>
              {steps.map((name, index) => (
                <button key={name} className={index === step ? "active" : index < step ? "complete" : ""} onClick={() => setStep(index)}>
                  <span>{index < step ? "✓" : index + 1}</span>{name}
                </button>
              ))}
            </nav>
            <div className="sidebar-proof"><small>SYSTEM STATUS</small><span><i className="signal" /> Local proof ready</span><span><i className="signal" /> No real funds</span></div>
          </aside>

          <div className="demo-workspace">
            <header className="demo-header">
              <div><small>GUIDED DEMO / {steps[step].toUpperCase()}</small><h2>{demoTitle(step)}</h2></div>
              <div className="progress-wrap"><span>{progress}</span><div><i style={{ width: progress }} /></div></div>
            </header>

            <div className="demo-content">
              {step === 0 && <ContractStage onNext={advance} />}
              {step === 1 && <ReviewStage approved={approved} onNext={advance} />}
              {step === 2 && <TwinStage onNext={advance} />}
              {step === 3 && <MandateStage onNext={advance} />}
              {step === 4 && <AgentStage state={paymentState} setState={setPaymentState} onNext={advance} />}
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

function ContractStage({ onNext }: { onNext: () => void }) {
  return <StageShell tag="FluxContracts" title="A synthetic agreement is ready." copy="The complete document remains private. Only reviewed economic meaning can become authority." action="Extract obligations" onNext={onNext}>
    <div className="document-card"><div className="document-icon">PDF</div><div><small>SYNTHETIC CONTRACT</small><h4>Axiom Compute Services Agreement</h4><p>3 pages · signed · SHA-256 commitment ready</p></div><span className="status status-neutral">Private</span></div>
    <div className="notice"><b>What AI will do</b><span>Propose structured terms with clause-level evidence. It cannot approve or sign.</span></div>
  </StageShell>;
}

function ReviewStage({ approved, onNext }: { approved: boolean; onNext: () => void }) {
  return <StageShell tag="Human checkpoint" title={approved ? "Material terms approved." : "Every claim carries its evidence."} copy="Review the commercial meaning before it becomes financial authority." action={approved ? "Continue to Twin" : "Approve all terms"} onNext={onNext}>
    <div className="obligation-grid">{obligations.map((item) => <article key={item.label}><small>{item.label}</small><strong>{item.value}</strong><span>{item.source}</span><i className="confidence">96%</i></article>)}</div>
  </StageShell>;
}

function TwinStage({ onNext }: { onNext: () => void }) {
  return <StageShell tag="FluxTwin" title="The commitment is safe—under current assumptions." copy="Forecasts are deterministic. AI explains the result but never invents the numbers." action="Create mandate draft" onNext={onNext}>
    <div className="metric-grid"><Metric label="Cash" value="$84.2K" delta="unchanged" /><Metric label="Committed" value="$27.4K" delta="+$12K" tone="warn" /><Metric label="Runway" value="12.8 mo" delta="−1.4 mo" tone="warn" /><Metric label="Safe to deploy" value="$18.4K" delta="within policy" tone="good" /></div>
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

function AgentStage({ state, setState, onNext }: { state: "idle" | "settled" | "blocked"; setState: (state: "settled" | "blocked") => void; onNext: () => void }) {
  return <StageShell tag="FluxFlow" title="The agent can act without unlimited access." copy="Test both sides of the boundary. The final build will submit these attempts against localnet and Devnet." action="Inspect full proof" onNext={onNext}>
    <div className="agent-panel"><div className="agent-identity"><span className="agent-avatar">A1</span><div><small>AUTONOMOUS BUYER</small><strong>Compute Buyer 01</strong><span>Mandate FM-8842</span></div></div><div className="allowance"><small>PERIOD ALLOWANCE</small><strong>$4,000</strong><div><i style={{ width: state === "settled" ? "31.5%" : "0%" }} /></div><span>{state === "settled" ? "$1,260 consumed · $2,740 available" : "$4,000 available"}</span></div></div>
    <div className="payment-actions"><button onClick={() => setState("settled")}><span>01</span><b>Pay $1,260</b><small>Within mandate</small></button><button onClick={() => setState("blocked")}><span>02</span><b>Pay $5,200</b><small>Exceeds cap</small></button></div>
    {state !== "idle" && <div className={`decision ${state}`}><b>{state === "settled" ? "Payment authorized" : "Payment blocked"}</b><span>{state === "settled" ? "Recipient, asset, period, and remaining allowance match." : "Requested amount exceeds the 4,000 DemoUSD period cap."}</span></div>}
  </StageShell>;
}

function ProofStage({ state }: { state: "idle" | "settled" | "blocked" }) {
  return <div className="stage"><div className="stage-intro"><span className="stage-tag">FluxProof</span><h3>One trace. Every reason.</h3><p>The production trace will link directly to the Solana Explorer. This foundation uses clearly labelled synthetic evidence until the program is deployed.</p></div>
    <div className="trace">{trace.map(([label, value], index) => <article key={label}><span>{String(index + 1).padStart(2, "0")}</span><div><small>{label}</small><strong>{value}</strong></div>{index < trace.length - 1 && <i />}</article>)}</div>
    <div className="proof-receipt"><div><small>DEMO OUTCOME</small><strong>{state === "blocked" ? "Rejected before settlement" : "Settlement evidence prepared"}</strong></div><span className={`status ${state === "blocked" ? "status-danger" : "status-good"}`}>{state === "blocked" ? "Policy blocked" : "Verified path"}</span></div>
  </div>;
}

