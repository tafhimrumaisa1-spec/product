import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { WalletConnect } from "@/components/wallet-connect";
import { DEVNET_EVIDENCE, devnetTransaction } from "@/lib/devnet-evidence";
import styles from "./thesis.module.css";

export const metadata: Metadata = {
  title: "The Thesis — FluxMandate",
  description: "Why the machine economy needs contract-linked financial authority, not only faster payments.",
};

const modules = [
  ["01", "FluxContracts", "Interpret", "Evidence-backed obligations from private commercial agreements."],
  ["02", "FluxGraph", "Connect", "A validated economic graph shared by every financial agent."],
  ["03", "FluxTwin", "Simulate", "Cash, runway, commitments and downside before authority exists."],
  ["04", "FluxMandate", "Authorize", "Human-approved limits linked to the contract and company state."],
  ["05", "FluxFlow", "Execute", "Direct and x402 requests routed through the same bounded authority."],
  ["06", "FluxProof", "Explain", "Contract-to-settlement evidence that survives every handoff."],
] as const;

const agents = [
  ["A1", "Contract", "Terms verified"],
  ["A2", "Treasury", "Runway watching"],
  ["A3", "Risk", "Cap enforced"],
  ["A4", "Purchasing", "Request ready"],
  ["A5", "Settlement", "Chain listening"],
  ["A6", "Ledger", "Reconcile ready"],
  ["A7", "Scenario", "Downside modeled"],
] as const;

