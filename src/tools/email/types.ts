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
