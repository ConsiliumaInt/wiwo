import assert from "node:assert/strict"
import test from "node:test"
import { createFinding, sameFailure } from "../lib/detection"
import type { BrowserRunResult } from "../lib/browser/worker"

function browserResult(message: string): BrowserRunResult {
  return {
    sessionId: "session-test",
    finalUrl: "https://example.com/register",
    finalText: "Internal server error",
    finishedReason: "done",
    evidence: [],
    steps: [{
      index: 1,
      action: { type: "click", target: "button Register", reason: "submit", expected: "Account dashboard" },
      url: "https://example.com/register",
      outcome: "passed",
      observation: "clicked",
      timestamp: new Date(0).toISOString(),
    }],
    signals: [{ kind: "http", message, url: "https://example.com/api/register", severity: "high" }],
  }
}

test("creates structured findings only from observable signals", () => {
  const finding = createFinding(browserResult("HTTP 500 POST https://example.com/api/register"), "Test registration")
  assert.ok(finding)
  assert.equal(finding.status, "FOUND")
  assert.equal(finding.expectedBehaviour, "Account dashboard")
  assert.equal(finding.reproductionSteps.length, 1)
  assert.equal(createFinding({ ...browserResult("unused"), signals: [] }, "Test registration"), null)
})

test("requires an equivalent signal to claim reproduction", () => {
  const original = createFinding(browserResult("HTTP 500 POST https://example.com/api/register"), "Test registration")
  assert.ok(original)
  assert.equal(sameFailure(original, browserResult("HTTP 500 POST https://example.com/api/register")), true)
  assert.equal(sameFailure(original, browserResult("HTTP 400 POST https://example.com/api/register")), false)
  assert.equal(sameFailure(original, browserResult("Console warning from analytics")), false)
})
