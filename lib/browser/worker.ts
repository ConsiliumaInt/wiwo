import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { Solari } from "@solarisdk/browser"
import type { LLMProvider } from "@/lib/llm/provider"
import type { BrowserAction, BrowserStep, Evidence } from "@/lib/types"
import { chooseNextAction } from "@/lib/browser/planner"
import { performAction } from "@/lib/browser/interactions"
import { inspectPage, type BrowserPage } from "@/lib/browser/snapshot"
import { redactSecrets } from "@/lib/security"

export interface FailureSignal {
  kind: "http" | "console" | "exception" | "interaction" | "page"
  message: string
  url: string
  severity: "critical" | "high" | "medium" | "low"
  request?: {
    url: string
    method: string
    body?: string
    contentType?: string
    expectedStatus: number
  }
}

export interface BrowserRunResult {
  sessionId: string
  recordingUrl?: string
  finalUrl: string
  finalText: string
  steps: BrowserStep[]
  signals: FailureSignal[]
  evidence: Evidence[]
  finishedReason: string
}

interface WorkerOptions {
  runId: string
  applicationUrl: string
  objective: string
  llm: LLMProvider
  onProgress: (message: string, detail?: string) => Promise<void>
}

export async function exploreApplication(options: WorkerOptions): Promise<BrowserRunResult> {
  const apiKey = process.env.SOLARI_API_KEY
  if (!apiKey) throw new Error("SOLARI_API_KEY is required to launch a real browser")
  const solari = new Solari({ apiKey })
  try {
    // The health probe can time out on an otherwise healthy remote session; the
    // first page navigation below is the meaningful end-to-end readiness check.
    const browser = await solari.launch({ recording: true, retries: 1, probe: false })
    const sessionId = browser.id
    const evidence: Evidence[] = []
    let result: Omit<BrowserRunResult, "recordingUrl">
    try {
      await options.onProgress("Browser launched", `Solari session ${sessionId}`)
      const page = await browser.newPage()
      const signals = observeFailures(page)
      await page.goto(options.applicationUrl, { waitUntil: "domcontentloaded", timeout: 30_000 })
      await options.onProgress("Application inspected", await page.title())
      const steps: BrowserStep[] = []
      const maxSteps = boundedInteger(process.env.WIWO_MAX_BROWSER_STEPS, 12, 3, 30)
      let finishedReason = "Browser step budget reached"

      for (let index = 0; index < maxSteps; index += 1) {
        const snapshot = await inspectPage(page)
        const action = await chooseNextAction(options.llm, options.objective, snapshot, steps)
        if (action.type === "finish") {
          finishedReason = action.reason
          steps.push(step(index, action, page.url(), "passed", action.reason))
          break
        }
        await options.onProgress(actionLabel(action), action.reason)
        const before = `${page.url()}\n${snapshot.text}`
        try {
          const outcome = await performAction(page, action, snapshot)
          const afterSnapshot = await inspectPage(page)
          const unchanged = (action.type === "click" || action.type === "press") &&
            before === `${page.url()}\n${afterSnapshot.text}`
          if (unchanged && action.expected) {
            signals.push({
              kind: "interaction",
              message: `No observable page change after ${outcome.selector}; expected ${action.expected}`,
              url: page.url(),
              severity: "medium",
            })
          }
          if (outcome.recovered) await options.onProgress("Interaction self-healed", outcome.observation)
          const replayableAction = outcome.selector ? { ...action, target: outcome.selector } : action
          steps.push(step(index, replayableAction, page.url(), outcome.recovered ? "recovered" : "passed", outcome.observation, outcome.selector))
          if (signals.some((signal) => ["http", "exception", "page"].includes(signal.kind))) {
            finishedReason = "Actionable application failure observed"
            await options.onProgress("Application failure captured", "Stopping exploration and moving to deterministic reproduction")
            break
          }
        } catch (error) {
          const message = safeError(error)
          signals.push({ kind: "interaction", message, url: page.url(), severity: "high" })
          steps.push(step(index, action, page.url(), "failed", message))
          finishedReason = `Interaction failed: ${message}`
          break
        }
      }
      const finalSnapshot = await inspectPage(page)
      detectVisibleFailure(finalSnapshot.text, page.url(), signals)
      const screenshot = await captureScreenshot(page, options.runId, "before")
      if (screenshot) evidence.push(screenshot)
      evidence.push(...signals.map(signalEvidence))
      result = {
        sessionId,
        finalUrl: page.url(),
        finalText: finalSnapshot.text.slice(0, 2_000),
        steps,
        signals: deduplicateSignals(signals),
        evidence,
        finishedReason,
      }
    } finally {
      await browser.close()
    }
    const recordingUrl = await pollRecording(solari, sessionId)
    if (recordingUrl) {
      result.evidence.push(evidenceItem("recording", "Solari session replay", recordingUrl))
    } else {
      result.evidence.push(evidenceItem("recording", "Solari session", sessionId))
    }
    return { ...result, recordingUrl }
  } finally {
    await solari.close()
  }
}

