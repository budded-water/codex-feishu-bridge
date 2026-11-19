import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { record } from '../types.js';
import { isSecond, type Binding } from './observer.js';

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const waitSeconds = 20;
const refreshMarginMs = 60_000;
const queueTimeoutMs = (waitSeconds + 5) * 1000;
const providerId = /^[a-zA-Z0-9_.:-]{1,160}$/;

export type RefundQueueSettings = { account: string; name: string; profile: string; roleArn: string };
export type FiringNotification = { id: string; at: number };
export type RefundDelivery = FiringNotification & { receipt: string };
export type RefundQueue = {
  receive(canContinue?: () => boolean): Promise<RefundDelivery | undefined>;
  acknowledge(receipt: string, canContinue?: () => boolean): Promise<void>;
};

type SmqResponse = { code: number; body?: unknown };
type SmqClient = {
  receiveMessage(queue: string, seconds: number): Promise<SmqResponse>;
  deleteMessage(queue: string, receipt: string): Promise<SmqResponse>;
};
type TemporaryCredentials = { accessKeyId: string; accessKeySecret: string; securityToken: string };
type SmqConstructor = new (account: string, options: TemporaryCredentials &
  { endpoint: string; readTimeout: number; connectTimeout: number }) => SmqClient;

export function parseRefundQueueSettings(value: unknown, region: string): RefundQueueSettings | undefined {
  if (value === undefined) return;
  const { account, name, profile, roleArn } = record(value);
  if (typeof account !== 'string' || !/^\d{8,20}$/.test(account) ||
    typeof name !== 'string' || !/^[a-zA-Z][a-zA-Z0-9-]{0,79}$/.test(name) ||
    typeof profile !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$/.test(profile) ||
    !/^cn-[a-z0-9-]+$/.test(region) || typeof roleArn !== 'string' ||
    !roleArn.startsWith('acs:ram::' + account + ':role/') ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(roleArn.split('/')[1] ?? '') || roleArn.split('/').length !== 2) {
    throw new Error('Invalid SLS refund SMQ scope');
  }
  return { account, name, profile, roleArn };
}

export function readRefundDelivery(body: unknown, binding: Binding, account: string, now: number): RefundDelivery {
  const { MessageBody, ReceiptHandle } = record(body);
  if (typeof MessageBody !== 'string' || Buffer.byteLength(MessageBody) > 16_384 ||
    typeof ReceiptHandle !== 'string' || !/^[a-zA-Z0-9+/_=-]{1,512}$/.test(ReceiptHandle)) {
    throw new Error('Invalid refund queue message');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(MessageBody); } catch { throw new Error('Invalid refund event JSON'); }
  const event = record(parsed), data = record(event.data);
  if (event.source !== 'acs.sls.alert' || event.specversion !== '1.0' || event.type !== 'sls:AlertEvent:Firing' ||
    typeof event.id !== 'string' || !providerId.test(event.id) || data.status !== 'firing' ||
    data.aliuid !== account || data.region !== binding.region || data.project !== binding.project || data.alert_id !== binding.rule ||
    !isSecond(data.alert_time) || data.alert_time < binding.start || data.alert_time > now) {
    throw new Error('Refund event does not match the registered alert');
  }
  return { id: event.id, at: data.alert_time, receipt: ReceiptHandle };
}

export function refundQueue(settings: RefundQueueSettings, binding: Binding, executable: string): RefundQueue {
  const sdk = require.resolve('@alicloud/mns');
  // The SDK and its HTTP transport can log signing headers and receipts.
  const sdkRequire = createRequire(sdk);
  const transportDebug = createRequire(sdkRequire.resolve('httpx'))('debug');
  if (sdkRequire('debug').enabled('mns:client') || transportDebug.enabled('httpx:header') || transportDebug.enabled('httpx:body')) {
    throw new Error('Disable SMQ SDK and transport debug logging before using the refund queue');
  }
  const Mns = require(sdk) as SmqConstructor;
  const { account, name, profile, roleArn } = settings, { region } = binding;
  let session: { client: SmqClient; expires: number } | undefined;
  const policy = JSON.stringify({ Version: '1', Statement: [{ Effect: 'Allow',
    Action: ['mns:ReceiveMessage', 'mns:DeleteMessage'], Resource: [`acs:mns:${region}:${account}:/queues/${name}/messages`] }] });

  async function client(): Promise<SmqClient> {
    if (session && Date.now() + refreshMarginMs < session.expires) return session.client;
    try {
      const { stdout } = await exec(executable, ['sts', 'AssumeRole', '--profile', profile, '--region', region,
        '--RoleArn', roleArn, '--RoleSessionName', 'bridge-refund-queue', '--DurationSeconds', '3600', '--Policy', policy],
      { timeout: 12_000, maxBuffer: 32_768 });
      const { AccessKeyId, AccessKeySecret, SecurityToken, Expiration } = record(record(JSON.parse(stdout)).Credentials);
      const expires = typeof Expiration === 'string' ? Date.parse(Expiration) : NaN;
      if (typeof AccessKeyId !== 'string' || !AccessKeyId || typeof AccessKeySecret !== 'string' || !AccessKeySecret ||
        typeof SecurityToken !== 'string' || !SecurityToken || !Number.isFinite(expires) || expires <= Date.now() + refreshMarginMs) {
        throw new Error('Invalid temporary credentials');
      }
      const endpoint = `https://${account}.mns.${region}.aliyuncs.com`;
      const smq = new Mns(account, { endpoint, accessKeyId: AccessKeyId, accessKeySecret: AccessKeySecret,
        securityToken: SecurityToken, connectTimeout: queueTimeoutMs, readTimeout: queueTimeoutMs });
      session = { client: smq, expires };
      return smq;
    } catch { throw new Error('Refund queue role unavailable'); }
  }

  return {
    async receive(canContinue = () => true) {
      const smq = await client();
      if (!canContinue()) return;
      let response: SmqResponse;
      try { response = await smq.receiveMessage(name, waitSeconds); }
      catch (error) {
        if (error instanceof Error && error.name === 'MNSMessageNotExistError') return;
        throw new Error('Refund queue receive unavailable');
      }
      if (response.code !== 200) throw new Error('Unconfirmed refund queue response');
      return readRefundDelivery(response.body, binding, account, Math.floor(Date.now() / 1000));
    },
    async acknowledge(receipt, canContinue = () => true) {
      const smq = await client();
      if (!canContinue()) return;
      try {
        const response = await smq.deleteMessage(name, encodeURIComponent(receipt));
        if (response.code !== 204) throw new Error('Unconfirmed acknowledgement');
      } catch { throw new Error('Refund queue acknowledgement unavailable'); }
    },
  };
}
