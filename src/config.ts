import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { MAX_CONTEXT_MESSAGES, MAX_CONTEXT_IMAGES } from './context-limits.js';
import { record } from './types.js';

export interface Config {
  allowedUsers: string[];
  accessMode: 'allowlist' | 'tenant';
  allowedTenant: string | null;
  enableGroups: boolean;
  groupContextMessages: number;
  groupContextImages: number;
  approvalUsers: string[];
  approvalChat: string | null;
  codexExecutable: string;
  stateDirectory: string;
  approvalTimeoutSeconds: number;
  projects: Record<string, string>;
  projectRouting: 'automatic' | 'manual';
}

export function loadConfig(filename = 'bridge.config.json'): Config {
  const path = resolve(filename);
  const value = record(JSON.parse(readFileSync(path, 'utf8')));
  const fields = ['allowedUsers', 'accessMode', 'allowedTenant', 'enableGroups', 'groupContextMessages', 'groupContextImages', 'approvalUsers', 'approvalChat', 'codexExecutable', 'stateDirectory', 'approvalTimeoutSeconds', 'projects', 'projectRouting'];
  if (Object.keys(value).some(key => !fields.includes(key))) throw new Error('Unknown bridge configuration field');
  const accessMode = value.accessMode ?? 'allowlist';
  if (accessMode !== 'allowlist' && accessMode !== 'tenant') throw new Error('Invalid accessMode');
  const ids = (input: unknown, field: string): string[] => {
    if (!Array.isArray(input) || !input.length || input.some(id => typeof id !== 'string' || !/^ou_[\w-]+$/.test(id)) || new Set(input).size !== input.length) {
      throw new Error(`${field} must contain distinct real Feishu open_id values (ou_...)`);
    }
    return input as string[];
  };
  const allowedUsers = ids(value.allowedUsers, 'allowedUsers');
  const approvalUsers = ids(value.approvalUsers ?? allowedUsers, 'approvalUsers');
  const allowedTenant = value.allowedTenant ?? null;
  if (allowedTenant !== null && (typeof allowedTenant !== 'string' || !/^[\w-]+$/.test(allowedTenant))) throw new Error('Invalid allowedTenant');
  if (accessMode === 'tenant' && !allowedTenant) throw new Error('Tenant access requires an explicit allowedTenant');
  if (accessMode === 'allowlist' && approvalUsers.some(id => !allowedUsers.includes(id))) throw new Error('Approvers must also be in allowedUsers');
  const enableGroups = value.enableGroups ?? false;
  if (typeof enableGroups !== 'boolean') throw new Error('Invalid enableGroups');
  const groupContextMessages = value.groupContextMessages ?? 0;
  if (!Number.isInteger(groupContextMessages) || typeof groupContextMessages !== 'number' || groupContextMessages < 0 || groupContextMessages > MAX_CONTEXT_MESSAGES) throw new Error(`groupContextMessages must be an integer from 0 to ${MAX_CONTEXT_MESSAGES}`);
  const groupContextImages = value.groupContextImages ?? 0;
  if (typeof groupContextImages !== 'number' || !Number.isInteger(groupContextImages) || groupContextImages < 0 || groupContextImages > MAX_CONTEXT_IMAGES) throw new Error(`groupContextImages must be an integer from 0 to ${MAX_CONTEXT_IMAGES}`);
  const approvalChat = value.approvalChat ?? null;
  if (approvalChat !== null && (typeof approvalChat !== 'string' || !/^oc_[\w-]+$/.test(approvalChat))) throw new Error('Invalid approvalChat');
  const executable = value.codexExecutable ?? 'codex';
  if (typeof executable !== 'string' || !executable.trim()) throw new Error('Invalid codexExecutable');
  const state = value.stateDirectory ?? '.local/state';
  if (typeof state !== 'string' || !state.trim()) throw new Error('Invalid stateDirectory');
  const timeout = value.approvalTimeoutSeconds ?? 300;
  if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 10 || timeout > 3600) {
    throw new Error('approvalTimeoutSeconds must be an integer between 10 and 3600');
  }
  const projects: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [alias, directory] of Object.entries(record(value.projects))) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(alias) || typeof directory !== 'string' || !isAbsolute(directory)) {
      throw new Error('Projects must use short aliases and absolute directory paths');
    }
    const canonical = realpathSync(directory);
    if (!statSync(canonical).isDirectory()) throw new Error('Project path is not a directory');
    projects[alias] = canonical;
  }
  if (!Object.keys(projects).length) throw new Error('Register at least one project');
  const projectRouting = value.projectRouting ?? 'automatic';
  if (projectRouting !== 'automatic' && projectRouting !== 'manual') throw new Error('Invalid projectRouting');
  return {
    allowedUsers, accessMode, allowedTenant, enableGroups, groupContextMessages, groupContextImages, approvalUsers, approvalChat, codexExecutable: executable,
    stateDirectory: resolve(dirname(path), state), approvalTimeoutSeconds: timeout, projects, projectRouting,
  };
}

export function credentials(): { appId: string; appSecret: string } {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !/^cli_[0-9a-fA-F]{16}$/.test(appId) || !appSecret || appSecret === 'your_app_secret') {
    throw new Error('Set valid FEISHU_APP_ID (cli_ plus 16 hex digits) and FEISHU_APP_SECRET in the local environment');
  }
  return { appId, appSecret };
}
