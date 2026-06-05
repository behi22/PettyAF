# Call Payload Reference — `assistantOverrides.variableValues`

> The single most important object when driving a call. Verified against
> `communication-helper.service.ts` (`startCall`, the canonical builder),
> `inbound-voice.service.ts`, and `demo.service.ts`.

---

## 1. Mental model

The Alebex assistant is partly configured in the **Alebex dashboard** (the base
system prompt, the wired-up tools like `transferCall`/`endCall`, default voice, etc.)
and partly **overridden per-call** by the API payload.

`assistantOverrides.variableValues` is a **flat dictionary** that the engine:

1. **substitutes into the dashboard prompt** via `{{variableName}}` templating
   (e.g. the dashboard "First Message" field can contain `{{dynamicFirstMessage}}`),
   and
2. **reads as runtime behaviour flags** (temperature, turn-end mode, recording, etc.).

### ⚠️ The string-vs-object rule (most common footgun)

> *"AlebexVoice requires specific keys to be native objects/arrays, others must be
> strings."* — comment in `communication-helper.service.ts`

- **Most values must be sent as STRINGS** — including booleans and numbers. BexAi
  explicitly does `String(...)` on booleans:
  ```ts
  forward_enabled: String(isCallForwardingEnabled),   // "true" / "false"
  recording:       String(alebexVoicePayload.recording ?? false),
  forward_ring_timeout_seconds: String(forwardingTimeout),
  ```
- **A specific allowlist of keys must stay NATIVE objects/arrays** (do **not**
  stringify these): `qualifyingQuestions`, `qualificationRubric`, `leadInfo`,
  `guardrails`, `calendar_reference`, `voiceConfig`, `skills`.

When in doubt for a *scalar* value, send it as a string.

---

## 2. The full `variableValues` field catalogue

Grouped by purpose. (✱ = native object/array — do not stringify. Everything else is a
string in production.)

### Persona / identity
| Key | Example | Meaning |
|---|---|---|
| `assistantName` | `"Vito"` | The AI's name. |
| `assistantRole` | `"debt collector"` | The AI's role/title. |
| `orgName` | `"Petty Debt Collectors"` | Org the AI represents. |
| `advisorTitle` | `"collector"` | Singular human-title used in script. |
| `advisorTitlePlural` | `"collectors"` | Plural form. |
| `virtualEmployeeName` | `"Vito"` | (inbound) alias of assistantName. |

### Prompt & knowledge
| Key | Example | Meaning |
|---|---|---|
| `customPrompt` | `"You are a persistent but funny..."` | **The assembled system prompt.** This is where the persona + script live. |
| `knowledge_base` | `"Debt: $20, for pizza, owed since..."` | Free-text knowledge the AI can draw on (string, may embed "pivot language"). |
| `conversationHistory` | `"Prior call on 2026-06-01: Dave said..."` | Prior-interaction context (string). |
| `pivotLanguage` | `"…"` | (inbound) phrasing to redirect the conversation. |
| `knowledgeGapResponse` | `"I'll have to check on that."` | What the AI says when it doesn't know something. |

### Conversation goal / behaviour shaping
| Key | Example | Meaning |
|---|---|---|
| `goalContext` | `"Goal: get Dave to admit + commit to pay."` | High-level goal awareness. |
| `goalInstructions` | `"After he agrees, confirm the amount + date."` | Post-goal behaviour. |
| `callDirectionContext` | `"This is an outbound call."` | Tells AI inbound vs outbound. |
| `qualifyingQuestions` ✱ | `[{ question, ... }]` | Array of question objects to ask. |
| `qualificationRubric` ✱ | `{ rules, rejectionScript }` | Scoring/branching rules object. |
| `guardrails` ✱ | `["no profanity", "no threats"]` | Array of compliance topics the AI must respect. |

### Callee / context data
| Key | Example | Meaning |
|---|---|---|
| `leadInfo` ✱ | `{ name, phone, ... }` | Object of details about the person being called. |
| `lead_timezone` | `"America/New_York"` | Callee timezone (used for greeting + `current_date_time`). |
| `current_date_time` | `"2026-06-05T14:00:00-04:00"` | (inbound) current time in callee tz. |
| `calendar_reference` ✱ | `{ businessHours, ... }` | Calendar/business-hours object for scheduling. |

### Opening lines / voicemail
| Key | Example | Meaning |
|---|---|---|
| `dynamicFirstMessage` | `"Hi, is this Dave?"` | Pre-built opening line (also settable at `assistantOverrides.firstMessage`). Dashboard field can use `{{dynamicFirstMessage}}`. |
| `voicemailMessage` | `"Hey Dave, call us back about..."` | Message left if voicemail is hit. Dashboard: `{{voicemailMessage}}`. |

### Call forwarding / transfer (the AI uses a pre-wired transfer tool)
| Key | Example | Meaning |
|---|---|---|
| `forward_enabled` | `"true"` | Whether transfer is available (string!). |
| `forward_target_number` | `"+15550000000"` | Where to transfer (E.164). |
| `forward_ring_timeout_seconds` | `"30"` | Ring timeout before giving up (string!). |

