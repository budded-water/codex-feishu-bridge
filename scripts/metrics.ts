import { DatabaseSync } from 'node:sqlite';
import { isAbsolute, join } from 'node:path';
import { existsSync } from 'node:fs';
import { loadConfig } from '../src/config.js';
import { handoffMetrics } from './handoff-metrics.js';

const args = process.argv.slice(2);
if (args.length) {
  const [mode, directory, hub] = args;
  if (args.length !== 3 || mode !== '--handoff' || !directory || !hub || !isAbsolute(directory) || !isAbsolute(hub)) {
    console.error('Usage: npm run metrics -- --handoff /absolute/pilot-state /absolute/hub.db');
    process.exit(2);
  }
  try { console.log(JSON.stringify(handoffMetrics(directory, hub), null, 2)); }
  catch { console.error('Cannot read the selected P1 admission, transport or compatible Hub database.'); process.exitCode = 1; }
} else legacyMetrics();

function legacyMetrics() {
  const file = join(loadConfig(process.env.BRIDGE_CONFIG ?? 'bridge.config.json').stateDirectory,'bridge.db');
  if (!existsSync(file)) { console.log('尚无运行数据；启动新版本后再查看。'); return; }
  const db = new DatabaseSync(file,{readOnly:true});
  try {
    const columns = db.prepare('PRAGMA table_info(tasks)').all() as {name:string}[];
    if (!columns.some(x=>x.name==='created_at')) { console.log('此部署尚未记录耗时；重载新版本后开始采集。'); process.exitCode=0; }
    else {
      const rows = db.prepare('SELECT created_at,routing_at,routed_at,execution_at,finished_at,feedback_at,delivered_at FROM tasks WHERE created_at IS NOT NULL ORDER BY sequence DESC LIMIT 1000').all() as Record<string,unknown>[];
      const measure = (start:string,end:string) => {
        const values = rows.flatMap(row=> typeof row[start]==='number' && typeof row[end]==='number' && Number(row[end])>=Number(row[start]) ? [Number(row[end])-Number(row[start])] : []).sort((a,b)=>a-b);
        return { samples:values.length,p50Ms:values.length ? values[Math.ceil(values.length*0.5)-1] : null,p95Ms:values.length ? values[Math.ceil(values.length*0.95)-1] : null };
      };
      console.log(JSON.stringify({scope:'latest 1000 timestamped requests; legacy requests excluded',requests:rows.length,routingToHandoff:measure('routing_at','routed_at'),executionQueue:measure('routed_at','execution_at'),firstFeedback:measure('created_at','feedback_at'),firstResultDelivery:measure('created_at','delivered_at')},null,2));
    }
  } finally { db.close(); }
}
