"use client"

import Image from "next/image"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { STAGES, type Evidence, type Finding, type QARun } from "@/lib/types"

export function RunView({ initialRun }: { initialRun: QARun }) {
  const [run, setRun] = useState(initialRun)

  useEffect(() => {
    let active = true
    const endpoint = `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/runs/${run.id}`
    const refresh = async () => {
      try {
        const response = await fetch(endpoint, { cache: "no-store" })
        if (active && response.ok) setRun(await response.json() as QARun)
      } catch {
        // The event stream remains the primary live update channel.
      }
    }
    void refresh()
    const poll = window.setInterval(() => void refresh(), 2_000)
    // Fallback for proxies/browsers that silently drop SSE and cache fetches:
    // an active run must never leave viewers staring at its initial snapshot.
    const hardRefresh = run.status === "RUNNING" || run.status === "QUEUED"
      ? window.setInterval(() => window.location.reload(), 10_000)
      : undefined
    const source = new EventSource(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/runs/${run.id}/events`)
    source.addEventListener("snapshot", (event) => { if (active) setRun(JSON.parse((event as MessageEvent<string>).data) as QARun) })
    return () => { active = false; window.clearInterval(poll); if (hardRefresh) window.clearInterval(hardRefresh); source.close() }
  }, [run.id])

  const duration = useMemo(() => formatDuration(run.startedAt ?? run.createdAt, run.completedAt), [run.startedAt, run.createdAt, run.completedAt])
  const fixed = run.findings.filter((finding) => finding.status === "VERIFIED_FIXED").length
  const unverified = run.findings.filter((finding) => finding.status !== "VERIFIED_FIXED").length

  return (
    <main className="runShell">
      <section className="runHeader">
        <div>
          <Link className="backLink" href="/">← New run</Link>
          <div className="eyebrow">RUN {run.id.slice(0, 8).toUpperCase()}</div>
          <h1>{run.input.objective}</h1>
          <div className="targetLine"><span>{host(run.input.applicationUrl)}</span>{run.input.repositoryUrl && <span>{repoName(run.input.repositoryUrl)}</span>}</div>
        </div>
        <StatusPill status={run.status} />
      </section>

      <section className="runStats">
        <Stat label="Duration" value={duration} />
        <Stat label="Findings" value={String(run.findings.length)} />
        <Stat label="Verified fixed" value={String(fixed)} tone="good" />
        <Stat label="Unverified" value={String(unverified)} tone={unverified ? "warn" : undefined} />
      </section>

      <div className="runGrid">
        <section className="panel timelinePanel">
          <div className="panelTitle"><span>Execution timeline</span><span>{run.currentStage.replace("_", " / ")}</span></div>
          <div className="stageRail">
            {STAGES.map((stage) => {
              const currentIndex = STAGES.indexOf(run.currentStage)
              const index = STAGES.indexOf(stage)
              return <div key={stage} className={`stageNode ${index < currentIndex || run.status === "COMPLETED" ? "done" : ""} ${stage === run.currentStage && run.status === "RUNNING" ? "active" : ""}`}><span>{index < currentIndex || run.status === "COMPLETED" ? "✓" : index + 1}</span><b>{stage.replace("_", " / ")}</b></div>
            })}
          </div>
          <div className="eventList" aria-live="polite">
            {run.events.map((event) => (
              <div className={`event ${event.level}`} key={event.id}>
                <time>{new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
                <span className="eventMarker" />
                <div><b>{event.message}</b>{event.detail && <p>{event.detail}</p>}</div>
              </div>
            ))}
          </div>
        </section>

        <aside className="panel evidenceSummary">
          <div className="panelTitle"><span>Run evidence</span></div>
          <KeyValue label="Target" value={run.input.applicationUrl} link />
          <KeyValue label="Repository" value={run.input.repositoryUrl ?? "QA-only mode"} link={Boolean(run.input.repositoryUrl)} />
          <KeyValue label="Browser session" value={run.browserSessionId ?? "Pending"} />
          <KeyValue label="Sandbox" value={run.repositoryAnalysis?.sandboxId ?? "Not created"} />
          <KeyValue label="Stack" value={run.repositoryAnalysis?.stack ?? "Pending repair mode"} />
          <KeyValue label="Preview" value={run.previewUrl ?? "Unavailable"} link={Boolean(run.previewUrl)} />
          <KeyValue label="Pull request" value={run.pullRequestUrl ?? "Only opened after verified fix"} link={Boolean(run.pullRequestUrl)} />
          {run.error && <div className="runError"><b>Run stopped</b><p>{run.error}</p></div>}
        </aside>
      </div>

      <section className="findingsSection">
        <div className="sectionHeading"><div><span className="eyebrow">ENGINEERING REPORT</span><h2>{run.findings.length ? "Findings" : run.status === "COMPLETED" ? "No actionable defect observed" : "Findings pending"}</h2></div><span>{run.findings.length} TOTAL</span></div>
        {run.findings.map((finding, index) => <FindingCard key={finding.id} finding={finding} index={index + 1} />)}
        {!run.findings.length && <div className="emptyReport">{run.status === "RUNNING" || run.status === "QUEUED" ? "WIWO will publish only evidence-backed findings." : "The tested workflow produced no failure signal. This does not claim coverage beyond the executed objective."}</div>}
      </section>
    </main>
  )
}

function FindingCard({ finding, index }: { finding: Finding; index: number }) {
  const screenshots = finding.evidence.filter((item) => item.kind === "screenshot")
  const otherEvidence = finding.evidence.filter((item) => item.kind !== "screenshot" && item.kind !== "diff")
  return (
    <article className="findingCard">
      <header className="findingHeader">
        <div className={`severity ${finding.severity}`}>{finding.severity.toUpperCase()}</div>
        <div><span>FINDING {String(index).padStart(2, "0")}</span><h3>{finding.title}</h3><p>{finding.description}</p></div>
        <div className="findingStatus">{finding.status.replaceAll("_", " ")}</div>
      </header>
      <div className="comparison">
        <div><span>EXPECTED</span><p>{finding.expectedBehaviour}</p></div>
        <div><span>ACTUAL</span><p>{finding.actualBehaviour}</p></div>
      </div>
      <div className="findingGrid">
        <section><h4>Reproduction</h4><ol>{finding.reproductionSteps.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{item}</li>)}</ol></section>
        <section><h4>Root cause</h4>{finding.rootCause ? <><p>{finding.rootCause.probableCause}</p><small>{finding.rootCause.confidence.toUpperCase()} CONFIDENCE</small><p className="muted">{finding.rootCause.rationale}</p></> : <p className="muted">Not available until a defect is reproduced and source is supplied.</p>}</section>
      </div>
      {finding.affectedFiles?.length ? <div className="fileList"><span>AFFECTED FILES</span>{finding.affectedFiles.map((file) => <code key={file}>{file}</code>)}</div> : null}
      {finding.patch && <details open><summary>Candidate patch</summary><pre>{finding.patch}</pre></details>}
      {finding.validation?.length ? <section className="validation"><h4>Validation</h4>{finding.validation.map((result) => <div className="validationRow" key={result.command}><span className={result.passed ? "pass" : "fail"}>{result.passed ? "PASS" : "FAIL"}</span><code>{result.command}</code><span>{(result.durationMs / 1000).toFixed(1)}s</span></div>)}</section> : null}
      {finding.verification && <div className={`verification ${finding.verification.expectedOutcomeObserved ? "verified" : "unverified"}`}><b>{finding.verification.expectedOutcomeObserved ? "BEFORE: FAIL → AFTER: PASS" : "FIX NOT VERIFIED"}</b><p>{finding.verification.summary}</p></div>}
      {screenshots.length ? <div className="screenshots">{screenshots.map((shot) => <figure key={shot.id}><Image src={evidenceSrc(shot.value)} alt={shot.label} width={1200} height={760} unoptimized /><figcaption>{shot.label}</figcaption></figure>)}</div> : null}
      {otherEvidence.length ? <details><summary>Evidence log ({otherEvidence.length})</summary><div className="evidenceLog">{otherEvidence.map((item) => <EvidenceRow key={item.id} evidence={item} />)}</div></details> : null}
    </article>
  )
}

function EvidenceRow({ evidence }: { evidence: Evidence }) {
  const isLink = /^https?:\/\//.test(evidence.value)
  return <div><span>{evidence.kind}</span><b>{evidence.label}</b>{isLink ? <a href={evidence.value} target="_blank" rel="noreferrer">Open evidence ↗</a> : <code>{evidence.value}</code>}</div>
}

function StatusPill({ status }: { status: QARun["status"] }) {
  return <div className={`runStatus ${status.toLowerCase()}`}><span />{status}</div>
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <div className={`stat ${tone ?? ""}`}><span>{label}</span><b>{value}</b></div>
}

function KeyValue({ label, value, link = false }: { label: string; value: string; link?: boolean }) {
  return <div className="keyValue"><span>{label}</span>{link ? <a href={value} target="_blank" rel="noreferrer">{value}</a> : <b>{value}</b>}</div>
}

function host(value: string): string { try { return new URL(value).hostname } catch { return value } }
function repoName(value: string): string { return value.replace(/\.git$/, "").split("/").slice(-2).join("/") }
function formatDuration(start: string, end?: string): string {
  const seconds = Math.max(0, Math.floor(((end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime()) / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function evidenceSrc(value: string): string {
  if (!value.startsWith("/api/")) return value
  return `${process.env.NEXT_PUBLIC_BASE_PATH || ""}${value}`
}
