import React, { memo, useEffect, useId, useMemo } from 'react';
import ReactMarkdown, { type Components, type Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { CodeBlock } from './code-block.js';
import 'katex/dist/katex.min.css';
import { useLinkConfirmation } from './link-confirmation.js';
import { linkTarget, type LinkSource } from './preview-model.js';

/** Trusted code extensions only. Both chat and file previews use these same hooks. */
export interface MarkdownExtensions extends Pick<Options, 'components' | 'remarkPlugins' | 'rehypePlugins'> {}
export interface MarkdownProps { text: string; extensions?: MarkdownExtensions; source?: LinkSource }

export function markdownUrl(url: string): string {
  if (url.startsWith('#')) return url;
  try { const parsed = new URL(url); return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : ''; }
  catch { return ''; }
}
const components: Components = {
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
export const Markdown = memo(function Markdown({ text, extensions, source }: MarkdownProps) {
  const confirmation = useLinkConfirmation(), owner = useId();
  useEffect(() => () => confirmation?.cancel(owner), [text, source?.kind === 'file' ? `${source.sessionId}:${source.workspace}:${source.path}` : source?.url, confirmation?.cancel, owner]);
  const requestLink = confirmation?.request;
  const sourceKey = source?.kind === 'file' ? `${source.sessionId}:${source.workspace}:${source.path}` : source?.url;
  const renderLink = useMemo<Components['a']>(() => ({ href, children, title }) => {
    if (href?.startsWith('#')) return <a href={href}>{children}</a>;
    const target = href ? linkTarget(href, source) : undefined;
    return target && requestLink ? <button type="button" className="markdown-link" title={target.kind === 'web' ? target.url : target.path} onClick={() => requestLink(target, owner)}>{children}</button> : <span title={title ?? '链接不可打开或缺少来源上下文'}>{children}</span>;
  }, [requestLink, owner, sourceKey]);
  return <div className="markdown"><ReactMarkdown
    skipHtml
    urlTransform={url => url.startsWith('#') || linkTarget(url, source) ? url : ''}
    remarkPlugins={[remarkGfm, remarkMath, ...(extensions?.remarkPlugins ?? [])]}
    rehypePlugins={[...(extensions?.rehypePlugins ?? []), [rehypeSanitize, { ...defaultSchema, attributes: { ...defaultSchema.attributes, code: [['className', /^language-./, 'math-inline', 'math-display']] } }], [rehypeKatex, { trust: false, strict: 'ignore', maxExpand: 500, maxSize: 20, output: 'htmlAndMathml' }]]}
    components={{ ...components, ...extensions?.components, a: renderLink }}
  >{text}</ReactMarkdown></div>;
});
