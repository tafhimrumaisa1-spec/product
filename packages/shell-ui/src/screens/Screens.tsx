"use client";

import React, { useEffect, useState } from "react";
import { Badge, Button, Field, Meter, Panel, ProofDrawer, StateView, Stat } from "../components/primitives";
import { demoApi, type FluxApi, type Obligation } from "../mocks/data";
import { evaluatePayment, runwayMonths, usd, type Mandate } from "../lib/mandate";

function useLoad<T>(load: () => Promise<T>) {
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  useEffect(() => {
    let active = true;
    load().then((data) => { if (active) setState({ data }); }, (error: unknown) => { if (active) setState({ error: String(error) }); });
    return () => { active = false; };
  }, [load]);
  return state;
}

export const STEPS = ["Load contract", "AI extracts terms", "Human approves", "See cash impact", "Create mandate", "Agent pays", "Overspend rejected", "Ledger reconciles", "Show proof"] as const;

export const DemoProgress = ({ current }: { current: number }) => (
  <ol aria-label="Guided demo progress" className="fx-demo-progress">
    {STEPS.map((step, index) => <li key={step} aria-current={index === current ? "step" : undefined} data-state={index < current ? "done" : index === current ? "now" : "next"}>
      <span className="fx-data">{index < current ? "Done" : index === current ? "Now" : "Next"}</span> {step}
    </li>)}
  </ol>
);

export const ContractReview = ({ api = demoApi }: { api?: FluxApi }) => {
  const { data, error } = useLoad(api.getObligations);
  const [decisions, setDecisions] = useState<Record<string, Obligation["status"]>>({});
  if (error) return <StateView kind="error" title="Contract terms could not load" body="Retry. Nothing was approved." />;
  if (!data) return <StateView kind="loading" title="Extracting contract terms" body="" />;
  if (!data.length) return <StateView kind="empty" title="No contract loaded" body="Load the synthetic compute contract to begin." action={<Button variant="primary">Load contract</Button>} />;
  const obligations = data.map((item) => ({ ...item, status: decisions[item.id] ?? item.status }));
  const open = obligations.filter((item) => item.status !== "approved").length;
  return <div className="fx-split">
    <Panel title="Contract text (private, synthetic)"><p>§3.2 Customer shall pay Vendor $40,000 monthly, not to exceed $40,000 in any calendar month…</p></Panel>
    <Panel title="Extracted obligations">
      {obligations.map((item) => <div key={item.id} className="fx-obligation">
        <div><strong>{item.label}</strong><div className="fx-muted">{item.clause}, AI confidence {Math.round(item.confidence * 100)}%</div></div>
        <div>{item.status === "approved" ? <Badge tone="ok">Human approved</Badge> : <><Badge tone={item.status === "flagged" ? "warn" : "neutral"}>{item.status === "flagged" ? "Needs attention" : "Awaiting review"}</Badge> <Button onClick={() => setDecisions((previous) => ({ ...previous, [item.id]: "approved" }))}>Approve</Button></>}</div>
      </div>)}
      {open === 0 ? <StateView kind="success" title="All obligations approved" body="Mandates can now be created." /> : <StateView kind="warning" title={`${open} obligation${open > 1 ? "s" : ""} still need a human`} body="AI cannot approve. Review each one." />}
    </Panel>
  </div>;
};

export const TwinPanels = ({ api = demoApi }: { api?: FluxApi }) => {
  const { data } = useLoad(api.getTwin);
  const [selected, setSelected] = useState(0);
  if (!data) return <StateView kind="loading" title="Running simulation" body="" />;
  const scenario = data.scenarios[selected];
  const burn = data.burnCents + scenario.burnDeltaCents;
  return <div className="fx-split">
    <Panel title="Company metrics"><Stat label="Cash" value={usd(data.cashCents)} /><Stat label="Monthly burn" value={usd(burn)} note={`${usd(scenario.burnDeltaCents)} from this contract`} /><Stat label="Runway" value={`${runwayMonths(data.cashCents, burn) ?? "—"} months`} /></Panel>
    <Panel title="Scenarios">{data.scenarios.map((item, index) => <Button key={item.name} variant={index === selected ? "primary" : "default"} aria-pressed={index === selected} onClick={() => setSelected(index)}>{item.name}</Button>)}<p>Calculated by deterministic code, not by AI.</p></Panel>
  </div>;
};

