export function executionReceipt(status: string): string {
  if (status === 'completed') return 'Native Codex round completed; business acceptance is not declared.';
  if (status === 'interrupted') return 'NOTHING: Native Codex round interrupted; completed effects were not rolled back.';
  return 'Native execution requires reconciliation; no automatic replay.\n\n```agent-autoloop\n' +
    JSON.stringify({ ask: [{ key: 'native-outcome-unconfirmed', title: 'Check the previous execution before continuing',
      text: 'The execution outcome is not confirmed. Inspect actual effects and the native conversation before authorizing further work.',
      options: ['Keep paused', 'Investigate without repeating the operation'], recommend: 0,
      about: 'Reconcile the previous execution. This response does not authorize replay of the original operation.',
    }] }) + '\n```';
}
