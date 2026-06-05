import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { Panel, BlockMeter, Waveform } from './Widgets.jsx'
import EmergencyStop from './EmergencyStop.jsx'
import { PERSONAS, caseNumber, money, clockFromSeconds, sentimentCaption, transcriptLines } from '../util.js'

const PHASE_LABEL = {
  dialing: 'DIALING',
  talking: 'ON THE CALL',
  analyzing: 'ANALYZING THE CONFESSION',
  done: 'CALL COMPLETE',
  failed: 'CALL FAILED',
}

const ENABLED_TOOLS = ['Relentless Dialer', 'Shame Broadcasting', 'Voicemail Torment', 'Receipts of Doom']

export default function LiveCalls({ live, cases, onChanged, notify }) {
  const focused = live.calls.find((c) => ['dialing', 'talking', 'analyzing'].includes(c.phase)) || live.calls[0] || null
  const focusedCase = focused ? cases.find((c) => c.id === focused.caseId) : null
  const [autoScroll, setAutoScroll] = useState(true)
  const [calls, setCalls] = useState([])
  const [sel, setSel] = useState(0)
  const scrollRef = useRef(null)
  // real backend names the live field partialTranscript (plan 06 section 7.3); mock uses transcript
  const lines = focused ? transcriptLines(focused.partialTranscript ?? focused.transcript) : []
  const sentimentPct = focused ? (focused.sentimentPct ?? 0) : 0
  const selectedCall = calls[sel] || null

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [focused?.callId, lines.length, autoScroll])

  // load this case's recordings; refetch when the call completes so the recording appears
  useEffect(() => {
    let alive = true
    setCalls([])
    setSel(0)
    const id = focusedCase?.id
    if (!id) return
    api
      .getCaseCalls(id)
      .then((cs) => {
        if (!alive) return
        const list = cs || []
        setCalls(list)
        setSel(Math.max(0, list.length - 1))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [focusedCase?.id, focused?.phase])

  const persona = focused ? PERSONAS[focused.personaKey] : null
  const relentlessOn = !!focusedCase?.relentless?.enabled
  const unhinged = focusedCase ? Math.round((focusedCase.aggressionLevel / 10) * 100) : 0

  const stamp = (t) => new Date(t).toTimeString().slice(0, 8)

  return (
    <div className="livecalls">
      {/* info bar */}
      <div className="infobar">
        <InfoCell label="COLLECTOR" value={persona ? persona.name : 'Standing by'} icon="person" />
        <InfoCell label="DEBTOR" value={focused ? focused.debtorName : 'Nobody. Yet.'} icon="person" />
        <InfoCell label="AMOUNT OWED" value={focused ? money(focused.amount) : '$0.00'} icon="dollar" accent />
        <InfoCell label="CALL TIMER" value={focused ? clockFromSeconds(focused.durationSec) : '00:00:00'} icon="clock" />
        <div className="infocell rec-cell">
          <span className={`rec-dot ${focused && focused.phase !== 'done' ? 'rec-live' : ''}`} />
          <span className="rec-text">REC {focused && focused.phase !== 'done' ? 'LIVE' : 'IDLE'}</span>
        </div>
        <InfoCell
          label="PHASE"
          value={focused ? (focused.windingDown ? 'WINDING DOWN' : PHASE_LABEL[focused.phase]) : 'AWAITING ORDERS'}
          accent
        />
      </div>

      {/* relentless banner */}
      {relentlessOn && !live.stopped && (
        <div className="relentless-banner">
          <span className="banner-icon">((•))</span>
          <span>
            RELENTLESS MODE ACTIVE. Call #{focused ? focused.callCount : focusedCase?.relentless?.callCount || 0}.
          </span>
          <span className="banner-icon">((•))</span>
        </div>
      )}
      {live.stopped && (
        <div className="relentless-banner banner-stopped">
          <span>EMERGENCY STOP ENGAGED. CURRENT CALL WINDING DOWN. NO NEW DIALS.</span>
        </div>
      )}

      {/* main grid */}
      <div className="live-grid">
        {/* left column */}
        <div className="live-col">
          <Panel title="CASE DETAILS">
            {focusedCase ? (
              <dl className="kv">
                <dt>CASE NUMBER</dt>
                <dd className="kv-red">{caseNumber(focusedCase.id)}</dd>
                <dt>REASON</dt>
                <dd>{focusedCase.reason}</dd>
                <dt>KNOWN WEAKNESS</dt>
                <dd>{focusedCase.knownWeaknesses || 'None on file. Suspicious.'}</dd>
              </dl>
            ) : (
              <p className="muted">No case on the line. Deploy a collector from the Dashboard.</p>
            )}
          </Panel>

          <Panel title="ENABLED TOOLS">
            <ul className="tools">
              {ENABLED_TOOLS.map((t) => (
                <li key={t}>
                  <span className="tool-name">{t}</span>
                  <span className="tool-dot" />
                </li>
              ))}
            </ul>
          </Panel>

          <Panel>
            <div className="meter-row">
              <span className="meter-label">UNHINGED LEVEL</span>
              <span className="meter-value">{unhinged}%</span>
            </div>
            <BlockMeter value={unhinged} max={100} />
            <div className="meter-row meter-row-gap">
              <span className="meter-label">RELENTLESS CALLING</span>
              <span className="meter-value">{focusedCase?.relentless?.callCount || 0}/10</span>
            </div>
            <BlockMeter value={Math.min(focusedCase?.relentless?.callCount || 0, 10)} max={10} />
          </Panel>

          {focusedCase && (
            <Panel title="RELENTLESS MODE">
              <label className="switch-row">
                <input
                  type="checkbox"
                  checked={relentlessOn}
                  onChange={async (e) => {
                    try {
                      await api.setRelentless(focusedCase.id, e.target.checked)
                      onChanged()
                    } catch (err) {
                      notify(err.message)
                    }
                  }}
                />
                <span>{relentlessOn ? 'ON. You monster.' : 'Off. How merciful.'}</span>
              </label>
              <p className="micro muted">Calls again 5 seconds after every unresolved call. Forever. No cap.</p>
            </Panel>
          )}
        </div>

        {/* center column */}
        <Panel
          className="transcript-panel"
          title="TRANSCRIPT"
          right={
            <button className="link-btn" onClick={() => setAutoScroll(!autoScroll)}>
              AUTO-SCROLL: {autoScroll ? 'ON' : 'OFF'} <span className={`mini-dot ${autoScroll ? 'mini-dot-on' : ''}`} />
            </button>
          }
        >
          <div className="transcript" ref={scrollRef}>
            {lines.length === 0 && (
              <p className="muted transcript-empty">
                {focused ? 'The call is live. The transcript posts here after the call ends.' : 'No active call. The phones rest. The debts do not.'}
              </p>
            )}
            {lines.map((l, i) => (
              <div className="tline" key={i}>
                <span className="t-time">{focused ? stamp(new Date(focused.startedAt).getTime() + i * 2300) : ''}</span>
                <span className="t-who">{l.who ? `${l.who}:` : ''}</span>
                <span className="t-text">{l.text}</span>
              </div>
            ))}
          </div>
          <div className="transcript-foot">
            <span className="muted">Transcript posts when the call ends.</span>
          </div>
        </Panel>

        {/* right column */}
        <div className="live-col">
          <Panel title="LIVE CALLS" right={<span className="count-red">{live.liveNow}</span>}>
            <ul className="calllist">
              {live.calls.map((c) => (
                <li key={c.callId}>
                  <span className="cl-time">{clockFromSeconds(c.durationSec)}</span>
                  <span className={`cl-name ${c.callId === focused?.callId ? 'cl-focused' : ''}`}>
                    {c.debtorName} ({c.phase === 'talking' ? 'ON CALL' : c.phase.toUpperCase()})
                  </span>
                </li>
              ))}
              {live.queued.map((q) => (
                <li key={q.caseId}>
                  <span className="cl-time">--:--</span>
                  <span className="cl-name muted">
                    {q.debtorName} ({q.state})
                  </span>
                </li>
              ))}
              {live.calls.length === 0 && live.queued.length === 0 && <li className="muted">Silence. For now.</li>}
            </ul>
          </Panel>

          <Panel title="EXCUSE TRACKER" right={<span className="count-red">{focusedCase?.excuses?.length || 0}</span>}>
            <div className="excuses">
              {(focusedCase?.excuses || []).length === 0 && <span className="muted">No excuses on file. Give it a minute.</span>}
              {tally(focusedCase?.excuses || []).map(([ex, n], i) => (
                <span className="stamp stamp-red excuse-stamp" key={ex} style={{ transform: `rotate(${[-3, 2, -1.5, 2.5][i % 4]}deg)` }}>
                  {ex}
                  {n > 1 ? ` x${n}` : ''}
                </span>
              ))}
            </div>
          </Panel>

          <Panel title="DEBTOR SENTIMENT">
            <div className="meter-row">
              <span className="meter-label">Cooperation Likelihood</span>
              <span className="meter-value meter-value-big">{sentimentPct}%</span>
            </div>
            <div className="gauge">
              <div className="gauge-track" />
              <div className="gauge-needle" style={{ left: `${sentimentPct}%` }} />
            </div>
            <div className="gauge-scale">
              <span>0%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
            <p className="micro">{focused ? sentimentCaption(sentimentPct) : 'Awaiting a victim.'}</p>
          </Panel>

          <Panel
            title={`EXHIBIT A: ${focusedCase ? focusedCase.debtorName.toUpperCase().slice(0, 18) : 'RECORDING'}`}
            right={
              calls.length > 1 ? (
                <select className="call-select" value={sel} onChange={(e) => setSel(Number(e.target.value))}>
                  {calls.map((c, i) => (
                    <option key={c.callId || i} value={i}>
                      Call {c.callNumber}
                      {c.durationSec ? ` - ${c.durationSec}s` : ''}
                    </option>
                  ))}
                </select>
              ) : null
            }
          >
            {selectedCall?.recordingUrl ? (
              <audio controls src={selectedCall.recordingUrl} className="audio" />
            ) : (
              <div className="exhibit">
                <Waveform />
                <span className="micro muted">
                  {calls.length ? 'Recording posts a few seconds after the call completes.' : 'No recordings yet for this case.'}
                </span>
              </div>
            )}
          </Panel>
        </div>
      </div>

      {/* bottom control: emergency stop only */}
      <div className="live-bottom">
        <EmergencyStop
          stopped={live.stopped}
          onStop={async () => {
            try {
              await api.emergencyStop()
              onChanged()
            } catch (e) {
              notify(e.message)
            }
          }}
        />
      </div>
    </div>
  )
}

function InfoCell({ label, value, accent }) {
  return (
    <div className="infocell">
      <span className="infocell-label">{label}</span>
      <span className={`infocell-value ${accent ? 'infocell-accent' : ''}`}>{value}</span>
    </div>
  )
}

function tally(arr) {
  const m = new Map()
  for (const x of arr) m.set(x, (m.get(x) || 0) + 1)
  return [...m.entries()]
}
