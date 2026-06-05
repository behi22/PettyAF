import React from 'react'

const TABS = [
  ['dashboard', 'Dashboard'],
  ['newcase', 'New Case'],
  ['live', 'Live Calls'],
  ['archive', 'Archive'],
]

export default function TopNav({ tab, onTab, liveNow, stopped, mock }) {
  return (
    <header className="topnav">
      <div className="brand" onClick={() => onTab('dashboard')}>
        <span className="brand-word">
          Petty<span className="brand-af">AF</span>
        </span>
        <span className="brand-tag">
          THE PETTIEST
          <br />
          COLLECTIONS AGENCY
        </span>
      </div>

      <nav className="tabs">
        {TABS.map(([key, label]) => (
          <button key={key} className={`tab ${tab === key ? 'tab-active' : ''}`} onClick={() => onTab(key)}>
            {label}
            {key === 'live' && liveNow > 0 && <span className="tab-dot" />}
          </button>
        ))}
      </nav>

      <div className="nav-right">
        {mock && <span className="chip chip-amber">MOCK MODE</span>}
        <span className="chip">
          Operator: <b>Behbod</b>
        </span>
        <span className="chip">
          Status: <b className="chip-red-text">{stopped ? 'Merciful' : 'Overreacting'}</b>
        </span>
        <button className="btn-red" onClick={() => onTab('newcase')}>
          OPEN NEW CASE
        </button>
      </div>
    </header>
  )
}
