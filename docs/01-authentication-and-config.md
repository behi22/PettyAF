# Authentication & Configuration

> Verified against `backend/.env.example` and every `axios` call to the engine in
> `backend/src/modules/communication/**` and `backend/src/modules/demo/demo.service.ts`.

---

## 1. Base URL

```
https://voice.alebex.ai
```

In production this is configurable via the `VOICE_ENGINE_URL` env var, but it
**defaults to `https://voice.alebex.ai`** everywhere in the codebase:

```ts
const voiceEngineUrl =
  this.configService.get<string>('VOICE_ENGINE_URL') || 'https://voice.alebex.ai';
```

The interactive (human) docs live at `https://voice.alebex.ai/docs/` and require a
login (email + password) — they are **not** the API auth mechanism, just a docs portal.

---

## 2. Authentication — `X-API-Key`

**Every** request to the voice engine authenticates with a single API key sent in the
**`X-API-Key`** HTTP header. There is no Bearer token, no OAuth, no signing for
outbound requests.

```ts
const headers: Record<string, string> = { 'Content-Type': 'application/json' };
const voiceEngineApiKey = this.configService.get<string>('VOICE_ENGINE_API_KEY');
if (voiceEngineApiKey) {
  headers['X-API-Key'] = voiceEngineApiKey;
}
```

- Header name (exact, case-insensitive over HTTP): **`X-API-Key`**
- Always paired with `Content-Type: application/json` for POST bodies.
- The key is **optional in code** (guarded by `if (apiKey)`), meaning a dev instance
  *may* run without it — but production always sends it. **For the hackathon, treat
  it as required.**

> ⚠️ The API key is a server-side secret. Never ship it to the browser/mobile client.
> All engine calls must originate from our backend.

---

## 3. Environment variables

From `backend/.env.example`:

```bash
# Base URL of the Alebex Voice Engine
VOICE_ENGINE_URL=https://voice.alebex.ai

# Secret API key sent as the X-API-Key header on every request
VOICE_ENGINE_API_KEY=

# HTTP client timeout for engine requests, in milliseconds
VOICE_ENGINE_HTTP_TIMEOUT_MS=60000

# (Optional) shared secret for verifying inbound webhooks from the engine
VOICE_ENGINE_WEBHOOK_SECRET=

# (Optional) the URL the engine should POST end-of-call reports to
VOICE_ENGINE_WEBHOOK_URL=
```

### Recommended `.env` for Petty Debt Collector

```bash
VOICE_ENGINE_URL=https://voice.alebex.ai
VOICE_ENGINE_API_KEY=<your-alebex-api-key>
VOICE_ENGINE_HTTP_TIMEOUT_MS=60000
VOICE_ENGINE_WEBHOOK_SECRET=<random-shared-secret>      # if the engine supports it
VOICE_ENGINE_WEBHOOK_URL=https://<our-host>/webhooks/alebex-voice/end-of-call
BACKEND_PUBLIC_URL=https://<our-host>                    # passed into calls as backendUrl
```

---

## 4. Timeouts & large payloads

- **Default timeout: 60 000 ms (60 s).** Call-creation payloads can be large
  (BexAi notes prompts of "17K+ chars"), so the HTTP client is configured generously:

```ts
const response = await axios.post(apiUrl, callPayload, {
  headers,
  timeout: axiosTimeoutMs,        // 60s by default
  maxContentLength: Infinity,
  maxBodyLength: Infinity,        // allow large prompt payloads
});
```

- `GET /call/status/{id}` uses a **shorter timeout** in practice (10 000 ms in demo).
- `POST /api/voice-sample` uses **30 000 ms**.
- If you exceed the timeout you'll get an `ECONNABORTED`/timeout error — BexAi surfaces
  this as *"AlebexVoice request timed out. The prompt may be too large."* Keep prompts
  reasonable.

---

## 5. Error handling shape

Engine errors come back as Axios errors. BexAi extracts the message defensively
because the engine's error body shape varies:

```ts
const responseMessage =
  (typeof responseData === 'string' && responseData) ||
  responseData?.message ||
  responseData?.error?.message ||
  responseData?.error ||
  error.message;
```

So an error response may be:
- a raw string, **or**
- `{ "message": "…" }`, **or**
- `{ "error": "…" }`, **or**
- `{ "error": { "message": "…" } }`.

**Defensive parsing recommended** — don't assume one shape. HTTP status is read from
`error.response.status`.

---

## 6. Phone numbers (the "from" number)

The engine places calls **from a real phone number that must be registered with it**.
In BexAi:

- Numbers are **purchased from Twilio** and stored locally with a `twilioSid`.
- Each engine-registered number carries an **`alebexVoicePhoneNumberId`**, which is the
  value passed as `phoneNumberId` in the call payload (see `02-api-reference.md`).
- Twilio webhooks (voice/sms/status) are pointed at the BexAi backend on purchase.

For the hackathon you will need **at least one Alebex/Twilio number** provisioned and
its `alebexVoicePhoneNumberId`. If you only have the raw E.164 number, note that the
BexAi *demo* flow passes the **phone number string itself** as `phoneNumberId`
(see `02-api-reference.md` §2.3) — confirm which your account expects.