export async function replayWorkflow(
  runId: string,
  applicationUrl: string,
  actions: BrowserAction[],
  label: "reproduction" | "after",
  onProgress: (message: string, detail?: string) => Promise<void>,
): Promise<BrowserRunResult> {
  const apiKey = process.env.SOLARI_API_KEY
  if (!apiKey) throw new Error("SOLARI_API_KEY is required to launch a real browser")
  const solari = new Solari({ apiKey })
  try {
    const browser = await solari.launch({ recording: true, retries: 1, probe: false })
    const sessionId = browser.id
    const evidence: Evidence[] = []
    let result: Omit<BrowserRunResult, "recordingUrl">
    try {
      const page = await browser.newPage()
      const signals = observeFailures(page)
      await page.goto(applicationUrl, { waitUntil: "domcontentloaded", timeout: 30_000 })
      const steps: BrowserStep[] = []
      for (let index = 0; index < actions.length; index += 1) {
        const action = adaptNavigation(actions[index], applicationUrl)
        if (action.type === "finish") continue
        const snapshot = await inspectPage(page)
        try {
          const outcome = await performAction(page, action, snapshot)
          steps.push(step(index, action, page.url(), outcome.recovered ? "recovered" : "passed", outcome.observation, outcome.selector))
        } catch (error) {
          const message = safeError(error)
          signals.push({ kind: "interaction", message, url: page.url(), severity: "high" })
          steps.push(step(index, action, page.url(), "failed", message))
          break
        }
      }
      await onProgress(label === "after" ? "Patched workflow replayed" : "Original workflow replayed", `${steps.length} deterministic steps`)
      const finalSnapshot = await inspectPage(page)
      detectVisibleFailure(finalSnapshot.text, page.url(), signals)
      const screenshot = await captureScreenshot(page, runId, label)
      if (screenshot) evidence.push(screenshot)
      evidence.push(...deduplicateSignals(signals).map(signalEvidence))
      result = {
        sessionId,
        finalUrl: page.url(),
        finalText: finalSnapshot.text.slice(0, 2_000),
        steps,
        signals: deduplicateSignals(signals),
        evidence,
        finishedReason: steps.some((item) => item.outcome === "failed") ? "Replay stopped on failed interaction" : "Replay completed",
      }
    } finally {
      await browser.close()
    }
    const recordingUrl = await pollRecording(solari, sessionId)
    if (recordingUrl) result.evidence.push(evidenceItem("recording", `${label} replay`, recordingUrl))
    return { ...result, recordingUrl }
  } finally {
    await solari.close()
  }
}

