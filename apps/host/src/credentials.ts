import type { CredentialProvider } from '@wisp/core';
export interface CredentialVault {
  available(): Promise<boolean>;
  load(provider?: CredentialProvider): Promise<string | undefined>;
  save(key: string, provider?: CredentialProvider): Promise<void>;
  delete(provider?: CredentialProvider): Promise<void>;
}
