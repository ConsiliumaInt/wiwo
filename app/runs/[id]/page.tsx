import { notFound } from "next/navigation"
import { RunView } from "@/components/run-view"
import { getRun } from "@/lib/store"

export const dynamic = "force-dynamic"

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const run = await getRun(id)
  if (!run) notFound()
  return <RunView initialRun={run} />
}
