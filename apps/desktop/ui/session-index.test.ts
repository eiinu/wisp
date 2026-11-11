import {expect,it} from 'vitest';
import {indexSessionList} from './session-index.js';
it('keeps list order, project membership, independent and archived conversations',()=>{
 const sessions=[{id:'a',title:'A',createdAt:'',updatedAt:'',projectId:'p'},{id:'b',title:'B',createdAt:'',updatedAt:''},{id:'c',title:'C',createdAt:'',updatedAt:'',projectId:'p',archivedAt:'today'},{id:'d',title:'D',createdAt:'',updatedAt:'',projectId:'p'}];
 const index=indexSessionList(sessions,[{id:'p',name:'Project',workspace:'/fixture',collapsed:false,createdAt:''}]);
 expect(index.active.get('p')?.map(s=>s.id)).toEqual(['a','d']);expect(index.active.get(undefined)?.map(s=>s.id)).toEqual(['b']);expect(index.archived.map(s=>s.id)).toEqual(['c']);expect(index.projectNames.get('p')).toBe('Project');
});
