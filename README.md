# UmbeliTools

Centralized reusable toolbox service for the Umbeli SaaS ecosystem. Plug-and-play integrations that any app can call via a simple REST API.

## Place dans la suite Umbelium

UmbeliTools est le service d'outils partagé de la suite Umbelium : les apps SaaS l'appellent via REST en présentant le header `x-service-key` (valeur de `UMBELIUM_SERVICE_KEY`). Le service écoute sur le port **3002**.

Règle d'or : les apps consommatrices appellent UmbeliTools **côté serveur uniquement** — la clé de service ne doit jamais se retrouver dans un bundle frontend. Pour éviter le boilerplate `fetch`, utilisez le SDK typé [`@umbeli-com/tools`](./client) publié sur GitHub Packages (voir [Calling from Any Umbeli App](#calling-from-any-umbeli-app)).

## Quick Start

```bash
cp .env.example .env   # Set UMBELIUM_SERVICE_KEY
npm install
npm run dev            # http://localhost:3002
```

## API

All tool endpoints require the `x-service-key` header.

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Health check (no auth) |
| `GET /api/tools` | List all tools, actions, and input schemas |
| **Email** | |
| `POST /api/tools/email/send` | Send one or more emails via Mailjet |
| `POST /api/tools/email/smtp-send` | Send an email via any SMTP server (Outlook SMTP, Gmail SMTP, infomaniak, Mailgun, custom, etc.) |
| `POST /api/tools/email/send-template` | Render a branded Umbelium template (table-based HTML + text/plain alternative) and send it through Mailjet or SMTP. Transport is inferred from the credentials shape. With EMAIL_CAPTURE=1 the message is recorded instead of sent and returned in `rendered`. |
| `POST /api/tools/email/render-template` | Render a branded template and RETURN { subject, preheader, html, text } without sending — for previews, snapshot tests and Supabase auth hooks that deliver the mail themselves. |
| `POST /api/tools/email/capture-log` | Test hook: read back what EMAIL_CAPTURE recorded (most recent first) instead of sending. Returns { enabled: false, emails: [] } when EMAIL_CAPTURE is off. |
| **AI** | |
| `POST /api/tools/ai/complete` | Generate a completion from any supported provider. Accepts text and image content blocks, and an ordered credentials.providers[] failover chain (transport / 408 / 429 / 5xx only — never a 400). meta.provider reports who answered. |
| `POST /api/tools/ai/web-research` | Real-time web-grounded AI research via OpenAI Responses API + web_search tool |
| `POST /api/tools/ai/generate-json` | Structured JSON via provider-native JSON mode (OpenAI response_format json_object, Anthropic forced tool-use, Gemini responseMimeType). Returns { data, raw, usage, provider, mode }. |
| `POST /api/tools/ai/embed` | Vector embeddings via OpenAI /v1/embeddings. Whitespace-normalises and truncates each input, batches transparently, and returns index-aligned vectors plus usage. |
| **Social** | |
| `POST /api/tools/social/meta/send-dm` | Send a DM on Instagram via the Graph API |
| `POST /api/tools/social/meta/reply-comment` | Reply to an Instagram comment |
| `POST /api/tools/social/meta/get-accounts` | List connected Facebook pages and Instagram business accounts |
| `POST /api/tools/social/meta/publish` | Create and publish a media post on Instagram |
| `POST /api/tools/social/meta/list-conversations` | List Instagram or Messenger conversations for an account |
| `POST /api/tools/social/meta/list-messages` | List messages in a conversation |
| **SMS** | |
| `POST /api/tools/sms/send` | Send an SMS or WhatsApp message |
| **Webhook** | |
| `POST /api/tools/webhook/dispatch` | Send an HTTP request to a webhook URL |
| `POST /api/tools/webhook/verify-signature` | Verify an inbound webhook signature (standard-webhooks/svix, github, tiktok, twilio, stripe-style). Every comparison is crypto.timingSafeEqual (length-checked first) and every timestamped scheme enforces a replay window that defaults to 300s and cannot be turned off. Returns HTTP 200 with { valid, scheme, reason } even when the signature is bad — 4xx means the call to this endpoint was malformed. RAW BODY REQUIRED: MUST be the EXACT bytes of the inbound request body. express.json() DESTROYS them: re-serialising the parsed object changes key order, spacing and unicode escaping, so the HMAC never matches and you get valid:false forever with a perfectly good secret. Capture the buffer BEFORE any body parser — app.post(path, express.raw({ type: "application/json" }), handler) and use req.body, or app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf } })) and use req.rawBody — then send buf.toString("utf8") here (or buf.toString("base64") with rawBodyEncoding:"base64"). |
| **Gmail** | |
| `POST /api/tools/gmail/list-messages` | List Gmail messages matching a query (e.g. "is:unread", "from:user@example.com") |
| `POST /api/tools/gmail/get-message` | Get the full contents of a Gmail message |
| `POST /api/tools/gmail/send-message` | Send an email via Gmail |
| `POST /api/tools/gmail/modify-message` | Add or remove labels on a Gmail message (e.g. mark as read by removing UNREAD) |
| **Outlook** | |
| `POST /api/tools/outlook/list-messages` | List Outlook messages with optional OData $filter or $search |
| `POST /api/tools/outlook/get-message` | Get the full contents of an Outlook message |
| `POST /api/tools/outlook/send-message` | Send an email via Outlook |
| `POST /api/tools/outlook/send-as-app` | Send email via Microsoft Graph using client_credentials flow (server-to-server, app permissions, no user session). Requires Mail.Send application permission with admin consent in Entra ID. |
| `POST /api/tools/outlook/mark-read` | Mark an Outlook message as read or unread |
| **Inbox** | |
| `POST /api/tools/inbox/log-inquiry` | POST a new inquiry (Instagram DM or email) to a BusinessInbox endpoint |
| `POST /api/tools/inbox/get-stats` | Fetch inquiry stats from a BusinessInbox endpoint |
| **Scrape** | |
| `POST /api/tools/scrape/fetch-markdown` | Fetch a URL as clean markdown. Two attempts: jina.ai reader, then a direct guarded fetch converted to text; a payload under ~40 normalised chars counts as a failure. |
| `POST /api/tools/scrape/fetch-html` | Fetch a URL directly and return raw HTML (SSRF-guarded, size-capped, redirects re-checked). |
| `POST /api/tools/scrape/extract-text` | HTML → plain text: strips script/style/noscript, decodes entities, collapses whitespace. Pass html, or a url to fetch first. Also returns title and meta description. |
| `POST /api/tools/scrape/render-html` | Headless-Chromium fallback for client-rendered pages. Fetches statically first and only renders when the page looks like an SPA shell (or force:true); returns a script-free snapshot. Answers 503 CONFIG_ERROR when Chromium is not installed in the image. |
| **Search** | |
| `POST /api/tools/search/google` | Run a Google search via the Serper API and return structured results |
| **DNS** | |
| `POST /api/tools/dns/create-zone` | Create a Cloudflare DNS zone |
| `POST /api/tools/dns/get-zone` | Get a Cloudflare zone by domain |
| `POST /api/tools/dns/delete-zone` | Delete a Cloudflare zone |
| `POST /api/tools/dns/list-records` | List DNS records in a zone |
| `POST /api/tools/dns/add-record` | Add a DNS record |
| `POST /api/tools/dns/update-record` | Update an existing DNS record |
| `POST /api/tools/dns/delete-record` | Delete a DNS record |
| **Domain** | |
| `POST /api/tools/domain/check-availability` | Check whether a domain is available for registration |
| `POST /api/tools/domain/suggest` | Get domain name suggestions for a query string |
| `POST /api/tools/domain/purchase` | Register/purchase a domain via Gandi |
| `POST /api/tools/domain/set-nameservers` | Update nameservers for an owned domain |
| **Anonymium (privacy proxy)** | |
| `POST /api/tools/anonymium/anonymize` | Detect and replace PII in text with placeholders — returns anonymized text + mapping + detections |
| `POST /api/tools/anonymium/anonymize-many` | Anonymize several texts against ONE shared mapping, so the same value gets the same placeholder everywhere. Output is positionally aligned with the input: anonymizedTexts[i] is always texts[i]. |
| `POST /api/tools/anonymium/deanonymize` | Restore placeholders back to their original values using a mapping |
| `POST /api/tools/anonymium/ai-complete` | Round-trip privacy proxy: anonymize messages → call AI provider → restore placeholders in response. Returns the deanonymized AI content plus the anonymized payload that was sent so callers can audit what crossed the boundary. |
| **Storage** | |
| `POST /api/tools/storage/upload` | Upload a file. Send JSON with "fileBase64" (raw base64 or a data: URL), or POST the same fields as multipart/form-data with the file in any file part. The stored content type comes from the extension allowlist, not from what the browser claimed (browsers send application/octet-stream for .heic, image/jpg for .jpg, application/vnd.ms-excel for .csv…). Size cap: maxSizeBytes, default 26214400 bytes, hard max 524288000. Pass requirePrefix (the tenant id) whenever key or prefix comes from an end user — with upsert on, a free-form key overwrites any object in the bucket. Errors: 400 INVALID_FIELD (bad base64 / extension / key), 403 FORBIDDEN_KEY, 413 FILE_TOO_LARGE, 502 PROVIDER_ERROR. NOTE: the JSON path is capped by the app-level 2mb express.json limit; use multipart above that. |
| `POST /api/tools/storage/list` | List objects under a prefix. Each entry is classified image \| video \| document \| other, and pseudo-folders are flagged with isFolder. Returns entries[], count, hasMore. |
| `POST /api/tools/storage/delete` | Delete one object, addressed by key or by a URL previously handed out. The URL is reversed back to a key only if it is on the caller's own Supabase origin, matches a known /storage/v1/object/... shape, names the caller's own bucket, and decodes to a key made of [A-Za-z0-9._-] segments — anything else is a 400. Pass requirePrefix (e.g. the tenant id) to refuse keys outside that folder: the service_role key can otherwise reach every object in the bucket. Returns { key, deleted, removed[] }; deleted is false when the object did not exist. |
| `POST /api/tools/storage/sign-url` | Create a time-limited signed URL for an object in a private bucket. Accepts key or url (reversed with the same strict guard as delete). expiresIn defaults to 3600s and is clamped to 7 days. Returns { signedUrl, key, expiresIn, expiresAt }. |
| **OAuth** | |
| `POST /api/tools/oauth/authorize-url` | Build the provider consent URL. Generates state and a PKCE verifier/challenge and RETURNS the verifier — persist it against the state, exchange-code needs it back. |
| `POST /api/tools/oauth/exchange-code` | Exchange an authorization code for tokens -> { accessToken, refreshToken, expiresAt, scope, tokenType, idToken, refreshTokenExpiresAt }. Meta additionally upgrades the short-lived token to the ~60-day long-lived one. |
| `POST /api/tools/oauth/refresh` | Refresh an access token. Skips the call when the current token has more than 2 minutes left (pass accessToken + expiresAt). Returns refreshTokenRotated + the refresh token to persist — microsoft, x, tiktok, linkedin and GitHub Apps invalidate the old one. |
| `POST /api/tools/oauth/profile` | Fetch the account behind an access token, normalised to { id, email, name, avatar, username, raw }. |
| **Events** | |
| `POST /api/tools/events/emit` | Emit a cross-service event to UmbeliumManager, which persists it in umbelium_events and routes it to every target registered for that type. Always returns 200: check `delivered` to see whether the bus accepted it. `delivered:true` means the bus ACCEPTED AND PERSISTED the event, never that a consumer received it: the Manager answers 200 even when a downstream target fails, and an unregistered type fans out to nobody. |

