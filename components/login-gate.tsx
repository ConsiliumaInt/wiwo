"use client"

import { FormEvent, ReactNode, useEffect, useState } from "react"

const DEMO_USER = "TestUser123"
const DEMO_PASSWORD = "Password123*"

export function LoginGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAuthenticated(window.sessionStorage.getItem("wiwo-demo-auth") === "ok")
      setReady(true)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (username === DEMO_USER && password === DEMO_PASSWORD) {
      window.sessionStorage.setItem("wiwo-demo-auth", "ok")
      setAuthenticated(true)
      setError("")
      return
    }
    setError("That access code did not match the demo account.")
  }

  return (
    <div className={`loginStage ${ready && authenticated ? "isUnlocked" : "isLocked"}`}>
      <div className="lockedHome" aria-hidden={!authenticated}>{children}</div>
      {(!ready || !authenticated) && (
        <div className="loginCurtain">
          <div className="loginPanel">
            <div className="loginBrand"><span className="loginMark"><b>WI</b><b>WO</b></span><div><strong>WIWO</strong><small>VERIFICATION SYSTEM</small></div></div>
            <div className="loginEyebrow"><span /> PRIVATE DEMO / ACCESS REQUIRED</div>
            <h1>Will it<br /><em>ship?</em></h1>
            <p className="loginIntro">Autonomous QA that finds the break, traces the cause, and proves the fix.</p>
            <form className="loginForm" onSubmit={submit}>
              <label>USERNAME<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" placeholder="Enter username" required /></label>
              <label>PASSWORD<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" placeholder="Enter password" required /></label>
              {error && <p className="loginError" role="alert">{error}</p>}
              <button type="submit">ENTER WIWO <span>↗</span></button>
            </form>
            <p className="loginFoot">DEMO ENVIRONMENT <i>•</i> ACCESS IS SESSION-BOUND</p>
          </div>
        </div>
      )}
    </div>
  )
}
