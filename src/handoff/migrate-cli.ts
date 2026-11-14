import { manageRuntime } from './ownership.js';
import { loadMigrationPlan, stageHandoff, rollbackHandoff, inspectLegacy } from './migration.js';

async function main(): Promise<void> {
  process.umask(0o077);
  const [command, path, task, reference] = process.argv.slice(2);
  if (!command || !path) throw new Error('Usage handoff status|quiesce|resume <state-root>, reconcile <state-root> <task> <reference>, inspect|stage|rollback <private-plan>');
  let result;
  if (['status', 'quiesce', 'resume', 'reconcile'].includes(command)) result = await manageRuntime(path, command, task, reference);
  else if (command === 'inspect') result = inspectLegacy(loadMigrationPlan(path));
  else if (command === 'stage') result = await stageHandoff(loadMigrationPlan(path));
  else if (command === 'rollback') result = await rollbackHandoff(loadMigrationPlan(path));
  else throw new Error('Unknown handoff command');
  console.log(JSON.stringify(result));
}
void main().catch(error => {
  console.error(error instanceof Error ? error.message.replace(/\/[^\s]+/g, '[path]') : 'Handoff operation failed');
  process.exitCode = 1;
});
