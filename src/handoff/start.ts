import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { Config } from '../config.js';
import { Feishu } from '../feishu.js';
import { record } from '../types.js';
import { acquireRoot, openRuntimeControl, readFence, verifyImportedState } from './ownership.js';
import { PilotAdmission, type PilotScope } from './gateway.js';
import { NativeExecutions } from './native.js';
import { AutoloopSource, SourceOutbox } from './source.js';
import { PilotInteractions } from './interactions.js';
import { pilotMaintenance } from './maintenance.js';

export async function startPilot(config: Config, auth: { appId: string; appSecret: string }, configPath: string): Promise<void> {
  process.umask(0o077);
  if (!process.env.HANDOFF_CONFIG || !process.env.HANDOFF_SOURCE_KEY) throw new Error('Configure the private handoff entry');
  const value = record(JSON.parse(readFileSync(process.env.HANDOFF_CONFIG, 'utf8')));
  if (typeof value.stateDirectory !== 'string' || !isAbsolute(value.stateDirectory) || typeof value.hubUrl !== 'string' ||
    typeof value.bridgeConfig !== 'string' || !isAbsolute(value.bridgeConfig) || realpathSync(value.bridgeConfig) !== realpathSync(configPath)) throw new Error('Invalid handoff entry configuration');
  const directory = realpathSync(value.stateDirectory);
  const hubUrl = value.hubUrl;
  const sourceKey = process.env.HANDOFF_SOURCE_KEY;
  let shutdown: (() => Promise<void>) | undefined;
  let compromised = false;
  const lease = await acquireRoot(config.stateDirectory, 'pilot', directory, () => { compromised = true; void shutdown?.(); });
  let admission: PilotAdmission | undefined;
  let interactions: PilotInteractions | undefined;
  let native: NativeExecutions | undefined;
  let control: Awaited<ReturnType<typeof openRuntimeControl>> | undefined;
  const feishu = new Feishu(auth, config.enableGroups, config.groupContextImages);
  let closing: Promise<void> | undefined;
  let stopping = false;
  let opening: Promise<void> | undefined;
  shutdown = () => closing ??= (async () => {
    stopping = true;
    feishu.close();
    await opening?.catch(() => {});
    await interactions?.close();
    admission?.close();
    await control?.close(true);
    await lease.release();
  })();
  const stop = () => { void shutdown!().catch(() => { process.exitCode = 1; }); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const unsubscribe = feishu.onFailure(() => { process.exitCode = 1; stop(); });
  try {
    opening = (async () => {
      control = await openRuntimeControl(lease, request => {
        if (!admission || !interactions || !native) throw new Error('Pilot is opening');
        return pilotMaintenance(admission, native, interactions.transport.state, request);
      });
      if (stopping) return;
      verifyImportedState(directory, readFence(lease.root)!.operation);
      admission = new PilotAdmission(directory, record(value.scope) as unknown as PilotScope, config.projectRouting);
      native = new NativeExecutions(admission, config);
      const source = new SourceOutbox(admission, new AutoloopSource(hubUrl, sourceKey));
      interactions = new PilotInteractions(admission, config, source, native, feishu, feishu, [auth.appSecret, sourceKey, process.env.OPENAI_API_KEY ?? ''], feishu);
      admission.store.bindChannel('feishu', await feishu.botIdentity());
      await interactions.start();
    })();
    await opening;
    if (stopping) return;
    if (compromised) throw new Error('Consumer ownership unavailable');
    lease.assertHeld();
    await feishu.start(message => { interactions!.receive(message); void interactions!.flush().catch(() => {}); });
    console.log('Pilot gateway connected under managed ownership');
  } catch (error) {
    const intentionalStop = stopping;
    await shutdown();
    if (!intentionalStop) throw error;
  } finally {
    if (closing) {
      unsubscribe(); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    }
  }
}
