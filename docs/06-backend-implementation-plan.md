# PettyAF Backend Implementation Plan (Manav)

> Status: DRAFT v2, revised after an adversarial code review against the real `BexAi`
> production backend. This plan extends `main.md` to cover the four new product requirements
> (dashboard, campaigns, centralized live-calls control room, emergency stop). Where it
> conflicts with `main.md` §7, this file wins; deviations are called out with a reason.
> Backend only. No frontend here.
>
> Tone note: technical prose, no em dashes, to match house style.

---

## 0. Read this first: platform reality vs the API docs

The biggest lesson from the review: **`api-documentation.yaml` is aspirational, not what the
code runs.** The platform docs (00-05) describe the raw voice engine accurately, but the
staging REST platform (the thing we actually ride) has diverged from its own OpenAPI spec.
Every concrete claim below is grounded in the real `BexAi` NestJS code, which the docs say the
platform is built from. Staging may run a slightly different version, so **each load-bearing
fact is also a verify-first curl (§18). Treat them as "true in the reference code, confirm on
staging in the first 10 minutes," not as gospel.**

The hard truths that reshape this plan:

1. **The Campaign entity is almost empty.** A migration (`CleanupCampaignsTable
   1734400000000`) dropped `status`, `start_date`, `end_date`, `targeting_type`, `goal`,
   `offer`, `custom_fields`. The persisted entity is only `{ id, organizationId,
   knowledgeBaseId, name, description, createdBy, updatedBy, timestamps }` plus relations.
   So there is **no campaign status, no dates, no timezone, no custom fields** to write to.
   Campaign run-state must live in our backend, not on staging.
2. **`knowledgeBaseId` is required (NOT NULL) to create a campaign.** We never provisioned a
   KB id. This is a blocker until fixed (§3.1, §18).
3. **`POST /leads/test-call` requires the lead's native `agentId`** (throws 400 otherwise).
   The persona must be set on the lead's native `agentId` field, not only in `customFields`.
4. **The relentless loop is gated by native `lead.status`.** Dialing is rejected unless
   `lead.status` is in `{NEW, UNCONTACTED, CONTACTED, OUTREACH_IN_PROGRESS,
   QUALIFIED_WAITING_APPOINTMENT}`. The platform's own end-of-call processor moves leads to
   `QUALIFIED_HANDOFF` (goal met) or `NOT_INTERESTED_DO_NOT_CONTACT` (opt-out), both of which
   are rejected. So redials 400 after the first decisive call unless we reset the native
   status before each dial (§9.8).
5. **Reinquiry dedup:** creating a lead with a phone/email that already exists returns the
   existing lead, not a new one. The demo reuses one volunteer number, so two "cases" can
   silently merge (§16).
6. **The platform auto-schedules outreach** when a lead is created with an assigned agent, via
   its own queue processor that we do not control. So "emergency stop = zero calls" is only
   true if we suppress that scheduling or scope the claim honestly (§11).
7. **Several documented endpoints are not implemented:** `GET /campaigns/:id`,
   `GET /campaigns/:id/analytics`, `POST /campaigns/:id/start`, `POST /calls/initiate`. Use the
   real routes instead (§1, §8).

The honest-scope conclusions from v1 all held up under review and are confirmed correct:
**no live call audio, no reliable mid-call transcript, no cancel/hangup endpoint, no
active-calls list endpoint.** Those shape requirements 3 and 4 (§10, §11).

---

## 1. What changed vs main.md, in one screen

`main.md` locked a case-centric, stateless, "no PettyAF database" design where a case IS a
staging lead. That core holds. Campaigns become a **thin grouping layer over the proven
single-case path**, not a parallel universe.

| New requirement | How we satisfy it | Net change to main.md |
|---|---|---|
| 1. Dashboard (calls made, money earned, etc.) | Backend computes KPIs from `GET /leads?source=PettyAF` plus a small in-memory call ledger | New `GET /api/dashboard` + aggregation service |
| 2. Add leads to a campaign, editable settings (purpose, duration, mode, unhinged level) | Campaign = native staging Campaign (name + description + `knowledgeBaseId` + `agentIds`). PettyAF settings (mode/duration/unhinged) live in a JSON blob inside `description`. Leads carry `campaignId` + native `agentId`. A backend Campaign Engine dials the list reusing the existing deploy code | New campaign routes + the Campaign Engine (in-memory) |
| 3. Centralized live-calls view + listen-in | Backend keeps an in-memory live-call registry (no platform active-calls endpoint). FE polls `GET /api/live` every 2s (matches main.md polling). "Listen in" = live phase + post-call transcript/recording. True audio is not available on this platform | New `GET /api/live` + `GET /api/live/:callId` |
| 4. Emergency stop | A synchronous kill flag stops the engine and all relentless timers instantly; in-flight connected calls cannot be force-terminated (no platform cancel API) and finish on their own | New `POST /api/live/stop` |

Three decisions from `main.md` §2 still stand, refined:

- **No PettyAF relational database (default).** Staging stores leads, custom fields,
  transcripts, recordings, qualification answers. The only PettyAF-only state is the campaign
  engine and the live registry, both in memory. Campaign settings ride in the campaign
  `description`. One optional escape hatch in §15.
- **Personas ARE staging Agents.** Set on the lead's native `agentId` and on the campaign's
  `agentIds`.
- **All secrets live in the backend only.**

---

## 2. Architecture

