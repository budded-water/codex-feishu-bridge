import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';

if (process.argv.includes('--version')) {
  const version = readFileSync(new URL('../../src/codex/generated/version.ts', import.meta.url), 'utf8').match(/CODEX_VERSION = '([^']+)'/)[1];
  console.log(`codex-cli ${version}`);
  process.exit(0);
}
const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);
let initialized = false;
const lines = createInterface({ input: process.stdin });
lines.on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') send({ id: message.id, result: {} });
  else if (message.method === 'initialized') initialized = true;
  else if (message.method === 'echo') setTimeout(() => send({ id: message.id, result: { value: message.params.value, initialized } }), message.params.delay ?? 0);
  else if (['turn/start', 'thread/resume', 'turn/steer'].includes(message.method)) send({ id: message.id, result: message.params });
  else if (message.method === 'env') send({ id: message.id, result: { secretPresent: Boolean(process.env.FEISHU_APP_SECRET) } });
  else if (message.method === 'ask') {
    send({ id: 'server-approval', method: 'item/commandExecution/requestApproval', params: { command: 'echo hello' } });
    send({ id: message.id, result: {} });
  } else if (message.id === 'server-approval') send({ method: 'approval/responded', params: message.result });
  else if (message.method === 'malformed') process.stdout.write('invalid json\n');
  else if (message.method === 'die') process.exit(0);
});
lines.on('close', () => process.exit(0));
