// Simulated PettyAF backend. Mirrors the contracts in docs/06-backend-implementation-plan.md
// (sections 7 and 8) so swapping to the real Express backend is a one-flag change in api.js.
// Honest-semantics notes are marked HONESTY: they mirror real platform limits on purpose.

function uid() {
  return 'xxxx-xxxx-xxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)) + '-' + Date.now().toString(16).slice(-4)
}

function clone(v) {
  return JSON.parse(JSON.stringify(v))
}

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)

// ---------------------------------------------------------------- scripts

const SCRIPTS = {
  child: {
    lines: [
      { who: 'ai', text: "Hiiii! Is this {debtor}? It IS? I found you! I'm so good at this!" },
      { who: 'debtor', text: 'Uh. Who is this?' },
      { who: 'ai', text: "It's KAEVON. The Venmo Vulture. From PettyAF. I'm a PROFESSIONAL. You have my {amount}!" },
      { who: 'debtor', text: '...the money for {reason}? Seriously?' },
      { who: 'ai', text: '{reason}. Like seven recesses ago. My notebook says so and my notebook NEVER lies.' },
      { who: 'debtor', text: 'Venmo is down right now.' },
      { who: 'ai', text: 'Pbbbbt! My mom says Venmo is never down. Are you mad at me?' },
      { who: 'debtor', text: "What? No, I'm not mad." },
      { who: 'ai', text: "Then say I'm a good collector. Say it. And then pay." },
      { who: 'debtor', text: "Fine. You're a good collector. I'll pay Friday." },
      { who: 'ai', text: "PINKY PROMISE? You can't break a pinky promise, that's the LAW." },
      { who: 'debtor', text: 'Pinky promise, Timmy.' },
      { who: 'ai', text: 'Okay! Writing it with my special pen! Best call EVER. Bye bye!' },
    ],
    excuse: 'VENMO IS DOWN',
    commitment: 'Friday',
    summary:
      '{debtor} admitted the debt and pinky-promised to pay {amount} on Friday. Excuse logged: Venmo is down. Pinky integrity: legally binding.',
    sentiment: [45, 40, 35, 30, 28, 22, 25, 35, 40, 55, 65, 74, 80],
  },
  medieval: {
    lines: [
      { who: 'ai', text: 'Hark and good morrow, gentle soul! Pray, do mine ears deceive, or do I address the gentle {debtor}, of whom the ballads speak?' },
      { who: 'debtor', text: '...what?' },
      { who: 'ai', text: "'Tis Sir Reginald of the House of PettyAF! A debt most small there standeth between thee and thy companion. Seven pieces of silver... which is to say, {amount} of thy modern coin." },
      { who: 'debtor', text: 'Is this about {reason}? Who talks like this?' },
      { who: 'ai', text: 'Verily! Rendered unto thee in the season of thawing. Wilt thou avow the debt standeth true?' },
      { who: 'debtor', text: 'I genuinely cannot understand you.' },
      { who: 'ai', text: 'A thousand pardons, nay, two thousand! I shall speak plainer: prithee, let coin ride forth anon, by yon money-sending scrying glass, that friendship be restored to its former glory.' },
      { who: 'debtor', text: '...are you asking me to Venmo him?' },
      { who: 'ai', text: 'GRAMERCY! Thou hast it! May thy harvest be bountiful and thy speaking-stone never lose its charge!' },
      { who: 'debtor', text: "Fine, fine, I'll send it tonight if you stop blessing me." },
      { who: 'ai', text: 'Then I dub thee Payer of Debts, Restorer of Friendships! Fare thee well, and may thy debts henceforth be ever paid!' },
    ],
    excuse: 'COULD NOT UNDERSTAND THE COLLECTOR',
    commitment: 'tonight',
    summary:
      '{debtor} surrendered out of confusion and committed to paying {amount} tonight. Sir Reginald blessed their phone twice. Honour: restored.',
    sentiment: [50, 38, 33, 30, 28, 20, 24, 40, 52, 68, 78],
  },
  angry: {
    lines: [
      { who: 'ai', text: "Yeah, am I talkin' to {debtor}? Don't make me ask twice, I had a day." },
      { who: 'debtor', text: 'Speaking. Who is this?' },
      { who: 'ai', text: 'Tony. PettyAF collections. {amount}. {reason}. Ring any bells? It BETTER ring bells.' },
      { who: 'debtor', text: 'How did you get this number?' },
      { who: 'ai', text: 'The file, pal. I got the file RIGHT HERE. Where is the money?' },
      { who: 'debtor', text: 'I forgot my wallet that day, I was going to...' },
      { who: 'ai', text: "HA! That's funny. You're a funny person. You remembered the goods. You just forgot accountability." },
      { who: 'debtor', text: 'This is ridiculous.' },
      { who: 'ai', text: 'Ridiculous is owing {amount} since MARCH. I have LOST SLEEP over this.' },
      { who: 'debtor', text: "Okay, okay. Monday. I'll send it Monday." },
      { who: 'ai', text: "Look. I'm calm now. I'm very calm. MONDAY. I'm writing it in PEN." },
      { who: 'debtor', text: 'Monday. I promise.' },
      { who: 'ai', text: "See? Was that so hard? You're my favorite person today. Don't make me come back." },
    ],
    excuse: 'I FORGOT MY WALLET',
    commitment: 'Monday',
    summary:
      '{debtor} folded under sustained disbelief and committed to {amount} by Monday. Tony wrote it in pen. He went to college for this.',
    sentiment: [50, 42, 35, 30, 26, 20, 16, 12, 18, 45, 60, 72, 82],
  },
}

