# Deploy: frontend on Vercel, backend local

## STATUS (2026-06-05): LIVE

- Vercel project: **`pettyaf-web`** (scope behbod-babais-projects).
- Production URL: `https://pettyaf-h0171jok1-behbod-babais-projects.vercel.app` (new immutable URL each deploy; the project's stable domain shows in the dashboard).
- Login gate: `behbod.babai.aic@gmail.com` / `***REDACTED***`. Mock mode (no backend) on the public link.
- REQUIRED once in the dashboard: Project → Settings → Deployment Protection → set Vercel Authentication to **Disabled**, or the site returns 401 to the public.

### How it was deployed (and how to redeploy)

The Vercel CLI auto-detects this monorepo and keeps injecting a `backend` service into
`vercel.json`, which breaks the build ("backend stays local"). The reliable workaround is to
deploy the **prebuilt static output from a temp dir outside the repo**:

```bash
cd frontend && npm run build
D="$TEMP/pettyaf-web"; rm -rf "$D"; mkdir -p "$D"; cp -r frontend/dist/. "$D/"
cd "$D" && npx vercel link --yes --project pettyaf-web && npx vercel --prod --yes
```

(Old broken projects `pettyaf` and `pettyaf-collections` have framework "services" and can be
deleted in the dashboard.) The committed `vercel.json` + `.vercelignore` (which excludes
`backend`) are kept for a future dashboard import; they are not used by the static CLI deploy.

---


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
