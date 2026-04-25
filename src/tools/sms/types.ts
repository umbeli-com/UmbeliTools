export interface SmsSendInput {
  credentials: {
    accountSid: string;
    authToken: string;
    from: string;
  };
  to: string;
  body: string;
  channel?: 'sms' | 'whatsapp';
}
