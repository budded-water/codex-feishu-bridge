export interface Mention { id: string; name: string }
export interface DeliveryOptions { replyTo?: string; mentions?: Mention[]; taskId?: string; final?: boolean; promptId?: string }

export interface IncomingMessage {
  tenant: string;
  user: string;
  chat: string;
  id: string;
  text: string;
  chatType?: 'p2p' | 'group';
  createTime?: string;
  parentId?: string;
  mentions?: Mention[];
  unsupported?: string;
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
  source?: { id: string; chatType?: 'p2p' | 'group'; createTime?: string; parentId?: string; clarification?: { id: string; createTime?: string; parentId: string } };
  routed?: boolean;
  routingOrigin?: string | null;
  routingRevision?: number | null;
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
  messages: { sender: string; type: string; text: string; quoted?: boolean }[];
  note: string;
  images?: { messageIndex: number; label: string; url: string }[];
}
export interface ContextPort {
  actor?(session: Session, message: string): Promise<{ name?: string; link?: string }>;
  context(session: Session, source: NonNullable<Task['source']>, limit: number): Promise<ChatContext>;
}
