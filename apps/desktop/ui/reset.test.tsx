// @vitest-environment jsdom
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {Markdown} from './markdown.js';
const base=readFileSync('apps/desktop/ui/reset.css','utf8'),styles=readFileSync('apps/desktop/ui/style.css','utf8');
it('loads reset in a lower-priority layer and preserves specialized content and native controls',()=>{
 expect(styles.startsWith('@import "./reset.css" layer(reset);')).toBe(true);
 expect(base).toContain('::before, ::after, ::backdrop, ::file-selector-button { box-sizing: border-box; }');
 expect(base).toContain('font: inherit; letter-spacing: inherit; color: inherit;');
 expect(base).toContain('appearance: auto;');expect(base).toContain('border: revert; background: revert;');
 expect(base).toContain('.katex svg { display: revert; vertical-align: revert; }');
 expect(base).not.toContain('list-style: none');expect(base).not.toContain('scrollbar-width');
 expect(base).toContain('dialog:not([open]) { display: none; }');
 expect(styles).toContain('.markdown ul{list-style:disc}.markdown ol{list-style:decimal}');
});
it('replaces browser focus with visible keyboard and forced-colors indicators, including the composer frame',()=>{
 expect(base).not.toMatch(/outline\s*:/);
 expect(styles).not.toMatch(/\*\s*\{[^}]*outline\s*:\s*(none|0)/);
 expect(styles).toContain(':focus:not(:focus-visible){outline:none}');
 expect(styles).toContain(':focus-visible{outline:2px solid var(--focus-color);outline-offset:2px}');
 expect(styles).toContain('.composer:has(textarea:focus-visible){outline:2px solid var(--focus-color)');
 expect(styles).toContain('.composer:focus-within{border-color:var(--focus-border)}');
 expect(styles).toContain('@media(forced-colors:active)');expect(styles).toContain('outline-color:Highlight');expect(styles).toContain('color:GrayText;opacity:1');
});
it('keeps Markdown list, table, highlighted code and math structure for style QA',()=>{
 const element=document.createElement('div');element.innerHTML=renderToStaticMarkup(<Markdown text={'# Heading\n\n- item\n- [x] task\n\n1. ordered\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```js\nconst n = 1;\n```\n\nInline $a+b=c$\n\n$$\n\\frac{1}{2}\n$$'}/>);
 expect(element.querySelector('h1')?.textContent).toBe('Heading');expect(element.querySelector('ul li')).not.toBeNull();expect(element.querySelector('ol li')).not.toBeNull();
 expect(element.querySelector<HTMLInputElement>('input[type=checkbox]')?.disabled).toBe(true);
 expect(element.querySelector('table th')).not.toBeNull();expect(element.querySelector('.hljs-keyword')).not.toBeNull();expect(element.querySelectorAll('.katex')).toHaveLength(2);expect(element.querySelector('.katex-display')).not.toBeNull();
});
