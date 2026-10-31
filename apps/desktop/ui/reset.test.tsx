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
 expect(styles).toContain('.composer:focus-within{border-color:var(--focus-border);outline:2px solid var(--focus-color);outline-offset:-2px}');
 expect(styles).not.toContain('.composer:has(textarea:focus-visible)');
 expect(styles).toContain('@media(forced-colors:active)');expect(styles).toContain('outline-color:Highlight');expect(styles).toContain('color:GrayText;opacity:1');
});
it('keeps Markdown list, table, highlighted code and math structure for style QA',()=>{
 const element=document.createElement('div');element.innerHTML=renderToStaticMarkup(<Markdown text={'# Heading\n\n- item\n- [x] task\n\n1. ordered\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```js\nconst n = 1;\n```\n\nInline $a+b=c$\n\n$$\n\\frac{1}{2}\n$$'}/>);
 expect(element.querySelector('h1')?.textContent).toBe('Heading');expect(element.querySelector('ul li')).not.toBeNull();expect(element.querySelector('ol li')).not.toBeNull();
 expect(element.querySelector<HTMLInputElement>('input[type=checkbox]')?.disabled).toBe(true);
 expect(element.querySelector('table th')).not.toBeNull();expect(element.querySelector('.hljs-keyword')).not.toBeNull();expect(element.querySelectorAll('.katex')).toHaveLength(2);expect(element.querySelector('.katex-display')).not.toBeNull();
});

it('merges text focus into the border while preserving separate keyboard rings for choice controls',()=>{
 const textRule=styles.match(/:is\(input:is\([^}]+\):focus\{[^}]+\}/)![0];
 const generic=styles.match(/:is\(button,a,input,textarea,select,summary,\[tabindex\]\):focus-visible\{[^}]+\}/)![0];
 const style=document.createElement('style');style.textContent=generic+'\n'+textRule;document.head.append(style);
 const fixture=document.createElement('div');document.body.append(fixture);
 try {
  for(const type of ['', 'text','password','email','url','search','tel','number']){
   fixture.innerHTML=`<input ${type?`type="${type}"`:''}/>`;const input=fixture.firstElementChild as HTMLInputElement;input.focus();
   expect(getComputedStyle(input).outlineOffset).toBe('-2px');
  }
  fixture.innerHTML='<textarea></textarea>';const textarea=fixture.firstElementChild as HTMLTextAreaElement;textarea.focus();expect(getComputedStyle(textarea).outlineOffset).toBe('-2px');
  for(const markup of ['<button>Action</button>','<a href="#">Link</a>','<input type="checkbox"/>','<input type="radio"/>','<select><option>A</option></select>']){
   fixture.innerHTML=markup;const control=fixture.firstElementChild as HTMLElement;control.focus();expect(getComputedStyle(control).outlineOffset).toBe('2px');
  }
 }finally{fixture.remove();style.remove();}
});
