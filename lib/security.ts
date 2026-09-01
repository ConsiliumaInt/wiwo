import { isIP } from "node:net"

const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal"])

export function validateApplicationUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error("Application URL must be a valid absolute URL")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS application URLs are supported")
  }
  if (url.username || url.password) throw new Error("Credentials must not be embedded in target URLs")
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (BLOCKED_HOSTS.has(hostname) || hostname.endsWith(".local")) {
    throw new Error("Local and metadata hosts are not supported")
  }
  const ipKind = isIP(hostname)
  if (ipKind && isPrivateIp(hostname)) {
    throw new Error("Private network targets are not supported")
  }
  url.hash = ""
  return url.toString()
}

function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) {
    return ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80:")
  }
  const parts = ip.split(".").map(Number)
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  )
}

export function validateRepositoryUrl(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error("Repository URL must be a valid GitHub URL")
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") {
    throw new Error("Only public HTTPS GitHub repositories are supported")
  }
  if (url.username || url.password) throw new Error("Credentials must not be embedded in repository URLs")
  const segments = url.pathname.replace(/\.git$/, "").split("/").filter(Boolean)
  if (segments.length !== 2 || !segments.every((part) => /^[\w.-]+$/.test(part))) {
    throw new Error("Repository URL must identify a GitHub owner and repository")
  }
  return `https://github.com/${segments[0]}/${segments[1]}.git`
}

export function redactSecrets(value: string, maxLength = 4_000): string {
  return value
    .replace(/(?:sk|slr_live)_[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/(authorization:\s*(?:bearer|basic)\s+)[^\s]+/gi, "$1[REDACTED]")
    .slice(0, maxLength)
}
