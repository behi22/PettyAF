# Petty Debt Collector — Implementation Guide

> How to build our hackathon app on top of the Alebex Voice Engine. Read
> `00`–`04` first for the raw API; this file is the application blueprint.

---

## 1. The product in one sentence

A creditor enters a (petty) debt — *who owes them, how much, and what for* — picks a
collector persona/voice, and our AI **calls the debtor** to humorously demand payment,
then returns a shareable recap of how it went.

---

## 2. Minimum viable flow

```
1. Creditor fills a form:
   - debtor name + phone (E.164)
   - amount + currency
   - what it's for ("pizza", "concert ticket", "lost bet")
   - creditor name
   - persona (Polite / Mob Boss / Passive-Aggressive / Karen / Shakespearean)
   - (optional) voice

2. Backend builds the call payload (persona → customPrompt, debt → knowledge_base)
   and POSTs /call/phone.  Stores { debtId, callId }.

3. Engine calls the debtor and runs the AI conversation.

4. Call ends → engine POSTs end-of-call webhook (or we poll /call/status/{id}).

5. Backend stores transcript + recording + summary, classifies the outcome,
   and shows the creditor a recap ("Dave promised to Venmo you Friday 😂").
```

Outbound-only. No inbound, no calendar, no CRM. That's the whole hackathon scope.

---

## 3. Domain → API mapping (cheat sheet)

| Our concept | Goes into | As |
|---|---|---|
| Debtor phone | `customer.number` | E.164 string |
| Debtor name | `customer.name` + `leadInfo.name` | string / object |
| FROM number | `phoneNumberId` | `alebexVoicePhoneNumberId` string |
| Persona | `customPrompt` (+ `assistantName`, `assistantRole`) | string |
| Debt facts | `knowledge_base` | string |
| Opening line | `firstMessage` / `dynamicFirstMessage` | string |
| Voicemail line | `voicemailMessage` | string |
| Funny-but-safe rules | `guardrails` | **native array** |
| Persona spice level | `llmTemperature` | string (e.g. `"0.85"`) |
| Record the call? | `recording` | string `"true"`/`"false"` |
| Our debt id | `metadata.debtId` | string (echoed back in webhook) |
| Outcome | from webhook `analysis.summary` + transcript | stored |

---

## 4. Building the call payload (reference implementation)

```ts
// POST https://voice.alebex.ai/call/phone
const callPayload = {
  type: 'outboundPhoneCall',
  phoneNumberId: String(fromNumber.alebexVoicePhoneNumberId),
  customer: {
    number: debt.debtorPhone,          // "+15551234567"
    name: debt.debtorName,             // "Dave"
  },
  assistantOverrides: {
    firstMessage: buildOpeningLine(debt, persona),
    variableValues: {
      // persona / identity (strings)
      assistantName: persona.agentName,            // "Vito"
      assistantRole: 'debt collector',
      orgName: 'Petty Debt Collectors',

      // the script + persona
      customPrompt: buildPersonaPrompt(debt, persona),

      // debt facts the AI can cite
      knowledge_base: [
        `Debtor: ${debt.debtorName}.`,
        `Amount owed: ${debt.amount} ${debt.currency}.`,
        `Reason: ${debt.reason}.`,
        `Owed to: ${debt.creditorName}.`,
        `Owed since: ${debt.since}.`,
      ].join(' '),

      // opening + voicemail
      dynamicFirstMessage: buildOpeningLine(debt, persona),
      voicemailMessage: `Hey ${debt.debtorName}, it's about the ${debt.amount} ${debt.currency} you owe ${debt.creditorName}. Call us back.`,

      // behaviour (NOTE: scalars as strings)
      llmTemperature: String(persona.temperature ?? 0.85),
      llmMaxTokens: '500',
      turnEndMode: 'middle',
      allowEndCall: 'true',
      recording: 'true',

      // safety — NATIVE array, do NOT stringify
      guardrails: [
        'Keep it playful and comedic, never genuinely threatening.',
        'No profanity, slurs, or real intimidation.',
        'Do not claim legal action or real consequences.',
        'If the person is distressed or asks to stop, de-escalate and end politely.',
      ],

      backendUrl: process.env.BACKEND_PUBLIC_URL,
    },
  },
  metadata: {
    debtId: debt.id,                   // echoed back in the webhook
    creditorUserId: debt.creditorId,
  },
};

