import { expect, it } from 'vitest';
import { linkTarget, previewReducer, type PreviewState } from './preview-model.js';
it('resolves authorized relative files without escaping or accepting dangerous schemes', () => {
  const source={kind:'file' as const,sessionId:'a',workspace:'/root',path:'docs/readme.md'};
  expect(linkTarget('../notes.txt',source)).toMatchObject({kind:'file',path:'notes.txt'});
  for (const href of ['../../secret','file:///etc/passwd','javascript:alert(1)','%2fetc/passwd','../.secret','https://user:pass@x.test']) expect(linkTarget(href,source)).toBeUndefined();
  expect(linkTarget('../next',{kind:'web',url:'https://example.com/docs/page'})).toEqual({kind:'web',url:'https://example.com/next'});
});
it('deduplicates files and closes private tabs on session or authorization changes', () => {
  let state:PreviewState={tabs:[]}; const target={kind:'file' as const,sessionId:'a',workspace:'/a',path:'notes.md'};
  state=previewReducer(state,{type:'open',target}); state=previewReducer(state,{type:'open',target}); expect(state.tabs).toHaveLength(1);
  state=previewReducer(state,{type:'open',target:{kind:'web',url:'https://example.com'}}); state=previewReducer(state,{type:'scope',sessionId:'b',workspace:'/b'}); expect(state.tabs.map(t=>t.kind)).toEqual(['web']);
});
it('artifact snapshots refresh same-title content and cannot survive a session scope switch',()=>{
 const first=previewReducer({tabs:[]},{type:'open',target:{kind:'artifact',sessionId:'a',title:'log.txt',text:'old'}});
 const second=previewReducer(first,{type:'open',target:{kind:'artifact',sessionId:'a',title:'log.txt',text:'new'}});expect(second.tabs).toHaveLength(1);expect(second.tabs[0]).toMatchObject({text:'new',revision:1});
 expect(previewReducer(second,{type:'scope',sessionId:'b'}).tabs).toEqual([]);
});
