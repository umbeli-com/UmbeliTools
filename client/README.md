# @umbeli-com/tools

Typed client SDK for the [UmbeliTools](../) service. Every tool / node is exposed as a typed method — drop the SDK into any Umbeli app and call the centralized tools without writing fetch boilerplate.

## Install

```bash
# Make sure your project has an .npmrc pointing the @umbeli-com scope at GitHub Packages:
echo "@umbeli-com:registry=https://npm.pkg.github.com" >> .npmrc

npm install @umbeli-com/tools
# or
pnpm add @umbeli-com/tools
```

You need a GitHub Personal Access Token with `read:packages` available as `NODE_AUTH_TOKEN` (or `~/.npmrc` `//npm.pkg.github.com/:_authToken=…`) to download from the registry.

## Quick start

```ts
import { UmbeliTools } from '@umbeli-com/tools';

const tools = new UmbeliTools({
  url: process.env.UMBELITOOLS_URL ?? 'http://umbelitools-api-prod:3002',
  serviceKey: process.env.UMBELIUM_SERVICE_KEY!,
});

const sent = await tools.email.send({
  credentials: { apiKey: MJ_KEY, secretKey: MJ_SECRET },
  from: { email: 'noreply@myapp.com' },
  to: [{ email: 'user@example.com' }],
  subject: 'Welcome!',
  htmlBody: '<p>Hi there!</p>',
});
```

That's it. The SDK handles serialization, the `x-service-key` header, response unwrapping, timeouts, and typed errors.

## Available tools

Every endpoint of the service is mapped to a method. Action paths are converted to camelCase.

| Tool | Methods |
|------|---------|
| `email` | `send`, `smtpSend` |
| `ai` | `complete`, `generateJson<T>`, `webResearch` |
| `anonymium` | `anonymize`, `deanonymize`, `aiComplete` |
| `social.meta` | `sendDm`, `replyComment`, `getAccounts`, `publish`, `listConversations`, `listMessages` |
| `sms` | `send` |
| `webhook` | `dispatch` |
| `gmail` | `listMessages`, `getMessage`, `sendMessage`, `modifyMessage` |
| `outlook` | `listMessages`, `getMessage`, `sendMessage`, `sendAsApp`, `markRead` |
| `inbox` | `logInquiry`, `getStats` |
| `scrape` | `fetchMarkdown`, `fetchHtml` |
| `search` | `google` |
| `dns` | `createZone`, `getZone`, `deleteZone`, `listRecords`, `addRecord`, `updateRecord`, `deleteRecord` |
| `domain` | `checkAvailability`, `suggest`, `purchase`, `setNameservers` |

## Examples

### AI completion

```ts
const res = await tools.ai.complete({
  credentials: { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY! },
  messages: [{ role: 'user', content: 'Hello!' }],
  systemPrompt: 'You are helpful.',
});
console.log(res.content);
```

### Structured JSON output

```ts
type Lead = { name: string; company: string; intent: 'hot' | 'warm' | 'cold' };

const { data } = await tools.ai.generateJson<Lead>({
  credentials: { provider: 'openai', apiKey: OPENAI_KEY },
  userPrompt: 'Extract a Lead JSON from: "Marie at Acme wants a demo tomorrow."',
});
```

### Privacy-preserving AI call

```ts
const res = await tools.anonymium.aiComplete({
  credentials: { provider: 'anthropic', apiKey: ANTHROPIC_KEY },
  messages: [{
    role: 'user',
    content: 'Draft a follow-up for Marie Lefebvre (marie@acme.fr) about REF-2024-789.',
  }],
});
// res.content has the originals restored
// res.anonymizedContent shows what the AI actually received
// res.mapping is the audit trail
```

### Cloudflare DNS

```ts
const zone = await tools.dns.createZone({
  credentials: { apiToken: CF_TOKEN, accountId: CF_ACCOUNT_ID },
  domain: 'newtenant.com',
});

await tools.dns.addRecord({
  credentials: { apiToken: CF_TOKEN },
  zoneId: zone.id,
  type: 'A',
  name: 'newtenant.com',
  content: '1.2.3.4',
});
```

### SMS / WhatsApp

```ts
await tools.sms.send({
  credentials: { accountSid: TWILIO_SID, authToken: TWILIO_TOKEN, from: '+1234567890' },
  to: '+15551234567',
  body: 'Your code is 1234',
  channel: 'sms', // or 'whatsapp'
});
```

### Scrape a page

```ts
const { markdown } = await tools.scrape.fetchMarkdown({ url: 'https://example.com' });
```

### Instagram DM

```ts
await tools.social.meta.sendDm({
  credentials: { accessToken: META_TOKEN },
  igUserId: '17841...',
  recipientId: '17985...',
  message: 'Hey!',
});
```

### Filter Meta webhook payloads (DMs only)

A Meta webhook delivers DMs (`entry[].messaging[]`) and comments (`entry[].changes[]`) in the same envelope. Use these pure helpers in your webhook receiver to keep only what you want:

```ts
import { extractMetaDms, extractMetaComments, splitMetaWebhook } from '@umbeli-com/tools';

app.post('/webhooks/instagram', (req, res) => {
  const dms = extractMetaDms(req.body); // outgoing echoes filtered out by default
  for (const dm of dms) {
    // dm.senderId, dm.text, dm.messageId, dm.isPrivateReplyToComment, ...
  }
  res.sendStatus(200);
});

// Options:
extractMetaDms(payload, {
  excludeEcho: true,           // default — drop messages emitted by your own account
  excludePrivateReplies: true, // drop DMs auto-sent in reply to a comment
  requireText: true,           // drop attachment-only DMs
});

// Or in one pass:
const { dms, comments } = splitMetaWebhook(req.body);
```

## Error handling

All errors throw `UmbeliToolsError`:

```ts
import { UmbeliTools, UmbeliToolsError } from '@umbeli-com/tools';

try {
  await tools.email.send({ ... });
} catch (err) {
  if (err instanceof UmbeliToolsError) {
    console.log(err.code);     // e.g. 'PROVIDER_ERROR', 'MISSING_FIELDS', 'TIMEOUT'
    console.log(err.message);
    console.log(err.status);   // HTTP status if a response was received
    console.log(err.details);
    console.log(err.meta);     // durationMs, provider, ...
  }
}
```

## Access the raw envelope

If you need `meta` (e.g. `durationMs`, `provider`) along with the data, use `call()`:

```ts
const { data, meta } = await tools.call('email', 'send', { ... });
console.log(meta?.durationMs);
```

## Options

```ts
new UmbeliTools({
  url: 'https://tools.umbeli.com',
  serviceKey: process.env.UMBELIUM_SERVICE_KEY!,
  timeoutMs: 30_000,          // per-request timeout (optional)
  headers: { 'x-app': 'webum' }, // extra headers merged into every call (optional)
  fetch: customFetch,         // override fetch (optional)
});
```

## Compatibility

- Node.js 18+ (global `fetch` required)
- Works in any modern bundler (ESM-only)

## Adding a new tool

1. Add the endpoint to the UmbeliTools server (`src/tools/<name>/`).
2. Add a matching wrapper in `client/src/tools/<name>.ts` extending `UmbeliToolsCore`.
3. Plug it into `UmbeliTools` in `client/src/index.ts`.
4. Bump `client/package.json` `version`. CI publishes on push to `main`.

## License

MIT
