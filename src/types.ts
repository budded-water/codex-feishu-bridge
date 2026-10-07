export interface IncomingMessage {
  tenant: string;
  user: string;
  chat: string;
  id: string;
  text: string;
  chatType?: 'p2p' | 'group';
  createTime?: string;
  parentId?: string;
}

export interface Session {
  id: string;
  owner: string;
  tenant: string;
  user: string;
  chat: string;
  project: string;
  directory: string;
  thread: string | null;
}

export interface Task {
  id: string;
  session: string;
  input: string;
  status: string;
  turn: string | null;
  source?: { id: string; chatType?: 'p2p' | 'group'; createTime?: string; parentId?: string };
}

export interface RpcEvent {
  method: string;
  params: Record<string, unknown>;
}

export interface RpcRequest extends RpcEvent {
  id: string | number;
}

export interface CodexPort {
  generation: string;
  ready: boolean;
  request<T = unknown>(method: string, params: unknown): Promise<T>;
  reply(id: string | number, result: unknown): void;
  reject(id: string | number, message: string): void;
  onNotification(listener: (event: RpcEvent) => void): () => void;
  onRequest(listener: (event: RpcRequest) => void): () => void;
  onExit(listener: () => void): () => void;
}

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function ownerKey(message: Pick<IncomingMessage, 'tenant' | 'user' | 'chat'>): string {
  return JSON.stringify([message.tenant, message.user, message.chat]);
}

export interface ChatContext {
  status: 'available' | 'unavailable';
  messages: { sender: string; type: string; text: string }[];
  note: string;
}
export interface ContextPort {
  context(session: Session, source: NonNullable<Task['source']>, limit: number): Promise<ChatContext>;
}
