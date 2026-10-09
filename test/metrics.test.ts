import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {setup} from './helpers.js';

test('metrics follows .env deployment configuration without a default config file', t => {
 const h=setup();t.after(h.close);const directory=mkdtempSync(join(tmpdir(),'bridge-metrics-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 writeFileSync(join(directory,'custom.json'),JSON.stringify(h.config));writeFileSync(join(directory,'.env'),'BRIDGE_CONFIG=custom.json\n');
 const env={...process.env};delete env.BRIDGE_CONFIG;
 const output=execFileSync(process.execPath,['--env-file-if-exists=.env','--import',resolve('node_modules/tsx/dist/loader.mjs'),resolve('scripts/metrics.ts')],{cwd:directory,env,encoding:'utf8'});
 assert.equal(JSON.parse(output).requests,0);
});
