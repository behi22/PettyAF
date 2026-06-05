// API layer. Mock mode (default) runs the in-browser simulated backend so the UI is fully
// testable with zero servers. Set VITE_USE_MOCK=false to hit the real Express backend on :4000
// (routes per docs/06-backend-implementation-plan.md section 8).
import * as mock from './mockEngine.js'

export const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'

async function http(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `${method} ${path} failed (${res.status})`)
  return data
}

const real = {
  getCases: () => http('GET', '/api/cases'),
  getCase: (id) => http('GET', `/api/cases/${id}`),
  createCase: (body) => http('POST', '/api/cases', body),
  patchCase: (id, body) => http('PATCH', `/api/cases/${id}`, body),
  deploy: (id) => http('POST', `/api/cases/${id}/deploy`),
  setRelentless: (id, enabled) => http('POST', `/api/cases/${id}/relentless`, { enabled }),
  getLive: () => http('GET', '/api/live'),
  getLiveCall: (callId) => http('GET', `/api/live/${callId}`),
  emergencyStop: () => http('POST', '/api/live/stop'),
  getDashboard: () => http('GET', '/api/dashboard'),
  // not available on the real backend: no platform hangup API, stop is one-way until restart
  resetStop: async () => ({ stopped: true }),
  endCall: async () => ({ ok: false }),
}

export const api = USE_MOCK ? mock.api : real
