import {chatCompletionsProvider} from './chat-completions.js';
import {supportsImages,type ModelConfig} from '@wisp/core';
export {sse} from './chat-completions.js';
export type {ChatCompletionsTransport as DeepSeekTransport} from './chat-completions.js';
import type {ChatCompletionsTransport} from './chat-completions.js';
export function deepseekProvider(config:ModelConfig,apiKey:string,transport:ChatCompletionsTransport={},assistantSetting='',imageInputSupported=supportsImages(config)){
 return chatCompletionsProvider(config,apiKey,transport,assistantSetting,imageInputSupported,'deepseek');
}
