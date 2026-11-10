// SDK 2.0.4 is supplied only by the verification script, not the product dependency tree.
import { App } from '@modelcontextprotocol/ext-apps';
const app=new App({name:'Synthetic Todo UI',version:'1'});
const list=document.getElementById('todos')!,input=document.getElementById('text') as HTMLInputElement;
function render(result:any){list.dataset.state=JSON.stringify(result.structuredContent.todos);list.replaceChildren();for(const todo of result.structuredContent.todos){const row=document.createElement('li'),check=document.createElement('input');check.type='checkbox';check.checked=todo.done;check.dataset.id=todo.id;check.onchange=async()=>render(await app.callServerTool({name:'set_todo_done',arguments:{id:todo.id,done:check.checked}}));row.append(check,document.createTextNode(todo.text));list.append(row);}}
app.ontoolresult=render;app.onteardown=async()=>({});
document.getElementById('add')!.onclick=async()=>{render(await app.callServerTool({name:'add_todo',arguments:{text:input.value}}));input.value='';};
void app.connect();