```
React FE (Vite)                 PettyAF backend (Express + TS)                  Alebex STAGING
localhost:5173                  localhost:4000                                  api-staging.alebex.ai
    |                                |                                                |
    |  REST /api/* (JSON)            |  JWT (org-admin), auto-refresh                 |
    |  poll /api/live every 2s       | ---------------------------------------------> |
    |  poll /api/dashboard           |   POST /campaigns   (name+desc+kbId+agentIds)  |
    | ---------------------------->  |   POST /leads       (agentId set! campaignId)  |
    |                                |   POST /leads/test-call  (deploy/dial)         |
    |                                |   PATCH /leads/:id  (status reset, paf_status) |
    |                                |   GET  /leads, GET /campaigns                  |
    |                                |   GET  /activities/lead/:id (enrichment)       |
    |                                |                                                |
    |                                |  Campaign Engine (in-memory loop + kill flag)  |
    |                                |  Live-call registry + call ledger (in-memory)  |
    |                                |                                                |
    |                                |  X-API-Key (engine status polls, RESULT source)|
    |                                | ------------------> voice.alebex.ai            |
    |                                |   GET /call/status/{callId}                    |
```

Key flow change from v1: **we classify call results from the ENGINE status poll**
(`status=ended` + `endedReason` + `summary` + `transcript`), not from staging. Staging's
`lead.qualificationSummary` is best-effort enrichment that may lag. This avoids the failure
mode where a call sits in "analyzing" forever waiting for staging to populate (§9.7).

State, all in memory, none of it mirrored to staging (because there is nowhere to mirror it):
- **Live-call registry** `Map<callId, LiveCall>` + `Map<leadId, dialState>` (the control room).
- **Campaign Engine** `Map<campaignId, EngineState>` (loop handles, mode, endsAt, counters).
- **Call ledger** `Map<callId, LedgerEntry>` (for exact dashboard counts; survives restart only
  if you adopt §15).

A backend restart stops in-flight campaigns. For a 60-minute demo that is acceptable; §9.9 has
the optional hardening if you want restart resilience.

---

## 3. Domain model and mapping (corrected to the real entities)

| PettyAF concept | Lives as | Notes |
|---|---|---|
| Campaign | staging **Campaign** | Only `name`, `description`, `knowledgeBaseId`, `agentIds` persist. Purpose + settings ride in `description` (§9.3) |
| Case (one debtor) | staging **Lead** | `campaignId` ties it to a campaign. native **`agentId` = persona agent (required for dialing)**. `source="PettyAF"`. PettyAF fields in `customFields` |
| Persona | staging **Agent** | pre-seeded, `PERSONA_AGENT_MAP[key] -> agentId` |
| Call attempt | engine call + staging CallLog | engine `callId` from test-call drives the live poll and classification |
| Result + verdict | engine `/call/status` (primary) + `lead.qualificationSummary` (enrichment) | activities endpoint does NOT return transcript/summary/sentiment (§1.5) |

### 3.1 The knowledge base (new provisioning dependency)

`POST /campaigns` requires `knowledgeBaseId`. `main.md` §5 already pastes a Knowledge Base into
the org during provisioning. Capture that KB's id and either set `STAGING_KNOWLEDGE_BASE_ID`
in env, or have the backend `GET` the knowledge-bases list at boot and use the first one.
Without this, every campaign create fails. Add to the provisioning handoff (`main.md` §3).

### 3.2 customFields carried on every lead

Extends `main.md` §7.3: `debt_amount`, `debt_currency`, `debt_reason`, `debt_since`,
`creditor_name`, `aggression_level`, `known_weaknesses`, `settlement_options` (comma-joined),
`persona_key`, `paf_status`, `relentless_count`, `campaign_id`, and `ever_completed_call`
(set true on first completed call, used for the dashboard successRate denominator, §12).

---

## 4. Tech stack and project structure

Express + TypeScript (per `main.md` §7). Add `zod` for request validation. No ORM. No SSE for
MVP (cut after review, §10.3); FE polls.

```
src/
  index.ts                 // bootstrap: env, login, discover KB id, start server
  config/env.ts            // typed env + PERSONA_AGENT_MAP parse
  clients/
    stagingClient.ts       // axios, JWT login/refresh, envelope unwrap, retry-on-401
    engineClient.ts        // X-API-Key, GET /call/status, 10s timeout, defensive parse
  domain/
    mappers.ts             // lead<->Case, campaign<->Campaign, description-blob (de)serialize
    status.ts              // engine endedReason + qual -> paf_status (single source, §13)
  services/
    campaigns.ts           // CRUD against staging campaigns + settings overlay
    cases.ts               // CRUD against staging leads (sets native agentId!)
    results.ts             // classify from engine status; enrich from lead
    dashboard.ts           // KPI aggregation (§12)
  engine/
    campaignEngine.ts      // the loop, modes, duration, relentless, the kill flag (§9)
    liveRegistry.ts        // Map<callId, LiveCall> + dialState index (§10)
    ledger.ts              // Map<callId, LedgerEntry> for exact counts (§12)
  routes/
    campaigns.routes.ts
    cases.routes.ts
    live.routes.ts         // control room + emergency stop
    dashboard.routes.ts
  middleware/
    error.ts               // { error: string } + status
    requestLog.ts          // console line per staging/engine call (the demo debugger)
```

---

## 5. Configuration (env)

Extends `main.md` §7.2. New in **bold**. Removed from v1: `FROM_PHONE_NUMBER_ID` (test-call
uses the org default FROM number and does not accept it).

