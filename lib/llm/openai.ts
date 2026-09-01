import type { GenerateRequest, LLMProvider } from "@/lib/llm/provider"
import { LLMUnavailableError } from "@/lib/llm/provider"

interface ResponsesPayload {
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
  error?: { message?: string }
  status?: string
}

export class OpenAIProvider implements LLMProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model = process.env.OPENAI_MODEL || "gpt-5-mini",
    private readonly endpoint = "https://api.openai.com/v1/responses",
  ) {}

  async generate<T>({ name, system, prompt, schema }: GenerateRequest): Promise<T> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        instructions: system,
        input: prompt,
        store: false,
        max_output_tokens: 12_000,
        text: {
          format: {
            type: "json_schema",
            name,
            strict: true,
            schema,
          },
        },
      }),
      signal: AbortSignal.timeout(90_000),
    })
    const payload = (await response.json()) as ResponsesPayload
    if (!response.ok) {
      throw new Error(`AI provider failed (${response.status}): ${payload.error?.message ?? "unknown error"}`)
    }
    if (payload.status && payload.status !== "completed") {
      throw new Error(`AI provider returned a non-completed response (${payload.status})`)
    }
    const text = payload.output
      ?.flatMap((item) => item.content ?? [])
      .find((item) => item.type === "output_text")?.text
    if (!text) throw new Error("AI provider returned no structured output")
    return JSON.parse(text) as T
  }
}

export function getLLMProvider(): LLMProvider {
  const provider = (process.env.LLM_PROVIDER || "openai").toLowerCase()
  if (provider === "deepseek") {
    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) {
      throw new LLMUnavailableError("DEEPSEEK_API_KEY is required when LLM_PROVIDER=deepseek")
    }
    return new OpenAIProvider(
      apiKey,
      process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
      process.env.DEEPSEEK_BASE_URL
        ? `${process.env.DEEPSEEK_BASE_URL.replace(/\/$/, "")}/responses`
        : "https://api.deepseek.com/responses",
    )
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new LLMUnavailableError("OPENAI_API_KEY is required (or set LLM_PROVIDER=deepseek with DEEPSEEK_API_KEY)")
  }
  return new OpenAIProvider(apiKey)
}
