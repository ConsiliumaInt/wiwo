import type { BrowserRunResult } from "@/lib/browser/worker"
import { exploreApplication, replayWorkflow } from "@/lib/browser/worker"
import { createFinding, sameFailure } from "@/lib/detection"
import { getLLMProvider } from "@/lib/llm/openai"
import { RepairWorkspace } from "@/lib/sandbox/worker"
import { addEvent, getRun, updateRun } from "@/lib/store"
import type { BrowserAction, Finding, QARun, Stage, VerificationResult } from "@/lib/types"
import { redactSecrets } from "@/lib/security"

const activeRuns = new Set<string>()

export function startRun(runId: string): void {
  if (activeRuns.has(runId)) return
  activeRuns.add(runId)
  void executeRun(runId).finally(() => activeRuns.delete(runId))
}

async function executeRun(runId: string): Promise<void> {
  const run = await requireRun(runId)
  const deadline = Date.now() + boundedTimeout(process.env.WIWO_RUN_TIMEOUT_MS)
  let workspace: RepairWorkspace | undefined
  let keepPreview = false
  try {
    await updateRun(runId, (current) => {
      current.status = "RUNNING"
      current.startedAt = new Date().toISOString()
    })
    const llm = getLLMProvider()

    assertDeadline(deadline)
    const exploration = await discover(run, llm)
    await updateRun(runId, (current) => {
      current.browserSessionId = exploration.sessionId
      current.recordingUrl = exploration.recordingUrl
    })

    assertDeadline(deadline)
    const finding = await detect(runId, run.input.objective, exploration)
    if (!finding) {
      await reportNoDefect(runId, exploration)
      return
    }

    assertDeadline(deadline)
    const reproduced = await reproduce(runId, run.input.applicationUrl, finding, exploration)
    if (!reproduced || !run.input.repositoryUrl) {
      await reportFinding(runId, run.input.repositoryUrl ? "Failure was not repeatable; repair was not attempted" : "No repository supplied; run completed in QA-only mode")
      return
    }

    assertDeadline(deadline)
    const apiKey = process.env.SOLARI_API_KEY
    if (!apiKey) throw new Error("SOLARI_API_KEY is required for repository repair")
    workspace = new RepairWorkspace(apiKey, (message, detail) => addEvent(runId, "DIAGNOSE", message, "info", detail).then(() => undefined))
    const prepared = await workspace.prepare(run.input.repositoryUrl, finding)
    await updateRun(runId, (current) => { current.repositoryAnalysis = prepared.analysis })
    const currentFinding = await requireFinding(runId, finding.id)
    const rootCause = await workspace.diagnose(llm, currentFinding, prepared)
    await updateFinding(runId, finding.id, (item) => {
      item.rootCause = rootCause
      item.affectedFiles = rootCause.likelyFiles
    })
    await addEvent(runId, "DIAGNOSE", "Cause identified", "success", rootCause.probableCause)

    assertDeadline(deadline)
    await addEvent(runId, "FIX", "Generating a minimal candidate fix")
    const patch = await workspace.generateAndApplyPatch(llm, currentFinding, rootCause, prepared.sourceContext)
    await updateFinding(runId, finding.id, (item) => {
      item.status = "FIX_ATTEMPTED"
      item.patch = patch
      item.evidence.push({ id: crypto.randomUUID(), kind: "diff", label: "Candidate patch", value: patch, timestamp: new Date().toISOString() })
    })
    await addEvent(runId, "FIX", "Patch generated and applied", "success")

    assertDeadline(deadline)
    const validation = await workspace.validate(prepared.analysis)
    const validationPassed = validation.length > 0 && validation.every((result) => result.passed)
    await updateFinding(runId, finding.id, (item) => { item.validation = validation })
    if (!validationPassed) {
      await workspace.reject(prepared.snapshotId)
      await updateFinding(runId, finding.id, (item) => { item.status = "FIX_REJECTED" })
      await addEvent(runId, "VALIDATE", "Candidate validation failed", "error", validationSummary(validation))
      await reportFinding(runId, "The candidate was rejected because practical repository checks did not all pass")
      return
    }
    await addEvent(runId, "VALIDATE", "Candidate validation passed", "success", validationSummary(validation))

    assertDeadline(deadline)
    await addEvent(runId, "DEPLOY_PREVIEW", "Starting patched application")
    const previewUrl = await workspace.launchPreview(prepared.analysis)
    keepPreview = true
    await updateRun(runId, (current) => { current.previewUrl = previewUrl })

    assertDeadline(deadline)
    const after = await verify(runId, previewUrl, finding, exploration, validationPassed)
    await updateFinding(runId, finding.id, (item) => {
      item.after = after.summary
      item.verification = after
      item.status = after.expectedOutcomeObserved ? "VERIFIED_FIXED" : "UNABLE_TO_VERIFY"
    })
    if (after.expectedOutcomeObserved && run.input.repositoryUrl) {
      await addEvent(runId, "REPORT", "Publishing verified repair as a pull request")
      const pullRequestUrl = await workspace.publishPullRequest(run.input.repositoryUrl, finding, runId)
      if (pullRequestUrl) {
        await updateRun(runId, (current) => { current.pullRequestUrl = pullRequestUrl })
        await addEvent(runId, "REPORT", "Pull request opened", "success", pullRequestUrl)
      } else {
        await addEvent(runId, "REPORT", "Pull request not opened", "warning", "GITHUB_TOKEN is not configured")
      }
    }
    await reportFinding(runId, after.expectedOutcomeObserved ? "The reproduced failure is absent from the patched workflow" : "The patched workflow did not meet every verification gate")
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error))
    await addEvent(runId, currentStageForError(await requireRun(runId)), "Run stopped", "error", message).catch(() => undefined)
    await updateRun(runId, (current) => {
      current.status = "FAILED"
      current.error = message
      current.completedAt = new Date().toISOString()
      for (const finding of current.findings) {
        if (!["VERIFIED_FIXED", "FIX_REJECTED", "UNABLE_TO_REPRODUCE"].includes(finding.status)) finding.status = "UNABLE_TO_VERIFY"
      }
    })
  } finally {
    await workspace?.complete(keepPreview).catch(() => undefined)
  }
}

