import { NextResponse } from "next/server"
import { getRun } from "@/lib/store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params
  const run = await getRun(id)
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 })
  return NextResponse.json(run, { headers: { "Cache-Control": "no-store" } })
}
