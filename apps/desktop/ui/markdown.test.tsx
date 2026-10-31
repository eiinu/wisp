import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Markdown, markdownUrl } from './markdown.js';

it('renders CommonMark and GFM structure instead of a handwritten line parser', () => {
  const html = renderToStaticMarkup(<Markdown text={'# 标题\n\n1. **重点**\n2. *强调*\n\n> 引用\n\n| A | B |\n| - | - |\n| 一 | 二 |\n\n- [x] 完成\n\n~~删除~~\n\n```ts\nconst x = 1\n```\n\n[链接](https://example.com)'}/>);
  for (const tag of ['h1', 'ol', 'strong', 'em', 'blockquote', 'table', 'del', 'pre']) expect(html).toContain(`<${tag}`);
  expect(html).toContain('type="checkbox"'); expect(html).toContain('language-ts'); expect(html).not.toContain('href="https://');
});
it('renders every prefix of a streaming Markdown response without throwing', () => {
  const message = '# 标题\n\n**粗体** [链接](https://example.com)\n\n```ts\nconst value = "中";\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |';
  for (let i = 0; i <= message.length; i++) expect(() => renderToStaticMarkup(<Markdown text={message.slice(0, i)}/>)).not.toThrow();
});
it('blocks raw HTML, unsafe URLs and automatic image loading', () => {
  const html = renderToStaticMarkup(<Markdown text={'<script>alert(1)</script>\n\n<img src="x" onerror="alert(2)">\n\n[x](javascript:alert) ![private](https://tracking.invalid/pixel) [file](file:///etc/passwd)'}/>);
  expect(html).not.toMatch(/<script|<img|javascript:|file:\/\/|src=/);
  expect(html).toContain('[图片：private]');
  for (const url of ['javascript:alert(1)', 'data:text/html,foo', 'file:///secret', '//remote/x', '../local', 'https://user:password@example.com']) expect(markdownUrl(url)).toBe('');
  expect(markdownUrl('#section')).toBe('#section'); expect(markdownUrl('https://example.com')).toBe('https://example.com/');
});
it('supports typed components and remark/rehype extensions with sanitization last', () => {
  const html = renderToStaticMarkup(<Markdown text="# extension" extensions={{
    components: { h1: ({ children }) => <h2 className="custom-title">{children}</h2> },
    remarkPlugins: [() => (tree: any) => { tree.children[0].children[0].value = 'remark extension'; }],
    rehypePlugins: [() => (tree: any) => { tree.children.push({ type: 'element', tagName: 'script', properties: {}, children: [{ type: 'text', value: 'bad()' }] }); }],
  }}/>);
  expect(html).toContain('<h2 class="custom-title">remark extension</h2>'); expect(html).not.toContain('<script');
});

it('renders inline and display mathematics and highlights only configured code languages', () => {
  const html = renderToStaticMarkup(<Markdown text={'Inline $a+b=c$\n\n$$\n\\frac{1}{2} + \\sqrt{x}\n$$\n\n```js\nconst value = "hello";\n```\n\n```unknown-language\n<untouched>\n```'}/>);
  expect(html).toContain('class="katex"'); expect(html).toContain('katex-display'); expect(html).toContain('<math');
  expect(html).toContain('hljs-keyword'); expect(html).toContain('hljs-string'); expect(html).toContain('&lt;untouched&gt;'); expect(html).toContain('复制代码');
});
it('never trusts math HTML or resource commands and tolerates incomplete streamed formulas', () => {
  const html = renderToStaticMarkup(<Markdown text={'$\\href{https://evil.invalid}{click}$ $\\includegraphics{https://evil.invalid/pixel}$ $\\htmlClass{fake}{x}$'}/>);
  expect(html).not.toMatch(/href="https:\/\/evil|src="https:\/\/evil|class="fake"/);
  for (const text of ['$', '$a+', '$$\n\\frac{', '$$\n\\frac{1}{2}', '$\\unknown{', '$\\def\\x{\\x}\\x$']) expect(() => renderToStaticMarkup(<Markdown text={text}/>)).not.toThrow();
});
