import type { Readable } from 'node:stream';

export interface Mention { id: string; name: string }
export interface FileAttachment { messageId: string; key: string; name: string }
export interface DeliveryOptions { replyTo?: string; deliverBefore?: number; mentions?: Mention[]; taskId?: string; final?: boolean; answer?: boolean; promptId?: string; approval?: import('./approval.js').ApprovalPresentation; taskView?: import('./task-card.js').TaskPresentation; reviewCard?: import('./review-card.js').ReviewPresentation; matterCard?: import('./matter-card.js').MatterPresentation; visualImages?: import('./visual-review.js').VisualAttachment[]; visualReview?: import('./visual-review.js').VisualReviewView }

export interface NativeActivity {
  task: string; thread: string; turn: string; generation: string; stage: string;
  startedAt: number; lastEventAt: number | null;
  prompts: { token: string; kind: 'approval' | 'question'; expires: number }[];
  accessBlocks?: import('./browser-access.js').BrowserAccessBlock[];
}

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
  imageKeys?: string[];
  attachment?: FileAttachment;
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
  source?: { id: string; chatType?: 'p2p' | 'group'; createTime?: string; parentId?: string; imageCount?: number; hasAttachment?: boolean; clarification?: { id: string; createTime?: string; parentId: string } };
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
  file?: { name: string; path: string; bytes: number };
}

export type PreparedReference = ChatContext & { attachmentBytes?: string };
export interface ContextPort {
  actor?(session: Session, message: string): Promise<{ name?: string; link?: string }>;
  context(session: Session, source: NonNullable<Task['source']>, limit: number): Promise<ChatContext>;
  attachedImages?(message: IncomingMessage): Promise<ChatContext>;
  openAttachment?(attachment: FileAttachment): Promise<Readable>;
}

export interface NativeControlTarget { generation: string; thread: string; turn: string }
export type ControlDisposition = 'dispatching' | 'accepted' | 'stopping' | 'sent' | 'rejected' | 'unknown';
