import { randomUUID } from 'node:crypto';
import { credentials } from './config.js';
import { Feishu } from './feishu.js';

// Explicit enrollment mode: receives one challenge message, never runs Codex or sends a reply.
async function identify(): Promise<void> {
  const feishu = new Feishu(credentials());
  const challenge = `pair ${randomUUID()}`;
  let stopped = false;
  const timeout = setTimeout(() => { close(); process.exitCode = 1; }, 15 * 60_000);
  const close = (): void => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timeout);
    feishu.close();
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  console.log(`Send this exact private message to the bot within 15 minutes: ${challenge}`);
  try {
    await feishu.start(message => {
      if (stopped || message.text.trim() !== challenge) return;
      console.log(`Set allowedUsers to ${JSON.stringify([message.user])} in your private bridge.config.json.`);
      console.log(`Tenant: ${message.tenant}; owner private approval chat: ${message.chat}. Use the enrolled open ID for approvalUsers.`);
      close();
    });
  } catch {
    close();
    throw new Error('Enrollment connection failed; verify Feishu application configuration');
  }
}

void identify().catch(() => { console.error('Enrollment failed; no Codex task was started'); process.exitCode = 1; });
