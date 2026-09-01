import { getRun } from "@/lib/store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params
  const initial = await getRun(id)
  if (!initial) return Response.json({ error: "Run not found" }, { status: 404 })
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      let sent = 0
      const send = (event: string, payload: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`))
      }
      while (!request.signal.aborted) {
        const run = await getRun(id)
        if (!run) break
        for (const event of run.events.slice(sent)) send("run-event", event)
        sent = run.events.length
        send("snapshot", run)
        if (run.status === "COMPLETED" || run.status === "FAILED") break
        await new Promise((resolve) => setTimeout(resolve, 1_000))
      }
      controller.close()
    },
  })
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}
