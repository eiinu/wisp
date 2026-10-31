import React, { useRef, useState } from 'react';
import type { ModelConfig, ModelInfo, Request, Result } from '@wisp/core';

/** Changes only the model ID within the saved provider/endpoint; never handles credentials. */
export function ModelSelector({ config, disabled, request, onError }: {
  config?: ModelConfig; disabled: boolean;
  request(input: Request): Promise<Result>; onError(message: string): void;
}) {
  const [models, setModels] = useState<ModelInfo[]>([]), [pending, setPending] = useState(false);
  const loading = useRef(false), saving = useRef(false);
  const discover = async () => {
    if (disabled || !config || loading.current) return;
    loading.current = true;
    try { const result = await request({ type: 'model.list' }); setModels(result.models ?? []); }
    catch (error) { onError(`无法获取可用模型：${error instanceof Error ? error.message : String(error)}`); }
    finally { loading.current = false; }
  };
  const change = async (model: string) => {
    if (disabled || !config || saving.current || model === config.model || !models.some(item => item.id === model)) return;
    saving.current = true; setPending(true);
    try { await request({ type: 'model.save', config: { ...config, model } }); }
    catch (error) { onError(error instanceof Error ? error.message : String(error)); }
    finally { saving.current = false; setPending(false); }
  };
  return <label className="model-selector"><span>Wisp</span><select aria-label="选择模型" title={config?.model ?? '请在设置中配置模型'} value={config?.model ?? ''} disabled={disabled || pending || !config} onFocus={() => void discover()} onPointerDown={() => void discover()} onChange={event => void change(event.target.value)}>
    <option value={config?.model ?? ''}>{config?.provider === 'offline' ? '离线验证（开发）' : config?.model ?? '未配置模型'}</option>
    {models.filter(item => item.id !== config?.model).map(item => <option key={item.id} value={item.id}>{item.name ?? item.id}</option>)}
  </select></label>;
}