### Recording / compliance disclosure
| Key | Example | Meaning |
|---|---|---|
| `recording` | `"true"` | Record the call (string!). |
| `enableCallRecording` | `true` | (inbound) boolean form used in inbound flow. |
| `compliance` | `"true"` | Whether to play a compliance disclosure (string!). |
| `isPreroll` | `"false"` | Play a preroll message (string!). |
| `prerollMessage` | `"This call may be recorded."` | The preroll/disclosure text. |
| `transcriptRetention` | `"true"` | Whether transcripts are retained (string!). |

### LLM & voice runtime tuning
| Key | Example | Meaning |
|---|---|---|
| `llmTemperature` | `0.7` | LLM creativity (default `0.7`). |
| `llmMaxTokens` | `500` | Max tokens per LLM turn (default `500`). |
| `voiceConfig` ✱ | `[{ provider, voiceId, ... }]` | Array of voice configs (multi-voice/multilingual). From `agent.voiceConfig.voices`. |
| `turnEndMode` | `"middle"` | End-of-turn detection: `risky` / `ultra_fast` / `fast` / `middle` / `conservative`. |
| `activeListening` | `false` | Emit "mm-hmm" sounds while user talks. |
| `skipFinalize` | `false` | Skip finalize wait for faster responses. |
| `idlePromptEnabled` | `false` | Prompt the user if they go silent. |
| `bgVolume` | `0.5` | Background-audio volume, 0–1. |
| `allowEndCall` | `true` | Allow the AI to end the call via tool. |
| `dynamicCallbackEnabled` | `false` | Treat a quick inbound as a callback. |
| `dynamicCallbackWindowMinutes` | `30` | Callback detection window (1–1440). |

### Integration / plumbing
| Key | Example | Meaning |
|---|---|---|
| `organization_id` / `organizationId` | `"…"` | Org id for webhook lookup. |
| `_organizationId`, `_leadId` | `"…"` | (inbound) internal correlation keys. |
| `_calendarApiKey` | `"…"` | Calendar API key so the engine can book appointments directly. |
| `skills` ✱ | `[{ ...definition }]` | Full skill definitions resolved by your backend (engine no longer looks them up itself). |
| `fromPhoneNumber` | `"+15553334444"` | The FROM number string. |
| `backendUrl` | `"https://api.…"` | Your backend public URL (for engine→backend callbacks/tools). |

---

## 3. The `voiceConfig` object (per-voice settings)

When you pass `voiceConfig` (array) or configure an agent's voice, each entry can hold
(from `VoiceConfigDto`):

```jsonc
{
  "provider": "elevenlabs",     // kokoro | elevenlabs | deepgram | alebex
  "voiceId": "…",
  "voices": [ /* multi-voice array for multilingual */ ],
  "modelId": "eleven_turbo_v2_5",
  "languageCode": "en",         // en | es | fr | …
  "speed": 1.0,                 // 0.5–2.0
  "pitch": 1.0,                 // 0.5–2.0
  "stability": 0.5,             // 0–1
  "similarityBoost": 0.5,       // 0–1
  "style": 0,                   // 0–1
  "useSpeakerBoost": true,
  "bgVolume": 0.5,              // 0–1
  "firstMessage": "…",
  "turnEndMode": "middle",
  "activeListening": false,
  "skipFinalize": false,
  "idlePromptEnabled": false,
  "allowEndCall": true,
  "dynamicCallbackEnabled": false,
  "dynamicCallbackWindowMinutes": 30,
  "expertiseLanguage": "…"
}
```

These are the same knobs `POST /api/voice-sample` exposes (in snake_case) for previews.

---

## 4. Tools are configured in the dashboard, not the payload

> *"Tools (transferCall, endCall) must be pre-configured in AlebexVoice assistant
> dashboard. We only pass variables to control when the AI uses them. The AI checks
> `forward_enabled` to decide when to offer/execute transfers."*

So: you don't define functions/tools in the API call. You **toggle behaviour** via
variables (`forward_enabled`, `allowEndCall`, etc.), and the engine's pre-wired tools
act accordingly.

---

## 5. Minimal vs full payload

You do **not** need every field. The demo flow proves a small payload works. For
Petty Debt Collector, a lean but effective `variableValues`:

```jsonc
{
  "assistantName": "Vito",
  "assistantRole": "debt collector",
  "orgName": "Petty Debt Collectors",
  "customPrompt": "<persona + collection script — see file 05>",
  "knowledge_base": "Debtor: Dave. Amount: $20. For: pizza on May 30. Creditor: Manav. Status: unpaid.",
  "dynamicFirstMessage": "Hi, is this Dave? I'm calling about a small matter of twenty dollars.",
  "voicemailMessage": "Hey Dave, it's about the twenty bucks you owe Manav. Give us a call back.",
  "llmTemperature": "0.85",
  "llmMaxTokens": "500",
  "turnEndMode": "middle",
  "allowEndCall": "true",
  "recording": "true",
  "guardrails": ["no real threats", "no profanity", "keep it playful"],
  "backendUrl": "https://<our-host>"
}
```

Remember: scalars/booleans → strings; `guardrails`/`leadInfo`/`voiceConfig` etc. →
native arrays/objects.
