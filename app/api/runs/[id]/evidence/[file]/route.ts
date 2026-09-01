import { readFile } from "node:fs/promises"
import path from "node:path"

export const runtime = "nodejs"

export async function GET(_request: Request, context: { params: Promise<{ id: string; file: string }> }): Promise<Response> {
  const { id, file } = await context.params
  if (!/^[a-f0-9-]{36}$/.test(id) || !/^[a-z]+-\d+\.png$/.test(file)) return new Response("Not found", { status: 404 })
  try {
    const contents = await readFile(path.join(process.cwd(), "data", "evidence", id, file))
    return new Response(contents, { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" } })
  } catch {
    return new Response("Not found", { status: 404 })
  }
}
