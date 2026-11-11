import {QIANFAN_MODEL,type ModelConfig} from '@wisp/core';
import {chatCompletionsProvider,type ChatCompletionsTransport} from './chat-completions.js';
/** Native Qianfan v2 dialect; no DeepSeek thinking parameters or model-discovery probe. */
export function qianfanProvider(config:ModelConfig,apiKey:string,transport:ChatCompletionsTransport={},assistantSetting=''){
 const provider=chatCompletionsProvider(config,apiKey,transport,assistantSetting,false,'qianfan');
 return {...provider,async listModels({signal}:{signal:AbortSignal}){
  signal.throwIfAborted();return [{id:QIANFAN_MODEL,name:'文心 5.5 Flash Preview',inputModalities:['text'],outputModalities:['text']}];
 }};
}