## Packages publiés à côté du service

Le service n'est pas la seule façon de consommer UmbeliTools — deux packages sont publiés
sur GitHub Packages depuis ce repo :

| Package | Pour qui | Quoi |
|---|---|---|
| [`@umbeli-com/tools`](./client) | toute app Umbeli | SDK typé du service : `tools.email.send(...)`, `tools.ai.complete(...)`, une méthode par action |
| [`@umbeli-com/server-kit`](./server-kit) | les backends Express | la plomberie que neuf backends réécrivaient : auth Bearer Supabase, clé de service à comparaison constante, enveloppe d'erreurs, allowlist CORS, rate limit, garde anti-traversée de chemin |

`server-kit` n'est **pas** un outil HTTP : c'est une librairie que le backend importe
directement, livrée en CJS **et** en ESM (les backends de la suite sont moitié-moitié —
c'est précisément ce qui bloquait l'adoption du SDK, qui était ESM seul).

```ts
import { supabaseBearerAuth, rateLimit, errorHandler, notFoundHandler } from '@umbeli-com/server-kit';

app.use(rateLimit({ windowMs: 60_000, max: 120 }));
app.use('/api', supabaseBearerAuth(supabase));
app.use(notFoundHandler());
app.use(errorHandler());
```

## Usage Examples

