import type { Request, Response, NextFunction } from 'express';
import { ENV } from '../config/env';

export function serviceKeyMiddleware(req: Request, res: Response, next: NextFunction) {
  const key = ENV.UMBELIUM_SERVICE_KEY;
  if (!key) {
    return res.status(500).json({ ok: false, error: { code: 'CONFIG_ERROR', message: 'UMBELIUM_SERVICE_KEY is not configured' } });
  }
  const provided = req.headers['x-service-key'];
  if (!provided || provided !== key) {
    return res.status(401).json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or missing x-service-key' } });
  }
  return next();
}
