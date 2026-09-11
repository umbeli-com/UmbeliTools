import { ToolError } from '../../lib/errors';
import type { AIContentBlock, AIImageContentBlock, AIMessage } from './types';

/**
 * Provider-neutral message normalisation. Every adapter maps from these parts,
 * so image handling is defined once and the per-provider wire formats (which
 * genuinely differ) stay isolated in the adapters.
 */

export interface NormalizedTextPart {
  kind: 'text';
  text: string;
}

export interface NormalizedImagePart {
  kind: 'image';
  /** Set when the caller passed a remote URL. */
  url?: string;
  /** Set when the caller passed base64 (data URL or bare). */
  base64?: string;
  mediaType?: string;
}

export type NormalizedPart = NormalizedTextPart | NormalizedImagePart;

export type NormalizedRole = 'user' | 'assistant' | 'system';

export interface NormalizedMessage {
  role: NormalizedRole;
  parts: NormalizedPart[];
}

const DATA_URL_RE = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([\s\S]+)$/i;
const HTTP_URL_RE = /^https?:\/\//i;
const BASE64_RE = /^[A-Za-z0-9+/=\s]+$/;

/** Magic-byte prefixes so a bare base64 payload does not force a mediaType. */
const BASE64_SIGNATURES: Array<[string, string]> = [
  ['/9j/', 'image/jpeg'],
  ['iVBORw0KGgo', 'image/png'],
  ['R0lGOD', 'image/gif'],
  ['UklGR', 'image/webp'],
];

function sniffMediaType(base64: string): string | undefined {
  for (const [prefix, mediaType] of BASE64_SIGNATURES) {
    if (base64.startsWith(prefix)) return mediaType;
  }
  return undefined;
}

function isImageBlock(block: AIContentBlock): block is AIImageContentBlock {
  return block.type === 'image' || block.type === 'image_url';
}

function normalizeRole(role: unknown): NormalizedRole {
  const value = typeof role === 'string' ? role.toLowerCase() : 'user';
  if (value === 'assistant' || value === 'model' || value === 'ai') return 'assistant';
  if (value === 'system' || value === 'developer') return 'system';
  return 'user';
}

function normalizeImagePart(block: AIImageContentBlock, where: string): NormalizedImagePart {
  let raw: string | undefined;
  let mediaType: string | undefined = block.mediaType ?? block.media_type;

  if (typeof block.image === 'string') raw = block.image;
  else if (typeof block.url === 'string') raw = block.url;
  else if (typeof block.image_url === 'string') raw = block.image_url;
  else if (block.image_url && typeof block.image_url === 'object' && typeof block.image_url.url === 'string') {
    raw = block.image_url.url;
  } else if (typeof block.source === 'string') raw = block.source;
  else if (block.source && typeof block.source === 'object') {
    if (typeof block.source.url === 'string') raw = block.source.url;
    else if (typeof block.source.data === 'string') {
      raw = block.source.data;
      mediaType = mediaType ?? block.source.media_type ?? block.source.mediaType;
    }
  }

  raw = raw?.trim();
  if (!raw) {
    throw new ToolError(
      'INVALID_FIELD',
      `${where}: image block needs an "image" value (data URL, bare base64, or https URL)`,
    );
  }

  const dataUrl = DATA_URL_RE.exec(raw);
  if (dataUrl) {
    return { kind: 'image', base64: dataUrl[2].replace(/\s/g, ''), mediaType: dataUrl[1].toLowerCase() };
  }

  if (HTTP_URL_RE.test(raw)) {
    return { kind: 'image', url: raw };
  }

  const base64 = raw.replace(/\s/g, '');
  if (!BASE64_RE.test(raw) || base64.length < 32) {
    throw new ToolError(
      'INVALID_FIELD',
      `${where}: image value is neither a data URL, an http(s) URL, nor base64 image data`,
    );
  }

  const resolved = mediaType?.trim().toLowerCase() || sniffMediaType(base64);
  if (!resolved) {
    throw new ToolError('INVALID_FIELD', `${where}: bare base64 image needs "mediaType" (e.g. "image/png")`);
  }

  return { kind: 'image', base64, mediaType: resolved };
}

function normalizeParts(content: unknown, where: string): NormalizedPart[] {
  if (typeof content === 'string') {
    return content.length ? [{ kind: 'text', text: content }] : [];
  }

  if (!Array.isArray(content)) {
    throw new ToolError('INVALID_FIELD', `${where}: content must be a string or an array of content blocks`);
  }

  const parts: NormalizedPart[] = [];
  content.forEach((entry, index) => {
    const at = `${where}.content[${index}]`;
    if (typeof entry === 'string') {
      if (entry.length) parts.push({ kind: 'text', text: entry });
      return;
    }
    if (!entry || typeof entry !== 'object') {
      throw new ToolError('INVALID_FIELD', `${at}: content blocks must be objects`);
    }

    const block = entry as AIContentBlock;
    if (isImageBlock(block)) {
      parts.push(normalizeImagePart(block, at));
      return;
    }
    if (block.type === 'text') {
      if (typeof block.text !== 'string') {
        throw new ToolError('INVALID_FIELD', `${at}: text block needs a string "text"`);
      }
      if (block.text.length) parts.push({ kind: 'text', text: block.text });
      return;
    }
    throw new ToolError('INVALID_FIELD', `${at}: unsupported block type "${String((block as { type?: unknown }).type)}"`);
  });

  return parts;
}

export function normalizeMessages(messages: AIMessage[]): NormalizedMessage[] {
  return messages.map((message, index) => {
    if (!message || typeof message !== 'object') {
      throw new ToolError('INVALID_FIELD', `messages[${index}]: must be an object`);
    }
    return {
      role: normalizeRole(message.role),
      parts: normalizeParts(message.content, `messages[${index}]`),
    };
  });
}

/**
 * Route-level validation: throws a ToolError the handler turns into a 400 so a
 * malformed image block never reaches a provider and comes back as a 502.
 */
export function validateMessages(messages: unknown): NormalizedMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new ToolError('MISSING_FIELDS', 'messages array is required');
  }
  const normalized = normalizeMessages(messages as AIMessage[]);
  if (!normalized.some((m) => m.role !== 'system')) {
    throw new ToolError('INVALID_FIELD', 'messages must contain at least one user or assistant message');
  }
  if (!normalized.some((m) => m.parts.length > 0)) {
    throw new ToolError('MISSING_FIELDS', 'messages must contain at least one non-empty content block');
  }
  // A system message alone carries no conversation: every adapter drops it into
  // the `system` parameter and would then post an EMPTY messages array, which
  // each provider rejects with its own 400 (billed round-trip, reported as a 502
  // PROVIDER_ERROR). Catch it here so the caller gets the real reason.
  if (!normalized.some((m) => m.role !== 'system' && m.parts.length > 0)) {
    throw new ToolError(
      'MISSING_FIELDS',
      'messages must contain at least one non-empty user or assistant message (a system message alone is not a conversation)',
    );
  }
  return normalized;
}

export function partsToText(parts: NormalizedPart[]): string {
  return parts
    .filter((p): p is NormalizedTextPart => p.kind === 'text')
    .map((p) => p.text)
    .join('\n')
    .trim();
}

export function hasImages(messages: NormalizedMessage[]): boolean {
  return messages.some((m) => m.parts.some((p) => p.kind === 'image'));
}

export function toDataUrl(part: NormalizedImagePart): string | undefined {
  if (part.url) return part.url;
  if (part.base64) return `data:${part.mediaType || 'image/png'};base64,${part.base64}`;
  return undefined;
}
