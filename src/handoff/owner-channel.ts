import { createServer, connect, type Socket } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { record } from '../types.js';

const defaultTimeoutMs = 1500;
export class OwnerRequestRejected extends Error {}

export async function openOwnerChannel(token: string, execution: string, handle: (request: Record<string, unknown>) => unknown,
  requestTimeout?: (request: Record<string, unknown>) => number | undefined) {
  const directory = mkdtempSync('/tmp/cno-');
  const path = join(directory, 'owner.sock');
  const clients = new Set<Socket>();
  const pending = new Set<Promise<void>>();
  let closing: Promise<void> | undefined;
  const server = createServer({ allowHalfOpen: true }, socket => {
    socket.setEncoding('utf8');
    clients.add(socket);
    socket.once('close', () => clients.delete(socket));
    socket.on('error', () => {});
    socket.setTimeout(defaultTimeoutMs, () => socket.destroy());
    let input = '';
    let handled = false;
    socket.on('data', chunk => {
      if (handled) return;
      input += chunk.toString();
      if (Buffer.byteLength(input) > 256 * 1024) { socket.destroy(); return; }
      if (!input.includes('\n')) return;
      handled = true;
      const work = (async () => {
        try {
          const request = record(JSON.parse(input.split('\n')[0]!));
          if (request.token !== token || request.execution !== execution || typeof request.nonce !== 'string') throw new Error('Invalid owner challenge');
          if (requestTimeout) socket.setTimeout(requestTimeout(request) ?? defaultTimeoutMs);
          const snapshot = await handle(request);
          if (!socket.destroyed) socket.end(JSON.stringify({ execution, nonce: request.nonce, snapshot }) + '\n');
        } catch { if (!socket.destroyed) socket.end('{"error":"Owner challenge rejected"}\n'); }
      })();
      pending.add(work);
      void work.finally(() => pending.delete(work));
    });
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
  } catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
  return { path, close: () => closing ??= (async () => {
    for (const socket of clients) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await Promise.allSettled(pending);
    rmSync(directory, { recursive: true, force: true });
  })() };
}

export async function probeOwner(path: string, token: string, execution: string, message?: unknown): Promise<Record<string, unknown>> {
  return requestOwner(path, token, execution, message !== undefined ? { message } : {});
}

export async function requestOwner(path: string, token: string, execution: string, request: Record<string, unknown> = {},
  timeoutMs = defaultTimeoutMs): Promise<Record<string, unknown>> {
  const nonce = randomUUID();
  return new Promise((resolve, reject) => {
    const socket = connect(path);
    socket.setEncoding('utf8');
    let input = '';
    socket.once('error', reject);
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error('Owner challenge timed out')));
    socket.once('connect', () => socket.end(JSON.stringify({ ...request, token, execution, nonce }) + '\n'));
    socket.on('data', chunk => {
      input += chunk.toString();
      if (Buffer.byteLength(input) > 64 * 1024) socket.destroy(new Error('Invalid owner reply'));
    });
    socket.once('end', () => {
      try {
        const value = record(JSON.parse(input));
        if (value.error === 'Owner challenge rejected') throw new OwnerRequestRejected('Invalid owner reply');
        if (value.execution !== execution || value.nonce !== nonce || !value.snapshot) throw new Error('Invalid owner reply');
        resolve(record(value.snapshot));
      } catch (error) { reject(error); }
    });
  });
}