async function discover(run: QARun, llm: ReturnType<typeof getLLMProvider>): Promise<BrowserRunResult> {
  await addEvent(run.id, "DISCOVER", "Launching Solari browser")
  const result = await exploreApplication({
    runId: run.id,
    applicationUrl: run.input.applicationUrl,
    objective: run.input.objective,
    llm,
    onProgress: (message, detail) => addEvent(run.id, "EXECUTE", message, "info", detail).then(() => undefined),
  })
  await addEvent(run.id, "EXECUTE", "Objective workflow completed", "success", `${result.steps.length} browser decisions`)
  return result
}

async function detect(runId: string, objective: string, exploration: BrowserRunResult): Promise<Finding | null> {
  await addEvent(runId, "DETECT", "Evaluating observable failure signals")
  const finding = createFinding(exploration, objective)
  if (!finding) {
    await addEvent(runId, "DETECT", "No actionable defect detected", "success", "WIWO does not infer success beyond the observed workflow")
    return null
  }
  await updateRun(runId, (run) => { run.findings.push(finding) })
  await addEvent(runId, "DETECT", "Failure detected", "warning", finding.actualBehaviour)
  return finding
}

async function reproduce(runId: string, url: string, finding: Finding, exploration: BrowserRunResult): Promise<boolean> {
  await updateFinding(runId, finding.id, (item) => { item.status = "REPRODUCING" })
  await addEvent(runId, "REPRODUCE", "Replaying the exact observed workflow")
  const replay = await replayWorkflow(runId, url, replayActions(exploration.steps), "reproduction", (message, detail) => addEvent(runId, "REPRODUCE", message, "info", detail).then(() => undefined))
  const reproduced = sameFailure(finding, replay)
  await updateFinding(runId, finding.id, (item) => {
    item.status = reproduced ? "REPRODUCED" : "UNABLE_TO_REPRODUCE"
    item.evidence.push(...replay.evidence)
  })
  await addEvent(runId, "REPRODUCE", reproduced ? "Failure reproduced" : "Unable to reproduce failure", reproduced ? "success" : "warning")
  return reproduced
}