```
PORT=4000
STAGING_API_URL=https://api-staging.alebex.ai/api/v1
STAGING_EMAIL=collector@pettyaf.test
STAGING_PASSWORD=<from Behbod, never commit>
VOICE_ENGINE_URL=https://voice.alebex.ai
VOICE_ENGINE_API_KEY=<from Behbod, never commit>
PERSONA_AGENT_MAP={"vinny":"...","deborah":"...","parent":"...","roommate":"...","herald":"..."}
CORS_ORIGIN=http://localhost:5173
**STAGING_KNOWLEDGE_BASE_ID=<required for campaign create; from provisioning>**
**MAX_CONCURRENT_CALLS=1**            # one FROM number => effectively 1 (see §9.4)
**REDIAL_GAP_MS=8000**               # single effective gap between calls to one debtor (§9.8)
**ENGINE_POLL_INTERVAL_MS=2000**     # live status poll cadence
**ANALYZING_TIMEOUT_MS=20000**       # force-classify if a call hangs in "analyzing" (§9.7)
**RELENTLESS_SOFT_CAP=50**           # safety ceiling; see §16. Set 0 to disable (pure chaos)
```

`.env` is gitignored; commit `.env.example` with empty values.

---

## 6. Clients

### 6.1 Staging client (`stagingClient.ts`)

- One axios instance, `baseURL = STAGING_API_URL`, 60s timeout on writes, 15s on GET.
- **Login at boot:** `POST /auth/login { email, password }`. The runtime response envelope is
  `{ success, data: { user, accessToken, refreshToken, expiresIn }, message }` (note: the
  field is `message`, there is no `meta`). Store tokens in memory; set a refresh timer at
  `expiresIn - 60s`.
- **Response interceptor:** when `success === true`, return `res.data.data`; else throw a
  normalized error from `res.data.message`/`error`.
- **List shapes differ per endpoint, so parse per call, do not assume one shape:**
  - `GET /campaigns` -> `data.items` + `data.pagination` (and each item carries `leadStats`:
    `totalLeads`, `qualifiedWaitingAppointment`, `qualifiedHandoff` -> reuse for rollups).
  - `GET /leads` -> paginated with a top-level `data` array + sibling pagination.
  - Confirm both with a curl (§18).
- **401 interceptor:** refresh via `POST /auth/refresh { refreshToken }`, retry once; if that
  fails, re-login, retry once, then surface the error.
- Helpers: `createCampaign`, `listCampaigns`, `updateCampaign`, `createLead`, `getLead`,
  `listLeads`, `patchLead`, `testCall`, `getLeadActivities`. (No `getCampaign` by id, no
  campaign analytics, no `/calls/initiate`: those routes are not implemented; see §1.)
- One console line per request: `[staging] POST /leads -> 201 (412ms)`.

### 6.2 Engine client (`engineClient.ts`) and where results actually come from

- `GET ${VOICE_ENGINE_URL}/call/status/{callId}` with header `X-API-Key`, 10s timeout.
- Read `status`, `endedReason`, `transcript`, `summary`, `recordingUrl` defensively (engine
  error bodies vary; doc 01 §5).
- **This direct engine poll is our primary result source.** Per engine doc 02 §3 the engine
  returns transcript/summary/recordingUrl/endedReason once the call ends. The staging proxy
  `GET /leads/call-status/:callId` strips those fields and only accepts a `CA`-prefixed Twilio
  SID, so **do not route status through staging; poll the engine directly.**
- Verify-first (§18.B/D): confirm the `callId` returned by `test-call` is the same id the
  engine `/call/status` accepts. The reference shows the engine uses `call_...` ids while the
  staging proxy expects `CA...` Twilio SIDs; we must poll with whatever id the engine accepts.

---

## 7. Data contracts (FE <-> BE)

All JSON. Errors: `{ error: string }` + status.

### 7.1 Campaign object (FE-facing; backend hides the description-blob mechanics)

```jsonc
{
  "id": "campaign-uuid",
  "name": "Taco Debts Q2",
  "purpose": "Recover small food debts from the friend group.",  // human text in description
  "runState": "active",            // active|paused|completed  (IN-MEMORY only, not on staging)
  "endsAt": "2026-06-12T00:00:00Z",// duration window (stored in the description blob)
  "settings": {
    "mode": "relentless",          // standard | relentless
    "unhingedLevel": 8,            // 1-10 default aggression applied to leads (§9.10)
    "defaultPersonaKey": "vinny",
    "maxConcurrentCalls": 1
  },
  "stats": {                       // derived from leadStats + ledger (§12)
    "leadCount": 12, "callsMade": 34, "promised": 5, "settled": 2,
    "collected": 41.50, "outstanding": 88.00, "liveNow": 1
  }
}
```

### 7.2 Case object

Unchanged from `main.md` §9, plus `campaignId`. `lastCall` is null until a call completes;
`daysDelinquent` is client-side from `sinceDate`.

### 7.3 Live call object (control room)

```jsonc
{
  "callId": "call_abc123",
  "caseId": "lead-uuid", "campaignId": "campaign-uuid",
  "caseNumber": "PAF-2026-3F2A",
  "debtorName": "Dave Martinez", "personaKey": "vinny",
  "amount": 7.0, "currency": "CAD",
  "phase": "talking",              // dialing|talking|analyzing|done|failed
  "startedAt": "2026-06-05T14:00:02Z", "durationSec": 38,
  "callCount": 3,                  // for relentless "Call #3"
  "partialTranscript": null        // usually null until done (§1.6 / §10.2)
}
```

### 7.4 Dashboard object

```jsonc
{
  "kpis": {
    "totalOutstanding": 412.75,
    "totalCollected": 88.50,       // "money earned from victims" = SETTLED total (decision, §12)
    "totalPromised": 140.00,
    "callsMade": 213,              // from the in-memory ledger (exact within this process life)
    "talkMinutes": 47,             // approximate; see §12
    "activeCases": 18,
    "friendshipsAtRisk": 6,        // DEPLOYED + DISPUTED
    "ledgerOfShame": 901.20,
    "liveNow": 2,                  // computed fresh from registry, NOT cached (§12)
    "successRate": 0.34
  },
  "byPersona": [ { "personaKey": "vinny", "calls": 60, "promised": 14, "collected": 40.0 } ],
  "recentCalls": [ /* last N completed, from the ledger */ ]
}
```

