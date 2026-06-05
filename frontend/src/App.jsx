import React, { useCallback, useEffect, useRef, useState } from 'react'
import { api, USE_MOCK } from './api.js'
import TopNav from './components/TopNav.jsx'
import Dashboard from './components/Dashboard.jsx'
import NewCase from './components/NewCase.jsx'
import LiveCalls from './components/LiveCalls.jsx'
import Archive from './components/Archive.jsx'

export default function App() {
  const [tab, setTab] = useState('dashboard')
  const [cases, setCases] = useState([])
  const [live, setLive] = useState({ calls: [], liveNow: 0, stopped: false, queued: [] })
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  const notify = useCallback((msg, kind = 'error') => {
    setToast({ msg, kind })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4200)
  }, [])

  const refreshCases = useCallback(async () => {
    try {
      setCases(await api.getCases())
    } catch (e) {
      notify(e.message)
    }
  }, [notify])

  useEffect(() => {
    refreshCases()
  }, [refreshCases])

  // live poll, 2s cadence per plan 06 section 8.3
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const snap = await api.getLive()
        // normalize so real-backend shape gaps can never crash consumers
        if (alive)
          setLive({
            calls: snap.calls || [],
            liveNow: snap.liveNow ?? 0,
            stopped: !!snap.stopped,
            queued: snap.queued || [],
          })
      } catch {
        /* backend down; keep last snapshot */
      }
    }
    tick()
    const h = setInterval(tick, 2000)
    return () => {
      alive = false
      clearInterval(h)
    }
  }, [])

  // refresh case list whenever a live call finishes (statuses change server-side)
  const doneCount = live.calls.filter((c) => c.phase === 'done').length
  useEffect(() => {
    refreshCases()
  }, [doneCount, refreshCases])

  const deployCase = useCallback(
    async (id) => {
      try {
        await api.deploy(id)
        await refreshCases()
        setTab('live')
      } catch (e) {
        notify(e.message)
      }
    },
    [notify, refreshCases],
  )

  const screens = {
    dashboard: (
      <Dashboard cases={cases} onDeploy={deployCase} onNewCase={() => setTab('newcase')} onOpenArchive={() => setTab('archive')} />
    ),
    newcase: (
      <NewCase
        onCreated={async (c, deployNow) => {
          await refreshCases()
          if (deployNow) await deployCase(c.id)
          else setTab('dashboard')
        }}
        notify={notify}
      />
    ),
    live: <LiveCalls live={live} cases={cases} onChanged={refreshCases} notify={notify} />,
    archive: <Archive cases={cases} onChanged={refreshCases} notify={notify} />,
  }

  return (
    <div className="app">
      <TopNav tab={tab} onTab={setTab} liveNow={live.liveNow} stopped={live.stopped} mock={USE_MOCK} />
      {live.stopped && (
        <div className="stop-strip">
          EMERGENCY STOP ENGAGED. All new dialing halted. Mercy has been granted.
          {USE_MOCK && (
            <button
              className="link-btn"
              onClick={async () => {
                try {
                  await api.resetStop()
                  setLive((s) => ({ ...s, stopped: false }))
                } catch (e) {
                  notify(e.message)
                }
              }}
            >
              RESUME OPERATIONS (mock only)
            </button>
          )}
        </div>
      )}
      <main className="screen">{screens[tab]}</main>
      {toast && <div className={`toast toast-${toast.kind}`}>{toast.msg}</div>}
    </div>
  )
}
