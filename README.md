# PettyAF

**The pettiest collections agency on earth.** PettyAF is a parody debt-collection app: you open a case against a friend who owes you a trivial amount (the unpaid half of a burrito, $7 for tacos, gas money), pick an AI collector persona, and the agent actually **phones them** and theatrically demands payment. Deadly-serious fintech UI, completely absurd subject matter.

> Built at a hackathon. The UI never winks. The collectors do.

## The collectors

| Persona | Who they are |
|---|---|
| **Kaevon Venmo Vulture** | A six-year-old "professional." Needy, whiny, blows raspberries at excuses, threatens to tell your mom. |
| **Justin Time to Collect** | An insult comic with a collections badge. Loud, exasperated, personally offended by the debt. |
| **Sir Rob, "Don't Make Me Rob You"** | A medieval knight. Impossibly polite, impossibly archaic, impossible to understand. |

## How it works

PettyAF rides on the **Alebex** voice platform. The backend is a thin orchestrator: a case is a lead, each persona is a stored voice agent, the debt details flow into the call, and the agent calls the debtor and reports back a transcript, an outcome stamp, the excuse they gave, and a recorded confession.

```
React frontend (Vite)            PettyAF backend (Express + TS)            Alebex platform
  - Dashboard                ->    - case + campaign orchestration   ->     - AI voice agents
  - New Case wizard                - live-call registry                     - real outbound calls
  - Live Calls control room        - emergency stop                         - transcript + outcome
  - Archive / case files           - dashboard aggregation
```

Signature features: a live call control room with a transcript feed and a big **EMERGENCY STOP**, **Relentless Mode** (redials until they pay), an Excuse Tracker, a Cooperation Meter, and a Ledger of Shame.

## Repository layout

```
frontend/    React + Vite UI (plain CSS, no UI framework)
backend/     Express + TypeScript orchestrator over the Alebex platform
docs/        The knowledge base, the deploy guide and the collector prompts
             knowledge base, deploy guide, and the collector prompts
```

See [`docs/`](./docs) for the knowledge base, the deploy guide and each collector's system prompt.

## Running locally

**Frontend (mock mode, no backend needed):**

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
```

The UI runs fully against an in-browser mock by default, so you can click through the whole app with simulated calls and transcripts. Set the login gate first (see Configuration below).

**With the real backend:**

```bash
cd backend
npm install
cp .env.example .env   # fill in your own values
npm run start
```

Then run the frontend with `VITE_USE_MOCK=false` so it talks to the backend on `:4000`.

## Configuration

All secrets live in `.env` files, which are gitignored. Copy each `.env.example` and fill in your own values. **Never commit a real `.env`.** The frontend ships no secrets to the browser; every platform call happens server-side in the backend.

The app is gated by a simple login screen. Its credentials come only from environment variables (`VITE_GATE_USER` and a SHA-256 `VITE_GATE_PASS_HASH`); set both in `frontend/.env` to get past it. `frontend/.env.example` shows how to make the hash.

## A note on consent

These are real phone calls. PettyAF is only for calling friends who are in on the joke. The collector personas keep one hard rule: no slurs or hateful content, no genuinely credible threats, and they back off immediately if the person is actually distressed or asks to stop.
