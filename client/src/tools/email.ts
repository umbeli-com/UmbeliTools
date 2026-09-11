import { UmbeliToolsCore } from '../client.js';

export interface EmailAddress {
  email: string;
  name?: string;
}

export interface EmailSendInput {
  credentials: { apiKey: string; secretKey: string };
  from: EmailAddress;
  to: EmailAddress[];
  subject: string;
  htmlBody: string;
}

export interface EmailSmtpSendInput {
  credentials: {
    host: string;
    port?: number;
    /** `true` for port 465, `false` for STARTTLS on 587. */
    secure?: boolean;
    user: string;
    password: string;
  };
  from: EmailAddress;
  to: string;
  subject: string;
  text?: string;
  html?: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
}

export interface EmailSendResult {
  Messages?: Array<{ Status: string; To: Array<{ Email: string; MessageID?: string }>; [key: string]: unknown }>;
  [key: string]: unknown;
}

export interface EmailSmtpSendResult {
  messageId: string;
  accepted?: string[];
  rejected?: string[];
  [key: string]: unknown;
}

// ── branded templates ────────────────────────────────────────────────────────

export type EmailTemplateName =
  | 'auth.signup'
  | 'auth.recovery'
  | 'auth.magiclink'
  | 'auth.email_change'
  | 'auth.invite'
  | 'notification'
  | 'form-submission'
  | 'welcome';

/** Per-app branding. Non-hex colors and non-http(s) URLs fall back to the Umbelium defaults. */
export interface EmailBranding {
  /** SaaS name in the lockup + subjects (Webum, Dialum, Anonymum…). */
  appName?: string;
  /** Absolute https logo URL; falls back to an initial badge. */
  logoUrl?: string;
  /** Hex color (`#rrggbb` / `#rgb`). Default `#030174`. */
  primaryColor?: string;
  /** Umbrella name in the footer/signature. Default `Umbelium`. */
  companyName?: string;
  /** Default `contact@umbeli.com`. */
  supportEmail?: string;
  /** Public app URL linked in the footer. */
  baseUrl?: string;
  /** Copy language. Default `fr`. */
  locale?: 'fr' | 'en';
}

/** Plain text only — every value is HTML-escaped server-side. */
export interface EmailTemplateVars {
  name?: string;
  /** Required for the `auth.*` templates: the one-click verify/invite link. */
  actionUrl?: string;
  ctaUrl?: string;
  ctaLabel?: string;
  subject?: string;
  heading?: string;
  preheader?: string;
  message?: string;
  footerNote?: string;
  /** `form-submission` / `notification`: the submitted fields, in order. */
  fields?: Array<{ label: string; value: unknown }> | Record<string, unknown>;
  /** Alias of `fields` — Webum's raw submission payload. */
  data?: Record<string, unknown>;
  siteName?: string;
  formName?: string;
  page?: string;
  pageUrl?: string;
  submittedAt?: string;
  [key: string]: unknown;
}

/** Mailjet `{apiKey, secretKey}` or SMTP `{host, user, password}` — both optional here, one is required. */
export interface EmailTemplateCredentials {
  apiKey?: string;
  secretKey?: string;
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  password?: string;
}

export type EmailTransportChoice = 'auto' | 'mailjet' | 'smtp';

export interface EmailTransportDescription {
  /** What would actually handle the send right now. */
  transport: 'mailjet' | 'smtp' | 'capture' | 'none';
  /** The transport that would be used if EMAIL_CAPTURE were off. */
  wouldUse: 'mailjet' | 'smtp' | 'none';
  capture: boolean;
  sends: boolean;
  reason: string;
}

export interface EmailRenderTemplateInput {
  template: EmailTemplateName;
  vars?: EmailTemplateVars;
  branding?: EmailBranding;
  /** Optional — only used to report which transport WOULD carry this message. */
  credentials?: EmailTemplateCredentials;
  transport?: EmailTransportChoice;
}

export interface EmailRenderTemplateResult {
  template: EmailTemplateName;
  subject: string;
  preheader: string;
  /** Suggested From display name, e.g. `Webum · Umbelium`. */
  fromName: string;
  html: string;
  text: string;
  transport: EmailTransportDescription;
}

export interface EmailSendTemplateInput {
  credentials: EmailTemplateCredentials;
  transport?: EmailTransportChoice;
  template: EmailTemplateName;
  vars?: EmailTemplateVars;
  branding?: EmailBranding;
  from: EmailAddress;
  to: string | EmailAddress | Array<string | EmailAddress>;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  /** Override the template's subject. */
  subject?: string;
  /** Echo the rendered html/text back in the response. */
  returnRendered?: boolean;
}

export interface EmailSendTemplateResult {
  template: EmailTemplateName;
  subject: string;
  to: string[];
  fromName: string;
  /** `capture` when EMAIL_CAPTURE recorded the message instead of sending it. */
  transport: 'mailjet' | 'smtp' | 'capture' | 'none';
  captured: boolean;
  /** Present when captured or when `returnRendered` was set. */
  rendered?: { html: string; text: string; preheader: string };
  /** Mailjet API response or nodemailer info, depending on the transport. */
  result?: unknown;
  /** Capture only: when the message was recorded. */
  capturedAt?: string;
  transportDetail?: EmailTransportDescription;
}

export interface EmailCapturedMessage {
  at: string;
  transport: 'mailjet' | 'smtp' | 'capture' | 'none';
  template?: string;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailCaptureLogInput {
  /** How many recorded messages to return (max 200, default 50). */
  limit?: number;
  /** Empty the buffer after reading. */
  clear?: boolean;
}

export interface EmailCaptureLogResult {
  /** false when EMAIL_CAPTURE is off on the service. */
  enabled: boolean;
  count: number;
  cleared: number;
  emails: EmailCapturedMessage[];
  transport: EmailTransportDescription;
}

export class EmailTool {
  constructor(private readonly core: UmbeliToolsCore) {}

  /** Send a transactional email via Mailjet. */
  send(input: EmailSendInput) {
    return this.core.request<EmailSendResult>('email', 'send', input);
  }

  /** Send via any SMTP server (Outlook/Gmail/Mailgun/infomaniak/custom…). */
  smtpSend(input: EmailSmtpSendInput) {
    return this.core.request<EmailSmtpSendResult>('email', 'smtp-send', input);
  }

  /**
   * Render a branded suite template and send it through Mailjet or SMTP
   * (transport inferred from the credentials shape). With `EMAIL_CAPTURE=1` on
   * the service the message is recorded instead of sent, and returned in
   * `rendered` so a hermetic test can assert what would have gone out.
   */
  sendTemplate(input: EmailSendTemplateInput) {
    return this.core.request<EmailSendTemplateResult>('email', 'send-template', input);
  }

  /** Render a branded template to html + text without sending (previews, snapshot tests, Supabase auth hooks). */
  renderTemplate(input: EmailRenderTemplateInput) {
    return this.core.request<EmailRenderTemplateResult>('email', 'render-template', input);
  }

  /** Test hook: read back what EMAIL_CAPTURE recorded on the service. */
  captureLog(input: EmailCaptureLogInput = {}) {
    return this.core.request<EmailCaptureLogResult>('email', 'capture-log', input);
  }
}