---

## 8. API surface (the FE contract)

### 8.1 Campaigns

- **`POST /api/campaigns`** create. Body `{ name, purpose, durationHours, mode, unhingedLevel,
  defaultPersonaKey, maxConcurrentCalls? }`. Action: `POST /campaigns` with **only**
  `{ name, description, knowledgeBaseId: STAGING_KNOWLEDGE_BASE_ID, agentIds:
  [PERSONA_AGENT_MAP[defaultPersonaKey]] }`, where `description` is `serialize(purpose,
  settings, endsAt)` (§9.3). All other v1 fields (status/dates/goal/offer/targeting) are
  dropped: staging ignores them. Returns the Campaign object.
- **`GET /api/campaigns`** list with `stats`. Staging `GET /campaigns` already returns
  per-campaign `leadStats`; reuse it, augment with ledger counts.
- **`GET /api/campaigns/:id`** one campaign. **Staging has no `GET /campaigns/:id`**, so fetch
  the list and filter by id in the backend (or confirm 404 behavior via curl, §18).
- **`PATCH /api/campaigns/:id`** edit settings later. Maps to `PUT /campaigns/:id` writing a
  freshly re-serialized `description` (purpose + settings + endsAt together, always, §9.3) and
  updates the in-memory EngineState. A running campaign picks up changes on the next tick.
- **`POST /api/campaigns/:id/leads`** add one or many cases. Creates staging leads with
  `campaignId`, native `agentId` set, and `aggression_level` defaulted from the campaign's
  `unhingedLevel` unless the lead overrides (§9.10). Watch reinquiry dedup (§16).
- **`POST /api/campaigns/:id/start`** start the engine (in-memory runState -> active).
- **`POST /api/campaigns/:id/pause`** pause (engine stop, keep state).
- **`DELETE /api/campaigns/:id`** cancel (engine stop; staging `DELETE /campaigns/:id`).

### 8.2 Cases

As `main.md` §7.3 (`POST/GET /api/cases`, `GET /api/cases/:id`, `POST /api/cases/:id/deploy`,
`PATCH /api/cases/:id`), with two corrections that apply everywhere a lead is created:
**always set native `agentId = PERSONA_AGENT_MAP[personaKey]`** (required for test-call), and
**`programOfInterest` is optional** (only `fullName` + `source` are required; v1 was wrong to
call it a blocker). `POST /api/cases` gains optional `campaignId`. The single-case path of
`main.md` §11 remains fully intact and is the demo spine.

### 8.3 Live control room

- **`GET /api/live`** snapshot of all live calls now (array of §7.3 objects) + a summary
  `{ liveNow, byCampaign }`. Pure in-memory read; instant. **The FE polls this every 2s**
  (matches `main.md` §8 polling cadence). This is the only realtime path for MVP.
- **`GET /api/live/:callId`** the focused "listen in" view for one call: the live object plus
  any transcript we have, and once `phase=done`, the result + `recordingUrl` (EXHIBIT A).
- **`POST /api/live/stop`** GLOBAL emergency stop. Optional body `{ campaignId? }`. See §11.

### 8.4 Dashboard

- **`GET /api/dashboard`** returns §7.4. Computed by `dashboard.ts` (§12). Cache the
  lead-aggregation parts ~5s; compute `liveNow` fresh each call (it is free).

(SSE, a webhook receiver, and per-campaign analytics from staging are all deferred, §10.3/§14.)

---

## 9. The Campaign Engine (requirement 2)

The dialer. Native campaigns are a durable container for name/description/KB/agents only; all
run-state is ours.

### 9.1 Why our own engine, not native automation

`POST /campaigns/:id/start` is documented but **not implemented**, and there is no campaign
`status` to drive a lifecycle anyway (§0.1). Even if it existed, it could not express
relentless no-cap redial, unhinged level, the §13 status mapping, or synchronous emergency
stop. So we drive dialing ourselves via `POST /leads/test-call`, the one path that works with
an org-admin JWT. There is no campaign-state mirroring to staging (nowhere to write it).

### 9.2 Engine state (in memory)

```ts
type DialState = 'idle' | 'reserved' | 'dialing' | 'live';   // per lead, set SYNCHRONOUSLY
type EngineState = {
  campaignId: string;
  runState: 'active' | 'paused' | 'completed';
  stopped: boolean;                 // synchronous kill flag, checked right before every dial
  mode: 'standard' | 'relentless';
  unhingedLevel: number;            // 1-10
  defaultPersonaKey: string;
  maxConcurrentCalls: number;
  endsAt: number;                   // epoch ms
  inFlight: Map<string, { callId: string; pollTimer: NodeJS.Timeout }>; // by leadId
  relentless: Map<string, { callCount: number; consecutiveErrors: number; redialTimer?: NodeJS.Timeout }>;
  tick: NodeJS.Timeout | null;
};
```

Every timer handle (tick, per-call poller, relentless redial) is tracked so emergency stop can
clear all of them (§11).

### 9.3 Where campaign settings live (the only writable home: description)

`custom_fields` was dropped from the campaign, so the **only** durable home for purpose +
settings + endsAt is the `description` string. One serializer used on every write:

```
description = `${purpose}\n\n__pettyaf__=${JSON.stringify({ mode, unhingedLevel,
               defaultPersonaKey, maxConcurrentCalls, endsAt })}`
```

