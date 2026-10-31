import React, { memo, useState } from 'react';
import ReactMarkdown, { type Components, type Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { CodeBlock } from './code-block.js';
import 'katex/dist/katex.min.css';

/** Trusted code extensions only. Both chat and file previews use these same hooks. */
export interface MarkdownExtensions extends Pick<Options, 'components' | 'remarkPlugins' | 'rehypePlugins'> {}
export interface MarkdownProps { text: string; extensions?: MarkdownExtensions }

export function markdownUrl(url: string): string {
  if (url.startsWith('#')) return url;
  try { const parsed = new URL(url); return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : ''; }
  catch { return ''; }
}
function Link({ href, children, title }: React.ComponentProps<'a'>) {
  const [error, setError] = useState(false);
  if (!href) return <span title="不支持此链接地址">{children}</span>;
  return <><a href={href} title={title} target={href.startsWith('#') ? undefined : '_blank'} rel="noreferrer noopener" onClick={event => {
    if (!href.startsWith('#') && window.wisp) { event.preventDefault(); setError(false); void window.wisp.openUrl(href).catch(() => setError(true)); }
  }}>{children}</a>{error && <span role="alert" className="markdown-link-error">无法打开链接，请复制地址后重试。</span>}</>;
}
const components: Components = {
  a: Link,
  pre: ({ node, children }) => {
    const code = node?.children.find(child => child.type === 'element' && child.tagName === 'code');
    if (!code || code.type !== 'element') return <pre>{children}</pre>;
    const language = String((code.properties.className as string[] | undefined)?.find(name => name.startsWith('language-')) ?? '').slice(9);
    const text = code.children.map(child => child.type === 'text' ? child.value : '').join('');
    return <CodeBlock text={text} language={language}/>;
  },
  // Untrusted model/file content must not load tracking URLs or local resources.
  img: ({ alt }) => <span className="markdown-image">[图片：{alt || '未加载'}]</span>,
  table: ({ children }) => <div className="markdown-table" tabIndex={0} role="region" aria-label="表格，可横向滚动"><table>{children}</table></div>,
};
export const Markdown = memo(function Markdown({ text, extensions }: MarkdownProps) {
  return <div className="markdown"><ReactMarkdown
    skipHtml
    urlTransform={markdownUrl}
    remarkPlugins={[remarkGfm, remarkMath, ...(extensions?.remarkPlugins ?? [])]}
    rehypePlugins={[...(extensions?.rehypePlugins ?? []), [rehypeSanitize, { ...defaultSchema, attributes: { ...defaultSchema.attributes, code: [['className', /^language-./, 'math-inline', 'math-display']] } }], [rehypeKatex, { trust: false, strict: 'ignore', maxExpand: 500, maxSize: 20, output: 'htmlAndMathml' }]]}
    components={{ ...components, ...extensions?.components }}
  >{text}</ReactMarkdown></div>;
});
