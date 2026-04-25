import express from 'express';
import { ENV, validateEnv } from './config/env';
import { serviceKeyMiddleware } from './middleware/serviceKey.middleware';
import { requestLogger } from './middleware/requestLogger.middleware';
import { mountTools } from './tools';

validateEnv();

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(requestLogger);

// Health check (no auth required)
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'umbeli-tools', version: '1.0.0' });
});

// All /api routes require service key
const api = express.Router();
api.use(serviceKeyMiddleware);
mountTools(api);
app.use('/api', api);

app.listen(ENV.PORT, () => {
  console.log(`[UmbeliTools] Running on port ${ENV.PORT} (${ENV.NODE_ENV})`);
});
