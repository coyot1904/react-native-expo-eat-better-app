# EatBetter case-study server

A small Express backend that proxies Gemini calls for the mobile app. It exists for three reasons:

1. **Security** — the Gemini API key no longer ships inside the mobile app bundle, where anyone could extract it.
2. **Idempotency/retries** — the same `Idempotency-Key` (the client's `traceId`) short-circuits repeated requests instead of re-calling the LLM, so a client-side timeout retry can't produce duplicate or inconsistent results. See `src/idempotency.js`.
3. **Observability** — structured, stage-tagged logs (`src/logger.js`), viewable live at `GET /debug/logs`, instead of logs trapped on a single phone.

## Endpoints

- `POST /api/extract/text` — body `{ "text": "..." }` → `{ items, languageDetected, modelNotes }`
- `POST /api/extract/photo` — body `{ "imageBase64": "...", "mimeType": "image/jpeg" }` → `{ items, languageDetected, modelNotes, description }`
- `GET /health` — for uptime checks
- `GET /debug/logs?limit=50` — recent structured log events (demo/debug only — see Known limitations)

## Run locally

```
cd server
npm install
cp .env.example .env   # then paste your Gemini key into .env
npm start
```

Server runs on `http://localhost:3000` by default.

To test it against your phone (both on the same Wi-Fi), find your computer's local IP (e.g. `192.168.1.23`) and set the mobile app's `EXPO_PUBLIC_API_BASE_URL` to `http://192.168.1.23:3000` instead of a deployed URL.

## Deploy for free (Render)

1. Push this whole project (mobile app + `server/`) to a GitHub repo.
2. On [render.com](https://render.com), **New +** → **Web Service** → connect the repo.
3. Set **Root Directory** to `server`.
4. Build command: `npm install`. Start command: `npm start`.
5. Add an environment variable: `GEMINI_API_KEY` = your key. (`PORT` is set automatically by Render — no need to add it.)
6. Deploy. You'll get a URL like `https://your-service.onrender.com`.
7. Set the mobile app's `EXPO_PUBLIC_API_BASE_URL` to that URL and rebuild.

**Free-tier caveat, worth mentioning in the write-up:** Render's free web services spin down after inactivity, so the first request after a while can take 30–60s (cold start). For a demo/case-study this is a fine, honest trade-off to name explicitly — it's a good answer to "what breaks at scale?" (fix: paid always-on instance, or a scheduled ping to keep it warm).

## Known limitations (intentional, for a 7-day case study)

- **In-memory logging and idempotency store** — both reset on every restart/cold-start. Fine for a demo; production would use Redis (idempotency) and a real log sink like Better Stack or Datadog (observability).
- **No auth/rate limiting** — anyone with the URL can call these endpoints. For a real launch, add an API key or session check between the mobile app and this server, plus per-IP rate limiting to control Gemini cost.
- **`/debug/logs` is open** — convenient for demoing, but would need to be removed or protected before this touched real user data.
