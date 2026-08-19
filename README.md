# EatBetter Meal Logger — Case Study Submission

**Author:** Keyvan Mozaffari
**Focus:** Meal Logging Accuracy (AI)
**Stack:** React Native (Expo, TypeScript), Google Gemini API (free tier), local-first storage (AsyncStorage)

**Note on model choice:** this build uses Gemini 2.5 Flash rather than Claude, purely to
avoid a paid API signup for a take-home case study (Gemini's free tier requires no credit
card). The extraction/matching architecture is model-agnostic — the LLM call is isolated to
one function (`callLLMOnce` in `src/services/llmExtract.ts`), so swapping providers is a
localized change, not a redesign.

## Screenshots

| Log a meal                                            | History                                                                   | Results & confidence                               |
| ----------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------- |
| ![Log a meal screen](https://i.imgur.com/fzf4eJH.png) | ![Results screen with confidence badges](https://i.imgur.com/1EdMGYx.png) | ![History screen](https://i.imgur.com/f6FzgJP.png) |

## What this is

An end-to-end mobile meal-logging flow: the user types a free-text description of what
they ate (Turkish, English, or mixed), and the app converts it into canonical foods,
estimated portions, and nutrition — with visible confidence and a human-in-the-loop
correction step for anything uncertain.

```
Free text  →  LLM extraction  →  Canonical food matching  →  Portion + nutrition calc  →  User review/save
(messy)       (structure only)    (deterministic, no LLM)     (deterministic)              (human-in-the-loop)
```

## Why this architecture (the core accuracy decision)

The main risk in "LLM parses food and tells you calories" is **hallucination**: the model
is fluent enough to confidently state a plausible-sounding but wrong number. So the design
splits the problem into two very different kinds of work and never lets the LLM do both:

1. **The LLM only extracts structure.** It's prompted to output food mentions, quantities,
   and units as JSON — explicitly forbidden from inventing calories or macros
   (`src/services/llmExtract.ts`, see `SYSTEM_PROMPT`). If it's unsure about a food, it still
   extracts it with a note, instead of silently dropping it or guessing a number.
2. **A deterministic matcher owns nutrition.** `src/services/matcher.ts` fuzzy-matches the
   LLM's guess against a canonical food database (alias-based + edit-distance + token-overlap
   scoring) and pulls nutrition from that database — never from the LLM. This is what
   actually prevents hallucinated numbers: the LLM never touches the number that ends up on
   screen.

This is the **hybrid approach** (rules/retrieval + LLM) from the case study options. I chose
it over a pure prompt/LLM flow because it makes the failure mode debuggable and boundable —
a wrong nutrition number can only come from a wrong _match_, which is a much smaller, testable
surface than "the LLM's arithmetic/knowledge might be off."

## Confidence & human-in-the-loop

Every match gets a score in `[0,1]` and a band:

- **High (≥0.8):** shown directly, no friction.
- **Medium (0.55–0.79) / Low (<0.55):** flagged in the UI with a "not right?" prompt that
  shows the top alternative candidates, so correcting is one tap, not free text. Below the
  medium threshold, we don't even assign a match — we'd rather show "unmatched" than a
  guess dressed up as a fact.
- A user correction is treated as ground truth (`ResultsScreen.tsx: recalc()`), logged with
  a `user_correction` event, and — in a production system — would feed back into eval set
  growth and matcher tuning (see "Next steps").

## How I evaluate accuracy

`eval/runEval.ts` + `eval/testCases.json` — 10 hand-labeled test cases / 18 food items
covering: Turkish dishes, English dishes, mixed compound sentences, quantity/unit parsing,
and two **deliberately unmatched** cases (foods not in the demo DB) to test that the system
says "I don't know" instead of hallucinating a match.

Run it:

```bash
npm run eval
```

Current result on the demo DB:

```
Top-1 accuracy: 88.9% (16/18)
Error taxonomy:
  low_confidence_correct_flagged: 1   (right answer, but under-confident — cheeseburger→hamburger, 58% score)
  missed_match: 2                     (pepperoni pizza, spaghetti bolognese — DB has no matching entry)
```

**Why the eval runs against the matcher offline, not the live LLM on every run:** LLM output
can drift between calls and model versions, so it's not a stable regression signal. The
matcher is deterministic and versioned, so it's what CI should gate on. A smaller _live_ eval
(hitting the real API on a sampled subset) is the right complement to catch extraction-stage
drift — noted in `eval/runEval.ts` but not implemented here given the time box.

**Error taxonomy** (the categories the harness classifies every mismatch into):