export const MandateBuilder = ({ api = demoApi }: { api?: FluxApi }) => {
  const { data } = useLoad(api.getMandate);
  const [mandate, setMandate] = useState<Mandate>();
  const [amount, setAmount] = useState("1200000");
  const [log, setLog] = useState<string[]>([]);
  useEffect(() => { if (data) setMandate(data); }, [data]);
  if (!mandate) return <StateView kind="loading" title="Loading mandate draft" body="" />;
  const test = () => {
    const amountCents = Number(amount);
    const result = evaluatePayment(mandate, mandate.vendor, amountCents);
    setLog((previous) => [result.ok ? `Authorized ${usd(amountCents)}` : `Rejected ${usd(amountCents)}: ${result.reason}`, ...previous]);
    if (result.ok) setMandate({ ...mandate, spentInPeriodCents: mandate.spentInPeriodCents + amountCents });
  };
  return <div className="fx-split">
    <Panel title="Mandate terms"><Field label="Per-payment limit (cents)" type="number" value={mandate.maxPerPaymentCents} onChange={(event) => setMandate({ ...mandate, maxPerPaymentCents: Number(event.target.value) })} /><Field label="Monthly cap (cents)" type="number" value={mandate.capPerPeriodCents} onChange={(event) => setMandate({ ...mandate, capPerPeriodCents: Number(event.target.value) })} /><p>Linked to {mandate.contractId}, {mandate.obligationId}, {mandate.agentId}</p><Button variant="primary" disabled={mandate.status === "active"} onClick={() => setMandate({ ...mandate, status: "active" })}>Approve as human</Button> <Badge tone={mandate.status === "active" ? "ok" : "warn"}>{mandate.status}</Badge></Panel>
    <Panel title="Test a payment"><Field label="Amount (cents)" type="number" value={amount} onChange={(event) => setAmount(event.target.value)} /><Meter value={mandate.spentInPeriodCents} max={mandate.capPerPeriodCents} label="Monthly cap used" /><Button onClick={test}>Send test payment</Button><ul aria-live="polite">{log.map((entry) => <li key={entry}>{entry}</li>)}</ul></Panel>
  </div>;
};

export const AgentEconomics = ({ api = demoApi }: { api?: FluxApi }) => {
  const { data } = useLoad(api.getAgents);
  if (!data) return <StateView kind="loading" title="Loading agents" body="" />;
  if (!data.length) return <StateView kind="empty" title="No agents have spending authority" body="Create a mandate to give an agent a budget." />;
  return <>{data.map((agent) => <Panel key={agent.id} title={agent.id}><Meter value={agent.spentCents} max={agent.capCents} label="Budget used" /><p>{usd(agent.spentCents)} of {usd(agent.capCents)} spent on “{agent.task}”. Outcome: {agent.value}.</p></Panel>)}</>;
};

export const ProofTrace = ({ api = demoApi }: { api?: FluxApi }) => {
  const { data } = useLoad(api.getProof);
  if (!data) return <StateView kind="loading" title="Building evidence trail" body="" />;
  return <Panel title="Settlement proof"><ol className="fx-proof-list">{data.map((entry) => <li key={entry.step} data-state={entry.state}>{entry.step} <Badge tone={entry.state === "ok" ? "ok" : "bad"}>{entry.state === "ok" ? "Verified (mock)" : "Blocked"}</Badge><ProofDrawer summary="Technical proof">{entry.ref}</ProofDrawer></li>)}</ol></Panel>;
};