export default function ThesisPage() {
  return (
    <main className={styles.page}>
      <nav className="topbar">
        <Link className="brand" href="/" aria-label="FluxMandate home">
          <span className="brand-mark"><Image src="/fluxmandate-logo.png" alt="" width={34} height={34} priority /></span>
          <span>FluxMandate</span>
        </Link>
        <div className="nav-links">
          <Link className={styles.activeNav} href="/thesis">The Thesis</Link>
          <Link href="/#system">System</Link>
          <Link href="/#proof">Proof</Link>
          <span className="network-pill"><i /> Devnet ready</span>
          <WalletConnect />
        </div>
      </nav>

      <section className={`${styles.hero} shell-grid`}>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}><span>01</span> THE FLUXMANDATE THESIS / DEFAI</p>
          <h1>The machine economy has payments.<br /><em>It does not have financial authority.</em></h1>
          <p className={styles.lede}>FluxMandate turns private commercial intent into simulated, human-approved and independently enforceable authority for autonomous software.</p>
          <div className={styles.actions}>
            <Link className="button button-primary" href="/#demo">Run the authority loop →</Link>
            <a className={styles.secondaryAction} href={devnetTransaction(DEVNET_EVIDENCE.rejected.signature)} target="_blank" rel="noreferrer">Inspect Devnet proof ↗</a>
          </div>
        </div>
        <div className={styles.heroSystem} aria-label="The FluxMandate authority stack">
          <div className={styles.systemHeader}><span>AUTHORITY STACK / LIVE</span><b><i /> verified boundary</b></div>
          <div className={styles.stackRow}><small>01</small><span>COMMERCIAL INTENT</span><b>Contract</b></div>
          <div className={styles.stackRow}><small>02</small><span>ECONOMIC CAPACITY</span><b>Company Twin</b></div>
          <div className={`${styles.stackRow} ${styles.stackActive}`}><small>03</small><span>BOUNDED AUTHORITY</span><b>Mandate Kernel</b></div>
          <div className={styles.stackRow}><small>04</small><span>INDEPENDENT CONTROL</span><b>Solana</b></div>
          <div className={styles.stackFooter}><span>AI interpreted</span><span>Human approved</span><span>Code calculated</span><span>Solana enforced</span></div>
        </div>
      </section>

      <section className={styles.proofRail} aria-label="Verified product status">
        <span><i /> 416 tests passed</span>
        <span><i /> Anchor deployed</span>
        <span><i /> Authorized settlement</span>
        <span><i /> On-chain rejection</span>
        <span><i /> x402 V2 ready</span>
      </section>

      <section className={styles.section}>
        <SectionIntro index="02" label="THE CATEGORY MISTAKE" title={<>A wallet is not<br />a finance department.</>} copy="Machine payments solved movement before companies solved authority. Signing a valid transaction does not prove that it was commercially permitted, financially safe or explainable later." />
        <div className={styles.questionGrid}>
          <article><small>PAYMENTS ANSWER</small><strong>How can money move?</strong><span>Transport</span></article>
          <article><small>WALLETS ANSWER</small><strong>Who can sign?</strong><span>Custody</span></article>
          <article><small>ACCOUNTING ANSWERS</small><strong>What happened?</strong><span>Record</span></article>
          <article className={styles.accentCard}><small>FLUXMANDATE ANSWERS</small><strong>Was it authorized?</strong><span>Authority</span></article>
        </div>
      </section>

      <section className={`${styles.section} ${styles.lightSection}`}>
        <SectionIntro index="03" label="THE MISSING LAYER" title={<>Between intent and settlement,<br />companies need authority.</>} copy="FluxMandate does not replace the ERP, wallet or payment rail. It connects their missing decisions into one governed loop." dark />
        <div className={styles.authorityFlow}>
          {[["01", "Contract", "What was agreed"], ["02", "Interpret", "What it means"], ["03", "Simulate", "Can we afford it"], ["04", "Approve", "What humans permit"], ["05", "Enforce", "What agents can do"], ["06", "Prove", "Why value moved"]].map(([n, title, copy], index) => (
            <article key={title}><small>{n}</small><b>{title}</b><span>{copy}</span>{index < 5 && <i>→</i>}</article>
          ))}
        </div>
        <p className={styles.declaration}>Autonomous commerce cannot scale on trust alone. <b>It needs bounded authority.</b></p>
      </section>

      <section className={styles.section}>
        <SectionIntro index="04" label="ONE GOVERNED FINANCIAL LOOP" title={<>From legal prose to<br />enforceable execution.</>} copy="Each module owns one trust boundary. Together they create the financial operating layer for autonomous companies." />
        <div className={styles.moduleGrid}>
          {modules.map(([number, name, verb, copy]) => <article key={name}><span>{number}</span><small>{verb}</small><h3>{name}</h3><p>{copy}</p></article>)}
        </div>
      </section>

      <section className={`${styles.section} ${styles.agentSection}`}>
        <SectionIntro index="05" label="MULTI-AGENT FINANCE SYSTEM" title={<>One company twin.<br />Seven financial specialists.</>} copy="The agents work simultaneously, but they do not form an uncontrolled swarm. FluxGraph gives them shared context; the Mandate Kernel gives them separate, bounded authority." />
        <div className={styles.agentMap}>
          <svg viewBox="0 0 1000 480" preserveAspectRatio="none" aria-hidden="true">
            <path className={styles.agentRing} d="M100 105 L360 62 L640 62 L900 105 L790 390 L500 430 L210 390 Z" />
            <path d="M500 240 L100 105 M500 240 L360 62 M500 240 L640 62 M500 240 L900 105 M500 240 L790 390 M500 240 L500 430 M500 240 L210 390" />
          </svg>
          {agents.map(([id, name, status], index) => <article className={styles[`agent${index + 1}`]} key={name}><span>{id}</span><div><small>{name} agent</small><b>{status}</b></div><i /></article>)}
          <div className={styles.twinCore}><small>NORTHSTAR AI</small><strong>COMPANY TWIN</strong><span>FluxGraph synchronized</span><b>MANDATE KERNEL</b></div>
        </div>
        <div className={styles.agentPrinciple}><span>Agents specialize.</span><span>State stays shared.</span><span>Authority stays bounded.</span><span>Every action stays explainable.</span></div>
      </section>

      <section className={`${styles.section} ${styles.lightSection}`}>
        <SectionIntro index="06" label="TRUST, DELIBERATELY SPLIT" title={<>We use each technology only<br />where its trust model belongs.</>} copy="Probabilistic interpretation should never become financial authority without deterministic and human controls." dark />
        <div className={styles.trustGrid}>
          <article><span>01</span><small>AI INTERPRETS</small><h3>Meaning from language</h3><p>Unstructured agreements, ambiguous clauses, cross-references and plain-language explanations.</p><b>Cannot approve · Cannot sign</b></article>
          <article><span>02</span><small>DETERMINISTIC CODE CALCULATES</small><h3>Numbers without invention</h3><p>Cash forecasts, runway, schedules, caps, lifecycle transitions and reconciliation.</p><b>Same input · Same result</b></article>
          <article className={styles.trustDark}><span>03</span><small>SOLANA ENFORCES</small><h3>A boundary agents cannot ignore</h3><p>Agent, recipient, asset, time window, period cap, allowance and replay protection.</p><b>Independent · Verifiable</b></article>
        </div>
      </section>

      <section className={styles.section}>
        <SectionIntro index="07" label="x402 + FINANCIAL CONTEXT" title={<>x402 tells an agent how to pay.<br /><em>FluxMandate decides whether it should.</em></>} copy="The x402 V2 bridge converts a machine payment challenge into the same canonical spend request used by FluxFlow. No protocol shortcut bypasses company policy." />
        <div className={styles.x402Grid}>
          <div className={styles.x402Column}><small>STANDARD MACHINE PAYMENT</small><span>Resource requests payment</span><span>Agent receives price</span><span>Wallet signs</span><span>Settlement proves payment</span></div>
          <div className={styles.x402Gate}><small>FLUXMANDATE GATE</small><b>CONTRACT</b><b>RECIPIENT</b><b>ASSET</b><b>CAP</b><b>EXPIRY</b><b>ALLOWANCE</b></div>
          <div className={`${styles.x402Column} ${styles.x402Governed}`}><small>GOVERNED MACHINE PAYMENT</small><span>Challenge becomes spend intent</span><span>Mandate evaluates authority</span><span>Solana enforces boundary</span><span>Proof explains commercial reason</span></div>
        </div>
        <div className={styles.statusLine}><span><i /> Policy bridge implemented and tested</span><span>Live facilitator settlement · next adapter</span></div>
      </section>

      <section className={`${styles.section} ${styles.proofSection}`}>
        <SectionIntro index="08" label="REAL PROOF, NOT A CONCEPT" title={<>We tested both sides<br />of authority.</>} copy="The public demo is safely replayable. The underlying enforcement evidence is independently inspectable on Solana Devnet." />
        <div className={styles.evidenceGrid}>
          <a href={devnetTransaction(DEVNET_EVIDENCE.authorized.signature)} target="_blank" rel="noreferrer"><small>AUTHORIZED</small><strong>1,260</strong><span>DemoUSD finalized ↗</span></a>
          <a href={devnetTransaction(DEVNET_EVIDENCE.rejected.signature)} target="_blank" rel="noreferrer"><small>REJECTED</small><strong>5,200</strong><span>6017 CapExceeded ↗</span></a>
          <a href="https://explorer.solana.com/address/E7MjFsDybvfCaoNWopicKzB4oAtHBWTVAC5ZX9ajWJRq?cluster=devnet" target="_blank" rel="noreferrer"><small>PROGRAM</small><strong>E7Mj…WJRq</strong><span>Anchor on Devnet ↗</span></a>
          <article><small>ENGINEERING</small><strong>416</strong><span>passing tests</span></article>
        </div>
      </section>

      <section className={`${styles.section} ${styles.lightSection}`}>
        <SectionIntro index="09" label="THE DIFFERENCE" title={<>Not another wallet.<br />A new control layer.</>} copy="FluxMandate begins where payment products usually end: with the commercial and economic reason value is allowed to move." dark />
        <div className={styles.differenceGrid}>
          {["Begins with contracts, not transactions", "Simulates impact before authorization", "Separates AI interpretation from control", "Coordinates agents through shared state", "Enforces limits independently from agents", "Preserves contract-to-settlement evidence", "Works with direct and x402 requests", "Complements wallets, ERPs and rails"].map((item, index) => <article key={item}><span>0{index + 1}</span><b>{item}</b></article>)}
        </div>
      </section>

      <section className={styles.section}>
        <SectionIntro index="10" label="THE COMMERCIAL WEDGE" title={<>Start where machines<br />already buy.</>} copy="AI companies already purchase compute, inference, data and paid APIs. This is where autonomous demand meets real contracts, recurring obligations and treasury risk." />
        <div className={styles.marketGrid}>
          <article><small>INITIAL USER</small><strong>AI-native companies</strong><p>Engineering and finance teams operating autonomous purchasing systems.</p></article>
          <article><small>BEACHHEAD</small><strong>Machine services</strong><p>Compute, inference, datasets, APIs and software subscriptions.</p></article>
          <article><small>EXPANSION</small><strong>Autonomous operations</strong><p>Cloud → SaaS procurement → marketplaces → machine-to-machine commerce.</p></article>
          <article><small>BUSINESS MODEL</small><strong>Authority infrastructure</strong><p>Platform subscription, governed volume and enterprise integrations.</p></article>
        </div>
      </section>

      <section className={`${styles.finalSection} shell-grid`}>
        <p>THE FLUXMANDATE MANIFESTO</p>
        <h2>The future of finance is not fully autonomous.<br /><em>It is autonomously executed and deliberately governed.</em></h2>
        <span>FluxMandate gives companies the confidence to let software act economically without losing control of why, where and how money moves.</span>
        <div className={styles.actions}>
          <Link className="button button-primary" href="/#demo">Launch the system →</Link>
          <a className={styles.secondaryAction} href="https://github.com/tafhimrumaisa1-spec/product" target="_blank" rel="noreferrer">Inspect the source ↗</a>
          <a className={styles.secondaryAction} href="https://explorer.solana.com/address/E7MjFsDybvfCaoNWopicKzB4oAtHBWTVAC5ZX9ajWJRq?cluster=devnet" target="_blank" rel="noreferrer">Verify on Solana ↗</a>
        </div>
      </section>

      <footer className={styles.footer}><span>FLUXMANDATE / DEFAI / SOLANA</span><span>AI interprets · Humans approve · Code calculates · Solana enforces</span></footer>
    </main>
  );
}

function SectionIntro({ index, label, title, copy, dark = false }: { index: string; label: string; title: React.ReactNode; copy: string; dark?: boolean }) {
  return <header className={`${styles.sectionIntro} ${dark ? styles.darkText : ""}`}><div><span>{index}</span><small>{label}</small></div><h2>{title}</h2><p>{copy}</p></header>;
}
