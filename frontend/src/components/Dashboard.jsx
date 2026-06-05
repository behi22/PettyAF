import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Panel, Stamp } from './Widgets.jsx'
import { PERSONAS, caseNumber, money, daysDelinquent, delinquencyCaption } from '../util.js'

export default function Dashboard({ cases, onDeploy, onNewCase, onOpenArchive }) {
  const [dash, setDash] = useState(null)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const d = await api.getDashboard()
        if (alive) setDash(d)
      } catch {
        /* keep last */
      }
    }
    tick()
    const h = setInterval(tick, 5000)
    return () => {
      alive = false
      clearInterval(h)
    }
  }, [])

  // one-shot refresh when the case list mutates, without resetting the 5s cadence
  useEffect(() => {
    let alive = true
    api
      .getDashboard()
      .then((d) => alive && setDash(d))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [cases])

  const k = dash?.kpis

  return (
    <div className="dashboard">
      <div className="kpi-grid">
        <Kpi label="TOTAL OUTSTANDING" value={k ? money(k.totalOutstanding) : '...'} sub="Receivables under active recovery." />
        <Kpi label="COLLECTED FROM VICTIMS" value={k ? money(k.totalCollected) : '...'} sub="Actual money. Actually recovered." green />
        <Kpi label="PROMISED" value={k ? money(k.totalPromised) : '...'} sub="Commitment, not cash. We know the difference." />
        <Kpi label="CALLS MADE" value={k ? k.callsMade : '...'} sub={k ? `${k.talkMinutes} minutes of justice` : ''} />
        <Kpi label="FRIENDSHIPS AT RISK" value={k ? k.friendshipsAtRisk : '...'} sub="Acceptable losses." />
        <Kpi
          label="LEDGER OF SHAME"
          value={k ? money(k.ledgerOfShame) : '...'}
          sub="Our analysts are standing by. They are very petty."
          red
        />
      </div>

      <Panel
        title="ACTIVE CASES"
        right={
          <span className="panel-actions">
            <button className="link-btn" onClick={onOpenArchive}>
              VIEW ARCHIVE
            </button>
            <button className="btn-red btn-small" onClick={onNewCase}>
              OPEN NEW CASE
            </button>
          </span>
        }
      >
        {cases.length === 0 ? (
          <p className="muted empty-line">No outstanding debts. Either you have great friends or terrible memory.</p>
        ) : (
          <table className="case-table">
            <thead>
              <tr>
                <th>CASE #</th>
                <th>DEBTOR</th>
                <th>AMOUNT</th>
                <th>REASON</th>
                <th>DAYS DELINQUENT</th>
                <th>COLLECTOR</th>
                <th>STATUS</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => {
                const days = daysDelinquent(c.sinceDate)
                const deployable = !['SETTLED', 'WRITTEN_OFF', 'DEPLOYED'].includes(c.status)
                return (
                  <tr key={c.id}>
                    <td className="td-red mono">{caseNumber(c.id)}</td>
                    <td>{c.debtorName}</td>
                    <td className="td-red">{money(c.amount)}</td>
                    <td className="td-muted">{c.reason}</td>
                    <td>
                      <span className="days">{days}</span>
                      <span className="micro muted"> {delinquencyCaption(days)}</span>
                    </td>
                    <td className="td-muted">{PERSONAS[c.personaKey]?.name || c.personaKey}</td>
                    <td>
                      <Stamp status={c.status} />
                    </td>
                    <td>
                      {deployable && (
                        <button className="btn-red btn-small" onClick={() => onDeploy(c.id)}>
                          DEPLOY
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Panel>

      {dash && (
        <div className="dash-lower">
          <Panel title="COLLECTOR PERFORMANCE">
            <table className="case-table">
              <thead>
                <tr>
                  <th>COLLECTOR</th>
                  <th>CASES</th>
                  <th>PROMISED</th>
                  <th>COLLECTED</th>
                </tr>
              </thead>
              <tbody>
                {dash.byPersona.map((p) => (
                  <tr key={p.personaKey}>
                    <td>{PERSONAS[p.personaKey]?.name || p.personaKey}</td>
                    <td>{p.cases}</td>
                    <td>{p.promised}</td>
                    <td className="td-red">{money(p.collected)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <Panel title="RECENT CALLS">
            {dash.recentCalls.length === 0 ? (
              <p className="muted">Nothing yet. The day is young and the debts are old.</p>
            ) : (
              <ul className="recent">
                {dash.recentCalls.map((r) => (
                  <li key={r.callId}>
                    <span className="mono td-red">{money(r.amount)}</span> {r.debtorName}
                    <span className="muted"> via {PERSONAS[r.personaKey]?.shortName || r.personaKey}, {r.durationSec}s</span>
                    <Stamp status={r.status} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </div>
  )
}

function Kpi({ label, value, sub, red, green }) {
  return (
    <div className={`kpi ${red ? 'kpi-red' : ''} ${green ? 'kpi-green' : ''}`}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  )
}
