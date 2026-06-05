# Alebex Voice Engine — Overview & Architecture

> Source of truth: reverse-engineered from the production integration in
> `jsudesign/BexAi` (NestJS backend, `backend/src/modules/communication/**`)
> plus the gated docs at https://voice.alebex.ai/docs/. Every endpoint, header,
> and payload field in these docs is taken directly from working production code.

---

## 1. What the Alebex Voice Engine is

The **Alebex Voice Engine** (internally referenced as the "AleBex Voice Engine",
formerly code-named `vapi`) is a hosted **AI phone-call service**. You hand it:

- a **phone number to dial** (the human),
- a **phone number to dial *from*** (registered with the engine),
- an **assistant configuration** (the AI's persona, prompt, voice, behaviour, and
  runtime variables),

…and it places a real outbound phone call, runs a full duplex voice conversation
driven by an LLM + TTS + STT pipeline, and then calls **your webhook** with the
transcript, recording, and analysis when the call ends.

It also supports **inbound** calls (a human dials your number → the engine answers
with your assistant) and **voice sampling** (generate a short TTS clip to preview a
voice).

Under the hood the engine uses **Twilio** for the actual telephony (numbers,
SIP/PSTN, TwiML) and layers the AI conversation on top. Your app never talks to the
LLM directly during a call — the engine owns the real-time loop.

### Core capabilities

| Capability | Endpoint | Direction |
|---|---|---|
| Place an AI outbound call | `POST /call/phone` | outbound |
| Answer an inbound call with AI | `POST /call/phone/inbound` | inbound |
| Poll a call's live/final status | `GET /call/status/{callId}` | either |
| Generate a TTS voice preview | `POST /api/voice-sample` | n/a |
| Receive end-of-call report | *your* webhook (engine → you) | callback |

---

## 2. The "Petty Debt Collector" app concept

**Petty Debt Collectors** is a for-fun app: a user ("the creditor") says *"my friend
Dave owes me $20 for pizza"*, and our AI agent **calls Dave** and good-naturedly (or
dramatically) hounds him about the debt on the creditor's behalf.

This maps almost 1:1 onto the voice engine's outbound-call model. The only real work
is **domain translation** — instead of a college admissions advisor qualifying a
lead (BexAi's use case), our assistant is a theatrical debt collector pursuing a
playful debt.

| Voice-engine concept | BexAi (production) meaning | Petty Debt Collector meaning |
|---|---|---|
| `customer` | the sales lead being called | **the debtor** (the human who "owes" money) |
| `assistant` / agent | admissions advisor persona | **the debt-collector persona** (e.g. polite, mob-boss, passive-aggressive) |
| `assistantOverrides.variableValues` | lead info, qualification questions | **debt details**: amount, what it's for, who's owed, since when |
| `firstMessage` | "Hi, this is Sarah from Bex College…" | "Hi, is this Dave? It's about the $20 you owe Manav…" |
| `customPrompt` | qualification + booking instructions | **collection script + persona + escalation rules** |
| end-of-call webhook | qualification analysis, CRM update | **outcome**: did they admit it? promise to pay? deny? hang up? |
| `summary` / `transcript` | call notes | **shareable recap** for the creditor ("Dave promised to Venmo you tonight 😂") |

See [`05-petty-debt-collector-implementation.md`](./05-petty-debt-collector-implementation.md)
for the full build plan.

---

## 3. End-to-end call lifecycle

```
┌─────────────┐   1. POST /call/phone        ┌──────────────────────┐
│  Your app   │ ───────────────────────────► │  Alebex Voice Engine │
│  (backend)  │   (X-API-Key, JSON payload)  │   (voice.alebex.ai)  │
└─────────────┘ ◄─────────────────────────── └──────────────────────┘
       ▲          2. { id, status }                     │
       │                                                │ 3. engine dials
       │                                                ▼  the debtor via Twilio
       │                                       ┌──────────────────┐
       │  5. POST end-of-call webhook          │   📞 Live call   │
       │     { message: { call, transcript,    │  AI ⇄ human voice│
       │       recordingUrl, analysis, … } }   └──────────────────┘
       └──────────────────────────────────────────────┘ 4. call ends

   (Optional) anytime: GET /call/status/{id} → { status, transcript, … }
```

1. **Initiate** — your backend POSTs a call payload to `/call/phone`.
2. **Ack** — the engine returns immediately with a call `id` and initial `status`
   (e.g. `queued`/`ringing`). The call has **not** finished — this is async.
3. **Dial & converse** — the engine calls the debtor and runs the AI conversation
   using your assistant config.
4. **End** — the call terminates (human hangs up, AI ends it, voicemail, no answer…).
5. **Report** — the engine POSTs an **end-of-call webhook** to your configured URL
   with the transcript, recording URL, structured analysis, duration, and cost.

You can **poll** `GET /call/status/{id}` at any point as an alternative/supplement to
the webhook (the BexAi demo flow polls; the main flow uses the webhook).

---

## 4. Key design facts to internalize

- **It is asynchronous.** `POST /call/phone` returns a call `id` instantly; the real
  outcome arrives later via webhook or by polling status. Never block on it.
- **Auth is a single API key** sent as the `X-API-Key` header. There is **no**
  OAuth / Bearer flow for the voice engine itself. (See `01-authentication-and-config.md`.)
- **`assistantOverrides.variableValues` is the heart of customization.** It's a flat
  bag of variables the engine substitutes into the dashboard-configured assistant
  prompt (`{{variableName}}` templating) and uses to control runtime behaviour. Most
  values must be **strings**; a few specific keys are passed as native objects/arrays.
  See `03-call-payload-reference.md`.
- **Tools (transfer call, end call) are pre-configured in the Alebex dashboard**, not
  in the API payload. The payload only passes *variables* (like `forward_enabled`)
  that tell the AI *when* to use those pre-wired tools.
- **The engine uses Twilio** for numbers/telephony. The "from" number must exist and
  be registered (it carries an `alebexVoicePhoneNumberId`).
- **Webhooks return `200 OK` fast and process async.** BexAi acks the webhook
  immediately and does the heavy transcript analysis in the background to avoid the
  engine's timeout/retry.

---

## 5. Document map

| File | Contents |
|---|---|
| `00-overview.md` | This file — concepts, lifecycle, domain mapping |
| `01-authentication-and-config.md` | API key, base URL, env vars, timeouts |
| `02-api-reference.md` | Every endpoint: method, path, request, response |
| `03-call-payload-reference.md` | Deep dive on the call payload & `variableValues` |
| `04-webhooks.md` | End-of-call webhook, inbound flow, `endedReason` lifecycle |
| `05-petty-debt-collector-implementation.md` | How to build our app on top of all this |
