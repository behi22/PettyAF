export function money(n, currency = 'CAD') {
  const v = Number(n || 0)
  return `$${v.toFixed(2)}`
}

export function caseNumber(id) {
  if (!id) return 'PAF-2026-0000'
  const tail = String(id).replace(/-/g, '').slice(-4).toUpperCase()
  return `PAF-2026-${tail}`
}

export function daysDelinquent(sinceDate) {
  if (!sinceDate) return 0
  const ms = Date.now() - new Date(sinceDate).getTime()
  return Math.max(0, Math.floor(ms / 86400000))
}

export function delinquencyCaption(days) {
  if (days >= 90) return 'A quarter. A fiscal QUARTER.'
  if (days >= 30) return 'A month. This is who they are now.'
  if (days >= 14) return 'Two weeks. Bold.'
  if (days >= 7) return 'A full week.'
  if (days >= 1) return 'The clock is ticking.'
  return 'Fresh case. Hope remains.'
}

export function clockFromSeconds(total) {
  const s = Math.max(0, Math.floor(total))
  const h = String(Math.floor(s / 3600)).padStart(2, '0')
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${h}:${m}:${ss}`
}

export const PERSONAS = {
  child: {
    key: 'child',
    name: 'Kaevon Venmo Vulture',
    shortName: 'KAEVON',
    vibe: 'Six years old. A PROFESSIONAL.',
    sample: 'My notebook says you owe seven dollars. My notebook NEVER lies.',
  },
  medieval: {
    key: 'medieval',
    name: 'Rob, "Don\'t Make Me Rob You"',
    shortName: 'ROB',
    vibe: 'Impossibly kind. Impossible to understand.',
    sample: 'A debt most small there standeth between thee and thy companion.',
  },
  angry: {
    key: 'angry',
    name: 'Justin Time to Collect',
    shortName: 'JUSTIN',
    vibe: 'Personally offended by your debt.',
    sample: 'SEVEN DOLLARS. I have LOST SLEEP over this, pal.',
  },
}

export const AGGRESSION_SAMPLES = {
  child: [
    'Um. Hi. You maybe owe my friend money? No rush. Sorry.',
    "Hi! It's about the money. Whenever you're ready. I have stickers.",
    "My notebook says you owe seven dollars. Notebooks don't lie.",
    "It's been SO long. Like four recesses.",
    "Pay up please! I'm a professional!",
    'but you proooomised. You PROMISED.',
    'Pbbbbt! That excuse again?',
    "I'm telling your mom. I have her number. Probably.",
    "GASP! You're going on THE LIST.",
    "GIVE ME THE MONEY OR I'M TELLING YOUR MOM. Pbbbbt!",
  ],
  medieval: [
    'Prithee, when convenient, mayhap remember the coin.',
    'Good morrow! A trifling debt awaiteth thy attention.',
    'Seven pieces of silver standeth between thee and honour.',
    'Alack, the purse remaineth closed. Wherefore?',
    'By my troth, the debt groweth ancient.',
    'Fie! The season of thawing hath passed, yet no coin rideth forth.',
    'Zounds! Thy excuses are as chaff before the wind.',
    "Od's bodkins! Honour DEMANDETH settlement anon!",
    'Hark! The ballads shall sing of thy delinquency!',
    'THOU OWEST. Let coin ride forth THIS VERY NIGHT or be dubbed Knave of Debts FOREVERMORE.',
  ],
  angry: [
    "Look, pay whenever. I'm not even mad. I'm fine.",
    'Quick reminder about the seven bucks. No biggie. Yet.',
    "It's been months, pal. Months.",
    'You remembered the tacos. You just forgot accountability.',
    'SEVEN DOLLARS. I have LOST SLEEP over this.',
    "HA! That's funny. You're a funny person. PAY UP.",
    "'Soon' is not a day, pal. MONDAY is a day.",
    "I'm writing it in PEN this time.",
    'I went to COLLEGE for this. SEVEN. DOLLARS.',
    'I am BEGGING you to test me. Pay. NOW.',
  ],
}

export const STAMP_LABELS = {
  OPEN: 'OPEN',
  DEPLOYED: 'COLLECTOR DEPLOYED',
  VOICEMAIL: 'SENT TO VOICEMAIL',
  GHOSTED: 'GHOSTED US',
  PROMISED: 'PROMISED FRIDAY',
  DISPUTED: 'DISPUTED',
  SETTLED: 'SETTLED',
  WRITTEN_OFF: 'WRITTEN OFF',
}

export function sentimentCaption(pct) {
  if (pct >= 60) return 'Cracking. Almost there.'
  if (pct >= 30) return 'Evasive.'
  return 'Hostile. But listening.'
}

export function transcriptLines(transcript) {
  if (!transcript) return []
  if (Array.isArray(transcript)) return transcript
  return String(transcript)
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^([A-Za-z .']+):\s*(.*)$/)
      if (m) return { who: m[1].trim().toUpperCase(), text: m[2] }
      return { who: '', text: line }
    })
}
