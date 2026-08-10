/**
 * Pure helpers to parse Meta (Instagram / Messenger) webhook payloads.
 *
 * Meta delivers two very different things inside the same envelope:
 *   - `entry[].messaging[]`  → DM events (conversations)
 *   - `entry[].changes[]`    → comments, mentions, story insights, etc.
 *
 * These helpers split / filter the payload so your webhook receiver can act
 * on one stream at a time. No network calls, no credentials.
 */

export type MetaWebhookObject = 'instagram' | 'page' | (string & {});

export interface MetaWebhookPayload {
  object: MetaWebhookObject;
  entry: MetaWebhookEntry[];
}

export interface MetaWebhookEntry {
  id: string;
  time?: number;
  messaging?: MetaMessagingEvent[];
  changes?: MetaChange[];
  [key: string]: unknown;
}

export interface MetaMessagingEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp?: number;
  message?: {
    mid: string;
    text?: string;
    /** `true` when the event was emitted by the IG account itself (outgoing). */
    is_echo?: boolean;
    is_unsupported?: boolean;
    attachments?: Array<{ type: string; payload?: Record<string, unknown> }>;
    /** Present when the DM is a private reply triggered by a comment. */
    referral?: Record<string, unknown>;
    [key: string]: unknown;
  };
  read?: Record<string, unknown>;
  reaction?: Record<string, unknown>;
  postback?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MetaChange {
  field: 'comments' | 'mentions' | 'story_insights' | 'live_comments' | (string & {});
  value: Record<string, unknown>;
}

/** Normalized DM (the only fields you usually care about in a webhook). */
export interface NormalizedMetaDm {
  igAccountId: string;
  senderId: string;
  recipientId: string;
  messageId: string;
  text: string;
  timestamp?: number;
  isEcho: boolean;
  hasAttachments: boolean;
  /** `true` when the DM was triggered by a comment (private reply). */
  isPrivateReplyToComment: boolean;
  raw: MetaMessagingEvent;
}

/** Normalized comment (split out for symmetry; ignore if you only want DMs). */
export interface NormalizedMetaComment {
  igAccountId: string;
  commentId: string;
  text?: string;
  fromId?: string;
  fromUsername?: string;
  mediaId?: string;
  parentId?: string;
  timestamp?: number;
  raw: MetaChange;
}

export interface ExtractDmsOptions {
  /** Drop outgoing echoes (default `true`). */
  excludeEcho?: boolean;
  /** Drop DMs that are private replies to comments (default `false`). */
  excludePrivateReplies?: boolean;
  /** Drop events without `message.text` (default `false`, keep attachment-only DMs). */
  requireText?: boolean;
}

/* ──────────────────────────────────────────────────────────────────────── */

/** Type guard: this messaging event is a DM with a message payload. */
export function isMetaDmEvent(event: MetaMessagingEvent): event is MetaMessagingEvent & { message: NonNullable<MetaMessagingEvent['message']> } {
  return !!event && !!event.message && typeof event.message.mid === 'string';
}

/** Type guard: this change entry is a comment event. */
export function isMetaCommentChange(change: MetaChange): boolean {
  return !!change && change.field === 'comments';
}

/**
 * Return every DM in a Meta webhook payload, normalized and filtered.
 * Comments and all other `changes[]` are ignored.
 */
export function extractMetaDms(
  payload: MetaWebhookPayload | undefined | null,
  opts: ExtractDmsOptions = {},
): NormalizedMetaDm[] {
  const excludeEcho = opts.excludeEcho ?? true;
  const excludePrivateReplies = opts.excludePrivateReplies ?? false;
  const requireText = opts.requireText ?? false;

  const out: NormalizedMetaDm[] = [];
  for (const entry of payload?.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      if (!isMetaDmEvent(event)) continue;

      const isEcho = event.message.is_echo === true;
      const isPrivateReply = !!event.message.referral;
      const hasAttachments = Array.isArray(event.message.attachments) && event.message.attachments.length > 0;
      const text = event.message.text ?? '';

      if (excludeEcho && isEcho) continue;
      if (excludePrivateReplies && isPrivateReply) continue;
      if (requireText && !text) continue;

      out.push({
        igAccountId: entry.id,
        senderId: event.sender.id,
        recipientId: event.recipient.id,
        messageId: event.message.mid,
        text,
        timestamp: event.timestamp,
        isEcho,
        hasAttachments,
        isPrivateReplyToComment: isPrivateReply,
        raw: event,
      });
    }
  }
  return out;
}

/**
 * Return every comment in a Meta webhook payload, normalized.
 * DMs and all other `changes[]` are ignored.
 */
export function extractMetaComments(payload: MetaWebhookPayload | undefined | null): NormalizedMetaComment[] {
  const out: NormalizedMetaComment[] = [];
  for (const entry of payload?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (!isMetaCommentChange(change)) continue;
      const v = change.value as Record<string, any>;
      out.push({
        igAccountId: entry.id,
        commentId: String(v.id ?? ''),
        text: v.text,
        fromId: v.from?.id,
        fromUsername: v.from?.username,
        mediaId: v.media?.id,
        parentId: v.parent_id,
        timestamp: typeof v.created_time === 'number' ? v.created_time : entry.time,
        raw: change,
      });
    }
  }
  return out;
}

/** Split a webhook payload into `{ dms, comments }` in one pass. */
export function splitMetaWebhook(
  payload: MetaWebhookPayload | undefined | null,
  opts: ExtractDmsOptions = {},
): { dms: NormalizedMetaDm[]; comments: NormalizedMetaComment[] } {
  return {
    dms: extractMetaDms(payload, opts),
    comments: extractMetaComments(payload),
  };
}