### Send an Email

```bash
curl -X POST http://localhost:3002/api/tools/email/send \
  -H "Content-Type: application/json" \
  -H "x-service-key: YOUR_KEY" \
  -d '{
    "credentials": { "apiKey": "mj_api_key", "secretKey": "mj_secret" },
    "from": { "email": "noreply@example.com", "name": "My App" },
    "to": [{ "email": "user@example.com" }],
    "subject": "Hello",
    "htmlBody": "<p>Hi there!</p>"
  }'
```

### Privacy-preserving AI call (Anonymium round-trip)

Sensitive data (names, emails, phones, IBANs, API keys, addresses, dates,
custom rules…) is detected, replaced with `[CATEGORY_N]` placeholders
before the request leaves UmbeliTools. The AI provider only ever sees
the anonymized text. When the response comes back, placeholders are
swapped back to their original values automatically.

```bash
curl -X POST http://localhost:3002/api/tools/anonymium/ai-complete \
  -H "Content-Type: application/json" -H "x-service-key: YOUR_KEY" \
  -d '{
    "credentials": { "provider": "anthropic", "apiKey": "sk-ant-..." },
    "messages": [{
      "role": "user",
      "content": "Draft a follow-up email for Marie Lefebvre (marie.lefebvre@acme.fr) about contract REF-2024-789 worth 12 500 EUR."
    }],
    "systemPrompt": "You are a helpful assistant."
  }'
```

