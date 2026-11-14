import type { Config } from '../config.js';
import type { IncomingMessage } from '../types.js';
import type { PilotScope } from './gateway.js';

export function isMaintenanceOwner(scope: PilotScope, config: Config, message: IncomingMessage): boolean {
  return message.tenant === scope.tenant && message.user === scope.operator && message.chat === scope.chat &&
    message.chatType === 'p2p' && config.approvalUsers.includes(message.user) &&
    message.chat === (config.approvalChat ?? scope.chat) &&
    (config.accessMode !== 'allowlist' || config.allowedUsers.includes(message.user));
}
