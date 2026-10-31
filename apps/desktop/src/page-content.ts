/** Executed only in an isolated world, using DOM text, never page JS globals or form values. */
export function extractPage() {
 const cleanUrl=(raw:string)=>{try{const url=new URL(raw,location.href);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)return;url.search='';url.hash='';return url.href;}catch{return;}};
 const excluded='script,style,noscript,template,iframe,frame,input,textarea,select,option,button,form,[contenteditable],[hidden],[aria-hidden="true"]';
 const root=document.querySelector('article,main,[role="main"]')??document.body;
 const links:{text:string;url:string}[]=[];const seen=new Set<string>();let text='',visited=0,truncated=false;
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
 while(walker.nextNode()){
  if(++visited>20000){truncated=true;break;}
  const node=walker.currentNode,element=node.parentElement;if(!element||element.closest(excluded)||!element.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))continue;
  const value=(node.textContent??'').replace(/\s+/g,' ').trim();if(!value)continue;
  text+=value+'\n';if(text.length>24000){text=text.slice(0,24000);truncated=true;break;}
  const a=element.closest('a[href]');if(a){const url=cleanUrl(a.getAttribute('href')??'');if(url&&!seen.has(url)&&links.length<60){seen.add(url);links.push({text:value.slice(0,160),url});}}
 }
 return {title:document.title.slice(0,300),text,links,truncated};
}
export function publicPageUrl(raw:string){const url=new URL(raw);url.search='';url.hash='';return url.href;}

export function boundedRead<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  const abort=()=>{signal.removeEventListener('abort',abort);reject(new Error('网页读取已取消或超时'));};
  if(signal.aborted){promise.catch(()=>{});abort();return;}
  signal.addEventListener('abort',abort,{once:true});
  promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
 });
}
