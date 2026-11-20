import { safeMentionText } from './reply.js';
import { escapeTaskMarkdown } from './task-card.js';
import type { DeliveryOptions } from './types.js';

export function visualReceiptCard(text: string, images: NonNullable<DeliveryOptions['visualImages']>) {
  // The outbox stores the original text and captions across gateway versions.
  const [title, candidate, ...details] = safeMentionText(text).split('\n');
  const focus = details.join('\n').trimStart().replace(/^待人工看图 · /, '');
  const plainText = (content: string) => ({ tag: 'plain_text', content });
  const note = (content: string) => ({ tag: 'div', text: { ...plainText(content), text_size: 'notation' } });
  const heading = (content: string) => ({ tag: 'markdown', content: `**${escapeTaskMarkdown(content)}**` });
  const scenes = images.map(image => {
    const caption = safeMentionText(image.caption);
    const match = /^([\s\S]+) · (通过|失败) · 已执行断言 (\d+\/\d+)$/.exec(caption);
    const label = (match?.[1] ?? caption).replace(/\s+/g, ' ');
    return [
      heading(label),
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
      heading('待人工验收'),
      { tag: 'div', text: plainText(focus) },
      { tag: 'hr' },
      note('点击截图查看原图'),
      ...gallery,
    ] },
  };
}