On read: regex `/\n\n__pettyaf__=(\{.*\})\s*$/`, `JSON.parse` in try/catch, and on ANY failure
(missing blob, a human edited the description in the staging UI, malformed JSON) fall back to
env defaults rather than crashing. `PUT /campaigns/:id` does `description ?? existing`, so we
must ALWAYS write purpose and blob together or one clobbers the other. This is fragile; if you
want it bulletproof, use the §15 store instead. Recommendation: blob for the hackathon, store
if it bites.

### 9.4 Concurrency reality

One provisioned FROM number serializes outbound calls, so `maxConcurrentCalls` is effectively
**1**. The control room will show 0 or 1 live call; "liveNow: 2" in §7.4 is illustrative, not
reachable on a single number. Keep `maxConcurrentCalls` parameterized for when more numbers
exist, but frame the demo control room as "what is happening right now" (one call, plus recent
and queued), not a wall of simultaneous calls.

### 9.5 The loop (one tick, ~1s)

1. If `stopped` or `runState !== active`: return. If `now > endsAt`: set `completed`, return.
2. If `inFlight.size >= min(maxConcurrentCalls, MAX_CONCURRENT_CALLS)`: return (wait).
3. Pick the next eligible lead. Eligible = `paf_status` in `{OPEN, GHOSTED, VOICEMAIL,
   DISPUTED}`, `DialState` is `idle`, and past `REDIAL_GAP_MS` since its last attempt. Order:
   never-called first, then oldest last-attempt.
   - **standard mode:** a lead that already talked and ended PROMISED/DISPUTED is left alone;
     only no-answer/voicemail/error leads are retried, up to a small retry cap.
   - **relentless mode:** any non-terminal lead is eligible (the no-cap redial), bounded only
     by `RELENTLESS_SOFT_CAP` and the stop conditions (§9.8).
4. If a lead is found: `deploy(lead)` (§9.6). If none found AND nothing in flight: in standard
   mode set `completed`; **in relentless mode, if every lead is terminal
   (PROMISED/SETTLED/WRITTEN_OFF), also set `completed`** (this fixes the v1 hot-spin where a
   fully-promised relentless campaign ticked to endsAt forever).

### 9.6 deploy(lead): the race-safe dial

Order matters to avoid double-dials and post-stop calls:

1. **Synchronously** (no await yet): if `engine.stopped` -> abort. If `DialState[leadId] !==
   idle` -> abort (already reserved/dialing/live). Else set `DialState[leadId] = 'reserved'`.
   This closes the across-await double-dial window for both the tick and the manual
   `POST /api/cases/:id/deploy`.
2. Reset the native gate: `PATCH /leads/:id { status: 'contacted' }` so the outreach gate
   passes (§9.8). Set `paf_status=DEPLOYED` in the same PATCH **before** dialing, so a crash
   between dial and status-write cannot leave the lead dial-eligible.
3. **Re-check `engine.stopped` one last time** (after the awaits above, right before firing).
   If set, revert `DialState` to idle and abort. This is the only thing that makes "no new call
   after stop" true; `clearTimeout` alone does not abort an already-running callback.
4. `POST /leads/test-call { leadId, phoneNumber }`. Extract `callId` from the wrapped response
   (likely `data.callId`; confirm depth via §18). Set `DialState='live'`, add to `inFlight`,
   add to the live registry, start the per-call poller (§9.7), increment the ledger.
5. On any failure: revert `DialState` to idle, log, and (relentless) treat a `not eligible for
   outreach` 400 as a **terminal stop for that lead**, not a transient error (§9.8).

### 9.7 Per-call poller and result classification

For each live call, poll the engine `GET /call/status/{callId}` every `ENGINE_POLL_INTERVAL_MS`:

- `queued|ringing` -> `dialing`; `in-progress` -> `talking`.
- `ended` -> classify immediately from the **engine payload** (`endedReason` + `summary` +
  `transcript`), set `phase=done`, update `paf_status` via §13, write the ledger entry, set
  `ever_completed_call=true`, remove from `inFlight`, clear this poller, and (relentless)
  schedule the next redial after `REDIAL_GAP_MS` (gated by the stop flag, §11).
- Enrich asynchronously: fetch `lead.qualificationSummary` for `admitted_debt` /
  `payment_commitment` to refine PROMISED vs DISPUTED. If staging has not populated it within
  `ANALYZING_TIMEOUT_MS`, keep the engine-derived classification (never get stuck "analyzing").
- transport failure or `endedReason=technical-error` -> `failed`; count toward the
  two-consecutive-error stop condition.

Why engine-first: staging only populates `qualificationSummary`/call_log after the engine's
end-of-call webhook reaches the staging backend and its LLM analysis runs, which can lag. The
engine status already has everything we need to classify and reveal. Staging is the nice-to-have
verdict detail, not the gate.

### 9.8 Relentless mode and the native-status gate (the make-or-break fix)

Relentless redial reuses §9.6. The platform gate is the critical subtlety: dialing requires
native `lead.status` in the allow-list, and the platform flips it to `QUALIFIED_HANDOFF` or
`NOT_INTERESTED_DO_NOT_CONTACT` after a decisive call. So step 2 of every deploy PATCHes the
native status back to `contacted` first.

Stop conditions, in priority order:
1. `engine.stopped` / campaign paused / global emergency stop (§11).
2. `paf_status` becomes PROMISED or SETTLED.
3. A `not eligible for outreach` 400 OR two consecutive `technical-error` results for that lead
   (treat the gate-400 as terminal: it usually means the platform pinned the lead
   do-not-contact, e.g. the debtor asked to stop and the persona de-escalated).
4. `RELENTLESS_SOFT_CAP` reached for that lead (default 50; §16), or past `endsAt`.

