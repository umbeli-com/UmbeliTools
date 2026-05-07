# UmbeliTools

Centralized reusable toolbox service for the Umbeli SaaS ecosystem. Plug-and-play integrations that any app can call via a simple REST API.

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
| `POST /api/tools/email/send` | Send email via Mailjet |
| **AI** | |
| `POST /api/tools/ai/complete` | Text completion (Anthropic, OpenAI, Gemini) |
| `POST /api/tools/ai/generate-json` | Structured JSON output from AI |
| **Social** | |
| `POST /api/tools/social/meta/send-dm` | Send Instagram DM |
| `POST /api/tools/social/meta/reply-comment` | Reply to Instagram comment |
| `POST /api/tools/social/meta/get-accounts` | List connected pages/IG accounts |
| `POST /api/tools/social/meta/publish` | Publish media to Instagram |
| `POST /api/tools/social/meta/list-conversations` | List Instagram/Messenger conversations |
| `POST /api/tools/social/meta/list-messages` | List messages in a conversation |
| **Gmail** | |
| `POST /api/tools/gmail/list-messages` | List Gmail messages by query |
| `POST /api/tools/gmail/get-message` | Get full message body |
| `POST /api/tools/gmail/send-message` | Send an email via Gmail |
| `POST /api/tools/gmail/modify-message` | Add/remove labels (e.g. mark read) |
| **Outlook** | |
| `POST /api/tools/outlook/list-messages` | List Outlook messages |
| `POST /api/tools/outlook/get-message` | Get full message body |
| `POST /api/tools/outlook/send-message` | Send an email via Outlook |
| `POST /api/tools/outlook/mark-read` | Mark an Outlook message as read/unread |
| **Inbox** | |
| `POST /api/tools/inbox/log-inquiry` | Log inquiry to a BusinessInbox/Ciao instance |
| `POST /api/tools/inbox/get-stats` | Get stats from a BusinessInbox instance |
| **SMS** | |
| `POST /api/tools/sms/send` | Send SMS or WhatsApp via Twilio |
| **Webhook** | |
| `POST /api/tools/webhook/dispatch` | Dispatch HTTP webhook |

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

Add a thin helper to your app:

```typescript
const TOOLS_URL = process.env.UMBELITOOLS_URL || 'http://umbelitools-api-prod:3002';

export async function callTool(tool: string, action: string, body: object) {
  const res = await fetch(`${TOOLS_URL}/api/tools/${tool}/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-service-key': process.env.UMBELIUM_SERVICE_KEY!,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}
```

Then use it anywhere:

```typescript
await callTool('email', 'send', {
  credentials: { apiKey: MJ_KEY, secretKey: MJ_SECRET },
  from: { email: 'noreply@myapp.com' },
  to: [{ email: 'user@example.com' }],
  subject: 'Welcome!',
  htmlBody: '<p>Welcome to our platform</p>',
});
```

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
