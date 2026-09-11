/**
 * Transport resolution + the EMAIL_CAPTURE test hook.
 *
 * EMAIL_CAPTURE is SERVICE-level config (like PORT), never a caller secret:
 * when it is on, /email/send-template renders the message, records exactly what
 * WOULD have been sent, and returns it — no Mailjet call, no SMTP connection.
 * A hermetic E2E can then assert on the recorded message instead of on a real
 * inbox. Same switch as UmbeliumManager's email.service.js (EMAIL_CAPTURE=1).
 */

import type { EmailTemplateCredentials, EmailTransportChoice } from './types';

export type EmailTransportName = 'mailjet' | 'smtp' | 'capture' | 'none';

export interface TransportDescription {
  /** What would actually handle the send right now. */
  transport: EmailTransportName;
  /** The transport that would be used if capture were off. */
  wouldUse: Exclude<EmailTransportName, 'capture'>;
  /** true when EMAIL_CAPTURE is on — nothing leaves the process. */
  capture: boolean;
  /** false when no usable credentials were supplied. */
  sends: boolean;
  reason: string;
}

export interface CapturedEmail {
  at: string;
  transport: EmailTransportName;
  template?: string;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
}

const MAX_CAPTURED = 200;
const captured: CapturedEmail[] = [];

/** EMAIL_CAPTURE=1|true|yes|on records instead of sending. */
export function isCaptureEnabled(): boolean {
  const raw = String(process.env.EMAIL_CAPTURE ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/** Record a message that would have been sent. Returns the stored entry. */
export function captureEmail(entry: Omit<CapturedEmail, 'at' | 'transport'> & { transport?: EmailTransportName }): CapturedEmail {
  const stored: CapturedEmail = { at: new Date().toISOString(), transport: 'capture', ...entry };
  captured.push(stored);
  if (captured.length > MAX_CAPTURED) captured.splice(0, captured.length - MAX_CAPTURED);
  return stored;
}

/** Most recent first. */
export function getCapturedEmails(limit = 50): CapturedEmail[] {
  const n = Math.max(1, Math.min(MAX_CAPTURED, Math.floor(limit) || 50));
  return captured.slice(-n).reverse();
}

export function clearCapturedEmails(): number {
  const n = captured.length;
  captured.length = 0;
  return n;
}

function hasMailjet(c?: EmailTemplateCredentials): boolean {
  return Boolean(c?.apiKey && c?.secretKey);
}

function hasSmtp(c?: EmailTemplateCredentials): boolean {
  return Boolean(c?.host && c?.user && c?.password);
}

/**
 * Which transport will actually carry this message, given the per-request
 * credentials and the EMAIL_CAPTURE switch. Exposed so a caller (or a test) can
 * ask "what would you do with this?" without sending anything.
 */
export function describeTransport(
  credentials?: EmailTemplateCredentials,
  requested: EmailTransportChoice = 'auto',
): TransportDescription {
  const capture = isCaptureEnabled();
  let wouldUse: Exclude<EmailTransportName, 'capture'> = 'none';
  let reason: string;

  if (requested === 'mailjet') {
    wouldUse = hasMailjet(credentials) ? 'mailjet' : 'none';
    reason = wouldUse === 'mailjet' ? 'transport forced to mailjet' : 'mailjet forced but credentials.apiKey/secretKey missing';
  } else if (requested === 'smtp') {
    wouldUse = hasSmtp(credentials) ? 'smtp' : 'none';
    reason = wouldUse === 'smtp' ? 'transport forced to smtp' : 'smtp forced but credentials.host/user/password missing';
  } else if (hasMailjet(credentials)) {
    wouldUse = 'mailjet';
    reason = 'mailjet credentials supplied';
  } else if (hasSmtp(credentials)) {
    wouldUse = 'smtp';
    reason = 'smtp credentials supplied';
  } else {
    reason = 'no usable credentials supplied';
  }

  return {
    transport: capture ? 'capture' : wouldUse,
    wouldUse,
    capture,
    sends: !capture && wouldUse !== 'none',
    reason: capture ? `EMAIL_CAPTURE is on — recorded, not sent (${reason})` : reason,
  };
}
