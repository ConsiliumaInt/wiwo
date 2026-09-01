export const STAGES = [
  "DISCOVER",
  "EXECUTE",
  "DETECT",
  "REPRODUCE",
  "DIAGNOSE",
  "FIX",
  "VALIDATE",
  "DEPLOY_PREVIEW",
  "VERIFY",
  "REPORT",
] as const

export type Stage = (typeof STAGES)[number]
export type RunStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED"
export type FindingStatus =
  | "FOUND"
  | "REPRODUCING"
  | "REPRODUCED"
  | "UNABLE_TO_REPRODUCE"
  | "FIX_ATTEMPTED"
  | "FIX_REJECTED"
  | "VERIFIED_FIXED"
  | "UNABLE_TO_VERIFY"
export type Severity = "critical" | "high" | "medium" | "low"

export interface RunInput {
  applicationUrl: string
  repositoryUrl?: string
  objective: string
}

export interface RunEvent {
  id: string
  timestamp: string
  stage: Stage
  level: "info" | "success" | "warning" | "error"
  message: string
  detail?: string
}

export interface Evidence {
  id: string
  kind: "screenshot" | "recording" | "console" | "network" | "log" | "diff"
  label: string
  value: string
  timestamp: string
}

export interface BrowserAction {
  type: "click" | "fill" | "select" | "goto" | "press" | "wait" | "finish"
  target?: string
  value?: string
  url?: string
  key?: string
  expected?: string
  reason: string
}

export interface BrowserStep {
  index: number
  action: BrowserAction
  url: string
  outcome: "passed" | "failed" | "recovered"
  observation: string
  selectorUsed?: string
  timestamp: string
}

export interface RootCause {
  probableCause: string
  confidence: "low" | "medium" | "high"
  likelyFiles: string[]
  rationale: string
  patchStrategy: string
}

export interface ValidationResult {
  command: string
  exitCode: number
  durationMs: number
  stdout: string
  stderr: string
  passed: boolean
}

export interface VerificationResult {
  originalReproduced: boolean
  validationPassed: boolean
  previewLaunched: boolean
  workflowRerun: boolean
  expectedOutcomeObserved: boolean
  summary: string
}

export interface Finding {
  id: string
  title: string
  severity: Severity
  status: FindingStatus
  description: string
  expectedBehaviour: string
  actualBehaviour: string
  reproductionSteps: string[]
  evidence: Evidence[]
  affectedUrl: string
  timestamp: string
  rootCause?: RootCause
  affectedFiles?: string[]
  patch?: string
  validation?: ValidationResult[]
  before?: string
  after?: string
  verification?: VerificationResult
}

export interface RepositoryAnalysis {
  stack: string
  packageManager?: string
  files: string[]
  scripts: Record<string, string>
  sandboxId: string
}

export interface QARun {
  id: string
  input: RunInput
  status: RunStatus
  currentStage: Stage
  createdAt: string
  startedAt?: string
  completedAt?: string
  events: RunEvent[]
  findings: Finding[]
  browserSessionId?: string
  recordingUrl?: string
  repositoryAnalysis?: RepositoryAnalysis
  previewUrl?: string
  pullRequestUrl?: string
  error?: string
}
