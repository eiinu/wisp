import {z} from 'zod';
import type {ModelConfig,ModelInfo} from './index.js';
export const IMAGE_LIMIT=10*1024*1024;
export const IMAGE_COUNT=4;
export const imageSchema=z.object({id:z.string().uuid(),name:z.string().min(1).max(160),mime:z.enum(['image/png','image/jpeg','image/webp','image/gif']),size:z.number().int().positive().max(IMAGE_LIMIT),width:z.number().int().positive().max(8192),height:z.number().int().positive().max(8192),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type ChatImage=z.infer<typeof imageSchema>;
export function supportsImages(config:ModelConfig|undefined, models?:ModelInfo[]):boolean {
 if(config?.provider!=='deepseek')return false;
 const discovered=models?.find(m=>m.id===config.model)?.inputModalities;
 if(discovered)return discovered.includes('image');
 return /^https:\/\/api\.deepseek\.com(?:\/v1)?\/?$/.test(config.baseUrl)&&['deepseek-flash','deepseek-v4-flash-vision-exp'].includes(config.model);
}
