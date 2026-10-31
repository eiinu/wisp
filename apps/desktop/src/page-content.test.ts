// @vitest-environment jsdom
import {it,expect,vi} from 'vitest';
import {extractPage,publicPageUrl} from './page-content.js';
it('extracts bounded untrusted article text, excluding all fields/forms/hidden data and URL queries',()=>{
 Object.defineProperty(Element.prototype,'checkVisibility',{configurable:true,value:function(this:Element){return this.getAttribute('style')!=='display:none'}});
 document.title='Article';document.body.innerHTML='<main><p>Public paragraph</p><form>Secret form<input value="password-secret"></form><div contenteditable>edited secret</div><p hidden>hidden secret</p><p style="display:none">CSS secret</p><script>token-secret</script><a href="https://example.com/a?token=secret#key">Source</a><a href="javascript:evil()">bad link</a></main><aside>Other data</aside>';
 const result=extractPage();expect(result.text).toContain('Public paragraph');expect(result.text).not.toMatch(/secret|Other data/);expect(result.links).toEqual([{text:'Source',url:'https://example.com/a'}]);expect(publicPageUrl('https://example.com/a?token=secret#key')).toBe('https://example.com/a');
 document.querySelector('main')!.innerHTML='<p>'+ 'long'.repeat(10000)+'</p>';expect(extractPage()).toMatchObject({truncated:true});expect(extractPage().text.length).toBe(24000);vi.restoreAllMocks();
});