The AI provider sees something like:
```
Draft a follow-up email for [PERSON_1] ([EMAIL_1]) about contract [ID_1] worth [PRICE_1].
```

The response you get back has the original values restored:
```json
{
  "ok": true,
  "data": {
    "content": "Subject: Suivi contrat REF-2024-789\n\nBonjour Marie Lefebvre, ...",
    "anonymizedContent": "Subject: Suivi contrat [ID_1]\n\nBonjour [PERSON_1], ...",
    "mapping": [{ "original": "Marie Lefebvre", "placeholder": "[PERSON_1]", ... }, ...],
    "sentMessages": [...]
  }
}
```

### AI Completion

```bash
curl -X POST http://localhost:3002/api/tools/ai/complete \
  -H "Content-Type: application/json" \
  -H "x-service-key: YOUR_KEY" \
  -d '{
    "credentials": { "provider": "anthropic", "apiKey": "sk-ant-..." },
    "messages": [{ "role": "user", "content": "Hello!" }],
    "systemPrompt": "You are helpful.",
    "maxTokens": 256
  }'
```

### Web-grounded AI research (lead enrichment, fact-checking)

```bash
curl -X POST http://localhost:3002/api/tools/ai/web-research \
  -H "Content-Type: application/json" -H "x-service-key: YOUR_KEY" \
  -d '{
    "credentials": { "apiKey": "sk-..." },
    "prompt": "Find what Acme Inc. (acme.com) does, who their decision-makers are, and current relevant news. Return markdown with sources."
  }'
```

### Scrape a page as markdown (great for AI agents)

```bash
curl -X POST http://localhost:3002/api/tools/scrape/fetch-markdown \
  -H "Content-Type: application/json" -H "x-service-key: YOUR_KEY" \
  -d '{ "url": "https://example.com/some-article" }'
```

### Spin up a domain + DNS for a new tenant

```bash
# 1) Check availability
curl -X POST http://localhost:3002/api/tools/domain/check-availability \
  -H "Content-Type: application/json" -H "x-service-key: YOUR_KEY" \
  -d '{ "credentials": { "apiKey": "GANDI_KEY" }, "domain": "newtenant.com" }'

# 2) Create a Cloudflare zone
curl -X POST http://localhost:3002/api/tools/dns/create-zone \
  -H "Content-Type: application/json" -H "x-service-key: YOUR_KEY" \
  -d '{
    "credentials": { "apiToken": "CF_TOKEN", "accountId": "CF_ACCOUNT_ID" },
    "domain": "newtenant.com"
  }'

# 3) Add an A record pointing to your server
curl -X POST http://localhost:3002/api/tools/dns/add-record \
  -H "Content-Type: application/json" -H "x-service-key: YOUR_KEY" \
  -d '{
    "credentials": { "apiToken": "CF_TOKEN" },
    "zoneId": "ZONE_ID_FROM_STEP_2",
    "type": "A", "name": "newtenant.com", "content": "1.2.3.4"
  }'
```

### Send via SMTP (any provider)

```bash
curl -X POST http://localhost:3002/api/tools/email/smtp-send \
  -H "Content-Type: application/json" -H "x-service-key: YOUR_KEY" \
  -d '{
    "credentials": {
      "host": "smtp.office365.com", "port": 587,
      "user": "you@example.com", "password": "..."
    },
    "from": { "email": "you@example.com", "name": "You" },
    "to": "lead@example.com",
    "subject": "Hello",
    "html": "<p>Hi there!</p>"
  }'
```

