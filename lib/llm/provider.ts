export interface JSONSchema {
  type: "object"
  properties: Record<string, unknown>
  required: string[]
  additionalProperties: false
}

export interface GenerateRequest {
  name: string
  system: string
  prompt: string
  schema: JSONSchema
}

export interface LLMProvider {
  generate<T>(request: GenerateRequest): Promise<T>
}

export class LLMUnavailableError extends Error {}
