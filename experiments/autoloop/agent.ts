// Standalone P0 plugin copied into an isolated Autoloop home by verify:autoloop.
// No relative engine imports, production configuration or platform credentials.
type Turn = { prompt: string; resume: string | null; cwd: string; folder: string };
const unknown = 'Native execution requires reconciliation; no automatic replay.\n\n```agent-autoloop\n' +
  JSON.stringify({ ask: [{
    key: 'native-outcome-unconfirmed', title: 'Check the previous execution before continuing',
    text: 'Inspect the previous execution and its actual effects. Its outcome has not been confirmed.',
    options: ['Keep paused', 'Investigate without repeating the operation'], recommend: 0,
    about: 'Reconcile the original operation; this is not authorization to repeat it.',
  }] }) + '\n```';

export default {
  command(turn: Turn): string[] {
    const runner = process.env.BRIDGE_PROBE_RUNNER;
    if (!runner) throw new Error('Build the bridge and supply the P0 runner');
    return [process.execPath, runner, JSON.stringify(turn)];
  },
  read(stdout: string, code: number | null): { started: boolean; session?: string; text?: string } {
    let session: string | undefined;
    let text: string | undefined;
    for (const line of stdout.split('\n')) {
      try {
        const event = JSON.parse(line);
        if (event?.bridgeProbe !== 1) continue;
        if (typeof event.session === 'string') session = event.session;
        if (typeof event.text === 'string') text = event.text;
      } catch { /* Partial stdout is expected while the wrapper is running. */ }
    }
    const known = { started: true, ...(session && { session }) };
    if (code === null) return known;
    return { ...known, text: code === 0 && text ? text : unknown };
  },
};
