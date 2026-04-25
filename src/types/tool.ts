import type { Router } from 'express';

export interface ToolDefinition {
  name: string;
  description: string;
  actions: ToolAction[];
  router: Router;
}

export interface ToolAction {
  action: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
