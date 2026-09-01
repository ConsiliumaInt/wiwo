"use client"

import { useRouter } from "next/navigation"
import { FormEvent, useState } from "react"

const EXAMPLE_OBJECTIVE = "Test signup, login and checkout. Find anything broken and try to fix it."

export function NewRunForm() {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError("")
    const form = new FormData(event.currentTarget)
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationUrl: form.get("applicationUrl"),
          repositoryUrl: form.get("repositoryUrl"),
          objective: form.get("objective"),
        }),
      })
      const payload = (await response.json()) as { runId?: string; error?: string }
      if (!response.ok || !payload.runId) throw new Error(payload.error || "Unable to start QA run")
      router.push(`/runs/${payload.runId}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to start QA run")
      setSubmitting(false)
    }
  }

  return (
    <form className="runForm" onSubmit={submit}>
      <div className="formHeading">
        <div><span className="statusDot" /> DEFINE THE MISSION</div>
        <span>LIVE / NO SIMULATION</span>
      </div>
      <label data-index="01">
        <span>Target application <b>REQUIRED</b></span>
        <input name="applicationUrl" type="url" inputMode="url" placeholder="https://app.example.com" required autoComplete="url" />
      </label>
      <label data-index="02">
        <span>Source repository <em>Optional / unlocks repair</em></span>
        <input name="repositoryUrl" type="url" inputMode="url" placeholder="https://github.com/owner/repository" autoComplete="url" />
      </label>
      <label data-index="03">
        <span>Mission objective <b>REQUIRED</b></span>
        <textarea name="objective" placeholder={EXAMPLE_OBJECTIVE} minLength={8} maxLength={2000} required />
      </label>
      {error && <div className="formError" role="alert">{error}</div>}
      <button className="primaryButton" type="submit" disabled={submitting}>
        <span>{submitting ? "INITIALIZING…" : "EXECUTE QA MISSION"}</span>
        <span aria-hidden>↗</span>
      </button>
      <p className="formNote"><b>SAFETY BOUNDARY</b> Repository code never touches this host. Every repair runs inside an isolated Solari microVM.</p>
    </form>
  )
}
