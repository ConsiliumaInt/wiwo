import { NewRunForm } from "@/components/new-run-form"
import { LoginGate } from "@/components/login-gate"

export default function HomePage() {
  return (
    <LoginGate><main className="shell homeShell">
      <section className="intro">
        <div className="eyebrow"><span>MISSION / 001</span> AUTONOMOUS SOFTWARE QUALITY</div>
        <div className="verdictHero" aria-label="Will it ship?">
          <span className="will">WILL IT</span>
          <span className="wont">WON&apos;T IT</span>
          <span className="ship">SHIP?</span>
        </div>
        <p className="heroCopy"><b>Don&apos;t trust the patch.</b> Make it prove itself. WIWO drives the product, reproduces the failure, repairs the source in isolation, then runs the same workflow again.</p>
        <div className="pipeline" aria-label="WIWO pipeline">
          {[
            ["01", "HUNT"], ["02", "REPRO"], ["03", "PATCH"], ["04", "PROVE"], ["05", "VERDICT"],
          ].map(([number, label]) => <span key={number}><b>{number}</b>{label}</span>)}
        </div>
      </section>
      <NewRunForm />
      <section className="trustStrip" aria-label="Execution guarantees">
        <strong>PROOF, NOT PROMISES</strong>
        <span><i>01</i> Real browser sessions</span>
        <span><i>02</i> Isolated repair sandboxes</span>
        <span><i>03</i> Observable verification only</span>
      </section>
    </main></LoginGate>
  )
}