GHOSTED/VOICEMAIL stay eligible by design (that is the chaos), which is exactly why the soft
cap defaults ON now: an unanswered number at an 8s gap is ~7 dials/min indefinitely otherwise.
`relentless_count` mirrors to `customFields` for the UI. One effective gap (`REDIAL_GAP_MS`)
governs both the redial delay and the eligibility cooldown, so they cannot disagree.

### 9.9 Restart (default vs hardened)

Default: a backend restart stops campaigns. The live registry empties; the FE shows nothing
live. Acceptable for a 60-minute demo. Do not attempt `GET /campaigns?status=active` (no status
column to filter).

Optional hardening (only if you want resilience): on boot, `GET /campaigns` for PettyAF
campaigns, parse the description blob to find ones whose `endsAt` is in the future and were
active, and resume ticking. Then run a reconciliation pass over leads with `paf_status=DEPLOYED`:
fetch their activities; if a completed call exists, classify and advance; if not, set OPEN after
a grace window so they re-enter eligibility. This needs the §15 store to know which were active
(the blob can hold a `runState`, but a paused campaign and an active one both have a future
endsAt). Defer unless asked.

### 9.10 unhingedLevel wiring (what it actually controls)

`llmTemperature` is baked into each persona agent at provisioning and is **not** settable
per-call via test-call. So `unhingedLevel` maps **only** to the lead's `aggression_level`
customField, which the persona prompt reads (`main.md` §4 shared block). Rule: at lead-create,
if the lead has no explicit `aggressionLevel`, set `aggression_level = campaign.unhingedLevel`;
a per-lead value always wins. Editing a running campaign's `unhingedLevel` affects only leads
created or PATCHed afterward, not the agent temperature and not already-created leads unless we
PATCH them. Document this so nobody expects a slider to change a live agent's voice intensity.

---

## 10. Centralized live-calls control room and "listen in" (requirement 3)

### 10.1 The live-call registry

No platform active-calls endpoint exists, so the backend owns this. Every deploy adds to
`Map<callId, LiveCall>`; every completion removes it. `GET /api/live` returns the current map.
The FE polls every 2s. Instant (pure memory). With one FROM number this is a single-call view
in practice (§9.4).

### 10.2 What "listen in" can and cannot be (confirmed by review)

- **Cannot:** stream live audio and let a human hear the voices. No media stream, no
  monitor/barge anywhere in the engine or platform. The socket.io `/communication` gateway
  emits only call lifecycle events (`call.initiated/connected/ended`,
  `call.recording.ready/transcription.ready`) and no mid-call partial transcript. Verified
  absent in the reference code.
- **Can (MVP):** open a focused live view for that call: collector + debtor + amount, live
  timer, phase (DIALING / ON THE CALL / ANALYZING), a pulsing REC indicator, and the transcript
  once the call ends (usually not before). On completion, play the recording (EXHIBIT A) from
  `recordingUrl`. This is `main.md` §8/§14 and is the realistic "listen in."
- **Could (separate workstream, not a backend tweak):** true live audio needs the backend to
  host a Twilio Media Streams `<Stream>` endpoint, decode mu-law frames, and relay to the
  browser. The platform does not surface the Twilio call to us, so this is out of hackathon
  scope. Flagged so the decision is explicit.

### 10.3 Why no SSE for MVP

`main.md` already drives the entire HUD with 2s/3s polling of plain GET endpoints. SSE adds a
reconnect/heartbeat/fan-out surface for zero demo benefit over that polling. Cut for MVP. If
later wanted: send a full snapshot on connect (so reconnects self-heal), keep a Set of
connections with a 15s `:keepalive`, and fall back to polling on error.

---

## 11. Emergency stop (requirement 4)

`POST /api/live/stop` is the kill switch. Honest, race-safe semantics:

- **Synchronous and guaranteed:** the handler sets `engine.stopped = true` (and per-campaign
  `runState=paused`) **before any await**, then clears every tracked timer (ticks, per-call
  pollers, relentless redial timers) and nulls them. Because `deploy()` re-checks
  `engine.stopped` synchronously right before the actual `test-call` (§9.6 step 3), and every
  relentless redial timer body checks it on entry, **no new call is placed after the button is
  pressed.** (One call already past that final guard, microseconds before, could still go out;
  that window is closed to the synchronous flag, which is the best achievable.)
- **Cannot force-terminate connected calls:** the platform exposes no cancel/hangup API
  (confirmed). Calls already on the line end on their own (persona prompts target under 2
  minutes). The control room shows them "winding down" until their poller reports `ended`.
- **The platform's own scheduler caveat:** creating a lead with an assigned agent may
  auto-schedule outreach on staging's queue, which we do not control. So the precise guarantee
  is "**stops all PettyAF-initiated dialing instantly**; any platform-auto-scheduled activity
  is governed separately by org compliance gates." Verify in the first 10 minutes whether lead
  creation auto-schedules a call (§18.G); if it does, suppress it at create time (org
  block-calls gate) so emergency stop is truly total.

Scope variants: `POST /api/live/stop` (global, the big red button);
`POST /api/live/stop { campaignId }` (one campaign); `POST /api/campaigns/:id/pause` (graceful,
same mechanism). The `main.md` §7.5 per-case relentless toggle-off is a subset and still works.

---

## 12. Dashboard metrics (requirement 1)

Computed by `dashboard.ts`. Primary source: `GET /leads?source=PettyAF&limit=100` (paginate as
needed) gives every case with `customFields` and status for the money/count KPIs. The
**in-memory call ledger** (incremented on every completed call, §9.7) gives exact `callsMade`
and `talkMinutes` without N+1 activity calls.

