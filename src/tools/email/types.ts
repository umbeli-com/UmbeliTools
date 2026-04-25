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
