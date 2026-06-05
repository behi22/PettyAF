# Webhooks & Call Lifecycle

> Verified against `webhook/alebex-voice-endofcall.controller.ts`,
> `services/alebex-voice-endofcall.service.ts`, and
> `dto/alebex-voice-endofcall-webhook.dto.ts`.

The engine pushes the call result back to **your** server when a call ends. This is
how you get the transcript, recording, and outcome. (You can also poll
`GET /call/status/{id}` — see `02-api-reference.md` §3.)

---

## 1. End-of-call webhook

### Endpoint (yours, that the engine calls)

BexAi exposes:

```
POST /webhooks/alebex-voice/end-of-call
```

(Full path in prod is prefixed with the API base, e.g.
`https://api.alebex.ai/api/v1/webhooks/alebex-voice/end-of-call`. Configure the engine
to point at your equivalent via `VOICE_ENGINE_WEBHOOK_URL`.)

### Payload shape

The engine sends a `message` envelope. BexAi also tolerates a flattened form (used by
test scripts):

```jsonc
{
  "message": {
    "call": {
      "id": "call_abc123",            // engine call id
      "endedReason": "customer-ended-call",
      "duration": 142,                // seconds
      "cost": 0.15,                   // call cost
      "metadata": {                   // ← YOUR metadata from POST /call/phone, echoed back
        "debtId": "debt_42",
        "organizationId": "…",
        "leadId": "…",
        "skipEndOfCallReport": false
      }
    },
    "customer": {
      "number": "+15551234567"        // the human who was called
    },
    "phoneNumber": {
      "id": "pn_xxx",
      "number": "+15553334444"        // your FROM number
    },
    "transcript": "AI: Hi Dave...\nDave: Ugh fine, I'll pay you Friday.",
    "recordingUrl": "https://…/recording.mp3",
    "analysis": {
      "summary": "Dave admitted the $20 debt and promised to pay Friday.",
      "structuredData": { /* optional extracted fields */ },
      "successEvaluation": "…"
    },
    "metadata": {
      "recordingUrl": "https://…/recording.mp3"   // recordingUrl sometimes lives here too
    }
  }
}
```

### Fields BexAi actually reads

| Path | Used for |
|---|---|
| `message.call.id` | external call id / correlation |
| `message.call.endedReason` | branch the whole post-call flow (see §3) |
| `message.call.duration` | call length |
| `message.call.cost` | billing |
| `message.call.metadata` | **your** echoed metadata (`demoSessionId`, `leadId`, `organizationId`, …) |
| `message.customer.number` | match the debtor |
| `message.phoneNumber.number` | match the org's FROM number |
| `message.transcript` | the full transcript (analyzed downstream) |
| `message.recordingUrl` *or* `message.metadata.recordingUrl` | the recording (check both) |
| `message.analysis.summary` | AI summary |

> The DTO is intentionally permissive (`[key: string]: any`) — *"we'll accept whatever
> AlebexVoice sends."* Don't over-validate the inbound webhook; read defensively.

### Required response behaviour

**Return `200 OK` immediately, then process asynchronously.** The controller acks
right away and runs analysis in the background so the engine doesn't time out and retry:

```ts
@Post('end-of-call')
@HttpCode(HttpStatus.OK)
async handleEndOfCall(@Body() payload: any): Promise<{ success: boolean }> {
  const messageData = payload.message || payload;        // tolerate both shapes
  // fire-and-forget; do NOT await the heavy work
  this.service.processEndOfCall(messageData).catch(err => this.logger.error(err));
  return { success: true };                              // always 200, even on error
}
```

Even when processing throws, BexAi **still returns `{ success: true }`** to prevent
retry storms. Mirror this.

---

## 2. `endedReason` — the call-outcome lifecycle

`message.call.endedReason` (and `call.status` from the status endpoint) drives
everything. Confirmed values handled in production:

| `endedReason` | Meaning | Suggested handling |
|---|---|---|
| `customer-ended-call` | Human hung up | Full processing (analyze transcript) |
| `assistant-ended-call` | AI ended it | Full processing |
| `voicemail` | Hit voicemail; left message | Voicemail-only flow (no transcript analysis) |
| `customer-did-not-answer` | No answer | No-answer flow → maybe retry later |
| `customer-busy` | Line busy | No-answer/busy flow → retry |
| `call-canceled` | Cancelled before connect | No-answer/busy flow |
| `technical-error` | Engine/telephony error | Error flow → retry or alert |
| `silence-timed-out` | Dead air timeout | (referenced in routing prompt) treat as voicemail/no-outcome |

Production switch:

```ts
switch (payload.call?.endedReason) {
  case 'voicemail':                  return handleVoicemailOnly(...);
  case 'customer-did-not-answer':
  case 'customer-busy':
  case 'call-canceled':              return handleNoAnswerOrBusy(...);
  case 'technical-error':            return handleTechnicalError(...);
  case 'customer-ended-call':
  case 'assistant-ended-call':       break;                  // → full analysis
  default:                           /* full processing fallback */
}
```

`call.status` values seen via the status endpoint include `queued`, `ringing`,
`in-progress`, and `ended` (the engine returns `status` + the same `endedReason` once
finished).

---

## 3. Webhook security

BexAi has `VOICE_ENGINE_WEBHOOK_SECRET` reserved in env, but the **end-of-call
controller does not currently verify a signature** — it accepts the payload openly and
relies on matching echoed `metadata` to known records. (By contrast, the **Twilio**
voice/SMS webhooks *do* verify `x-twilio-signature`.)

For the hackathon:

- **Minimum:** use a hard-to-guess webhook path or a shared-secret query param/header
  and validate it.
- **Better:** if the engine supports HMAC signing with `VOICE_ENGINE_WEBHOOK_SECRET`,
  verify it. Confirm header name in the gated docs (`x-alebex-signature` is a likely
  candidate, but **not confirmed in code** — verify before relying on it).
- Always validate that the echoed `metadata.debtId` maps to a real, pending debt before
  acting.

---

## 4. Inbound call flow (optional)

If a human dials your number:

```
Human dials your # ──► Twilio ──► POST your /webhook/twilio/voice
                                        │
        your backend ──► POST https://voice.alebex.ai/call/phone/inbound
                                        │  { callSid, fromPhone, toPhone, assistantOverrides, metadata }
                                        ▼
                              engine returns { twiml }
                                        │
       return that TwiML to Twilio ◄────┘   (connects caller to the AI)
```

Then the same **end-of-call webhook** fires when that inbound call ends. See
`02-api-reference.md` §2. **Not required** for the core Petty Debt Collector outbound
experience.

---

## 5. Polling alternative (simplest for a hackathon)

If standing up a public webhook is friction during the hackathon, you can skip it and
**poll**:

```
POST /call/phone           → { id }
loop every few seconds:
  GET /call/status/{id}     → { status, endedReason, transcript, summary, recordingUrl }
  until status indicates the call ended
```

The demo flow does exactly this (10 s timeout per poll) and emits results over a
WebSocket to the UI. This avoids needing a publicly reachable webhook URL. Trade-off:
slightly more latency and you must run the poll loop.
