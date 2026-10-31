import { spawnSync } from 'node:child_process';
import { packageIdentity } from './package-identity.mjs';

const { timestamp } = packageIdentity();
const result = spawnSync('pnpm', ['exec', 'electron-builder', '--config', 'electron-builder.yml', '--mac', 'dmg', '--arm64', '--publish', 'never'], {
  stdio: 'inherit', env: { ...process.env, WISP_COMMIT_TIME: timestamp },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
