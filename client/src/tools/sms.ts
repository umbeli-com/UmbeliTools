import { UmbeliToolsCore } from '../client.js';

export interface SmsSendInput {
  credentials: {
    accountSid: string;
    authToken: string;
    /** Twilio phone number or WhatsApp number (with or without `whatsapp:` prefix). */
    from: string;
  };
  to: string;
  body: string;
  channel?: 'sms' | 'whatsapp';
}

export interface SmsSendResult {
  sid: string;
  status: string;
  to: string;
  from: string;
}

export class SmsTool {
  constructor(private readonly core: UmbeliToolsCore) {}

  /** Send an SMS or WhatsApp message via Twilio. */
  send(input: SmsSendInput) {
    return this.core.request<SmsSendResult>('sms', 'send', input);
  }
}