| KPI | Definition | Source |
|---|---|---|
| `totalOutstanding` | sum `amount` over cases not SETTLED/WRITTEN_OFF | leads aggregate |
| `totalCollected` ("earned from victims") | sum `amount` over **SETTLED** cases | leads aggregate |
| `totalPromised` | sum `amount` over **PROMISED** cases | leads aggregate |
| `callsMade` | count of all attempts (first + retries + relentless) | **ledger** |
| `talkMinutes` | sum `durationSec` / 60 | **ledger** (exact within process life) |
| `activeCases` | OPEN/DEPLOYED/DISPUTED/GHOSTED/VOICEMAIL | leads aggregate |
| `friendshipsAtRisk` | DEPLOYED + DISPUTED | leads aggregate |
| `ledgerOfShame` | grand total of every `amount` | leads aggregate |
| `liveNow` | `liveRegistry.size`, computed fresh (not cached) | memory |
| `successRate` | (PROMISED+SETTLED) / cases with `ever_completed_call=true` | leads aggregate |
| `byPersona` | the above grouped by `persona_key` | leads aggregate |

Two honesty notes from review:
- `callsMade`/`talkMinutes` are exact only within a process lifetime (the ledger is in memory).
  After a restart they reset unless you adopt the §15 store. Acceptable for a single demo run.
- The `successRate` denominator uses `ever_completed_call` (a customField we set on first
  completion) because a bare `OPEN` status is ambiguous (never-called vs reverted from
  technical-error).
- Activities endpoint does NOT return transcript/summary/sentiment/cost (only
  durationSeconds/status/outcome/timestamps/recordingUrl), so `recentCalls` richness and the
  Reveal Card transcript come from the engine poll and `lead.qualificationSummary`, not from
  activities.

Decision flagged: "money earned from victims" = SETTLED total (recovered). If you want the
bigger, funnier PROMISED total instead (committed but not actually collected), it is a one-line
change. Show both is also easy.

We do **not** use `GET /campaigns/:id/analytics` (route not implemented) or
`GET /analytics/dashboard` (real path is `/analytics/dashboard/kpis`, role-gated, throttled).
Own aggregation is authoritative and on-brand.

---

## 13. Status mapping (single source of truth)

Unchanged from `main.md` §7.4, restated for self-containment. The classifier reads
`endedReason` from the **engine status poll** (not from staging; `endedReason` is an engine
field, not a call_logs column) and `admitted_debt`/`payment_commitment` from
`lead.qualificationSummary` when available.

| Signal | paf_status | UI stamp |
|---|---|---|
| created, no call | OPEN | OPEN |
| deploy fired, running | DEPLOYED | COLLECTOR DEPLOYED |
| endedReason voicemail | VOICEMAIL | SENT TO VOICEMAIL |
| customer-did-not-answer / customer-busy | GHOSTED | GHOSTED US |
| ended, admitted + commitment | PROMISED | PROMISED FRIDAY |
| ended, denied | DISPUTED | DISPUTED |
| creditor marks paid | SETTLED | SETTLED |
| creditor writes off | WRITTEN_OFF | WRITTEN OFF |
| technical-error | OPEN (revert) | OPEN |

Reopen transition (new, from review): a "reopen" user action on a PROMISED/SETTLED case sets
`paf_status=OPEN` **and clears that lead's relentless counters** so it is cleanly re-eligible.

---

## 14. Getting results back: engine poll now, webhook later

- **MVP (chosen): poll the engine `/call/status` directly** (§9.7). Classify from the engine
  payload. No public URL needed. Staging `lead.qualificationSummary` enriches when it lands.
- **Upgrade A (optional): our own end-of-call webhook** per doc 04 (ack 200 immediately,
  process async, match echoed `metadata`). Needs the backend publicly reachable (ngrok). Lower
  latency. Not needed for MVP.
- **Upgrade B (optional): socket.io client to staging `/communication`** (JWT handshake, org
  room `org:${orgId}`). It pushes call lifecycle (`call.ended`, `call.transcription.ready`),
  **not** a mid-call transcript. Useful only to lower end-of-call latency; not required.

---

## 15. Persistence decision

**Chosen: stateless, staging holds the durable data, run-state in memory.** Justified because
leads, custom fields, transcripts, recordings, and qualification answers all persist on
staging; the engine loop, live registry, and ledger are ephemeral and (mostly) rebuildable.

**Optional escape hatch (recommended if any of these bite):** a single-file embedded store
(better-sqlite3 or lowdb) with `campaign_settings(campaignId, json)` and
`call_ledger(callId, campaignId, leadId, startedAt, endedAt, outcome, durationSec, cost)`. This
removes the fragile description-blob (§9.3), makes `callsMade`/`talkMinutes` exact across
restarts (§12), and enables clean restart recovery (§9.9). ~30 minutes. Ship stateless for the
hackathon; adopt the store if the blob round-trip or restart resilience becomes a problem.

---

## 16. Safety, compliance, rate limiting

`main.md` §15 and doc 05 §8 are non-negotiable. Backend-enforced:

- **Consent gate:** require `consentConfirmed` (customField) before any deploy; refuse to dial
  without it.
- **Single effective per-debtor gap:** `REDIAL_GAP_MS` governs both redial delay and
  eligibility cooldown (§9.8) so they cannot disagree.
- **Relentless soft cap ON by default** (`RELENTLESS_SOFT_CAP=50`). Review showed
  GHOSTED/VOICEMAIL stay relentlessly eligible, so a never-answering number would otherwise be
  dialed forever. The cap stops and flags instead. Set to 0 for `main.md` §7.5 pure-no-cap if
  you want, but ON is the safer default and still plenty funny on stage.