function observeFailures(page: BrowserPage): FailureSignal[] {
  const signals: FailureSignal[] = []
  page.on("console", (message) => {
    if (message.type() === "error") signals.push({ kind: "console", message: redactSecrets(message.text()), url: page.url(), severity: "medium" })
  })
  page.on("pageerror", (error) => {
    signals.push({ kind: "exception", message: redactSecrets(error.message), url: page.url(), severity: "high" })
  })
  page.on("requestfailed", (request) => {
    signals.push({ kind: "http", message: `${request.method()} ${request.url()} — ${request.failure()?.errorText ?? "request failed"}`, url: request.url(), severity: "medium" })
  })
  page.on("response", (response) => {
    if (response.status() >= 400 && ["document", "xhr", "fetch"].includes(response.request().resourceType())) {
      const request = response.request()
      signals.push({
        kind: "http",
        message: `HTTP ${response.status()} ${request.method()} ${response.url()}`,
        url: response.url(),
        severity: response.status() >= 500 ? "high" : "medium",
        request: {
          url: response.url(),
          method: request.method(),
          body: request.postData() ?? undefined,
          contentType: request.headers()["content-type"],
          expectedStatus: response.status(),
        },
      })
    }
  })
  return signals
}

export async function replayHttpFailure(request: NonNullable<FailureSignal["request"]>): Promise<boolean> {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.contentType ? { "Content-Type": request.contentType } : undefined,
    body: ["GET", "HEAD"].includes(request.method.toUpperCase()) ? undefined : request.body,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  })
  return response.status === request.expectedStatus
}

function detectVisibleFailure(text: string, url: string, signals: FailureSignal[]): void {
  const patterns = [
    /\binternal server error\b/i,
    /\bsomething went wrong\b/i,
    /\bpage not found\b/i,
    /\bunexpected error\b/i,
    /\bservice unavailable\b/i,
  ]
  const match = patterns.find((pattern) => pattern.test(text))
  if (match) signals.push({ kind: "page", message: `Visible error state: ${text.match(match)?.[0]}`, url, severity: "high" })
}

async function captureScreenshot(page: BrowserPage, runId: string, label: string): Promise<Evidence | null> {
  try {
    const directory = path.join(process.cwd(), "data", "evidence", runId)
    await mkdir(directory, { recursive: true })
    const fileName = `${label}-${Date.now()}.png`
    await writeFile(path.join(directory, fileName), await page.screenshot({ fullPage: true, type: "png" }), { mode: 0o600 })
    return evidenceItem("screenshot", `${label} screenshot`, `/api/runs/${runId}/evidence/${fileName}`)
  } catch {
    return null
  }
}

async function pollRecording(solari: Solari, sessionId: string): Promise<string | undefined> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    try {
      return (await solari.sessions.getReplayUrl(sessionId)).url
    } catch {
      // Upload is asynchronous after release, as documented by the cookbook.
    }
  }
  return undefined
}

function step(index: number, action: BrowserAction, url: string, outcome: BrowserStep["outcome"], observation: string, selectorUsed?: string): BrowserStep {
  return { index: index + 1, action, url, outcome, observation, selectorUsed, timestamp: new Date().toISOString() }
}

function actionLabel(action: BrowserAction): string {
  const verb = { click: "Clicking", fill: "Filling", select: "Selecting", goto: "Navigating", press: "Pressing", wait: "Waiting", finish: "Finishing" }[action.type]
  return `${verb}${action.target ? ` ${action.target}` : ""}`
}

function evidenceItem(kind: Evidence["kind"], label: string, value: string): Evidence {
  return { id: crypto.randomUUID(), kind, label, value, timestamp: new Date().toISOString() }
}

function signalEvidence(signal: FailureSignal): Evidence {
  return evidenceItem(signal.kind === "http" ? "network" : signal.kind === "console" ? "console" : "log", signal.kind, signal.message)
}

function deduplicateSignals(signals: FailureSignal[]): FailureSignal[] {
  return Array.from(new Map(signals.map((signal) => [`${signal.kind}:${signal.message}`, signal])).values())
}

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback
}

function adaptNavigation(action: BrowserAction, applicationUrl: string): BrowserAction {
  if (action.type !== "goto" || !action.url) return action
  const requested = new URL(action.url, applicationUrl)
  const target = new URL(applicationUrl)
  requested.protocol = target.protocol
  requested.host = target.host
  return { ...action, url: requested.toString() }
}

function safeError(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error))
}
