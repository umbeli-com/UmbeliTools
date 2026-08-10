import { UmbeliToolsCore } from '../client.js';

export interface InboxCredentials {
  /** Base URL of the BusinessInbox/Ciao instance, e.g. `https://samtr.umbeli.com`. */
  baseUrl: string;
  apiToken: string;
}

export interface InboxLogInquiryInput {
  credentials: InboxCredentials;
  canal: 'instagram' | 'email';
  source?: 'gmail' | 'outlook' | 'instagram' | (string & {});
  expediteur: string;
  sujet?: string;
  texte: string;
  reponse_proposee?: string;
  horodatage?: string;
  external_id?: string;
}

export interface InboxGetStatsInput {
  credentials: InboxCredentials;
  range?: 'today' | 'week' | 'all';
}

export class InboxTool {
  constructor(private readonly core: UmbeliToolsCore) {}

  /** Log an inquiry into a BusinessInbox/Ciao instance. */
  logInquiry(input: InboxLogInquiryInput) {
    return this.core.request<Record<string, unknown>>('inbox', 'log-inquiry', input);
  }

  getStats(input: InboxGetStatsInput) {
    return this.core.request<Record<string, unknown>>('inbox', 'get-stats', input);
  }
}
