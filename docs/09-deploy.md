# Deploy: frontend on Vercel, backend local

Chosen setup: the React frontend is hosted free on Vercel; the Express backend runs on the
demo laptop. The deployed page can reach `http://localhost:4000` because browsers exempt
localhost from mixed-content blocking, so an HTTPS Vercel page may call a local HTTP backend
on the same machine.

## Security posture (audited 2026-06-05)

- No secrets are committed. `.env` is gitignored; all `.env.example` files are empty placeholders.
- No secret ever ships to the browser. Every Alebex call (staging JWT, voice engine key,
  webhook key) happens server-side in the backend. The frontend only knows a public backend URL.
- The backend has a hard rail: `DIALING_ENABLED` must be `true` or no real call is placed.
- Do not expose the backend publicly. Run it locally for the demo.

## A. Deploy the frontend to Vercel (free)

1. Go to vercel.com, New Project, import `behi22/PettyAF`.
2. Leave defaults. `vercel.json` at the repo root already builds `frontend/` and outputs
   `frontend/dist` (no dashboard config needed).
3. Set environment variables (Project, Settings, Environment Variables):
   - For a shareable, always-works demo link (recommended default): set nothing, or
     `VITE_USE_MOCK` unset. The site runs the in-browser mock (fake calls, no backend).
   - For real calls from the deployed link during a laptop demo:
     - `VITE_USE_MOCK = false`
     - `VITE_API_URL = http://localhost:4000`
     (the deployed page will then only function on a machine running the backend on :4000).
4. Deploy. You get a `https://<project>.vercel.app` link.

Tip: keep the public Vercel link in mock mode (safe, always works for judges) and do the real
live calls from the laptop, see section B.

## B. Run the backend locally for real calls

```
cd backend
npm install
# create backend/.env from backend/.env.example and fill real values (never commit it):
#   STAGING_EMAIL, STAGING_PASSWORD, STAGING_API_URL
#   STAGING_ORGANIZATION_ID, STAGING_KNOWLEDGE_BASE_ID
#   PERSONA_AGENT_MAP={"child":"...","medieval":"...","angry":"..."}
#   VOICE_ENGINE_URL=https://dev.voice.alebex.ai
#   VOICE_ENGINE_API_KEY=...
#   DIALING_ENABLED=true            # REQUIRED to place real calls
#   CORS_ORIGIN=http://localhost:5173,https://<your-project>.vercel.app
npm run start   # or: npm run dev
```

CORS now accepts a comma-separated list, so both the local dev origin and the Vercel origin
pass. `GET http://localhost:4000/api/health` should return `{ ok: true, dialingEnabled: true }`.

## C. Two ways to demo

| Mode | Frontend | Backend | Real calls |
|---|---|---|---|
| Public link | Vercel, mock | none | no (simulated) |
| Live, from laptop | Vercel (VITE_USE_MOCK=false, VITE_API_URL=http://localhost:4000) OR local `npm run dev` | local, DIALING_ENABLED=true | yes |

Simplest fully-local live demo (no Vercel needed for real calls): run `npm run dev` in
`frontend/` and `npm run start` in `backend/`; the Vite dev proxy already forwards `/api`
to `:4000`.
