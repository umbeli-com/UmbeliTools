import { Router } from 'express';
import type { ToolDefinition } from '../types/tool';
import { emailTool } from './email';
import { aiTool } from './ai';
import { socialTool } from './social';
import { smsTool } from './sms';
import { webhookTool } from './webhook';
import { gmailTool } from './gmail';
import { outlookTool } from './outlook';
import { inboxTool } from './inbox';
import { scrapeTool } from './scrape';
import { searchTool } from './search';
import { dnsTool } from './dns';
import { domainTool } from './domain';
import { anonymiumTool } from './anonymium';
import { storageTool } from './storage';
import { oauthTool } from './oauth';
import { eventsTool } from './events';

const allTools: ToolDefinition[] = [
  emailTool,
  aiTool,
  socialTool,
  smsTool,
  webhookTool,
  gmailTool,
  outlookTool,
  inboxTool,
  scrapeTool,
  searchTool,
  dnsTool,
  domainTool,
  anonymiumTool,
  storageTool,
  oauthTool,
  eventsTool,
];

export function mountTools(parentRouter: Router) {
  for (const tool of allTools) {
    parentRouter.use(`/tools/${tool.name}`, tool.router);
  }

  parentRouter.get('/tools', (_req, res) => {
    res.json({
      ok: true,
      data: {
        tools: allTools.map((t) => ({
          name: t.name,
          description: t.description,
          actions: t.actions.map((a) => ({
            action: a.action,
            description: a.description,
            endpoint: `POST /api/tools/${t.name}/${a.action}`,
            inputSchema: a.inputSchema,
          })),
        })),
      },
    });
  });
}
