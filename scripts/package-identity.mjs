import { execFileSync } from 'node:child_process';

export function formatCommitTime(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid commit timestamp');
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return ['year', 'month', 'day', 'hour', 'minute'].map(key => values[key]).join('');
}

export function packageIdentity() {
  const [commit, committedAt] = execFileSync('git', ['show', '-s', '--format=%H%n%cI', 'HEAD'], { encoding: 'utf8' }).trim().split('\n');
  const timestamp = formatCommitTime(committedAt);
  const artifactName = `Wisp-macos-arm64-${timestamp}`;
  return { commit, committedAt, timestamp, artifactName, dmgPath: `release/${artifactName}.dmg` };
}
