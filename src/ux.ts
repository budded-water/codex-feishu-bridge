export const MAX_NOTIFICATION_MEMBERS = 20;

export function naturalControl(text: string): 'stop' | 'steer' | undefined {
  if (/^(?:先)?(?:停一下|停止(?:当前任务|这个任务)?|取消(?:当前任务|这个任务)|别继续了|不要继续了)[。！!\s]*$/.test(text)) return 'stop';
  if (/^(?:补充(?:一下|要求)?|更正)[：:\s]|^只(?:看|统计|查询|分析|读取)|^(?:先)?(?:别|不要)(?:改|修改|写|提交|发布)/.test(text)) return 'steer';
  return;
}

export function duration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

export function taskTitle(text: string): string {
  return text.replace(/\s+/g, ' ').slice(0,80);
}

export function deadline(milliseconds: number): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }).format(milliseconds);
}

export function terminalText(status: string, answer: string, explanation?: string, diagnostic?: string | null): string {
  if (explanation) return explanation;
  if (status === 'completed' && answer) return answer;
  if (status === 'interrupted') return '已停止当前任务。已经执行的操作不会自动撤回。';
  if (status === 'unknown') return '这次任务的结果尚未确认。请先核对已经发生的改动，再决定是否继续；不会自动重跑。';
  if (diagnostic) return '这一步需要部署者在运行 Bot 的电脑上确认，当前飞书入口无法完成。请处理后再继续，已有操作可能保留。';
  return '这次没有拿到最终答复。请先核对已执行的操作，再重新说明需要继续的部分。';
}

export const statusNames: Record<string,string> = { queued: '排队中', running: '处理中', completed: '已完成', failed: '未完成', interrupted: '已停止', unknown: '结果未确认' };

export function fencedPreview(text: string): string | undefined {
  const runs = [...text.matchAll(/^ {0,3}(`{3,}|~{3,})/gm)].map(x=>x[1]!);
  const length = (marker:string) => Math.max(3,...runs.filter(x=>x[0]===marker).map(x=>x.length+1));
  const marker=length('`')<=length('~') ? '`' : '~';
  if (length(marker)>180) return;
  const fence=marker.repeat(length(marker));
  return `${fence}\n${text}\n${fence}`;
}


export function notificationBody(text: string, names: string[]): string {
  let body=text.trim();
  const sorted=[...names].sort((a,b)=>b.length-a.length);
  for (;;) {
    const name=sorted.find(name=>body.startsWith(`@${name}`) && (!body[name.length+1] || /[\s,，、:：]/.test(body[name.length+1]!)));
    if (!name) return body;
    body=body.slice(name.length+1).replace(/^[\s,，、:：]+/,'');
  }
}
