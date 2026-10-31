// Serializes Wisp mutations across sessions, including different grants of the same directory.
// External applications are not locked: individual operations revalidate their approved version.
let tail: Promise<unknown> = Promise.resolve();
export function fileMutation<T>(signal:AbortSignal, work:()=>Promise<T>):Promise<T>{
 const next=tail.then(()=>{signal.throwIfAborted();return work();});tail=next.catch(()=>{});return next;
}
