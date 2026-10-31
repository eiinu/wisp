import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
it('resolves shared design values and preserves keyboard, touch and narrow-layout affordances',()=>{
 const styles=readFileSync('apps/desktop/ui/style.css','utf8'),tokens=readFileSync('apps/desktop/ui/tokens.css','utf8');
 const defined=new Set([...tokens.matchAll(/(--[a-z-]+)\s*:/g)].map(m=>m[1]));
 for(const match of styles.matchAll(/var\((--[a-z-]+)\)/g))expect(defined.has(match[1]),`Undefined ${match[1]}`).toBe(true);
 expect(styles).toContain('@import "./tokens.css";');
 expect(styles).toContain('@media(hover:hover) and (pointer:fine)');
 expect(styles).toContain('.session-row:focus-within>.session-action');
 expect(styles).toContain('.project-row:focus-within>button:last-child');
 expect(styles).toContain('.composer-toolbar{flex-wrap:wrap}');
 expect(styles).toContain('.workspace-chip>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}');
 expect(styles).toContain('.modal-actions{flex-wrap:wrap;');
 expect(styles).toContain('@media(prefers-reduced-motion:reduce)');
 expect(styles).toContain('.messages{scroll-behavior:auto}');
});
