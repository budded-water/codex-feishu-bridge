import { safeMentionText } from './reply.js';
import type { DeliveryOptions } from './types.js';
import type { VisualDecision, VisualReviewView } from './visual-review.js';

export function visualReceiptCard(text: string, images: NonNullable<DeliveryOptions['visualImages']>, review?: VisualReviewView) {
  // The outbox stores the original text and captions across gateway versions.
  const [title, candidate, ...details] = safeMentionText(text).split('\n');
  const focus = details.join('\n').trimStart().replace(/^待人工看图 · /, '');
  const plainText = (content: string) => ({ tag: 'plain_text', content });
  const paragraph = (content: string) => ({ tag: 'div', text: plainText(content) });
  const note = (content: string) => ({ tag: 'div', text: { ...plainText(content), text_size: 'notation' } });
  const button = (decision: VisualDecision, content: string, primary: boolean) => ({
    tag: 'button', text: plainText(content), width: 'fill', type: primary ? 'primary' : 'default',
    behaviors: [{ type: 'callback', value: { kind: 'visual_review', id: review!.id, decision } }],
  });
  const scenes = images.map(image => {
    const caption = safeMentionText(image.caption);
    const match = /^([\s\S]+) · (通过|失败) · 已执行断言 (\d+\/\d+)$/.exec(caption);
    const label = (match?.[1] ?? caption).replace(/\s+/g, ' ');
    return [
      paragraph(label),
      ...(match ? [note(`${match[2]} · 断言 ${match[3]}`)] : []),
      { tag: 'img', img_key: image.key, alt: plainText(caption), scale_type: 'fit_horizontal', preview: true },
    ];
  });
  const [first, second, third] = scenes;
  const gallery = first && second ? [{
    tag: 'column_set', flex_mode: 'bisect', horizontal_spacing: '8px',
    columns: [first, second].map(elements => ({ tag: 'column', width: 'weighted', weight: 1, elements })),
  }, ...(third ? [{ tag: 'hr' }, ...third] : [])] : first ?? [];

  return {
    schema: '2.0',
    header: { title: plainText(title ?? ''), template: 'blue' },
    body: { padding: '12px', vertical_spacing: '8px', elements: [
      ...(candidate ? [note(candidate)] : []),
      { tag: 'markdown', content: review && review.phase !== 'pending' ? '**验收重点**' : '**待人工验收**' },
      paragraph(focus),
      { tag: 'hr' },
      note('点击截图查看原图'),
      ...gallery,
      ...(review ? [
        { tag: 'hr' },
        ...(review.phase === 'pending' ? [] : [paragraph(visualReviewStatus(review))]),
        ...(review.binding.pullRequest ? [note(review.binding.repository + ' · PR #' + review.binding.pullRequest +
          (review.binding.workflow ? ' → ' + review.binding.workflow.base : ''))] : []),
        ...((review.phase === 'pending' || review.phase === 'reviewed') && review.binding.workflow ?
          [button('merge', review.phase === 'pending' ? '通过并合并 PR' : '合并 PR', true)] : []),
        ...(review.phase === 'pending' ? [button('accept', '仅确认验收', !review.binding.workflow)] : []),
        ...(review.phase === 'merged' && review.binding.workflow?.uploadTarget ?
          [note('目标 · ' + review.binding.workflow.uploadTarget), button('upload', '上传微信开发版', true)] : []),
      ] : []),
    ] },
  };
}

function visualReviewStatus(review: VisualReviewView): string {
  const captions = {
    pending: '请选择验收结果',
    reviewed: '人工验收通过 · 待交付',
    'merge-queued': '人工验收通过 · 合并已排队',
    merging: '人工验收通过 · 正在检查并合并',
    'merge-blocked': '人工验收通过 · 合并受阻',
    'merge-unknown': '合并结果待核对 · 请检查 GitHub 后再继续',
    merged: '已合并 · ' + review.mergeCommit?.slice(0, 12),
    'upload-queued': '已合并 · 开发版上传已排队',
    uploading: '已合并 · 正在处理开发版上传',
    'upload-blocked': '已合并 · 开发版上传受阻',
    'upload-unknown': '已合并 · 上传结果待核对',
    uploaded: '开发版已上传',
  };
  const result = review.result;
  if (result?.status === 'uploaded') return captions[review.phase] + ' · ' + result.version + ' · 回执 ' + result.receipt;
  if (result?.status === 'blocked') {
    const reasons = { 'stale-source': 'PR 候选已变化，请重新验收', checks: '项目交付检查未通过',
      authorization: '项目授权未就绪', 'target-unavailable': '项目目标不可用',
      'workflow-unavailable': '登记的交付程序不可用或已变化' };
    return captions[review.phase] + ' · ' + reasons[result.reason];
  }
  return captions[review.phase];
}
