import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import type { QARun, RunEvent, Stage } from "@/lib/types"

const DATA_DIR = path.join(process.cwd(), "data", "runs")
const locks = new Map<string, Promise<void>>()

async function ensureDataDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
}

function runPath(id: string): string {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid run id")
  return path.join(DATA_DIR, `${id}.json`)
}

export async function createRun(run: QARun): Promise<void> {
  await ensureDataDir()
  await writeAtomic(run)
}

export async function getRun(id: string): Promise<QARun | null> {
  try {
    return JSON.parse(await readFile(runPath(id), "utf8")) as QARun
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

export async function updateRun(id: string, mutate: (run: QARun) => void): Promise<QARun> {
  const previous = locks.get(id) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  const queued = previous.then(() => current)
  locks.set(id, queued)
  await previous
  try {
    const run = await getRun(id)
    if (!run) throw new Error(`Run ${id} not found`)
    mutate(run)
    await writeAtomic(run)
    return run
  } finally {
    release()
    if (locks.get(id) === queued) locks.delete(id)
  }
}

export async function addEvent(
  runId: string,
  stage: Stage,
  message: string,
  level: RunEvent["level"] = "info",
  detail?: string,
): Promise<RunEvent> {
  const event: RunEvent = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    stage,
    level,
    message,
    detail,
  }
  await updateRun(runId, (run) => {
    run.currentStage = stage
    run.events.push(event)
  })
  return event
}

async function writeAtomic(run: QARun): Promise<void> {
  const destination = runPath(run.id)
  const temporary = `${destination}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, destination)
}
