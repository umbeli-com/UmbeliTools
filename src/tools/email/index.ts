import { Router } from 'express';
import type { ToolDefinition } from '../../types/tool';
import { sendMailjet } from './mailjet.adapter';
import type { MailjetAddress } from './mailjet.adapter';
import { sendSmtp } from './smtp.adapter';
import { sendSuccess, sendError } from '../../lib/response';
import type {
  EmailSendInput,
  EmailSmtpSendInput,
  EmailRenderTemplateInput,
  EmailSendTemplateInput,
} from './types';
import { EMAIL_TEMPLATES, ACTION_LINK_TEMPLATES, isEmailTemplate, renderTemplate, safeUrl } from './templates';
import { captureEmail, describeTransport, getCapturedEmails, clearCapturedEmails, isCaptureEnabled } from './capture';

const router = Router();

router.post('/send', async (req, res) => {
  const start = Date.now();
  const input = req.body as EmailSendInput;

  if (!input.credentials?.apiKey || !input.credentials?.secretKey) {
    return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.apiKey and credentials.secretKey are required');
  }
  if (!input.from?.email || !input.to?.length || !input.subject || !input.htmlBody) {
    return sendError(res, 400, 'MISSING_FIELDS', 'from.email, to, subject, and htmlBody are required');
  }

  try {
    const result = await sendMailjet(input.credentials, [
      {
        From: { Email: input.from.email, Name: input.from.name },
        To: input.to.map((t) => ({ Email: t.email, Name: t.name })),
        Subject: input.subject,
        HTMLPart: input.htmlBody,
      },
    ]);

    if (!result.success) {
      return sendError(res, 502, 'PROVIDER_ERROR', result.error || 'Mailjet send failed', undefined, {
        durationMs: Date.now() - start,
        provider: 'mailjet',
      });
    }

    sendSuccess(res, result.response, { durationMs: Date.now() - start, provider: 'mailjet' });
  } catch (err: any) {
    sendError(res, 500, 'INTERNAL_ERROR', err.message, undefined, {
      durationMs: Date.now() - start,
      provider: 'mailjet',
    });
  }
});

router.post('/smtp-send', async (req, res) => {
  const start = Date.now();
  const input = req.body as EmailSmtpSendInput;

  if (!input.credentials?.host || !input.credentials?.user || !input.credentials?.password) {
    return sendError(res, 400, 'MISSING_CREDENTIALS', 'credentials.host, credentials.user, and credentials.password are required');
  }
  if (!input.from?.email || !input.to || !input.subject || (!input.text && !input.html)) {
    return sendError(res, 400, 'MISSING_FIELDS', 'from.email, to, subject, and text or html are required');
  }

  try {
    const result = await sendSmtp(input.credentials, input);
    sendSuccess(res, result, { durationMs: Date.now() - start, provider: 'smtp', host: input.credentials.host });
  } catch (err: any) {
    sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, {
      durationMs: Date.now() - start,
      provider: 'smtp',
    });
  }
});

// ── branded templates ────────────────────────────────────────────────────────

interface Recipient {
  email: string;
  name?: string;
}

/** Accepts "a@b.c" | {email,name} | a list of either. Drops anything without an "@". */
function normalizeRecipients(to: EmailSendTemplateInput['to']): Recipient[] {
  const list = Array.isArray(to) ? to : [to];
  const out: Recipient[] = [];
  for (const entry of list) {
    if (typeof entry === 'string') {
      const email = entry.trim();
      if (email.includes('@')) out.push({ email });
    } else if (entry && typeof entry === 'object' && typeof entry.email === 'string') {
      const email = entry.email.trim();
      if (email.includes('@')) out.push({ email, name: entry.name });
    }
  }
  return out;
}

function normalizeList(value: string | string[] | undefined): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  return list.map((v) => String(v).trim()).filter((v) => v.includes('@'));
}