- **Suppress or scope platform auto-scheduling** so emergency stop is honest (§11, §18.G).
- **Recording disclosure** stays on (provisioning step 9).
- **De-escalation** is in every persona prompt; surface a `negative` sentiment result
  prominently so a human can intervene / mark settled.
- **Secrets server-side only.**

---

## 17. Error handling, logging, timeouts, idempotency

- Staging writes 60s, GET 15s, engine status 10s.
- Normalize errors to `{ error: string }` + status. Defensive parsing on staging (envelope) and
  engine (variable shapes).
- One console line per request (method, path, status, latency).
- The tick and pollers never crash the process: wrap each in try/catch, log, continue.
- Idempotency: `DialState` is reserved synchronously before any await (§9.6 step 1), closing the
  across-await double-dial window for both the tick and the manual deploy route.

---

## 18. Verify-first items (the first 10 minutes; one curl each)

Reordered to lead with the real blockers this review surfaced. **Do not write the engine,
registry, or relentless loop until B/D are green.**

- **A. Campaign create.** `POST /campaigns { name, description, knowledgeBaseId, agentIds }`
  with a real KB id. Confirm 201 and that a `GET /campaigns` returns it. Without `knowledgeBaseId`
  it fails. (BLOCKER)
- **B. Dial + pollable callId.** `POST /leads/test-call { leadId, phoneNumber }` on a lead that
  has native `agentId` set. Capture the EXACT response JSON and the `callId`. Immediately
  `GET ${VOICE_ENGINE_URL}/call/status/{callId}` with `X-API-Key` and confirm it returns
  status/endedReason. If it 404s, find the id the engine accepts (CA-SID vs call-id). (BLOCKER)
- **C. agentId requirement.** Confirm test-call 400s when the lead has no `agentId`, and 200s
  when set to `PERSONA_AGENT_MAP[...]`. (BLOCKER)
- **D. Redial status gate.** Complete one call, then `GET /leads/:id` and read native `status`.
  Fire test-call again: observe the `not eligible for outreach` 400. Then `PATCH /leads/:id
  { status: 'contacted' }` and confirm the redial now 200s. This is whether relentless works
  on stage. (BLOCKER)
- **E. Reinquiry dedup.** `POST /leads` twice with the same phone; confirm the second returns
  the existing lead id. Plan the campaign demo around distinct numbers. (BLOCKER for the
  campaign demo)
- **F. Result population.** After a completed call, does `GET /leads/:id` populate
  `qualificationSummary` (and how fast)? Drives how much we lean on engine-only classification.
- **G. Auto-scheduling.** After `POST /leads` with an agent, does staging place a call on its
  own (watch the phone / activities)? If yes, find the suppression gate so emergency stop is
  total.
- **H. Envelope + list shapes.** Confirm `auth/login` returns `{success,data,message}` and the
  exact list shapes for `GET /campaigns` (items+pagination) and `GET /leads`.
- (programOfInterest is optional, not a blocker; sanity-check only.)

---

## 19. Build order (demo-first, re-scoped after review)

| Phase | Work |
|---|---|
| 0-10 | Scaffold Express+TS. Staging client (login/refresh/unwrap). Run verify-first A-H. Capture the KB id. Smoke test: create a lead WITH `agentId`, fire test-call to a real phone, poll engine status. |
| 10-30 | Prove the `main.md` SINGLE-CASE path end to end: `POST /api/cases` (agentId set), deploy, per-call engine poller, classify from engine, `/result`, PATCH/settle, and relentless WITH the status-reset fix (§9.8). This is the demo spine. |
| 30-45 | Campaign as a thin label: `POST /api/campaigns` (name+desc-blob+KB+agentIds), `POST /api/campaigns/:id/leads`, `GET /api/campaigns` with leadStats rollup. The engine loop reuses the proven deploy code; standard + relentless eligibility; duration window; start/pause. |
| 45-55 | `GET /api/dashboard` aggregation (GET /leads math + ledger). `GET /api/live` snapshot. |
| 55-60 | `POST /api/live/stop` emergency stop (synchronous flag + clear all timers + relentless off). Console logging polish, error paths, second dry-run call. |

Deferred (only if ahead): SSE, our own webhook, socket.io client, per-campaign analytics,
restart recovery, the §15 store.

---

## 20. Decisions for you to redline

Real verify-first blockers come first; they gate a working demo more than any preference:

- **V1. Provision a Knowledge Base** and hand me its id (`STAGING_KNOWLEDGE_BASE_ID`). Campaign
  create fails without it. (§3.1)
- **V2. Confirm the redial status-gate workaround** (PATCH status to `contacted` before each
  dial) is acceptable, or relentless dies after call #1. (§9.8)
- **V3. Campaign demo uses distinct phone numbers** (reinquiry dedup merges same-number cases).
  How many consenting test numbers do we have? (§16)
- **V4. Decide on platform auto-scheduling**: suppress it, or accept the softened emergency-stop
  wording. (§11)

Then the genuine design choices:

1. **"Money earned from victims"** = SETTLED total (my default) or PROMISED (bigger, funnier,
   not actually collected) or both? (§12)
2. **Settings storage:** description-blob (stateless, default) vs the §15 SQLite/lowdb store
   (robust, ~30 min). (§9.3, §15)
3. **Concurrency:** one FROM number means liveNow is 0-1 and the control room is single-call.
   Provision more numbers for a true multi-call view, or keep the single-call framing? (§9.4)
4. **Relentless soft cap:** ON at 50 (my recommendation, given GHOSTED-forever) vs `main.md`
   §7.5 pure no-cap (set 0). (§16)

Already settled by `main.md`, not reopening unless you want to: live-audio listen-in is roadmap
(§10.2), results via polling not webhook (§14), no SSE for MVP (§10.3).
