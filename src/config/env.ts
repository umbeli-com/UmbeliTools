export const ENV = {
  PORT: parseInt(process.env.PORT || '3002', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  UMBELIUM_SERVICE_KEY: process.env.UMBELIUM_SERVICE_KEY || '',
};

export function validateEnv() {
  if (!ENV.UMBELIUM_SERVICE_KEY) {
    console.warn('[env] UMBELIUM_SERVICE_KEY is not set — all requests will be rejected');
  }
}
