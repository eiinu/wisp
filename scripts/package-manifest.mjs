import { readFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { packageIdentity } from './package-identity.mjs';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const { commit, committedAt, timestamp, artifactName, dmgPath } = packageIdentity();
const checksum = createHash('sha256').update(await readFile(dmgPath)).digest('hex');
const summary = `## Wisp macOS arm64\n\n- DMG: \`${artifactName}.dmg\`\n- Commit: \`${commit}\`\n- Committer timestamp: \`${committedAt}\`\n- Filename time: \`${timestamp}\` (Asia/Shanghai, UTC+08)\n- App version: \`${version}\`\n- Signing: ad-hoc; no Developer ID; not notarized\n- SHA-256: \`${checksum}\`\n\nDownload the artifact below; GitHub wraps the single DMG in a ZIP archive.\n`;
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `artifact_name=${artifactName}\ndmg_path=${dmgPath}\n`);