const { data } = await axios.post(
  `${process.env.VOICE_ENGINE_URL}/call/phone`,
  callPayload,
  {
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': process.env.VOICE_ENGINE_API_KEY,
    },
    timeout: Number(process.env.VOICE_ENGINE_HTTP_TIMEOUT_MS || 60000),
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  },
);

await debts.update(debt.id, { callId: data.id, callStatus: data.status });
```

---

## 5. Persona prompt template (`customPrompt`)

The persona lives in `customPrompt`. Keep it tight; the engine has a base prompt in the
dashboard, so this is the *overlay*. Example:

```
You are {{assistantName}}, a {{assistantRole}} calling on behalf of {{orgName}}.
You are calling {{debtorName}} about a debt they owe.

THE DEBT (cite these facts naturally, do not read them like a list):
{{knowledge_base}}

YOUR PERSONALITY: <persona-specific block, e.g. for "Mob Boss">
  Speak like a charming but menacing mob boss. Use phrases like "capisce?",
  "it would be a real shame if...", and call them "my friend". Keep it COMEDIC —
  this is a fun bit between friends, never a real threat.

YOUR GOAL:
  1. Confirm you're speaking to {{debtorName}}.
  2. Bring up the debt with theatrical flair.
  3. Try to get them to (a) admit it and (b) commit to a day/way to pay.
  4. Keep it short and funny — aim for under 2 minutes.

RULES:
{{guardrails}}
  - If they deny the debt, act mock-offended but stay playful.
  - If they agree to pay, confirm the amount and when, then wrap up warmly.
  - Never actually threaten, harass, or upset the person. Read the room — if they
    sound genuinely upset, drop the act, apologize, and end the call kindly.
