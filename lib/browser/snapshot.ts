import type { BrowserSession } from "@solarisdk/browser"

export type BrowserPage = Awaited<ReturnType<BrowserSession["newPage"]>>

export interface SemanticElement {
  id: string
  tag: string
  role: string
  name: string
  type: string
  value: string
  disabled: boolean
}

export interface PageSnapshot {
  url: string
  title: string
  text: string
  elements: SemanticElement[]
}

export async function inspectPage(page: BrowserPage): Promise<PageSnapshot> {
  const data = await page.evaluate(() => {
    const visible = (element: HTMLElement): boolean => {
      const style = getComputedStyle(element)
      const box = element.getBoundingClientRect()
      return style.visibility !== "hidden" && style.display !== "none" && box.width > 0 && box.height > 0
    }
    const selector = [
      "a[href]",
      "button",
      "input",
      "select",
      "textarea",
      "[role='button']",
      "[role='link']",
      "[role='checkbox']",
      "[role='radio']",
    ].join(",")
    const elements = Array.from(document.querySelectorAll<HTMLElement>(selector))
      .filter(visible)
      .slice(0, 100)
      .map((element, index) => {
        const id = `qz-${index}`
        element.dataset.wiwoId = id
        const labelledBy = element.getAttribute("aria-labelledby")
        const explicitLabel = element.id
          ? document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(element.id)}"]`)?.innerText
          : undefined
        const wrappedLabel = element.closest("label")?.textContent
        const ariaReference = labelledBy
          ? labelledBy.split(/\s+/).map((labelId) => document.getElementById(labelId)?.textContent).join(" ")
          : undefined
        const input = element as HTMLInputElement
        return {
          id,
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute("role") ?? element.tagName.toLowerCase(),
          name: (
            element.getAttribute("aria-label") ??
            ariaReference ??
            explicitLabel ??
            wrappedLabel ??
            input.placeholder ??
            element.innerText ??
            element.textContent ??
            ""
          ).replace(/\s+/g, " ").trim().slice(0, 180),
          type: input.type ?? "",
          value: input.value?.slice(0, 120) ?? "",
          disabled: input.disabled || element.getAttribute("aria-disabled") === "true",
        }
      })
    return {
      url: location.href,
      title: document.title,
      text: (document.body?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 8_000),
      elements,
    }
  })
  return data
}

export function compactSnapshot(snapshot: PageSnapshot): string {
  const controls = snapshot.elements
    .map((element) => `[${element.id}] ${element.role} "${element.name}"${element.type ? ` type=${element.type}` : ""}${element.disabled ? " disabled" : ""}`)
    .join("\n")
  return `URL: ${snapshot.url}\nTitle: ${snapshot.title}\nVisible text: ${snapshot.text}\nControls:\n${controls}`
}
