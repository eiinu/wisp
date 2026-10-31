import { questionnaireSchema, questionnaireJsonSchema, type Tool } from '@wisp/core';
/** Only this Host-registered tool can enter the questionnaire interaction. MCP tool metadata cannot set it. */
export const askUserTool:Tool={
 name:'ask_user',interaction:'questionnaire',requiresApproval:false,
 description:'Ask the user for missing preferences or task details in 1–6 questions. Supports single, multiple, text and custom answers. Wait for structured answers; cancellation means do not repeat the question automatically. This is NOT authorization: answers never approve actions. Never request passwords, API keys, tokens or other secrets; direct the user to secure Settings instead.',
 inputSchema:questionnaireJsonSchema,
 validate(args){const form=questionnaireSchema.parse(args);if(/api[ _-]?key|password|secret|access[ _-]?token|密码|密钥|口令|验证码/i.test(JSON.stringify(form)))throw new Error('请在安全设置中填写凭据，问答工具不得收集秘密');},
 async execute(){throw new Error('问答仅通过 Host 独立交互通道执行');},
};
