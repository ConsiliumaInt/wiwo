import type { BrowserRunResult, FailureSignal } from "@/lib/browser/worker"
import type { Finding, Severity } from "@/lib/types"

export function createFinding(result: BrowserRunResult, objective: string): Finding | null {
  if (!result.signals.length) return null
  // Prefer failures emitted by the application over the agent's own inability
  // to locate an element. A selector timeout can explain a bad test step, but
  // repeated HTTP/console/exception signals are the evidence we can repair.
  const primary = [...result.signals].sort((a, b) => signalRank(b) - signalRank(a))[0]
  return {
    id: crypto.randomUUID(),
    title: titleFor(primary),
    severity: primary.severity,
    status: "FOUND",
    description: `WIWO observed ${result.signals.length} failure signal${result.signals.length === 1 ? "" : "s"} while executing: ${objective}`,
    expectedBehaviour: expectedFrom(result),
    actualBehaviour: primary.message,
    reproductionSteps: result.steps.filter((step) => step.action.type !== "finish").map((step) => describeStep(step.action)),
    evidence: result.evidence,
    affectedUrl: primary.url || result.finalUrl,
    timestamp: new Date().toISOString(),
    before: primary.message,
    reproductionRequest: primary.request,
  }
}

export function sameFailure(original: Finding, replay: BrowserRunResult): boolean {
  const fingerprint = tokens(original.actualBehaviour)
  const originalHttpStatus = original.actualBehaviour.match(/\bHTTP\s+(\d{3})\b/i)?.[1]
  return replay.signals.some((signal) => {
    const replayHttpStatus = signal.message.match(/\bHTTP\s+(\d{3})\b/i)?.[1]
    if (originalHttpStatus && replayHttpStatus !== originalHttpStatus) return false
    return overlap(fingerprint, tokens(signal.message)) >= 0.55
  })
}

function expectedFrom(result: BrowserRunResult): string {
  const expected = [...result.steps].reverse().find((step) => step.action.expected)?.action.expected
  return expected || "The requested workflow should complete without an application or interaction failure"
}

function describeStep(action: BrowserRunResult["steps"][number]["action"]): string {
  if (action.type === "goto") return `Navigate to ${action.url}`
  if (action.type === "fill") return `Fill ${action.target} with synthetic test data`
  if (action.type === "select") return `Select ${action.value} in ${action.target}`
  if (action.type === "press") return `Press ${action.key || "Enter"} on ${action.target}`
  if (action.type === "wait") return "Wait for the interface to settle"
  return `Click ${action.target}`
}

function titleFor(signal: FailureSignal): string {
  if (signal.kind === "http") return "Workflow triggered a failed network request"
  if (signal.kind === "console") return "Application emitted a console error"
  if (signal.kind === "exception") return "Application raised an unhandled JavaScript exception"
  if (signal.kind === "interaction") return "Expected interaction could not be completed"
  return "Application displayed an error state"
}

function severityRank(severity: Severity): number {
  return { low: 1, medium: 2, high: 3, critical: 4 }[severity]
}

function signalRank(signal: FailureSignal): number {
  const kindRank = { http: 5, exception: 5, console: 4, page: 4, interaction: 1 }[signal.kind]
  return kindRank * 10 + severityRank(signal.severity)
}

function tokens(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []
}

function overlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const matches = a.filter((token) => b.includes(token)).length
  return matches / Math.min(a.length, b.length)
}
