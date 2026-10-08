import type { Config } from './config.js';
import type { JsonValue } from './codex/generated/serde_json/JsonValue.js';
import { record, type CodexPort } from './types.js';

export interface RouteDecision { kind: 'answer' | 'question' | 'project'; project: string | null; text: string; continuePending: boolean }

export function routeSchema(config: Pick<Config, 'projects'>): JsonValue {
  return { title: 'BridgeRoute', type: 'object', additionalProperties: false,
    required: ['kind', 'project', 'text', 'continuePending'], properties: {
      kind: { type: 'string', enum: ['answer', 'question', 'project'] },
      project: { anyOf: [{ type: 'string', enum: ['$chat', ...Object.keys(config.projects)] }, { type: 'null' }] },
      text: { type: 'string' }, continuePending: { type: 'boolean' },
    } };
}

export function parseRoute(text: string, config: Pick<Config, 'projects'>): RouteDecision {
  const value = record(JSON.parse(text));
  if (Object.keys(value).some(key => !['kind', 'project', 'text', 'continuePending'].includes(key)) ||
      !['answer', 'question', 'project'].includes(String(value.kind)) || typeof value.text !== 'string' ||
      typeof value.continuePending !== 'boolean' || value.text.length > 30_000 ||
      (value.kind === 'project' ? typeof value.project !== 'string' || (value.project !== '$chat' && !Object.hasOwn(config.projects, value.project)) || value.text !== ''
        : value.project !== null || !value.text.trim())) throw new Error('Invalid project decision');
  return value as unknown as RouteDecision;
}

// Routing is a separate, tool-disabled thread. Execution inherits local policies.
export async function routingConfig(codex: CodexPort): Promise<Record<string, JsonValue>> {
  const response = record(await codex.request('config/read', { includeLayers: false }));
  const config = record(response.config);
  const disabled = (value: unknown): Record<string, JsonValue> => Object.fromEntries(Object.keys(record(value)).map(key => [key, { enabled: false }]));
  return { features: { shell_tool: false, unified_exec: false, apps: false, multi_agent: false, code_mode: false },
    web_search: 'disabled', mcp_servers: disabled(config.mcp_servers), plugins: disabled(config.plugins) };
}