```

**Persona ideas** (swap the PERSONALITY block + temperature + voice):

| Persona | Vibe | temp | voice hint |
|---|---|---|---|
| Polite Professional | Overly courteous, relentlessly so | 0.6 | calm, warm |
| Mob Boss | Charming menace, all bit | 0.9 | deep, slow |
| Passive-Aggressive | "No worries if not… but actually" | 0.8 | sighing, flat |
| Karen | Demands the manager (there is none) | 0.9 | sharp, fast |
| Shakespearean | Iambic guilt-tripping | 1.0 | theatrical |

---

## 6. Handling the result

### Option A — webhook (recommended for a polished demo)
Implement `POST /webhooks/alebex-voice/end-of-call` exactly as in `04-webhooks.md`:
ack `200` immediately, process async, match on `message.call.metadata.debtId`.

```ts
async processEndOfCall(msg) {
  const debtId = msg.call?.metadata?.debtId;
  const outcome = classifyOutcome(msg.call?.endedReason, msg.transcript);
  await debts.update(debtId, {
    callStatus: 'ended',
    endedReason: msg.call?.endedReason,
    transcript: msg.transcript,
    recordingUrl: msg.recordingUrl ?? msg.metadata?.recordingUrl,
    summary: msg.analysis?.summary,
    durationSec: msg.call?.duration,
    outcome,
  });
  notifyCreditor(debtId, outcome);   // websocket / push / just refresh
}
```

### Option B — polling (simplest, no public URL needed)
```ts
// after POST /call/phone
let call;
do {
  await sleep(4000);
  call = (await axios.get(`${URL}/call/status/${callId}`,
          { headers: { 'X-API-Key': KEY }, timeout: 10000 })).data;
} while (!['ended', 'failed'].includes(call.status));
// then use call.transcript / call.summary / call.recordingUrl / call.endedReason
```

### Outcome classification (for the recap)
Map `endedReason` + a quick LLM read of the transcript into a fun result:

| Result | Trigger |
|---|---|
| 💰 Admitted & promised to pay | transcript shows agreement (`customer-ended-call`/`assistant-ended-call`) |
| 🙅 Denied the debt | transcript denial |
| 😂 Hung up on us | short call, `customer-ended-call` early |
| 📭 Left a voicemail | `endedReason: voicemail` |
| 📵 No answer / busy | `customer-did-not-answer` / `customer-busy` |
| ⚠️ Technical hiccup | `technical-error` |

---

## 7. Voice picker (optional polish)

Let creditors preview collector voices with `POST /api/voice-sample` (snake_case body,
30 s timeout — see `02-api-reference.md` §4). Cache the returned audio per `voice_id`.
Then pass the chosen voice via `voiceConfig` in the call payload (`03` §3).

---

## 8. ⚠️ Legal / ethical / safety guardrails (do not skip)

Real phone calls to real people from an AI raise real issues. Even as a joke app:

1. **Consent of the debtor.** Calling someone with an AI debt collector unsolicited can
   violate telemarketing/robocall laws (TCPA in the US, CASL in Canada) and is just
   mean. **Require the creditor to attest the debtor consents / is in on the joke**, or
   restrict to numbers verified via opt-in.
2. **Recording disclosure.** Use the engine's `recording` / `compliance` / `prerollMessage`
   variables to play a "this call may be recorded" disclosure where required (two-party
   consent states/provinces).
3. **No real harassment.** Bake the `guardrails` array into every call. The AI must
   de-escalate and end politely if the person is upset. This is wired into the persona
   prompt above too.
4. **Opt-out / do-not-call.** Honor "stop calling me" instantly; BexAi has whole
   opt-out detection services — at minimum, never auto-retry a number that asked to stop.
5. **Rate limits & abuse.** Don't let one user mass-call a number. Cap calls per
   debtor/day. (BexAi gates outbound on lead status for exactly this reason.)
6. **Keep API keys server-side.** Never expose `VOICE_ENGINE_API_KEY` to the client.

> The BexAi repo literally has a `legal-compliance-gates` feature and opt-out detection
> — treat compliance as a first-class feature, not an afterthought, even for a fun app.

---

## 9. Suggested data model

```
Debt {
  id
  creditorUserId
  debtorName
  debtorPhone        // E.164
  amount, currency
  reason             // "pizza"
  since              // date
  persona            // enum
  voiceId?           // chosen voice
  consentConfirmed   // bool — gate calling on this
  // call lifecycle
  callId?            // engine id from POST /call/phone
  callStatus?        // queued|ringing|in-progress|ended|failed
  endedReason?
  transcript?
  recordingUrl?
  summary?
  durationSec?
  outcome?           // classified result enum
}
```

---

## 10. Build order (hackathon-optimized)

1. **Env + auth** — set `VOICE_ENGINE_URL`, `VOICE_ENGINE_API_KEY`; confirm one
   registered FROM number and its `phoneNumberId`.
2. **Smoke test** — `curl` a single `POST /call/phone` to your own phone with a hardcoded
   payload. Confirm it rings and talks.
3. **Poll for result** — implement Option B polling; print transcript/summary. (Defer
   webhooks.)
4. **Persona engine** — build `buildPersonaPrompt()` + 3–5 personas.
5. **Form + DB** — creditor enters a debt, persists, triggers the call.
6. **Recap UI** — show outcome, transcript, play recording.
7. **Polish** — voice picker (`/api/voice-sample`), webhook instead of polling, the
   safety/consent gate.

Steps 1–3 prove the whole risky part (real telephony) in the first hour. Everything
after is UI and content.