function fill(text, c) {
  return text
    .replaceAll('{debtor}', c.debtorName.split(' ')[0])
    .replaceAll('{amount}', `$${Number(c.amount).toFixed(2)}`)
    .replaceAll('{reason}', c.reason)
}

// ---------------------------------------------------------------- state

const state = {
  cases: [],
  live: new Map(), // callId -> live call object
  timers: new Map(), // callId -> [timer handles]
  redials: new Map(), // caseId -> timer handle
  stopped: false,
  ledger: { callsMade: 9, talkSeconds: 14 * 60 + 22 },
  recentCalls: [],
}

function seedCase(over) {
  return {
    id: uid(),
    debtorName: '',
    debtorPhone: '+16045550100',
    amount: 0,
    currency: 'CAD',
    reason: '',
    sinceDate: daysAgo(30),
    creditorName: 'Behbod',
    personaKey: 'child',
    aggressionLevel: 7,
    knownWeaknesses: '',
    settlementOptions: ['full payment'],
    consentConfirmed: true,
    status: 'OPEN',
    relentless: { enabled: false, callCount: 0, active: false },
    excuses: [],
    lastCall: null,
    ...over,
  }
}

state.cases = [
  seedCase({
    debtorName: 'Alex Moreno',
    amount: 7.0,
    reason: 'Three al pastor tacos',
    sinceDate: daysAgo(93),
    personaKey: 'child',
    knownWeaknesses: 'Guilty of having taste. Probably soft.',
    settlementOptions: ['full payment', 'public apology in the group chat'],
  }),
  seedCase({
    debtorName: 'Chris Park',
    amount: 12.5,
    reason: 'Fantasy league dues',
    sinceDate: daysAgo(41),
    personaKey: 'angry',
    status: 'GHOSTED',
    relentless: { enabled: true, callCount: 2, active: false },
    excuses: ['LITERAL CRICKETS', 'LITERAL CRICKETS'],
    knownWeaknesses: 'Reads every text. Replies to none.',
  }),
  seedCase({
    debtorName: 'Sam Patel',
    amount: 3.75,
    reason: 'Coffee run, never settled',
    sinceDate: daysAgo(12),
    personaKey: 'medieval',
    status: 'PROMISED',
    excuses: ['COULD NOT UNDERSTAND THE COLLECTOR'],
    lastCall: {
      callId: 'call_seed_sam',
      endedReason: 'customer-ended-call',
      durationSec: 96,
      transcript: SCRIPTS.medieval.lines.map((l) => ({ who: l.who === 'ai' ? 'ROB' : 'SAM', text: l.text.replaceAll('{debtor}', 'Sam').replaceAll('{amount}', '$3.75').replaceAll('{reason}', 'the coffee') })),
      summary: 'Sam surrendered out of confusion and committed to paying $3.75 tonight. Honour: restored.',
      sentiment: 'positive',
      outcome: 'qualified',
      recordingUrl: null,
      qualAnswers: { admittedDebt: true, excuseGiven: 'could not understand the collector', paymentCommitment: 'tonight' },
    },
  }),
  seedCase({
    debtorName: 'Dana Whitfield',
    amount: 20.0,
    reason: "Concert ticket, 'I'll get you back'",
    sinceDate: daysAgo(67),
    personaKey: 'angry',
    status: 'DISPUTED',
    excuses: ['WHAT CONCERT?', 'I THOUGHT YOU PAID'],
    lastCall: {
      callId: 'call_seed_dana',
      endedReason: 'customer-ended-call',
      durationSec: 58,
      transcript: [
        { who: 'JUSTIN', text: 'Twenty dollars, Dana. The concert. September.' },
        { who: 'DANA', text: 'What concert? I thought YOU paid.' },
        { who: 'JUSTIN', text: 'Unbelievable. UNBELIEVABLE. We have the receipts, Donna.' },
        { who: 'DANA', text: "It's Dana. And I'm hanging up." },
      ],
      summary: 'Dana denied the debt twice and hung up. Tony remains personally offended. Case escalation recommended.',
      sentiment: 'negative',
      outcome: 'not_qualified',
      recordingUrl: null,
      qualAnswers: { admittedDebt: false, excuseGiven: 'claims the creditor paid', paymentCommitment: null },
    },
  }),
  seedCase({
    debtorName: 'Jordan Lee',
    amount: 5.0,
    reason: 'Gas money',
    sinceDate: daysAgo(120),
    personaKey: 'child',
    status: 'SETTLED',
    excuses: ['I FORGOT MY WALLET'],
  }),
]

