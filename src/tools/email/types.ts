export interface EmailSendInput {
  credentials: {
    apiKey: string;
    secretKey: string;
  };
  from: { email: string; name?: string };
  to: { email: string; name?: string }[];
  subject: string;
  htmlBody: string;
}

export interface EmailSmtpSendInput {
  credentials: {
    host: string;
    port?: number;
    secure?: boolean;
    user: string;
    password: string;
  };
  from: { email: string; name?: string };
  to: string;
  subject: string;
  text?: string;
  html?: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
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

/** Per-app branding. Everything here is sanitized before it reaches the HTML. */
export interface EmailBranding {
  /** SaaS name shown in the lockup + subjects (Anonymum, Dialum, Webum…). */
  appName?: string;
  /** Absolute https URL of the app logo. Falls back to an initial badge. */
  logoUrl?: string;
  /** Hex color (#rrggbb or #rgb). Anything else falls back to the Umbelium indigo. */
  primaryColor?: string;
  /** Umbrella company name in the footer/signature. Defaults to "Umbelium". */
  companyName?: string;
  /** Support address in the footer/signature. Defaults to contact@umbeli.com. */
  supportEmail?: string;
  /** Public app URL linked in the footer. */
  baseUrl?: string;
  /** Copy language. Defaults to 'fr' (the suite's default). */
  locale?: 'fr' | 'en';
}

/**
 * Template variables. Every value is HTML-escaped at render time — pass plain
 * text, never HTML. Unknown keys are ignored by the renderers.
 */
export interface EmailTemplateVars {
  /** Recipient display name for the greeting. */
  name?: string;
  /** The one-click link for auth.* templates (Supabase verify URL, invite link…). */
  actionUrl?: string;
  ctaUrl?: string;
  ctaLabel?: string;
  url?: string;
  appUrl?: string;
  /** Override the generated subject. */
  subject?: string;
  /** Override the generated H1. */
  heading?: string;
  title?: string;
  /** Hidden inbox preview line. */
  preheader?: string;
  /** Body copy (notification / welcome). Blank lines become paragraphs. */
  message?: string;
  body?: string;
  /** Small note under the card. */
  footerNote?: string;
  /** form-submission: the submitted fields, in order. */
  fields?: Array<{ label?: unknown; value?: unknown; [key: string]: unknown }> | Record<string, unknown>;
  /** form-submission: Webum's raw submission payload (alias of `fields`). */
  data?: Record<string, unknown>;
  submission?: Record<string, unknown>;
  siteName?: string;
  site?: string;
  formName?: string;
  formId?: string;
  form?: string;
  page?: string;
  pageUrl?: string;
  submittedAt?: string | number | Date;
  createdAt?: string | number | Date;
  [key: string]: unknown;
}

/** What a renderer produces. */
export interface RenderedEmail {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  /** Suggested From display name ("Webum · Umbelium"). */
  fromName: string;
}

export interface EmailMailjetCredentials {
  apiKey: string;
  secretKey: string;
}

export interface EmailSmtpCredentials {
  host: string;
  port?: number;
  secure?: boolean;
  user: string;
  password: string;
}

/** send-template accepts either transport's credentials. */
export type EmailTemplateCredentials = Partial<EmailMailjetCredentials> & Partial<EmailSmtpCredentials>;

export type EmailTransportChoice = 'mailjet' | 'smtp' | 'auto';

export interface EmailRenderTemplateInput {
  template: EmailTemplateName;
  vars?: EmailTemplateVars;
  branding?: EmailBranding;
  /** Optional: describe which transport WOULD be used for these credentials. */
  credentials?: EmailTemplateCredentials;
  transport?: EmailTransportChoice;
}

export interface EmailSendTemplateInput {
  credentials: EmailTemplateCredentials;
  /** Force a transport. Default 'auto' = infer from the credentials shape. */
  transport?: EmailTransportChoice;
  template: EmailTemplateName;
  vars?: EmailTemplateVars;
  branding?: EmailBranding;
  from: { email: string; name?: string };
  /** One address, an {email,name}, or a list of either. */
  to: string | { email: string; name?: string } | Array<string | { email: string; name?: string }>;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  /** Override the template's subject. */
  subject?: string;
  /** Echo the rendered html/text back in the response (previews, tests). */
  returnRendered?: boolean;
}