- `wrong_match` — matched to a different, incorrect food
- `false_positive` — matched to something when the correct answer was "no match"
- `missed_match` — correct food exists in DB but score fell below threshold
- `low_confidence_correct_flagged` — right answer, but confidence too conservative

Separating these matters because they point to different fixes: `wrong_match` means tune
scoring weights or add disambiguation; `missed_match` means grow DB coverage or lower
thresholds; `low_confidence_correct_flagged` means thresholds are too strict, costing user
trust/friction for no accuracy gain.

## Testing

`eval/runEval.ts` above measures matching _accuracy_. Separately, `src/services/__tests__/`
has unit tests for _correctness of the logic itself_ — these two are complementary, not
duplicates: eval can hide a bug (wrong grams still "matches" the right food), and unit tests
can't tell you if the matcher is well-tuned against real inputs (correct code can still score
things badly). Both matter for the "accuracy mindset" this case study asks about.

Run them:

```bash
npm test
```

- **`matcher.test.ts`** — exact/alias matches land at high confidence; a typo still resolves
  to the right food; unrelated input correctly returns no match (not a wrong guess) at low
  confidence; gram/nutrition math is checked against known values; the conservative
  mismatched-unit fallback (see `resolveGrams` comment above) doesn't silently invent a
  conversion.
- **`pipeline.test.ts`** — mocks the LLM call so the deterministic part (matching + nutrition
  summation) is tested without network flakiness; checks that unmatched items stay visible
  with `null` nutrition instead of being dropped or defaulting to `0`/`NaN`; checks that a
  photo-sourced entry carries `imageUri`/`aiDescription` correctly; checks that extraction
  errors propagate instead of silently returning an empty "successful" entry.

**What's not covered yet:** the LLM-calling code path itself (`llmExtract.ts`,
`visionExtract.ts`, and the server's mirrored versions) — these are mocked out in
`pipeline.test.ts` rather than tested directly. Testing them would mean either recording/replaying
real API responses (fixtures) or spinning up a local mock server; noted as a next step rather
than done here given the time box.

## Reliability

- **Idempotent LLM calls:** extraction is a pure function of input text — same input, same
  request, safe to retry. Retries (`MAX_RETRIES = 2`, exponential backoff) trigger on
  network/timeout/parse errors, but a well-formed empty result is treated as valid, not retried.
- **Server-side idempotency:** the client sends its `traceId` as an `Idempotency-Key` header;
  the backend (`server/src/idempotency.js`) caches in-flight/recent results by that key, so a
  client-side timeout that retries a request the server actually already completed returns the
  cached result instead of calling Gemini (and potentially the matcher) twice.