async function verify(runId: string, previewUrl: string, finding: Finding, exploration: BrowserRunResult, validationPassed: boolean): Promise<VerificationResult> {
  await addEvent(runId, "VERIFY", "Running before/after verification against preview")
  const after = await replayWorkflow(runId, previewUrl, replayActions(exploration.steps), "after", (message, detail) => addEvent(runId, "VERIFY", message, "info", detail).then(() => undefined))
  const originalAbsent = !sameFailure(finding, after)
  const workflowRerun = after.steps.filter((step) => step.action.type !== "finish").length === exploration.steps.filter((step) => step.action.type !== "finish").length
  const noFailureSignals = after.signals.length === 0
  const expectedOutcomeObserved = originalAbsent && workflowRerun && noFailureSignals && validationPassed
  const summary = expectedOutcomeObserved
    ? "PASS — the same workflow completed without the reproduced failure and repository validation passed"
    : `UNVERIFIED — originalAbsent=${originalAbsent}, workflowRerun=${workflowRerun}, noFailureSignals=${noFailureSignals}, validationPassed=${validationPassed}`
  await updateFinding(runId, finding.id, (item) => { item.evidence.push(...after.evidence) })
  await addEvent(runId, "VERIFY", expectedOutcomeObserved ? "Bug verified fixed" : "Unable to verify fix", expectedOutcomeObserved ? "success" : "warning", summary)
  return {
    originalReproduced: true,
    validationPassed,
    previewLaunched: true,
    workflowRerun,
    expectedOutcomeObserved,
    summary,
  }
}

async function reportNoDefect(runId: string, exploration: BrowserRunResult): Promise<void> {
  await addEvent(runId, "REPORT", "Run complete", "success", `No actionable defect was observed. ${exploration.finishedReason}`)
  await completeRun(runId)
}

async function reportFinding(runId: string, detail: string): Promise<void> {
  await addEvent(runId, "REPORT", "QA report ready", "success", detail)
  await completeRun(runId)
}

async function completeRun(runId: string): Promise<void> {
  await updateRun(runId, (run) => {
    run.status = "COMPLETED"
    run.currentStage = "REPORT"
    run.completedAt = new Date().toISOString()
  })
}

async function updateFinding(runId: string, findingId: string, mutate: (finding: Finding) => void): Promise<void> {
  await updateRun(runId, (run) => {
    const finding = run.findings.find((item) => item.id === findingId)
    if (!finding) throw new Error(`Finding ${findingId} not found`)
    mutate(finding)
  })
}

async function requireFinding(runId: string, findingId: string): Promise<Finding> {
  const run = await requireRun(runId)
  const finding = run.findings.find((item) => item.id === findingId)
  if (!finding) throw new Error(`Finding ${findingId} not found`)
  return finding
}

async function requireRun(runId: string): Promise<QARun> {
  const run = await getRun(runId)
  if (!run) throw new Error(`Run ${runId} not found`)
  return run
}

function assertDeadline(deadline: number): void {
  if (Date.now() > deadline) throw new Error("Run exceeded its configured execution deadline")
}

function boundedTimeout(value?: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(60_000, Math.min(3_600_000, parsed)) : 20 * 60_000
}

function validationSummary(results: { command: string; passed: boolean }[]): string {
  return results.length ? results.map((result) => `${result.passed ? "PASS" : "FAIL"} ${result.command}`).join(" · ") : "No practical validation scripts discovered"
}

function replayActions(steps: BrowserRunResult["steps"]): BrowserAction[] {
  // Replay the exact recorded target first. qz element IDs are regenerated
  // deterministically for a fresh page, while semantic labels may vary or be
  // absent during hydration; performAction still provides semantic recovery.
  return steps.map((step) => step.action)
}

function currentStageForError(run: QARun): Stage {
  return run.currentStage
}
