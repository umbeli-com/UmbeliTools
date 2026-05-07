export interface SearchGoogleInput {
  credentials: {
    apiKey: string;
  };
  query: string;
  country?: string;
  language?: string;
  numResults?: number;
  page?: number;
}