// ---------------------------------------------------------------- engine internals

function getCase(id) {
  const c = state.cases.find((x) => x.id === id)
  if (!c) throw new Error('Case not found')
  return c
}

function addTimer(callId, handle) {
  if (!state.timers.has(callId)) state.timers.set(callId, [])
  state.timers.get(callId).push(handle)
}

function clearCallTimers(callId) {
  for (const h of state.timers.get(callId) || []) clearTimeout(h)
  state.timers.delete(callId)
}

function finishCall(callId, c, result) {
  const lc = state.live.get(callId)
  if (!lc) return
  lc.phase = 'done'
  lc.endedAt = Date.now()
  c.status = result.status
  c.lastCall = {
    callId,
    endedReason: result.endedReason,
    durationSec: Math.round((lc.endedAt - lc.startedAtMs) / 1000),
    transcript: lc.transcript,
    summary: result.summary,
    sentiment: result.sentiment,
    outcome: result.outcome,
    recordingUrl: null,
    qualAnswers: result.qualAnswers,
  }
  if (result.excuse) c.excuses.push(result.excuse)
  state.ledger.callsMade += 1
  state.ledger.talkSeconds += c.lastCall.durationSec
  state.recentCalls.unshift({
    callId,
    caseId: c.id,
    debtorName: c.debtorName,
    personaKey: c.personaKey,
    amount: c.amount,
    status: c.status,
    durationSec: c.lastCall.durationSec,
    endedAt: new Date(lc.endedAt).toISOString(),
  })
  state.recentCalls = state.recentCalls.slice(0, 12)
  clearCallTimers(callId)
  // leave the finished call visible for a few seconds, then drop from the registry
  const cleanup = setTimeout(() => state.live.delete(callId), 6000)
  addTimer(`${callId}_cleanup`, cleanup)

  // relentless: schedule the next dial unless stopped or resolved
  const resolved = ['PROMISED', 'SETTLED', 'WRITTEN_OFF'].includes(c.status)
  if (c.relentless.enabled && !resolved && !state.stopped) {
    c.relentless.active = true
    const h = setTimeout(() => {
      state.redials.delete(c.id)
      if (!state.stopped && c.relentless.enabled) {
        try {
          doDeploy(c)
        } catch {
          c.relentless.active = false
        }
      }
    }, 5000)
    state.redials.set(c.id, h)
  } else {
    c.relentless.active = false
  }
}

function runGhostCall(callId, c) {
  const lc = state.live.get(callId)
  const t1 = setTimeout(() => {
    if (!state.live.has(callId)) return
    lc.phase = 'dialing'
  }, 500)
  const t2 = setTimeout(() => {
    if (!state.live.has(callId)) return
    lc.transcript.push({ who: 'SYSTEM', text: 'Ringing... and ringing. The debtor knows. They always know.' })
  }, 3000)
  const t3 = setTimeout(() => {
    if (!state.live.has(callId)) return
    finishCall(callId, c, {
      status: 'GHOSTED',
      endedReason: 'customer-did-not-answer',
      summary: `${c.debtorName.split(' ')[0]} did not pick up. Call #${c.relentless.callCount}. The silence has been added to the file.`,
      sentiment: 'negative',
      outcome: 'no_answer',
      excuse: 'LITERAL CRICKETS',
      qualAnswers: { admittedDebt: null, excuseGiven: 'did not answer', paymentCommitment: null },
    })
  }, 8000)
  ;[t1, t2, t3].forEach((h) => addTimer(callId, h))
}

