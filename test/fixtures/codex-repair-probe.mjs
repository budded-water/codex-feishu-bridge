// Scripted app-server for the explicit isolated repair probe. No model inference.
import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
if (process.argv.includes('--version')) {
  console.log('codex-cli ' + readFileSync(new URL('../../src/codex/generated/version.ts', import.meta.url), 'utf8').match(/CODEX_VERSION = '([^']+)'/)[1]); process.exit(0);
}
const send = data => process.stdout.write(JSON.stringify(data) + '\n');
let thread, turn;
createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line), p = m.params;
  const reply = value => send({ id: m.id, result: value });
  if (m.method === 'initialize') reply({});
  else if (m.method === 'thread/start' || m.method === 'thread/resume') { thread = p.threadId ?? randomUUID(); reply({ thread: { id: thread } }); }
  else if (m.method === 'turn/start') {
    turn = randomUUID(); const repair = p.input[0].text.startsWith('这是本任务已授权的唯一一轮修复');
    appendFileSync(process.argv[2], JSON.stringify({ thread, turn, pid: process.pid, repair }) + '\n');
    if (repair) { const page = process.argv[3]; writeFileSync(page, readFileSync(page, 'utf8').replace('BROKEN_TITLE', 'REPAIRED_TITLE')); }
    reply({ turn: { id: turn, status: 'inProgress' } }); send({ method: 'turn/started', params: { threadId: thread, turn: { id: turn, status: 'inProgress' } } });
    setTimeout(() => {
      send({ method: 'item/completed', params: { threadId: thread, turnId: turn, item: { type: 'agentMessage', id: 'answer', phase: 'final_answer', text: repair ? 'REPAIR_PROBE_FIXED' : 'REPAIR_PROBE_FIRST' } } });
      send({ method: 'turn/completed', params: { threadId: thread, turn: { id: turn, status: 'completed' } } });
    }, 50);
  } else if (m.method === 'turn/interrupt') { reply({}); send({ method: 'turn/completed', params: { threadId: thread, turn: { id: turn, status: 'interrupted' } } }); }
  else if (m.id !== undefined) reply({});
});
