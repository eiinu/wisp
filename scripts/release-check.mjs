import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const workspacePackages = ['apps/desktop/package.json', 'apps/host/package.json', 'packages/core/package.json'];
export function versionInfo({ sync = false } = {}) {
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('Expected stable semver version');
  for (const path of workspacePackages) {
    const pkg = JSON.parse(readFileSync(path, 'utf8'));
    if (sync) {
      pkg.version = version;
      writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
    } else if (pkg.version !== version) throw new Error(`Version mismatch: ${path}`);
  }
  return version;
}
export function releaseNotes(version) {
  const text = readFileSync('CHANGELOG.md', 'utf8');
  const sections = text.split(/^## /m).slice(1);
  const matches = sections.filter(section => section.startsWith(`[${version}] - `));
  if (matches.length !== 1 || !matches[0].includes('\n- ')) throw new Error('Missing or duplicate changelog entry');
  return `## ${matches[0].trim()}\n`;
}
export function checkRelease(tag, expectedCommit = process.env.GITHUB_SHA) {
  const version = versionInfo();
  if (tag !== `v${version}`) throw new Error('Tag must exactly match package version');
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commit = git('rev-parse', 'HEAD');
  if (expectedCommit && commit !== expectedCommit) throw new Error('Unexpected checked-out commit');
  if (git('rev-parse', `refs/tags/${tag}^{commit}`) !== commit) throw new Error('Tag points to another commit');
  // A full, freshly fetched checkout is required by both jobs. Detached tags on feature branches fail.
  git('merge-base', '--is-ancestor', commit, 'refs/remotes/origin/main');
  return { version, tag, commit, notes: releaseNotes(version) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--sync') console.log(versionInfo({ sync: true }));
  else console.log(JSON.stringify(checkRelease(process.env.RELEASE_TAG ?? process.argv[2])));
}