- **Idempotent saves:** `storage.ts` saves by `id` (the pipeline's `traceId`), so a retried
  save overwrites in place instead of duplicating a meal log.
- **Schema validation:** LLM output is JSON-parsed and shape-validated (`validateShape`) on
  _both_ the server and the client — a malformed response fails loudly instead of silently
  propagating `undefined` into a nutrition calculation.

## Observability

Both sides log with a shared `traceId` per pipeline run, so one meal-log request — text or
photo — can be reconstructed end-to-end, which is exactly what you need to answer "why did this
specific log come out wrong."

- `src/services/logger.ts` (client): per-stage events (`llm_extract`, `vision_extract`,
  `match`, `nutrition_calc`, `user_correction`, `error`).
- `server/src/logger.js` (backend): mirrors the same shape server-side, viewable live at
  `GET /debug/logs` — useful for demoing the pipeline without needing a phone in hand.

Both are in-memory ring buffers for this demo. In production these would ship to a real sink
(Sentry/Datadog/Supabase logs table), and `user_correction` events specifically would be the
seed data for growing the eval set from real usage.

## What I built vs. didn't (time-boxed scope)

**Built:**

- Full text → extraction → match → confidence → review/correct → save flow, working in Expo
- **Photo input**: camera capture → vision extraction (same JSON-schema contract as text,
  feeding the _same_ matcher) → same review/correct/save flow. Confirms the matching/confidence
  architecture generalizes across input modalities without changes.
- **Backend proxy for the LLM call** (`server/`): a small Express service holds the Gemini
  key server-side, adds request idempotency (same `traceId`/`Idempotency-Key` across a client
  retry returns the cached result instead of re-billing the LLM), and structured per-stage
  logging exposed at `GET /debug/logs`. Deployed free on Render.
- Canonical food DB (20 items, Turkish + English aliases) — a stand-in for USDA FoodData
  Central + local-dish data in production
- Deterministic matcher with confidence bands and disambiguation UI
- Offline eval harness with error taxonomy
- History screen with local persistence

**Didn't build (given the 7-day/demo scope), with the plan for each:**

- **Real food DB / embeddings.** Demo uses 20 hand-written entries with string-similarity
  matching. Production plan: USDA FoodData Central (~400k entries) + `pgvector` in Supabase
  for embedding-based semantic search, since string similarity won't scale past a small DB
  (see "what breaks at scale").
- **Auth/rate limiting on the backend.** The proxy solves the key-exposure problem but doesn't
  yet gate _who_ can call it or how often — currently anyone with the URL can hit it. Real
  build: per-user API key or session token, plus per-user request quotas.
- **Persistent idempotency/log store.** Both currently live in-memory on the server, so they
  reset on restart (Render free tier cold-starts after inactivity). Real build: Redis for
  idempotency, a real log sink (Sentry/Datadog/Supabase logs table) for observability.
- **Fine-tuning.** Not attempted — with rules+retrieval handling the hard-precision part
  (nutrition), the ROI of fine-tuning the extraction step is lower until there's real usage
  data showing systematic extraction errors the prompt can't fix.

## Answers to the interview questions

**Biggest trade-off:** Accuracy over latency/simplicity — the two-stage hybrid (LLM +
deterministic matcher) is slower and more code than a single LLM call that returns
calories directly, but it's the only way to make wrong answers _boundable and debuggable_
rather than a black box. I'd make this trade again; a meal-logging app that confidently
lies about calories is worse than one that sometimes says "I'm not sure."

**Top 3 accuracy improvements, in order:**

1. Replace string-similarity matching with embedding-based retrieval (pgvector) + a real
   food DB — the current matcher's ceiling is the small hand-written DB and simple scoring.
2. Turn user corrections into a growing, versioned eval set — right now eval is static and
   hand-labeled; real accuracy work needs it fed by production disagreements.
3. Portion estimation from photos (depth/reference-object cues) instead of defaulting to
   "one standard serving" when quantity is unstated — that default is the single biggest
   source of nutrition error in the current design.

**What breaks at scale:**

- The matcher is O(DB size) per item with no indexing — fine at 20 entries, needs a vector
  index (or at minimum a proper search index) at 400k+.
- The backend has no shared rate limiting or caching yet; at scale it needs to batch/cache
  repeated queries (e.g. "rice" gets looked up constantly) and apply per-user quotas.
- In-memory idempotency and logging on the server don't survive restarts or scale across
  multiple instances — needs Redis + a real telemetry pipeline.

**Biggest security/privacy risks:**

- ~~API key exposed in a client-direct LLM call~~ — fixed: the key now lives only in the
  backend's environment (`server/.env`), never shipped in the app bundle.
- The backend itself has no auth yet — anyone with the URL can call it and consume API quota.
  Needs a per-user token before this could go further than a demo.
- Meal/food data is sensitive (can reveal health conditions, religious/dietary practices,
  disordered eating patterns) — needs explicit data retention limits and care about what
  gets logged verbatim (raw user text, photos) vs. what gets aggregated, especially now that
  `/debug/logs` exists — it's open for demo convenience but would need to be removed or
  protected before touching real user data.
- Local storage (AsyncStorage) is unencrypted on-device; a production build should use
  encrypted storage for meal history.

## Running it

```bash
npm install
npx expo install --fix   # aligns versions if you're on a different SDK than the template
```

This app calls its own backend for LLM/vision calls (key is never in the app). Either run the
backend locally or point at a deployed instance — see `server/README.md` for both.

```bash
# Local backend:
cd server && npm install && cp .env.example .env  # paste your Gemini key into .env
npm start   # runs on http://localhost:3000
```

Back in the project root:

```bash
echo "EXPO_PUBLIC_API_BASE_URL=http://<your-computer's-LAN-IP>:3000" > .env
npx expo start
```

(Use your deployed Render URL instead of a LAN IP if you deployed the backend — see
`server/README.md`.)

Scan the QR code with Expo Go, or press `i`/`a` for a simulator.

Run the accuracy eval (no API key needed):

```bash
npm run eval
```

## AI tools used

Built with Claude (Anthropic) as a pair-programming/architecture partner for the pipeline
design, matcher scoring logic, and this write-up. All code reviewed and structured to reflect
my own architectural decisions (hybrid over pure-LLM, deterministic nutrition ownership,
trace-based observability) rather than generated wholesale. The app itself calls Google's
Gemini API at runtime (see "Note on model choice" above) — Claude was the design/build
partner, Gemini is the in-app extraction model for this free-tier demo build.
