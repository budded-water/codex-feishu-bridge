import { crc32 } from 'node:zlib';
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { record } from '../types.js';
import { privateRecord } from './ownership.js';
import { boundedFile, fingerprint, gitRead, verificationSourceState } from './verification-profile.js';
import type { PilotAdmission } from './gateway.js';
import type { State } from '../state.js';
import { githubRepository, type VisualWorkflows } from './visual-review-workflow.js';

export interface VisualImage { caption: string; png: string; key?: string }
const segment = /^[a-zA-Z0-9_-]{1,128}$/;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const digest = /^[a-f0-9]{64}$/;
const pngHeader = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const imageLimit = 2 * 1024 * 1024;

async function repositoryIdentity(root: string): Promise<string> {
  const url = new URL(await gitRead(root, ['config', '--get', 'remote.origin.url']));
  if (url.protocol !== 'https:') throw Error('Visual receipts require an HTTPS origin');
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function readVisualReceiptPlan(path: string) {
  if (!isAbsolute(path)) throw Error('Visual receipt plan requires an absolute path');
  const file = lstatSync(path);
  if (!file.isFile() || file.uid !== process.getuid?.() || (file.mode & 0o077) !== 0 || file.size > 16 * 1024) {
    throw Error('Visual receipt plan must be private to the runtime owner');
  }
  const plan = privateRecord(path);
  const { projectRoot, projectId, commit, reviewFocus, scenes, pullRequest, format, screenshots } = plan;
  if (typeof projectRoot !== 'string' || !isAbsolute(projectRoot) ||
    typeof projectId !== 'string' || !segment.test(projectId) ||
    typeof commit !== 'string' || !/^[a-f0-9]{40}$/.test(commit) ||
    typeof reviewFocus !== 'string' || !reviewFocus.trim() || reviewFocus.length > 300 ||
    (pullRequest !== undefined && (typeof pullRequest !== 'number' || !Number.isSafeInteger(pullRequest) || pullRequest < 1))) throw Error('Invalid visual receipt plan');
  const metadata = { projectRoot, projectId, commit, reviewFocus: reviewFocus.trim() };
  const pr = pullRequest !== undefined ? { pullRequest } : {};
  if (format === 'web-screenshot') {
    if (scenes !== undefined || !Array.isArray(screenshots) || !screenshots.length || screenshots.length > 3) {
      throw Error('Web visual receipt requires one to three screenshots');
    }
    const entries = screenshots.map(value => {
      const { file, sha256, label } = record(value);
      if (typeof file !== 'string' || !/^[a-zA-Z0-9_-]{1,128}\.png$/.test(file) ||
        typeof sha256 !== 'string' || !digest.test(sha256) ||
        typeof label !== 'string' || !label.trim() || label.length > 90) throw Error('Invalid Web visual receipt screenshot');
      return { file, sha256, label: label.trim() };
    });
    if (new Set(entries.map(entry => entry.file)).size !== entries.length) throw Error('Duplicate Web visual receipt screenshot');
    const normalized = { format: 'web-screenshot' as const, ...metadata, entries, ...pr };
    return { ...normalized, evidence: fingerprint(JSON.stringify(normalized)) };
  }
  if (format !== undefined || screenshots !== undefined || !Array.isArray(scenes) || !scenes.length || scenes.length > 3) {
    throw Error('Invalid visual receipt plan');
  }
  const entries = scenes.map(value => {
    const { run, reportSha256, checkpoint, label } = record(value);
    if (typeof run !== 'string' || !uuid.test(run) || typeof reportSha256 !== 'string' || !digest.test(reportSha256) ||
      typeof checkpoint !== 'string' || !segment.test(checkpoint) ||
      typeof label !== 'string' || !label.trim() || label.length > 90) throw Error('Invalid visual receipt scene');
    return { run, reportSha256, checkpoint, label: label.trim() };
  });
  // Retain the existing evidence identity for registered WeChat plans.
  const normalized = { ...metadata, entries, ...pr };
  return { format: 'wechat' as const, ...normalized, evidence: fingerprint(JSON.stringify(normalized)) };
}

type VisualReceiptPlan = ReturnType<typeof readVisualReceiptPlan>;

export async function readVisualReceipt(plan: VisualReceiptPlan) {
  const { projectRoot, commit, evidence } = plan;
  if (realpathSync(projectRoot) !== projectRoot || await gitRead(projectRoot, ['rev-parse', '--show-toplevel']) !== projectRoot) {
    throw Error('Visual receipt requires the candidate worktree root');
  }
  const source = await verificationSourceState(projectRoot);
  if (!source.clean || source.commit !== commit) throw Error('Visual receipt candidate changed');
  const repository = await repositoryIdentity(projectRoot);
  const content = plan.format === 'web-screenshot' ? webScreenshotContent(plan) : wechatReceiptContent(plan, repository);
  const finalSource = await verificationSourceState(projectRoot);
  if (!finalSource.clean || finalSource.commit !== commit || await repositoryIdentity(projectRoot) !== repository) throw Error('Visual receipt candidate changed');
  const github = githubRepository(repository);
  if (plan.pullRequest && !github) throw Error('Visual review PR requires a github.com origin');
  return { ...content, evidence, github, repository };
}

function webScreenshotContent(plan: Extract<VisualReceiptPlan, { format: 'web-screenshot' }>) {
  const { projectRoot, entries, commit, reviewFocus } = plan;
  const images = entries.map(({ file, sha256, label }) => {
    const png = boundedFile(projectRoot, join(projectRoot, '.ui-eval', 'visual-review', file), imageLimit);
    if (!hasCompletePngChunks(png) || fingerprint(png) !== sha256) throw Error('Web visual receipt screenshot differs from its plan');
    return { caption: label, png: png.toString('base64') };
  });
  return { images, workflowEligible: false,
    body: 'Web UI 验收 · ' + images.length + ' 张截图\n浏览器截图 · 候选 ' + commit.slice(0, 12) +
      '\n\n待人工看图 · ' + reviewFocus + '\n本卡记录看图验收，自动化检查以项目报告为准。' };
}

function hasPngHeader(png: Buffer): boolean {
  return png.length >= 33 && png.subarray(0, pngHeader.length).equals(pngHeader) && png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0;
}

// Inspect framing and CRCs without decompressing attacker-controlled image data.
function hasCompletePngChunks(png: Buffer): boolean {
  if (!hasPngHeader(png)) return false;
  let imageData = false;
  for (let offset = 8; offset + 12 <= png.length;) {
    const length = png.readUInt32BE(offset);
    const end = offset + length + 12;
    if (end > png.length || crc32(png.subarray(offset + 4, end - 4)) !== png.readUInt32BE(end - 4)) return false;
    const kind = png.toString('latin1', offset + 4, offset + 8);
    if (!/^[a-zA-Z]{2}[A-Z][a-zA-Z]$/.test(kind) || (kind === 'IHDR' && offset !== 8)) return false;
    if (kind === 'IDAT' && length > 0) imageData = true;
    if (kind === 'IEND') return imageData && length === 0 && end === png.length;
    offset = end;
  }
  return false;
}

function wechatReceiptContent(plan: Extract<VisualReceiptPlan, { format: 'wechat' }>, repository: string) {
  const { projectRoot, projectId, commit, reviewFocus, entries } = plan;
  // UI-eval hashes the clean source record with these keys in canonical order.
  const sourceDigest = 'sha256:' + fingerprint(JSON.stringify({ commitSha: commit, dirtyTree: false, repository }));
  const images: VisualImage[] = [];
  const scenarios = new Set<string>();
  let runtimeDigest: string | undefined;
  let passed = 0;
  for (const { run, reportSha256, checkpoint, label } of entries) {
    const directory = join(projectRoot, '.ui-eval', 'wechat-runs', run);
    const bytes = boundedFile(projectRoot, join(directory, 'report.json'), 256 * 1024);
    if (fingerprint(bytes) !== reportSha256) throw Error('Visual receipt report changed');
    const report = record(JSON.parse(bytes.toString('utf8')));
    const assertions = record(report.assertions);
    const verdict = report.status === 'passed' ? '通过' : report.status === 'failed' ? '失败' : undefined;
    if (report.apiVersion !== 'uieval.io/wechat-pilot-v1' || report.kind !== 'WechatPilotResult' ||
      report.executionId !== run || report.projectId !== projectId || report.sourceCommit !== commit ||
      typeof report.scenarioId !== 'string' || !segment.test(report.scenarioId) || scenarios.has(report.scenarioId) ||
      report.sourceDigest !== sourceDigest ||
      typeof report.runtimeDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(report.runtimeDigest) ||
      !verdict || report.cleanup !== 'completed' || !Number.isSafeInteger(assertions.passed) || !Number.isSafeInteger(assertions.failed) ||
      Number(assertions.passed) < 0 || Number(assertions.failed) < 0 ||
      (report.status === 'passed' ? assertions.failed !== 0 || Number(assertions.passed) < 1 : Number(assertions.failed) < 1) ||
      !Array.isArray(report.screenshots)) throw Error('Invalid or foreign visual receipt report');
    if (runtimeDigest && runtimeDigest !== report.runtimeDigest) throw Error('Visual receipt reports have different runtimes');
    runtimeDigest = report.runtimeDigest;
    scenarios.add(report.scenarioId);
    const matches = report.screenshots.map(record).filter(shot => shot.checkpointId === checkpoint);
    const shot = matches[0];
    if (matches.length !== 1 || !shot || shot.path !== checkpoint + '.png') throw Error('Visual receipt screenshot is missing or ambiguous');
    const png = boundedFile(projectRoot, join(directory, shot.path), imageLimit);
    if (!hasPngHeader(png) || png.readUInt32BE(16) !== shot.widthPx ||
      png.readUInt32BE(20) !== shot.heightPx || 'sha256:' + fingerprint(png) !== shot.digest) throw Error('Visual receipt screenshot differs from its report');
    const total = Number(assertions.passed) + Number(assertions.failed);
    images.push({ caption: label.trim() + ' · ' + verdict + ' · 已执行断言 ' + assertions.passed + '/' + total, png: png.toString('base64') });
    if (report.status === 'passed') passed++;
  }
  return { images, workflowEligible: passed === images.length,
    body: '微信 UI 验证 · ' + passed + '/' + images.length + ' 个场景通过\n微信开发者工具 · 候选 ' + commit.slice(0, 12) +
      '\n\n待人工看图 · ' + reviewFocus.trim() };
}

export async function queueVisualReceipt(admission: PilotAdmission, transport: State, executionId: unknown, path: unknown, assertOwned: () => void,
  workflows: VisualWorkflows = {}) {
  if (typeof executionId !== 'string' || !uuid.test(executionId) || typeof path !== 'string') throw Error('Visual receipt requires an execution and private plan');
  const execution = admission.store.execution(executionId);
  const request = execution && admission.store.request(execution.request);
  const scope = admission.scope;
  if (!request || !execution || execution.status !== 'completed' || execution.project !== admission.project ||
    request.blocked || request.message.chatType !== 'p2p' || request.message.tenant !== scope.tenant ||
    request.message.user !== scope.operator || request.message.chat !== scope.chat ||
    admission.store.hasDedicatedContinuation(executionId) || !transport.projectedFinal(executionId)) {
    throw Error('Visual receipt requires a completed owner-private ordinary task');
  }
  const plan = readVisualReceiptPlan(path);
  const existing = transport.visualReceipt(executionId, plan.evidence);
  if (existing) return { execution: executionId, ...existing };
  if (admission.store.maintenance.paused) throw Error('Visual receipt admission is paused');
  const receipt = await readVisualReceipt(plan);
  assertOwned();
  if (admission.store.maintenance.paused) throw Error('Visual receipt admission is paused');
  return { execution: executionId, ...transport.projectVisualReceipt(request, { ...receipt, binding: {
    repository: receipt.github ?? receipt.repository, commit: plan.commit, pullRequest: plan.pullRequest,
    workflow: receipt.workflowEligible && receipt.github && plan.pullRequest ? workflows[receipt.github] : undefined,
  } }) };
}
