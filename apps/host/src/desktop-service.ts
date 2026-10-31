import {randomUUID} from 'node:crypto';
export interface DesktopService { call(operation:string, payload:Record<string,unknown>, signal:AbortSignal):Promise<any> }
/** Only the fork's private parent IPC. Never available as a Renderer request. */
export function parentDesktopService():DesktopService {
 return {call:(operation,payload,signal)=>new Promise((resolve,reject)=>{
  signal.throwIfAborted();const id=randomUUID();
  const clean=()=>{clearTimeout(timer);process.off('message',receive);signal.removeEventListener('abort',abort);};
  const abort=()=>{clean();if(process.connected)process.send?.({type:'desktop-cancel',id});reject(signal.reason??new Error('已取消'));};
  const receive=(message:any)=>{if(message?.type!=='desktop-response'||message.id!==id)return;clean();message.error?reject(new Error(message.error)):resolve(message.value);};
  const timer=setTimeout(()=>{clean();if(process.connected)process.send?.({type:'desktop-cancel',id});reject(new Error('桌面操作超时；不要自动重试，先确认实际状态'));},12000);
  process.on('message',receive);signal.addEventListener('abort',abort,{once:true});process.send?.({type:'desktop-request',id,operation,payload});
 })};
}
