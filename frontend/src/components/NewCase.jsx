import React, { useState } from 'react'
import { api } from '../api.js'
import { Panel } from './Widgets.jsx'
import { PERSONAS, AGGRESSION_SAMPLES, money } from '../util.js'

const STEPS = ['THE DEBT', 'THE DEBTOR', 'THE COLLECTOR']

const REASON_CHIPS = ['split bill never settled', 'gas money', "they said they'd get the next one", 'fantasy league dues']

const SETTLEMENTS = ['full payment', 'payment plan', 'a coffee', 'dishes for a week', 'public apology in the group chat']

export default function NewCase({ onCreated, notify }) {
  const [step, setStep] = useState(0)
  const [created, setCreated] = useState(null)
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState({
    amount: '',
    reason: '',
    sinceDate: new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10),
    settlementOptions: ['full payment'],
    debtorName: '',
    debtorPhone: '+1',
    knownWeaknesses: '',
    creditorName: 'Behbod',
    personaKey: 'child',
    aggressionLevel: 7,
    consentConfirmed: false,
  })

  const set = (k, v) => setF((p) => ({ ...p, [k]: v }))

  const stepValid = [
    Number(f.amount) > 0 && f.reason.trim().length > 0,
    f.debtorName.trim().length > 0 && /^\+\d{7,15}$/.test(f.debtorPhone),
    !!f.personaKey && f.consentConfirmed,
  ][step]

  const submit = async (deployNow) => {
    setBusy(true)
    try {
      const c = await api.createCase({ ...f, amount: Number(f.amount) })
      setCreated(c)
      await onCreated(c, deployNow)
    } catch (e) {
      notify(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (created) return null

  return (
    <div className="newcase">
      <div className="wizard-head">
        {STEPS.map((s, i) => (
          <div key={s} className={`wstep ${i === step ? 'wstep-active' : ''} ${i < step ? 'wstep-done' : ''}`}>
            <span className="wstep-num">{String(i + 1).padStart(2, '0')}</span> {s}
          </div>
        ))}
      </div>

      {step === 0 && (
        <Panel title="STEP 01: THE DEBT">
          <div className="form-grid">
            <label className="field">
              <span className="field-label">AMOUNT OWED</span>
              <input type="number" min="0" step="0.25" value={f.amount} onChange={(e) => set('amount', e.target.value)} placeholder="7.00" />
              <span className="micro muted">Yes, even $1.25.</span>
            </label>
            <label className="field">
              <span className="field-label">DATE INCURRED</span>
              <input type="date" value={f.sinceDate} onChange={(e) => set('sinceDate', e.target.value)} />
            </label>
            <label className="field field-wide">
              <span className="field-label">WHAT WAS IT FOR</span>
              <input value={f.reason} onChange={(e) => set('reason', e.target.value)} placeholder="Three al pastor tacos" />
              <span className="chips">
                {REASON_CHIPS.map((r) => (
                  <button type="button" key={r} className="chip chip-click" onClick={() => set('reason', r)}>
                    {r}
                  </button>
                ))}
              </span>
            </label>
            <div className="field field-wide">
              <span className="field-label">SETTLEMENT AUTHORITY (what the collector may accept)</span>
              <div className="checks">
                {SETTLEMENTS.map((s) => (
                  <label key={s} className="check">
                    <input
                      type="checkbox"
                      checked={f.settlementOptions.includes(s)}
                      onChange={(e) =>
                        set('settlementOptions', e.target.checked ? [...f.settlementOptions, s] : f.settlementOptions.filter((x) => x !== s))
                      }
                    />
                    {s}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </Panel>
      )}

      {step === 1 && (
        <Panel title="STEP 02: THE DEBTOR">
          <div className="form-grid">
            <label className="field">
              <span className="field-label">FULL NAME</span>
              <input value={f.debtorName} onChange={(e) => set('debtorName', e.target.value)} placeholder="Alex Moreno" />
            </label>
            <label className="field">
              <span className="field-label">PHONE (E.164)</span>
              <input value={f.debtorPhone} onChange={(e) => set('debtorPhone', e.target.value.replace(/[^+\d]/g, ''))} placeholder="+16045551234" />
              <span className="micro muted">Real number. Real call. Choose wisely.</span>
            </label>
            <label className="field field-wide">
              <span className="field-label">KNOWN WEAKNESSES</span>
              <input
                value={f.knownWeaknesses}
                onChange={(e) => set('knownWeaknesses', e.target.value)}
                placeholder="Cannot handle awkward silence. Fears their mom finding out."
              />
              <span className="micro muted">The collector will use this. That is the point.</span>
            </label>
          </div>
        </Panel>
      )}

      {step === 2 && (
        <Panel title="STEP 03: THE COLLECTOR">
          <div className="persona-grid">
            {Object.values(PERSONAS).map((p) => (
              <button
                type="button"
                key={p.key}
                className={`persona-card ${f.personaKey === p.key ? 'persona-active' : ''}`}
                onClick={() => set('personaKey', p.key)}
              >
                <span className="persona-avatar">{p.shortName[0]}</span>
                <span className="persona-name">{p.name}</span>
                <span className="persona-vibe muted">{p.vibe}</span>
                <span className="persona-sample">"{p.sample}"</span>
              </button>
            ))}
          </div>

          <div className="slider-block">
            <div className="meter-row">
              <span className="meter-label">AGGRESSION LEVEL</span>
              <span className="meter-value">{f.aggressionLevel}/10</span>
            </div>
            <input
              type="range"
              min="1"
              max="10"
              value={f.aggressionLevel}
              onChange={(e) => set('aggressionLevel', Number(e.target.value))}
              className="slider"
            />
            <p className="sample-line">"{(AGGRESSION_SAMPLES[f.personaKey] || [])[f.aggressionLevel - 1] || '...'}"</p>
          </div>

          <label className="check consent">
            <input type="checkbox" checked={f.consentConfirmed} onChange={(e) => set('consentConfirmed', e.target.checked)} />
            The debtor is in on the joke and consents to this call. We are petty, not illegal.
          </label>
        </Panel>
      )}

      <div className="wizard-foot">
        {step > 0 && (
          <button className="btn-ghost" onClick={() => setStep(step - 1)}>
            BACK
          </button>
        )}
        {step < 2 && (
          <button className="btn-red" disabled={!stepValid} onClick={() => setStep(step + 1)}>
            CONTINUE
          </button>
        )}
        {step === 2 && (
          <>
            <button className="btn-ghost" disabled={!stepValid || busy} onClick={() => submit(false)}>
              FILE THE CASE
            </button>
            <button className="btn-red" disabled={!stepValid || busy} onClick={() => submit(true)}>
              FILE AND DEPLOY {f.amount ? `(${money(f.amount)})` : ''}
            </button>
          </>
        )}
      </div>
      <p className="micro muted center">Reviewed by our legal team. We do not have a legal team.</p>
    </div>
  )
}
