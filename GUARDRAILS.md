# JobScan AI — Production Guardrails

## Phase 1: Failures Observed

### Failure 1 — Unlimited Input Length
Observed: POST /api/analyze with a 5000-character body returned HTTP 200 and a full AI analysis. The AI service was called — an [AI_USAGE] log line appeared in the terminal showing prompt_tokens well above normal. No rejection occurred. Any user could drive up token costs arbitrarily.
AI service called: YES — [AI_USAGE] token log appeared in terminal.

### Failure 2 — Indefinite Hang
Observed: After adding `await new Promise(resolve => setTimeout(resolve, 60000))` before the fetch call, hitting the endpoint caused the HTTP connection to hang with no response for the full 60 seconds. The server held the connection open the entire time. During that window, additional requests would also queue up, and with enough concurrent users the event loop would be saturated.
Duration: 60 seconds before HTTP client timeout or manual cancellation. No server-side timeout fired.

### Failure 3 — Server Crash on LLM Error
Observed: After setting `OPENROUTER_API_KEY=invalid_key_that_will_cause_401`, restarting the server, and hitting POST /api/analyze, the OpenRouter API returned a 401 error object instead of a completion. Because the code executed `data.choices[0].message.content` with no try/catch, and `data.choices` was undefined, Node.js threw:
```
TypeError: Cannot read properties of undefined (reading '0')
    at analyzeJobDescription (aiService.js:59:26)
```
The process exited with code 1. A subsequent `curl http://localhost:3000/health` returned "Connection refused" — the server was completely down.
Server state after crash: Down. No endpoints responded. Required a manual restart.

---

## Guardrail 1 — Input Length Validation

**What was added:** Input length check in `analyzeController.js` added before any call to `aiService`. Two checks run in sequence: (1) if `!text || text.trim().length === 0`, return `400 { error: 'input_required', message: '...' }`; (2) if `text.length > 3000`, return `400 { error: 'input_too_long', limit: 3000, received: N }`. The AI service is never reached when either check fails — no [AI_USAGE] log line appears.

**What it protects against:** Unbounded LLM costs from users pasting arbitrarily large inputs. A 50,000-character job description consumes approximately 12,500 tokens per call — 40× the cost of a normal request. Without a length limit, a malicious or careless user can trigger thousands of expensive LLM calls before any billing alert fires.

**Production incident it prevents:** A user script that pastes entire recruitment portal dumps (50+ pages) into the analyser, triggering thousands of high-token LLM calls and running up a $600+ monthly bill instead of the expected $15.

---

## Guardrail 2 — Request Timeout

**What was added:** `AbortController` instantiated before the fetch call in `aiService.js`. `setTimeout(() => controller.abort(), 15000)` fires the abort signal after 15 seconds. The `signal: controller.signal` option is passed to `fetch`. `clearTimeout(timeoutId)` is called in **both** the success path (after `response.json()` resolves) and the catch block. On `AbortError`, the catch logs `[AI_TIMEOUT]` with timestamp, userId, and timeoutMs, then returns `{ success: false, fallback: true, message: 'Analysis unavailable. Please try again shortly.' }`.

**What it protects against:** LLM provider slow responses holding Node.js connections open indefinitely. During provider cold-starts, rate-limit queuing, or internal slowdowns, response times can exceed 60 seconds. Without a timeout, 10 concurrent users triggering AI calls can saturate the server's connection pool, making the server unresponsive to all other traffic.

**Production incident it prevents:** A 2 AM provider slowdown where 10 concurrent hanging AI requests saturated the server's connection pool, made the server unresponsive to all traffic, and required an emergency on-call restart to resolve.

---

## Guardrail 3 — LLM Failure Handling

**What was added:** A `try/catch` block wraps the entire fetch call and all response processing in `aiService.js`. Every failure mode — `AbortError` (timeout), network errors, HTTP 5xx/4xx from the provider, missing `data.choices`, malformed JSON from `response.json()`, and invalid API key (401) — is caught. Non-abort errors log `[AI_ERROR]` with timestamp, userId, and error message, then return `{ success: false, fallback: true, message: '...' }`. In `analyzeController.js`, the controller checks `if (result?.fallback === true)` and returns HTTP 503 with the fallback object. The server never throws an unhandled exception and never crashes.

**What it protects against:** Uncaught exceptions from any LLM provider failure (outages, quota exceeded, malformed responses, invalid API key) that would otherwise crash the Node.js process. Without this guard, a single bad LLM response turns a 4-second provider outage into a multi-hour server outage requiring manual intervention.

**Production incident it prevents:** The Friday night crash where an OpenRouter outage caused `data.choices` to be `undefined`, threw an unhandled `TypeError`, exited the Node.js process with code 1, and took the server completely offline for 4 hours until the on-call engineer woke up and restarted it manually.
