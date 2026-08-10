import { UmbeliToolsCore } from './client.js';
import type { UmbeliToolsClientOptions } from './types.js';
import { EmailTool } from './tools/email.js';
import { AiTool } from './tools/ai.js';
import { AnonymiumTool } from './tools/anonymium.js';
import { SocialTool } from './tools/social.js';
import { SmsTool } from './tools/sms.js';
import { WebhookTool } from './tools/webhook.js';
import { GmailTool } from './tools/gmail.js';
import { OutlookTool } from './tools/outlook.js';
import { InboxTool } from './tools/inbox.js';
import { ScrapeTool } from './tools/scrape.js';
import { SearchTool } from './tools/search.js';
import { DnsTool } from './tools/dns.js';
import { DomainTool } from './tools/domain.js';

/**
 * Typed client for the UmbeliTools service.
 *
 * @example
 * ```ts
 * import { UmbeliTools } from '@umbeli-com/tools';
 *
 * const tools = new UmbeliTools({
 *   url: process.env.UMBELITOOLS_URL!,
 *   serviceKey: process.env.UMBELIUM_SERVICE_KEY!,
 * });
 *
 * await tools.email.send({ ... });
 * await tools.ai.complete({ ... });
 * ```
 */
export class UmbeliTools extends UmbeliToolsCore {
  readonly email: EmailTool;
  readonly ai: AiTool;
  readonly anonymium: AnonymiumTool;
  readonly social: SocialTool;
  readonly sms: SmsTool;
  readonly webhook: WebhookTool;
  readonly gmail: GmailTool;
  readonly outlook: OutlookTool;
  readonly inbox: InboxTool;
  readonly scrape: ScrapeTool;
  readonly search: SearchTool;
  readonly dns: DnsTool;
  readonly domain: DomainTool;

  constructor(opts: UmbeliToolsClientOptions) {
    super(opts);
    this.email = new EmailTool(this);
    this.ai = new AiTool(this);
    this.anonymium = new AnonymiumTool(this);
    this.social = new SocialTool(this);
    this.sms = new SmsTool(this);
    this.webhook = new WebhookTool(this);
    this.gmail = new GmailTool(this);
    this.outlook = new OutlookTool(this);
    this.inbox = new InboxTool(this);
    this.scrape = new ScrapeTool(this);
    this.search = new SearchTool(this);
    this.dns = new DnsTool(this);
    this.domain = new DomainTool(this);
  }
}

/** Functional sugar over `new UmbeliTools(...)`. */
export function createUmbeliTools(opts: UmbeliToolsClientOptions): UmbeliTools {
  return new UmbeliTools(opts);
}

export { UmbeliToolsCore } from './client.js';
export { UmbeliToolsError } from './types.js';
export type { UmbeliToolsClientOptions, ToolMeta, ToolResponse } from './types.js';
export * from './tools/index.js';
