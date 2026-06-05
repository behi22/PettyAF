# API Reference — Alebex Voice Engine

> Every endpoint below is taken from live production `axios`/`fetch` calls in BexAi.
> Common to all: base URL `https://voice.alebex.ai`, header `X-API-Key: <key>`,
> and `Content-Type: application/json` for bodies.

Endpoints covered:

| # | Method | Path | Purpose |
|---|---|---|---|
| 1 | `POST` | `/call/phone` | Place an **outbound** AI call |
| 2 | `POST` | `/call/phone/inbound` | Get TwiML to answer an **inbound** call |
| 3 | `GET`  | `/call/status/{callId}` | Poll a call's status / final result |
| 4 | `POST` | `/api/voice-sample` | Generate a TTS voice preview clip |

---

## 1. `POST /call/phone` — place an outbound AI call

The primary endpoint. Tells the engine to dial a human and run the AI assistant.

### Request headers
```
X-API-Key: <VOICE_ENGINE_API_KEY>
Content-Type: application/json
```

### Request body (production shape)

```jsonc
{
  "type": "outboundPhoneCall",
  "phoneNumberId": "<alebexVoicePhoneNumberId>",   // the FROM number's engine ID (string)
  "customer": {
    "number": "+15551234567",                      // E.164 number to dial (the human)
    "name": "Dave"                                  // display name of the callee
  },
  "assistantOverrides": {
    "firstMessage": "Hi, is this Dave?",            // optional; omit to use dashboard default
    "variableValues": {
      /* large flat bag of strings + a few objects — see 03-call-payload-reference.md */
    }
  },
  "metadata": {
    "leadId": "…",                                  // YOUR ids, echoed back in the webhook
    "organizationId": "…",
    "payloadSource": "dynamic_json",
    "dynamicPayload": true
  }
}
```

#### Top-level fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `type` | string | yes | Always `"outboundPhoneCall"` for outbound. |
| `phoneNumberId` | string | yes | The engine's ID for the FROM number (`alebexVoicePhoneNumberId`). Stringified in code: `String(phoneNumber.alebexVoicePhoneNumberId \|\| '')`. |
| `assistantId` | string | optional | Reference a dashboard-defined assistant by ID. The **demo** flow sends this (`assistantId: agent.id`); the main flow omits it and drives everything via `assistantOverrides`. |
| `customer` | object | yes | Who to call. |
| `customer.number` | string | yes | E.164, e.g. `+15551234567`. Stringified in code. |
| `customer.name` | string | optional | Callee display name; falls back to `"Customer"`. |
| `assistantOverrides` | object | yes (in practice) | Per-call overrides of the assistant. |
| `assistantOverrides.firstMessage` | string | optional | The AI's opening line. **Omit entirely if empty** — an empty string still overrides the dashboard default. |
| `assistantOverrides.variableValues` | object | yes | The big config bag — see `03-call-payload-reference.md`. |
| `metadata` | object | optional | Arbitrary key/values **echoed back verbatim in the end-of-call webhook** (`message.call.metadata`). Use it to correlate the call to your own records. |

> **Critical pattern:** BexAi puts its own `leadId` / `organizationId` into `metadata`
> so the end-of-call webhook can be matched back to the right record. **Do the same**
> with your `debtId` / `userId`.

### Response (success)