/** RFC-ish "Name <email>" header value. */
function formatAddress(r: Recipient): string {
  const name = String(r.name ?? '').replace(/["\r\n]/g, '').trim();
  return name ? `"${name}" <${r.email}>` : r.email;
}

router.post('/render-template', async (req, res) => {
  const start = Date.now();
  const input = req.body as EmailRenderTemplateInput;

  if (!input?.template) {
    return sendError(res, 400, 'MISSING_FIELDS', `template is required (one of: ${EMAIL_TEMPLATES.join(', ')})`);
  }
  if (!isEmailTemplate(input.template)) {
    return sendError(
      res,
      400,
      'MISSING_FIELDS',
      `Unknown template "${String(input.template)}" — expected one of: ${EMAIL_TEMPLATES.join(', ')}`,
    );
  }

  try {
    const rendered = renderTemplate(input.template, input.vars || {}, input.branding || {});
    sendSuccess(
      res,
      {
        template: input.template,
        subject: rendered.subject,
        preheader: rendered.preheader,
        fromName: rendered.fromName,
        html: rendered.html,
        text: rendered.text,
        transport: describeTransport(input.credentials, input.transport || 'auto'),
      },
      { durationMs: Date.now() - start, provider: 'templates' },
    );
  } catch (err: any) {
    sendError(res, 500, 'INTERNAL_ERROR', err.message, undefined, {
      durationMs: Date.now() - start,
      provider: 'templates',
    });
  }
});

router.post('/send-template', async (req, res) => {
  const start = Date.now();
  const input = req.body as EmailSendTemplateInput;

  if (!input?.template) {
    return sendError(res, 400, 'MISSING_FIELDS', `template is required (one of: ${EMAIL_TEMPLATES.join(', ')})`);
  }
  if (!isEmailTemplate(input.template)) {
    return sendError(
      res,
      400,
      'MISSING_FIELDS',
      `Unknown template "${String(input.template)}" — expected one of: ${EMAIL_TEMPLATES.join(', ')}`,
    );
  }
  if (!input.from?.email) {
    return sendError(res, 400, 'MISSING_FIELDS', 'from.email is required');
  }

  const recipients = normalizeRecipients(input.to);
  if (!recipients.length) {
    return sendError(res, 400, 'MISSING_FIELDS', 'to is required (an email address, {email,name}, or a list of either)');
  }

  const vars = input.vars || {};
  if (ACTION_LINK_TEMPLATES.includes(input.template) && !safeUrl(vars.actionUrl ?? vars.ctaUrl ?? vars.url)) {
    return sendError(
      res,
      400,
      'MISSING_FIELDS',
      `vars.actionUrl is required for "${input.template}" and must be an http(s) URL`,
    );
  }

  const transport = describeTransport(input.credentials, input.transport || 'auto');
  if (!transport.capture && transport.wouldUse === 'none') {
    return sendError(
      res,
      400,
      'MISSING_CREDENTIALS',
      'credentials.apiKey + credentials.secretKey (Mailjet) or credentials.host + credentials.user + credentials.password (SMTP) are required',
    );
  }

  let rendered;
  try {
    rendered = renderTemplate(input.template, vars, input.branding || {});
  } catch (err: any) {
    return sendError(res, 500, 'INTERNAL_ERROR', err.message, undefined, {
      durationMs: Date.now() - start,
      provider: 'templates',
    });
  }

  // CR/LF in a subject or a display name is header-injection bait — flatten both.
  const subject = (String(input.subject ?? '').trim() || rendered.subject).replace(/[\r\n]+/g, ' ');
  const fromName = String(input.from.name || rendered.fromName).replace(/[\r\n]+/g, ' ');
  const cc = normalizeList(input.cc);
  const bcc = normalizeList(input.bcc);
  const replyTo = input.replyTo && String(input.replyTo).includes('@') ? String(input.replyTo).trim() : undefined;

  const base = {
    template: input.template,
    subject,
    to: recipients.map((r) => r.email),
    fromName,
    transport: transport.transport,
    captured: transport.capture,
  };
  const withRendered = (extra: Record<string, unknown>) => ({
    ...base,
    ...extra,
    ...(transport.capture || input.returnRendered
      ? { rendered: { html: rendered.html, text: rendered.text, preheader: rendered.preheader } }
      : {}),
  });

  // EMAIL_CAPTURE: record what WOULD have been sent, send nothing.
  if (transport.capture) {
    const entry = captureEmail({
      template: input.template,
      from: formatAddress({ email: input.from.email, name: fromName }),
      to: recipients.map((r) => r.email),
      cc: cc.length ? cc : undefined,
      bcc: bcc.length ? bcc : undefined,
      replyTo,
      subject,
      html: rendered.html,
      text: rendered.text,
    });
    return sendSuccess(res, withRendered({ capturedAt: entry.at, transportDetail: transport }), {
      durationMs: Date.now() - start,
      provider: 'capture',
    });
  }

  try {
    if (transport.wouldUse === 'mailjet') {
      const message = {
        From: { Email: input.from.email, Name: fromName },
        To: recipients.map<MailjetAddress>((r) => ({ Email: r.email, Name: r.name })),
        Cc: cc.length ? cc.map<MailjetAddress>((email) => ({ Email: email })) : undefined,
        Bcc: bcc.length ? bcc.map<MailjetAddress>((email) => ({ Email: email })) : undefined,
        ReplyTo: replyTo ? { Email: replyTo } : undefined,
        Subject: subject,
        HTMLPart: rendered.html,
        TextPart: rendered.text,
      };
      const result = await sendMailjet(
        { apiKey: input.credentials.apiKey as string, secretKey: input.credentials.secretKey as string },
        [message],
      );
      if (!result.success) {
        return sendError(res, 502, 'PROVIDER_ERROR', result.error || 'Mailjet send failed', undefined, {
          durationMs: Date.now() - start,
          provider: 'mailjet',
        });
      }
      return sendSuccess(res, withRendered({ result: result.response }), {
        durationMs: Date.now() - start,
        provider: 'mailjet',
      });
    }

    const result = await sendSmtp(
      {
        host: input.credentials.host as string,
        port: input.credentials.port,
        secure: input.credentials.secure,
        user: input.credentials.user as string,
        password: input.credentials.password as string,
      },
      {
        from: { email: input.from.email, name: fromName },
        to: recipients.map(formatAddress).join(', '),
        subject,
        html: rendered.html,
        text: rendered.text,
        cc: cc.length ? cc.join(', ') : undefined,
        bcc: bcc.length ? bcc.join(', ') : undefined,
        replyTo,
      },
    );
    return sendSuccess(res, withRendered({ result }), {
      durationMs: Date.now() - start,
      provider: 'smtp',
      host: input.credentials.host,
    });
  } catch (err: any) {
    return sendError(res, 502, 'PROVIDER_ERROR', err.message, undefined, {
      durationMs: Date.now() - start,
      provider: transport.wouldUse,
    });
  }
});

/** Test-only readback of what EMAIL_CAPTURE recorded. */
router.post('/capture-log', async (req, res) => {
  const start = Date.now();
  const body = (req.body || {}) as { limit?: number; clear?: boolean };
  const emails = getCapturedEmails(typeof body.limit === 'number' ? body.limit : 50);
  const cleared = body.clear === true ? clearCapturedEmails() : 0;
  sendSuccess(
    res,
    {
      enabled: isCaptureEnabled(),
      count: emails.length,
      cleared,
      emails,
      transport: describeTransport(undefined, 'auto'),
    },
    { durationMs: Date.now() - start, provider: 'capture' },
  );
});

const BRANDING_SCHEMA = {
  type: 'object',
  description: 'Per-app branding. Sanitized: non-hex colors and non-http(s) URLs fall back to the Umbelium defaults.',
  properties: {
    appName: { type: 'string', description: 'SaaS name in the lockup + subjects (Webum, Dialum…)' },
    logoUrl: { type: 'string', description: 'Absolute https logo URL; falls back to an initial badge' },
    primaryColor: { type: 'string', description: 'Hex color (#rrggbb). Default #030174' },
    companyName: { type: 'string', default: 'Umbelium' },
    supportEmail: { type: 'string', default: 'contact@umbeli.com' },
    baseUrl: { type: 'string', description: 'Public app URL linked in the footer' },
    locale: { type: 'string', enum: ['fr', 'en'], default: 'fr' },
  },
};

const VARS_SCHEMA = {
  type: 'object',
  description: 'Template variables — plain text only, every value is HTML-escaped at render time.',
  properties: {
    name: { type: 'string', description: 'Recipient display name for the greeting' },
    actionUrl: { type: 'string', description: 'REQUIRED for auth.* — the one-click verify/invite link (http(s) only)' },
    ctaUrl: { type: 'string' },
    ctaLabel: { type: 'string' },
    subject: { type: 'string', description: 'Override the generated subject' },
    heading: { type: 'string', description: 'Override the generated H1' },
    preheader: { type: 'string', description: 'Hidden inbox preview line' },
    message: { type: 'string', description: 'Body copy (notification, welcome). Blank lines become paragraphs.' },
    footerNote: { type: 'string' },
    fields: {
      description: 'form-submission/notification: submitted fields — {label:value} object or [{label,value}] array',
      oneOf: [
        { type: 'object' },
        { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, value: {} } } },
      ],
    },
    data: { type: 'object', description: "Alias of `fields` (Webum's raw submission payload)" },
    siteName: { type: 'string', description: 'form-submission: the site the form belongs to' },
    formName: { type: 'string', description: 'form-submission: form id/name' },
    page: { type: 'string', description: 'form-submission: page the form was submitted from' },
    submittedAt: { type: 'string', description: 'form-submission: ISO date; defaults to now' },
  },
};

