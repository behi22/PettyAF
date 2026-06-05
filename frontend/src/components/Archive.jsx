import React, { useState } from 'react'
import { api } from '../api.js'
import { Panel, Stamp, Waveform } from './Widgets.jsx'
import { PERSONAS, caseNumber, money, daysDelinquent, transcriptLines } from '../util.js'

export default function Archive({ cases, onChanged, notify }) {
  const [openId, setOpenId] = useState(null)
  const open = cases.find((c) => c.id === openId)

  const act = async (id, status) => {
    try {
      await api.patchCase(id, { status })
      onChanged()
    } catch (e) {
      notify(e.message)
    }
  }

  return (
    <div className="archive">
      <Panel title="CASE ARCHIVE" right={<span className="muted">{cases.length} files. The file never closes.</span>}>
        <table className="case-table">
          <thead>
            <tr>
              <th>CASE #</th>
              <th>DEBTOR</th>
              <th>AMOUNT</th>
              <th>DAYS</th>
              <th>COLLECTOR</th>
              <th>STATUS</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => (
              <tr key={c.id} className={openId === c.id ? 'row-open' : ''}>
                <td className="td-red mono">{caseNumber(c.id)}</td>
                <td>{c.debtorName}</td>
                <td className="td-red">{money(c.amount)}</td>
                <td>{daysDelinquent(c.sinceDate)}</td>
                <td className="td-muted">{PERSONAS[c.personaKey]?.shortName || c.personaKey}</td>
                <td>
                  <Stamp status={c.status} />
                </td>
                <td>
                  <button className="link-btn" onClick={() => setOpenId(openId === c.id ? null : c.id)}>
                    {openId === c.id ? 'CLOSE FILE' : 'OPEN FILE'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {open && (
        <Panel className="casefile" title={`CASE FILE ${caseNumber(open.id)}`} right={<Stamp status={open.status} />}>
          <div className="casefile-grid">
            <div>
              <dl className="kv">
                <dt>DEBTOR</dt>
                <dd>{open.debtorName}</dd>
                <dt>AMOUNT</dt>
                <dd className="kv-red">{money(open.amount)}</dd>
                <dt>REASON</dt>
                <dd>{open.reason}</dd>
                <dt>CREDITOR</dt>
                <dd>{open.creditorName}</dd>
                <dt>COLLECTOR</dt>
                <dd>{PERSONAS[open.personaKey]?.name}</dd>
                <dt>KNOWN WEAKNESS</dt>
                <dd>{open.knownWeaknesses || 'None on file.'}</dd>
              </dl>

              {open.lastCall?.qualAnswers && (
                <div className="qual">
                  <span className="panel-title">EXTRACTED CONFESSION DATA</span>
                  <ul>
                    <li>
                      Admitted the debt: <b>{String(open.lastCall.qualAnswers.admittedDebt ?? 'unknown')}</b>
                    </li>
                    <li>
                      Excuse given: <b>{open.lastCall.qualAnswers.excuseGiven || 'none'}</b>
                    </li>
                    <li>
                      Payment commitment: <b>{open.lastCall.qualAnswers.paymentCommitment || 'none'}</b>
                    </li>
                  </ul>
                </div>
              )}

              <div className="file-actions">
                {!['SETTLED'].includes(open.status) && (
                  <button className="btn-green" onClick={() => act(open.id, 'SETTLED')}>
                    MARK SETTLED
                  </button>
                )}
                {!['WRITTEN_OFF'].includes(open.status) && (
                  <button className="btn-ghost" onClick={() => act(open.id, 'WRITTEN_OFF')}>
                    WRITE OFF
                  </button>
                )}
                {['SETTLED', 'WRITTEN_OFF', 'PROMISED'].includes(open.status) && (
                  <button className="btn-ghost" onClick={() => act(open.id, 'OPEN')}>
                    REOPEN
                  </button>
                )}
              </div>
              <p className="micro muted">
                {open.status === 'SETTLED'
                  ? 'Justice, served. Friendship, intact. Probably.'
                  : open.status === 'WRITTEN_OFF'
                    ? 'Debt forgiven. The file remains. The file always remains.'
                    : 'Closing a case is admitting defeat. Or getting paid.'}
              </p>
            </div>

            <div>
              <span className="panel-title">CALL SUMMARY</span>
              <p className="summary">{open.lastCall?.summary || 'No completed calls yet. The debtor sleeps peacefully. For now.'}</p>

              <span className="panel-title">TRANSCRIPT</span>
              <div className="transcript transcript-small">
                {transcriptLines(open.lastCall?.transcript).map((l, i) => (
                  <div className="tline" key={i}>
                    <span className="t-who">{l.who ? `${l.who}:` : ''}</span>
                    <span className="t-text">{l.text}</span>
                  </div>
                ))}
                {!open.lastCall && <p className="muted">Empty. Like their promises.</p>}
              </div>

              <span className="panel-title">EXHIBIT A</span>
              {open.lastCall?.recordingUrl ? (
                <audio controls src={open.lastCall.recordingUrl} className="audio" />
              ) : (
                <div className="exhibit">
                  <Waveform bars={28} />
                  <span className="micro muted">Recording pending backend wiring.</span>
                </div>
              )}
            </div>
          </div>
        </Panel>
      )}
    </div>
  )
}
