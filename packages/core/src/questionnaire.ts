import { z } from 'zod';
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const option = z.object({ id, label:z.string().trim().min(1).max(200), description:z.string().max(400).optional() }).strict();
export const questionnaireSchema = z.object({
 title:z.string().trim().min(1).max(160),
 questions:z.array(z.object({id, title:z.string().trim().min(1).max(500), type:z.enum(['single','multiple','text']), required:z.boolean(), options:z.array(option).max(12).optional(), allowCustom:z.boolean().optional()}).strict()).min(1).max(6),
}).strict().superRefine((value,ctx)=>{
 const fail=(message:string)=>ctx.addIssue({code:'custom',message});
 if(new Set(value.questions.map(q=>q.id)).size!==value.questions.length)fail('题目 ID 不可重复');
 for(const q of value.questions){
  if(q.type==='text'&&(q.options?.length||q.allowCustom))fail('文字题不能包含选项');
  if(q.type!=='text'&&(!q.options||q.options.length<2))fail('选择题需要至少两个选项');
  if(new Set(q.options?.map(o=>o.id)).size!==(q.options?.length??0))fail('选项 ID 不可重复');
 }
});
export type Questionnaire = z.infer<typeof questionnaireSchema>;
export const questionResponseSchema=z.discriminatedUnion('status',[
 z.object({status:z.literal('cancelled')}).strict(),
 z.object({status:z.literal('answered'),answers:z.array(z.object({questionId:id,optionIds:z.array(id).max(12),text:z.string().trim().max(4000)}).strict()).max(6)}).strict(),
]);
export type QuestionResponse=z.infer<typeof questionResponseSchema>;
export type QuestionAnswer=Extract<QuestionResponse,{status:'answered'}>['answers'][number];
export function validateQuestionResponse(questionnaire:Questionnaire,input:unknown):QuestionResponse {
 const value=questionResponseSchema.parse(input);if(value.status==='cancelled')return value;
 if(value.answers.length!==questionnaire.questions.length||new Set(value.answers.map(a=>a.questionId)).size!==value.answers.length)throw new Error('请按题目提交答案，不可重复或遗漏');
 for(const q of questionnaire.questions){
  const a=value.answers.find(a=>a.questionId===q.id);if(!a)throw new Error('未知或缺少题目');
  if(new Set(a.optionIds).size!==a.optionIds.length||a.optionIds.some(id=>!q.options?.some(o=>o.id===id)))throw new Error('答案包含无效选项');
  if(q.type==='text'&&a.optionIds.length)throw new Error('文字题不接受选项');
  if(q.type!=='text'&&a.text&&!q.allowCustom)throw new Error('此题不接受自定义答案');
  if(q.type==='single'&&a.optionIds.length+(a.text?1:0)>1)throw new Error('单选题只能选择一项或自定义答案');
  if(q.required&&!a.text&&!a.optionIds.length)throw new Error('请回答所有必填题');
 }
 return value;
}

export const questionnaireJsonSchema=z.toJSONSchema(questionnaireSchema) as Record<string,unknown>;
