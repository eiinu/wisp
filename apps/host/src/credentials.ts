export interface CredentialVault {
  available(): Promise<boolean>;
  load(): Promise<string | undefined>;
  save(key: string): Promise<void>;
  delete(): Promise<void>;
}
export function officialDeepSeek(config: { provider: string; baseUrl: string }) {
  try { const url = new URL(config.baseUrl); return config.provider === 'deepseek' && url.origin === 'https://api.deepseek.com' && ['/', '/v1', '/v1/'].includes(url.pathname) && !url.username && !url.password && !url.search && !url.hash; } catch { return false; }
}
