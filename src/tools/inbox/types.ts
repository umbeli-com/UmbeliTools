export interface InboxLogInquiryInput {
  credentials: {
    baseUrl: string;
    apiToken: string;
  };
  canal: 'instagram' | 'email';
  source?: 'gmail' | 'outlook' | 'instagram' | string;
  expediteur: string;
  sujet?: string;
  texte: string;
  reponse_proposee?: string;
  horodatage?: string;
  external_id?: string;
}

export interface InboxGetStatsInput {
  credentials: {
    baseUrl: string;
    apiToken: string;
  };
  range?: 'today' | 'week' | 'all';
}
