// @vitest-environment jsdom
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';
import {WorkspaceIcon,iconPaths} from './workspace-icon.js';
it('every registered icon has visible geometry, fixed bounds and decorative accessibility',()=>{
 for(const name of Object.keys(iconPaths) as (keyof typeof iconPaths)[]){
  const element=document.createElement('div');element.innerHTML=renderToStaticMarkup(<WorkspaceIcon name={name}/>);
  const svg=element.querySelector('svg')!;expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');expect(svg.getAttribute('stroke')).toBe('currentColor');expect(svg.getAttribute('aria-hidden')).toBe('true');
  expect(svg.querySelector('path')?.getAttribute('d')).toMatch(/[MLm][\d -]+/);
 }
});
it('all literal icon references exist and UI chrome no longer depends on Unicode icon fonts',()=>{
 for(const file of readdirSync('apps/desktop/ui').filter(f=>f.endsWith('.tsx')&&!f.includes('.test.'))){
  const source=readFileSync(`apps/desktop/ui/${file}`,'utf8');
  for(const match of source.matchAll(/<WorkspaceIcon name="([^"]+)"/g))expect(iconPaths).toHaveProperty(match[1]);
  expect(source).not.toMatch(/[⚙☰⌄▱◎◇◈✓↓↑■›＋×]/);
 }
 const css=readFileSync('apps/desktop/ui/style.css','utf8');
 expect(css).toContain('.workspace-icon{display:block;flex-shrink:0;align-self:center}');expect(css).toContain('transform-origin:center');
});

it('centers block icons only inside both browser and directory empty states',()=>{
 const css=readFileSync('apps/desktop/ui/style.css','utf8');
 const rule=css.match(/\.panel-empty>span \.workspace-icon\{[^}]+\}/)?.[0];
 expect(rule).toBeDefined();
 const style=document.createElement('style');style.textContent=rule!;document.head.append(style);
 const content=document.createElement('div');document.body.append(content);
 try {
  for(const name of ['globe','folder'] as const){
   content.innerHTML=`<div class="panel-empty"><span>${renderToStaticMarkup(<WorkspaceIcon name={name}/>)}</span></div><button>${renderToStaticMarkup(<WorkspaceIcon name={name}/>)}</button>`;
   expect(getComputedStyle(content.querySelector('.panel-empty svg')!).marginInline).toBe('auto');
   expect(getComputedStyle(content.querySelector('button svg')!).marginInline).not.toBe('auto');
  }
 }finally{content.remove();style.remove();}
});
