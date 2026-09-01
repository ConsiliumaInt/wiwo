import { NextResponse } from "next/server"
import { startRun } from "@/lib/orchestrator"
import { createRun } from "@/lib/store"
import type { QARun, RunInput } from "@/lib/types"
import { validateApplicationUrl, validateRepositoryUrl } from "@/lib/security"

export const runtime = "nodejs"

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as Partial<RunInput>
    const objective = body.objective?.trim()
    if (!objective || objective.length < 8 || objective.length > 2_000) {
      return NextResponse.json({ error: "Testing objective must be between 8 and 2,000 characters" }, { status: 400 })
    }
    const input: RunInput = {
      applicationUrl: validateApplicationUrl(body.applicationUrl ?? ""),
      repositoryUrl: validateRepositoryUrl(body.repositoryUrl),
      objective,
    }
    const now = new Date().toISOString()
    const run: QARun = {
      id: crypto.randomUUID(),
      input,
      status: "QUEUED",
      currentStage: "DISCOVER",
      createdAt: now,
      events: [{ id: crypto.randomUUID(), timestamp: now, stage: "DISCOVER", level: "info", message: "Run queued" }],
      findings: [],
    }
    await createRun(run)
    startRun(run.id)
    return NextResponse.json({ runId: run.id }, { status: 202 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create run" }, { status: 400 })
  }
}
