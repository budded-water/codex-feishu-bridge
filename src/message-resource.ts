import { addAbortListener } from 'node:events';
import { addAbortSignal, type Readable } from 'node:stream';

export async function openResourceStream(open: () => Promise<Readable>, signal: AbortSignal): Promise<Readable> {
  signal.throwIfAborted();
  let listener: ReturnType<typeof addAbortListener> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    listener = addAbortListener(signal, () => reject(signal.reason));
  });
  try {
    const opened = Promise.resolve().then(open).then(stream => {
      if (signal.aborted) {
        stream.destroy();
        signal.throwIfAborted();
      }
      return addAbortSignal(signal, stream);
    });
    return await Promise.race([opened, timeout]);
  } finally { listener?.[Symbol.dispose](); }
}
