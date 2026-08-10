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
}
