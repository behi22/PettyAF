import React, { useRef, useState } from 'react'
import Logo from './Logo.jsx'

// Soft gate. Credentials are configurable via env; the password is compared as a SHA-256 hash
// so the plaintext never ships in the bundle. NOTE: any client-side gate is a curtain, not a
// vault (a determined visitor can bypass it in devtools). Good enough to keep randos out of a
// demo link; real auth would have to be backend-enforced.
const GATE_USER = (import.meta.env.VITE_GATE_USER || 'behbod.babai.aic@gmail.com').trim().toLowerCase()
const GATE_HASH = (import.meta.env.VITE_GATE_PASS_HASH ||
  'ecca90ea2d8e21f60f40492a52704f647cdec047cf495450619db9e639f062db').toLowerCase()

const DENIALS = [
  'ACCESS DENIED. Nice try, debtor.',
  'STILL WRONG. This is going in your file.',
  'WRONG AGAIN. We are calling your mom.',
  'INCORRECT. Sal is getting his coat.',
  'DENIED. The goose has been dispatched.',
]
const LOADERS = [
  'Verifying your debts...',
  'Waking up Sal...',
  'Cross-referencing the Wall of Shame...',
  'Sharpening the pencils...',
  'Consulting our legal team (we have none)...',
]
const FOOTERS = [
  'Three failed logins and we call your mom. We have her number.',
  'This terminal has collected from people much scarier than you.',
  'By clocking in you consent to caring deeply about seven dollars.',
  'Trespassers are added to the Wall of Shame and the group chat.',
  'Sal is watching. Sal is always watching. Sal is also the goose.',
  'Unauthorized access voids your dignity. Our warranty is fine.',
]

async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export default function Login({ onAuthed }) {
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaderLine, setLoaderLine] = useState('')
  const attempts = useRef(0)
  const cardRef = useRef(null)
  const [footer] = useState(() => FOOTERS[Math.floor(Math.random() * FOOTERS.length)])

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setErr('')
    setLoaderLine(LOADERS[attempts.current % LOADERS.length])
    await new Promise((r) => setTimeout(r, 850)) // dramatic pause
    let ok = false
    try {
      ok = user.trim().toLowerCase() === GATE_USER && (await sha256hex(pass)) === GATE_HASH
    } catch {
      ok = false
    }
    setBusy(false)
    setLoaderLine('')
    if (ok) {
      onAuthed()
      return
    }
    setErr(DENIALS[Math.min(attempts.current, DENIALS.length - 1)])
    attempts.current += 1
    const el = cardRef.current
    if (el) {
      el.classList.remove('shake')
      void el.offsetWidth // restart the animation
      el.classList.add('shake')
    }
  }

  return (
    <div className="login-screen">
      <div className="login-scan" aria-hidden="true" />
      <div className="login-bg" aria-hidden="true">
        {Array.from({ length: 14 }, (_, i) => (
          <span key={i} style={{ '--i': i }}>$</span>
        ))}
      </div>

      <form className="login-card" ref={cardRef} onSubmit={submit}>
        <div className="login-rec">
          <span className="rec-dot rec-live" /> REC
        </div>
        <div className="login-logo">
          <Logo size={66} />
        </div>
        <h1 className="login-title">
          Petty<span className="brand-af">AF</span>
        </h1>
        <p className="login-sub">RESTRICTED COLLECTIONS TERMINAL — AUTHORIZED PERSONNEL ONLY</p>

        <label className="login-field">
          <span>COLLECTOR ID</span>
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="you@pettyaf.inc"
            autoFocus
            autoComplete="username"
          />
        </label>
        <label className="login-field">
          <span>PASSCODE</span>
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder="the secret handshake"
            autoComplete="current-password"
          />
        </label>

        <button className="login-btn" type="submit" disabled={busy}>
          {busy ? loaderLine : 'CLOCK IN'}
        </button>

        {err && <p className="login-err">{err}</p>}
        <p className="login-foot">{footer}</p>
      </form>
    </div>
  )
}
