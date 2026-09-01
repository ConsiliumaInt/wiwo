import assert from "node:assert/strict"
import test from "node:test"
import { redactSecrets, validateApplicationUrl, validateRepositoryUrl } from "../lib/security"

test("accepts public application URLs", () => {
  assert.equal(validateApplicationUrl("https://example.com/signup#form"), "https://example.com/signup")
})

test("rejects dangerous target schemes and private hosts", () => {
  assert.throws(() => validateApplicationUrl("file:///etc/passwd"))
  assert.throws(() => validateApplicationUrl("http://127.0.0.1:3000"))
  assert.throws(() => validateApplicationUrl("http://192.168.1.20"))
  assert.throws(() => validateApplicationUrl("http://service.local"))
  assert.throws(() => validateApplicationUrl("http://[::1]"))
  assert.throws(() => validateApplicationUrl("https://user:password@example.com"))
})

test("normalises only public GitHub repository URLs", () => {
  assert.equal(validateRepositoryUrl("https://github.com/acme/shop"), "https://github.com/acme/shop.git")
  assert.equal(validateRepositoryUrl(""), undefined)
  assert.throws(() => validateRepositoryUrl("https://gitlab.com/acme/shop"))
  assert.throws(() => validateRepositoryUrl("https://github.com/acme/shop/issues"))
  assert.throws(() => validateRepositoryUrl("https://token@github.com/acme/shop"))
})

test("redacts server credentials from captured output", () => {
  assert.equal(redactSecrets("key=slr_live_supersecret"), "key=[REDACTED]")
  assert.equal(redactSecrets("Authorization: Bearer token-value"), "Authorization: Bearer [REDACTED]")
})