const TEMPLATE_ENUM = {
  type: 'string',
  enum: EMAIL_TEMPLATES,
  description:
    'auth.signup | auth.recovery | auth.magiclink | auth.email_change | auth.invite | notification | form-submission | welcome',
};

export const emailTool: ToolDefinition = {
  name: 'email',
  description: 'Send transactional emails via Mailjet or SMTP, including the suite\'s branded templates',
  actions: [
    {
      action: 'send',
      description: 'Send one or more emails via Mailjet',
      inputSchema: {
        type: 'object',
        required: ['credentials', 'from', 'to', 'subject', 'htmlBody'],
        properties: {
          credentials: {
            type: 'object',
            required: ['apiKey', 'secretKey'],
            properties: {
              apiKey: { type: 'string' },
              secretKey: { type: 'string' },
            },
          },
          from: {
            type: 'object',
            required: ['email'],
            properties: { email: { type: 'string' }, name: { type: 'string' } },
          },
          to: {
            type: 'array',
            items: {
              type: 'object',
              required: ['email'],
              properties: { email: { type: 'string' }, name: { type: 'string' } },
            },
          },
          subject: { type: 'string' },
          htmlBody: { type: 'string' },
        },
      },
    },
    {
      action: 'smtp-send',
      description: 'Send an email via any SMTP server (Outlook SMTP, Gmail SMTP, infomaniak, Mailgun, custom, etc.)',
      inputSchema: {
        type: 'object',
        required: ['credentials', 'from', 'to', 'subject'],
        properties: {
          credentials: {
            type: 'object',
            required: ['host', 'user', 'password'],
            properties: {
              host: { type: 'string', description: 'SMTP host (e.g. smtp.office365.com)' },
              port: { type: 'number', default: 587 },
              secure: { type: 'boolean', description: 'true for port 465, false for STARTTLS on 587' },
              user: { type: 'string' },
              password: { type: 'string' },
            },
          },
          from: {
            type: 'object',
            required: ['email'],
            properties: { email: { type: 'string' }, name: { type: 'string' } },
          },
          to: { type: 'string' },
          subject: { type: 'string' },
          text: { type: 'string', description: 'Plain-text body' },
          html: { type: 'string', description: 'HTML body' },
          cc: { type: 'string' },
          bcc: { type: 'string' },
          replyTo: { type: 'string' },
        },
      },
    },
    {
      action: 'send-template',
      description:
        'Render a branded Umbelium template (table-based HTML + text/plain alternative) and send it through Mailjet or SMTP. Transport is inferred from the credentials shape. With EMAIL_CAPTURE=1 the message is recorded instead of sent and returned in `rendered`.',
      inputSchema: {
        type: 'object',
        required: ['credentials', 'template', 'from', 'to'],
        properties: {
          credentials: {
            type: 'object',
            description: 'Mailjet {apiKey, secretKey} OR SMTP {host, user, password, port?, secure?}',
            properties: {
              apiKey: { type: 'string' },
              secretKey: { type: 'string' },
              host: { type: 'string' },
              port: { type: 'number', default: 587 },
              secure: { type: 'boolean' },
              user: { type: 'string' },
              password: { type: 'string' },
            },
          },
          transport: {
            type: 'string',
            enum: ['auto', 'mailjet', 'smtp'],
            default: 'auto',
            description: 'Force a transport; auto infers it from the credentials',
          },
          template: TEMPLATE_ENUM,
          vars: VARS_SCHEMA,
          branding: BRANDING_SCHEMA,
          from: {
            type: 'object',
            required: ['email'],
            properties: {
              email: { type: 'string' },
              name: { type: 'string', description: 'Defaults to "<appName> · <companyName>"' },
            },
          },
          to: {
            description: 'An email address, an {email,name}, or a list of either',
            oneOf: [
              { type: 'string' },
              { type: 'object', required: ['email'], properties: { email: { type: 'string' }, name: { type: 'string' } } },
              { type: 'array', items: {} },
            ],
          },
          cc: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
          bcc: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
          replyTo: { type: 'string' },
          subject: { type: 'string', description: "Override the template's subject" },
          returnRendered: { type: 'boolean', default: false, description: 'Echo the rendered html/text in the response' },
        },
      },
    },
    {
      action: 'render-template',
      description:
        'Render a branded template and RETURN { subject, preheader, html, text } without sending — for previews, snapshot tests and Supabase auth hooks that deliver the mail themselves.',
      inputSchema: {
        type: 'object',
        required: ['template'],
        properties: {
          template: TEMPLATE_ENUM,
          vars: VARS_SCHEMA,
          branding: BRANDING_SCHEMA,
          credentials: {
            type: 'object',
            description: 'Optional — only used to report which transport WOULD carry this message',
            properties: {
              apiKey: { type: 'string' },
              secretKey: { type: 'string' },
              host: { type: 'string' },
              user: { type: 'string' },
              password: { type: 'string' },
            },
          },
          transport: { type: 'string', enum: ['auto', 'mailjet', 'smtp'], default: 'auto' },
        },
      },
    },
    {
      action: 'capture-log',
      description:
        'Test hook: read back what EMAIL_CAPTURE recorded (most recent first) instead of sending. Returns { enabled: false, emails: [] } when EMAIL_CAPTURE is off.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', default: 50, description: 'How many recorded messages to return (max 200)' },
          clear: { type: 'boolean', default: false, description: 'Empty the buffer after reading' },
        },
      },
    },
  ],
  router,
};
