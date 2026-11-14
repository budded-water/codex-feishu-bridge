// Standalone agent plugin using the public Turn fields and documented worker context.
type Turn = { cwd: string; contextFile: string };
const blocked = 'Native execution requires reconciliation; no automatic replay.\n\n```agent-autoloop\n' +
  JSON.stringify({ ask: [{ key: 'native-outcome-unconfirmed', title: 'Check the previous execution before continuing',
    text: 'Inspect the retained execution and its effects before authorizing remaining work.',
    options: ['Keep paused', 'Investigate without repeating the operation'], recommend: 0,
    about: 'Reconcile the original execution and retain completed effects.',
  }] }) + '\n```';

export default {
  command(turn: Turn) {
    const runner = process.env.HANDOFF_RUNNER;
    if (!runner) throw new Error('Configure the native assignment runner');
    return [process.execPath, runner, JSON.stringify({ cwd: turn.cwd, contextFile: turn.contextFile })];
  },
  read(stdout: string, code: number | null): { started: boolean; session?: string; text?: string } {
    let session: string | undefined;
    let text: string | undefined;
    for (const line of stdout.split('\n')) {
      try {
        const value = JSON.parse(line);
        if (value?.nativeExecution !== 1) continue;
        if (typeof value.session === 'string') session = value.session;
        if (typeof value.text === 'string') text = value.text;
      } catch { /* A running process can have a partial output line. */ }
    }
    const result = { started: true, ...(session && { session }) };
    return code === null ? result : { ...result, text: code === 0 && text ? text : blocked };
  },
};