### Send SMS

```bash
curl -X POST http://localhost:3002/api/tools/sms/send \
  -H "Content-Type: application/json" \
  -H "x-service-key: YOUR_KEY" \
  -d '{
    "credentials": { "accountSid": "AC...", "authToken": "...", "from": "+1234567890" },
    "to": "+15551234567",
    "body": "Your code is 1234",
    "channel": "sms"
  }'
```

### Read Gmail and forward to BusinessInbox

```bash
# 1) List unread Gmail messages
curl -X POST http://localhost:3002/api/tools/gmail/list-messages \
  -H "Content-Type: application/json" -H "x-service-key: YOUR_KEY" \
  -d '{
    "credentials": { "clientId": "...", "clientSecret": "...", "refreshToken": "..." },
    "query": "is:unread",
    "maxResults": 50
  }'

# 2) Forward an inquiry to BusinessInbox/Ciao
curl -X POST http://localhost:3002/api/tools/inbox/log-inquiry \
  -H "Content-Type: application/json" -H "x-service-key: YOUR_KEY" \
  -d '{
    "credentials": { "baseUrl": "https://samtr.umbeli.com", "apiToken": "..." },
    "canal": "email",
    "source": "gmail",
    "expediteur": "lead@example.com",
    "sujet": "Question about your services",
    "texte": "Hi, I am interested in...",
    "reponse_proposee": "Thanks for reaching out!",
    "external_id": "gmail-msg-12345"
  }'
```

### Instagram Reply + DM (from n8n or any app)

```bash
# Reply to a comment
curl -X POST http://localhost:3002/api/tools/social/meta/reply-comment \
  -H "Content-Type: application/json" \
  -H "x-service-key: YOUR_KEY" \
  -d '{
    "credentials": { "accessToken": "IGAAPoZB..." },
    "commentId": "17985759509853904",
    "message": "Thanks for commenting!"
  }'

# Send a DM
curl -X POST http://localhost:3002/api/tools/social/meta/send-dm \
  -H "Content-Type: application/json" \
  -H "x-service-key: YOUR_KEY" \
  -d '{
    "credentials": { "accessToken": "IGAAPoZB..." },
    "igUserId": "17841433232515990",
    "recipientId": "17985759509853904",
    "message": "Hey! Check your DMs"
  }'
```

## Calling from Any Umbeli App

Install the typed SDK from GitHub Packages — every node is exposed as a typed method, no fetch boilerplate needed:

```bash
# .npmrc
@umbeli-com:registry=https://npm.pkg.github.com

npm install @umbeli-com/tools
```

```typescript
import { UmbeliTools } from '@umbeli-com/tools';

const tools = new UmbeliTools({
  url: process.env.UMBELITOOLS_URL ?? 'http://umbelitools-api-prod:3002',
  serviceKey: process.env.UMBELIUM_SERVICE_KEY!,
});

await tools.email.send({
  credentials: { apiKey: MJ_KEY, secretKey: MJ_SECRET },
  from: { email: 'noreply@myapp.com' },
  to: [{ email: 'user@example.com' }],
  subject: 'Welcome!',
  htmlBody: '<p>Welcome to our platform</p>',
});

await tools.ai.complete({
  credentials: { provider: 'anthropic', apiKey: ANTHROPIC_KEY },
  messages: [{ role: 'user', content: 'Hello' }],
});

await tools.dns.addRecord({
  credentials: { apiToken: CF_TOKEN },
  zoneId, type: 'A', name: 'app.example.com', content: '1.2.3.4',
});
```

The SDK lives at [`client/`](./client) and is auto-published to GitHub Packages on every push to `main` that touches it. See [client/README.md](./client/README.md) for the full method catalog, options, and error handling.

## Response Format

All endpoints return a unified format:

```json
// Success
{ "ok": true, "data": { ... }, "meta": { "durationMs": 342, "provider": "mailjet" } }

// Error
{ "ok": false, "error": { "code": "PROVIDER_ERROR", "message": "..." }, "meta": { ... } }
```

## Adding a New Tool

1. Create a folder under `src/tools/your-tool/`
2. Add `types.ts`, an adapter file, and `index.ts` exporting a `ToolDefinition`
3. Register it in `src/tools/index.ts`

## Deployment

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

The service runs on port 3002 and integrates with the existing nginx-proxy + Let's Encrypt setup.