The engine acks **immediately** (the call hasn't happened yet):

```jsonc
{
  "id": "call_abc123",        // the engine's call ID — store this
  "status": "queued"          // initial status, e.g. queued / ringing / in-progress
  // … other fields present but only id + status are consumed by BexAi
}
```

BexAi reads exactly:
```ts
const callData = response.data;
callData.id        // → store as the external call id
callData.status    // → initial status
```

### Response (error)
Non-2xx → Axios error. Body shape varies (string, `{message}`, `{error}`,
`{error:{message}}`). See `01-authentication-and-config.md` §5. A timeout
(`ECONNABORTED`) usually means the payload/prompt was too large.

### Minimal example (curl)

```bash
curl -X POST https://voice.alebex.ai/call/phone \
  -H "X-API-Key: $VOICE_ENGINE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "outboundPhoneCall",
    "phoneNumberId": "pn_xxx",
    "customer": { "number": "+15551234567", "name": "Dave" },
    "assistantOverrides": {
      "firstMessage": "Hi, is this Dave? It is about that twenty bucks.",
      "variableValues": {
        "assistantName": "Vito",
        "orgName": "Petty Debt Collectors",
        "customPrompt": "You are a friendly but persistent debt collector...",
        "llmTemperature": "0.8"
      }
    },
    "metadata": { "debtId": "debt_42" }
  }'
```

---

## 2. `POST /call/phone/inbound` — answer an inbound call (returns TwiML)

Used when a human dials **your** number. Your Twilio voice webhook fires first; your
backend then asks the engine for the TwiML that connects the caller to the AI.

### Request body

```jsonc
{
  "callSid": "CAxxxxxxxx",        // Twilio Call SID from the inbound webhook
  "fromPhone": "+15551112222",    // the human who called in
  "toPhone": "+15553334444",      // your number they dialed
  "assistantOverrides": {
    "variableValues": { /* same big bag as outbound; built for callType: 'inbound' */ }
  },
  "metadata": {
    "organizationId": "…",
    "leadId": "…",
    "agentId": "…",
    "skipEndOfCallReport": false
  }
}
```

Note inbound `variableValues` additionally includes `enableCallRecording: true` and
`current_date_time`, and uses `callType: 'inbound'` when built.

### Response

```jsonc
{
  "id": "call_abc123",
  "status": "…",
  "twiml": "<Response>…</Response>"   // REQUIRED — return this to Twilio verbatim
}
```

BexAi **throws** if `twiml` is missing/empty:
```ts
const twiml = response.data?.twiml;
if (typeof twiml !== 'string' || !twiml.trim()) {
  throw new Error('Engine response missing twiml');
}
```

> For the hackathon, inbound is **optional**. The debt-collector core only needs
> outbound. Skip this unless you want debtors to be able to call back.

---

## 3. `GET /call/status/{callId}` — poll a call

Fetch the current (or final) state of a call. Used by the BexAi demo flow and lead
flow to check on a call without waiting for the webhook.

### Request
```
GET https://voice.alebex.ai/call/status/call_abc123
X-API-Key: <key>
```
(No body. Demo uses a 10 s timeout.)

### Response

```jsonc
{
  "status": "ended",                 // call lifecycle status
  "endedReason": "customer-ended-call",
  "transcript": "AI: Hi Dave...\nDave: Ugh, fine...",
  "summary": "Dave admitted the debt and promised to pay Friday.",
  "recordingUrl": "https://…/recording.mp3"
}
```

BexAi reads exactly these five fields:
```ts
return {
  status: call.status,
  endedReason: call.endedReason,
  transcript: call.transcript,
  summary: call.summary,
  recordingUrl: call.recordingUrl,
};
```

`transcript`, `summary`, `recordingUrl`, and `endedReason` are only populated once the
call has progressed/ended. See `04-webhooks.md` for `endedReason` values.

---

## 4. `POST /api/voice-sample` — generate a TTS preview

Generate a short spoken clip to preview/choose a voice. Note the `/api/` prefix (the
call endpoints have **no** `/api/` prefix). Timeout 30 s.

### Request body (note: **snake_case** here)

```jsonc
{
  "text": "Hi, this is your friendly neighborhood debt collector.",
  "voice_id": "<voiceId>",
  "stability": 0.5,
  "similarity_boost": 0.75,
  "style": 0.0,
  "speed": 1.0,
  "use_speaker_boost": true
}
```

| Field | Type | Notes |
|---|---|---|
| `text` | string | Text to synthesize (defaults to `''` in code). |
| `voice_id` | string | Provider voice ID. |
| `stability` | number | 0–1 (ElevenLabs-style). |
| `similarity_boost` | number | 0–1. |
| `style` | number | 0–1. |
| `speed` | number | playback speed multiplier. |
| `use_speaker_boost` | boolean | speaker boost toggle. |

### Response
Returns `response.data` directly (audio payload / URL — BexAi passes it straight
through to the caller). Treat as the audio clip or a link to it.

---

## Quick implementation checklist

- [ ] Store `VOICE_ENGINE_URL`, `VOICE_ENGINE_API_KEY` in backend env.
- [ ] Have a registered FROM number → its `alebexVoicePhoneNumberId`.
- [ ] `POST /call/phone` with `type`, `phoneNumberId`, `customer`, `assistantOverrides`.
- [ ] Put your own correlation IDs in `metadata`.
- [ ] Store the returned `id`.
- [ ] Receive the end-of-call webhook **or** poll `GET /call/status/{id}`.
- [ ] (Optional) `POST /api/voice-sample` to let users pick a collector voice.