function runScriptedCall(callId, c) {
  const script = SCRIPTS[c.personaKey] || SCRIPTS.angry
  const persona = c.personaKey === 'child' ? 'KAEVON' : c.personaKey === 'medieval' ? 'ROB' : 'JUSTIN'
  const debtorShort = c.debtorName.split(' ')[0].toUpperCase()
  const lc = state.live.get(callId)

  const startTalking = setTimeout(() => {
    if (!state.live.has(callId)) return
    lc.phase = 'talking'
  }, 3000)
  addTimer(callId, startTalking)

  script.lines.forEach((line, i) => {
    const h = setTimeout(() => {
      if (!state.live.has(callId)) return
      lc.transcript.push({ who: line.who === 'ai' ? persona : debtorShort, text: fill(line.text, c) })
      lc.sentimentPct = script.sentiment[Math.min(i, script.sentiment.length - 1)]
    }, 3200 + i * 2300)
    addTimer(callId, h)
  })

  const analyzeAt = 3200 + script.lines.length * 2300 + 800
  const hAnalyze = setTimeout(() => {
    if (!state.live.has(callId)) return
    lc.phase = 'analyzing'
  }, analyzeAt)
  addTimer(callId, hAnalyze)

  const hDone = setTimeout(() => {
    if (!state.live.has(callId)) return
    finishCall(callId, c, {
      status: 'PROMISED',
      endedReason: 'customer-ended-call',
      summary: fill(script.summary, c),
      sentiment: 'positive',
      outcome: 'qualified',
      excuse: script.excuse,
      qualAnswers: { admittedDebt: true, excuseGiven: script.excuse.toLowerCase(), paymentCommitment: script.commitment },
    })
  }, analyzeAt + 3500)
  addTimer(callId, hDone)
}

function doDeploy(c) {
  if (state.stopped) throw new Error('EMERGENCY STOP ACTIVE. Mercy has been granted. No new calls.')
  if (!c.consentConfirmed) throw new Error('Consent gate: the debtor must be in on the joke before we dial.')
  if (['SETTLED', 'WRITTEN_OFF'].includes(c.status)) throw new Error('This case is closed. Reopen it first.')
  const alreadyLive = [...state.live.values()].some((l) => l.caseId === c.id && ['dialing', 'talking', 'analyzing'].includes(l.phase))
  if (alreadyLive) throw new Error('A collector is already on this case.')

  const callId = `call_${uid()}`
  c.status = 'DEPLOYED'
  c.relentless.callCount += 1

  state.live.set(callId, {
    callId,
    caseId: c.id,
    caseNumber: null, // FE derives from caseId
    debtorName: c.debtorName,
    personaKey: c.personaKey,
    amount: c.amount,
    currency: c.currency,
    phase: 'dialing',
    startedAtMs: Date.now(),
    startedAt: new Date().toISOString(),
    callCount: c.relentless.callCount,
    sentimentPct: 50,
    transcript: [],
  })

  // relentless warm-up calls get ghosted; the breakthrough call runs the full script
  if (c.relentless.enabled && c.relentless.callCount < 3) {
    runGhostCall(callId, c)
  } else {
    runScriptedCall(callId, c)
  }
  return { callId }
}

// ---------------------------------------------------------------- public api

