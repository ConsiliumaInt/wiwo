import type { BrowserAction } from "@/lib/types"
import type { BrowserPage, PageSnapshot, SemanticElement } from "@/lib/browser/snapshot"

export interface ActionResult {
  recovered: boolean
  selector: string
  observation: string
}

export async function performAction(
  page: BrowserPage,
  action: BrowserAction,
  snapshot: PageSnapshot,
): Promise<ActionResult> {
  if (action.type === "wait") {
    await page.waitForTimeout(1_000)
    return { recovered: false, selector: "", observation: "Waited for the interface to settle" }
  }
  if (action.type === "goto") {
    if (!action.url) throw new Error("Planner omitted the navigation URL")
    const destination = new URL(action.url, page.url())
    if (destination.origin !== new URL(page.url()).origin) throw new Error("Cross-origin planner navigation was blocked")
    await page.goto(destination.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 })
    return { recovered: false, selector: destination.toString(), observation: `Navigated to ${destination.pathname}` }
  }
  if (action.type === "finish") {
    return { recovered: false, selector: "", observation: action.reason }
  }

  const match = resolveTarget(action.target ?? "", snapshot.elements)
  if (!match) throw new Error(`No safe semantic match for target "${action.target}"`)
  if (action.type === "click" && /\b(place order|buy now|purchase|delete|remove account|send message|publish)\b/i.test(match.element.name)) {
    throw new Error(`Potentially irreversible action blocked: "${match.element.name}"`)
  }
  const locator = page.locator(`[data-wiwo-id="${match.element.id}"]`).first()
  if (action.type === "click") await locator.click({ timeout: 10_000 })
  if (action.type === "fill") await locator.fill(syntheticValue(action.value ?? "", match.element))
  if (action.type === "select") await locator.selectOption({ label: action.value }).catch(() => locator.selectOption(action.value ?? ""))
  if (action.type === "press") await locator.press(action.key || "Enter")
  await page.waitForTimeout(600)
  return {
    recovered: match.recovered,
    selector: `${match.element.role} "${match.element.name}"`,
    observation: match.recovered
      ? `Recovered semantically from "${action.target}" to "${match.element.name}"`
      : `Used ${match.element.role} "${match.element.name}"`,
  }
}

function resolveTarget(target: string, elements: SemanticElement[]): { element: SemanticElement; recovered: boolean } | null {
  const direct = elements.find((element) => element.id === target && !element.disabled)
  if (direct) return { element: direct, recovered: false }
  const wanted = normalise(target)
  const ranked = elements
    .filter((element) => !element.disabled)
    .map((element) => ({ element, score: semanticScore(wanted, normalise(element.name)) }))
    .sort((a, b) => b.score - a.score)
  return ranked[0] && ranked[0].score >= 0.45 ? { element: ranked[0].element, recovered: true } : null
}

function normalise(value: string): string[] {
  return value.toLowerCase().replace(/qz-\d+/g, "").match(/[a-z0-9]+/g) ?? []
}

function semanticScore(wanted: string[], candidate: string[]): number {
  if (!wanted.length || !candidate.length) return 0
  const overlap = wanted.filter((token) => candidate.includes(token)).length
  return (2 * overlap) / (wanted.length + candidate.length)
}

function syntheticValue(proposed: string, element: SemanticElement): string {
  if (element.type === "password") return proposed || "WIWO-Test-7f!"
  if (element.type === "email") return proposed.includes("@") ? proposed : `wiwo+${Date.now()}@example.com`
  if (element.type === "tel") return proposed || "+15555550123"
  return proposed || "WIWO test"
}