export const api = {
  async getCases() {
    return clone(state.cases)
  },

  async getCase(id) {
    return clone(getCase(id))
  },

  async getCaseCalls(id) {
    const c = getCase(id)
    if (!c.lastCall) return []
    return clone([
      {
        callNumber: c.relentless?.callCount || 1,
        callId: c.lastCall.callId,
        recordingUrl: c.lastCall.recordingUrl || null,
        transcript: c.lastCall.transcript || null,
        summary: c.lastCall.summary || null,
        durationSec: c.lastCall.durationSec ?? null,
        endedReason: c.lastCall.endedReason || null,
        endedAt: null,
      },
    ])
  },

  async createCase(body) {
    const c = seedCase({
      ...body,
      amount: Number(body.amount || 0),
      status: 'OPEN',
      excuses: [],
      lastCall: null,
      relentless: { enabled: !!body.relentless, callCount: 0, active: false },
    })
    state.cases.unshift(c)
    return clone(c)
  },

  async patchCase(id, body) {
    const c = getCase(id)
    if (body.status) {
      c.status = body.status
      if (body.status === 'OPEN') {
        // reopen clears relentless counters (plan 06 section 13)
        c.relentless.callCount = 0
        c.relentless.active = false
      }
      if (['SETTLED', 'WRITTEN_OFF'].includes(body.status)) {
        c.relentless.enabled = false
        const h = state.redials.get(c.id)
        if (h) clearTimeout(h)
        state.redials.delete(c.id)
      }
    }
    return clone(c)
  },

  async deploy(id) {
    const c = getCase(id)
    return doDeploy(c)
  },

  async setRelentless(id, enabled) {
    const c = getCase(id)
    c.relentless.enabled = !!enabled
    if (!enabled) {
      c.relentless.active = false
      const h = state.redials.get(c.id)
      if (h) clearTimeout(h)
      state.redials.delete(c.id)
    }
    return clone(c)
  },

  async getLive() {
    const calls = [...state.live.values()].map((l) => {
      const { startedAtMs, ...rest } = l
      return { ...rest, durationSec: Math.round((Date.now() - startedAtMs) / 1000) }
    })
    const queued = state.cases
      .filter((c) => state.redials.has(c.id))
      .map((c) => ({ caseId: c.id, debtorName: c.debtorName, state: 'RELENTLESS QUEUE' }))
    return clone({
      calls,
      liveNow: calls.filter((c) => ['dialing', 'talking', 'analyzing'].includes(c.phase)).length,
      stopped: state.stopped,
      queued,
    })
  },

  async getLiveCall(callId) {
    const l = state.live.get(callId)
    if (!l) return null
    const { startedAtMs, ...rest } = l
    return clone({ ...rest, durationSec: Math.round((Date.now() - startedAtMs) / 1000) })
  },

  async emergencyStop() {
    // HONESTY: mirrors plan 06 section 11. Stops all new dialing instantly;
    // a call already on the line winds down on its own (no platform hangup API).
    state.stopped = true
    for (const [, h] of state.redials) clearTimeout(h)
    state.redials.clear()
    for (const c of state.cases) {
      c.relentless.active = false
    }
    return { stopped: true }
  },

  async resetStop() {
    state.stopped = false
    return { stopped: false }
  },

  async endCall(callId) {
    // Mock-only convenience. The real platform has NO hangup API; the persona wraps up on its own.
    const l = state.live.get(callId)
    if (!l) return { ok: false }
    const c = getCase(l.caseId)
    clearCallTimers(callId)
    l.phase = 'analyzing'
    const h = setTimeout(() => {
      finishCall(callId, c, {
        status: 'VOICEMAIL',
        endedReason: 'assistant-ended-call',
        summary: `${c.debtorName.split(' ')[0]}'s call was wrapped early by the operator. The collector left with dignity. Mostly.`,
        sentiment: 'neutral',
        outcome: 'incomplete',
        excuse: null,
        qualAnswers: { admittedDebt: null, excuseGiven: null, paymentCommitment: null },
      })
    }, 2000)
    addTimer(callId, h)
    return { ok: true }
  },

  async getDashboard() {
    const cs = state.cases
    const open = cs.filter((c) => !['SETTLED', 'WRITTEN_OFF'].includes(c.status))
    const sum = (arr) => arr.reduce((a, c) => a + Number(c.amount || 0), 0)
    const completed = cs.filter((c) => c.lastCall || ['SETTLED'].includes(c.status))
    const wins = cs.filter((c) => ['PROMISED', 'SETTLED'].includes(c.status))
    const byPersona = ['child', 'medieval', 'angry'].map((p) => {
      const pc = cs.filter((c) => c.personaKey === p)
      return {
        personaKey: p,
        cases: pc.length,
        promised: pc.filter((c) => c.status === 'PROMISED').length,
        collected: sum(pc.filter((c) => c.status === 'SETTLED')),
      }
    })
    return clone({
      kpis: {
        totalOutstanding: sum(open),
        totalCollected: sum(cs.filter((c) => c.status === 'SETTLED')),
        totalPromised: sum(cs.filter((c) => c.status === 'PROMISED')),
        callsMade: state.ledger.callsMade,
        talkMinutes: Math.round(state.ledger.talkSeconds / 60),
        activeCases: open.length,
        friendshipsAtRisk: cs.filter((c) => ['DEPLOYED', 'DISPUTED'].includes(c.status)).length,
        ledgerOfShame: sum(cs),
        liveNow: [...state.live.values()].filter((l) => ['dialing', 'talking', 'analyzing'].includes(l.phase)).length,
        successRate: completed.length ? wins.length / completed.length : 0,
      },
      byPersona,
      recentCalls: state.recentCalls,
    })
  },
}
