import { test } from 'vitest';
import assert from 'node:assert/strict';
import { formatCommitTime, packageIdentity } from './package-identity.mjs';

test('commit time uses Shanghai with stable minute precision and date rollover', () => {
  assert.equal(formatCommitTime('2026-10-31T03:46:59Z'), '202610311146');
  assert.equal(formatCommitTime('2026-10-31T11:46:59+08:00'), '202610311146');
  assert.equal(formatCommitTime('2026-12-31T16:00:00Z'), '202701010000');
  assert.throws(() => formatCommitTime('invalid'), /Invalid commit timestamp/);
});

test('same checked-out commit produces the same single DMG identity', () => {
  const identity = packageIdentity();
  assert.deepEqual(packageIdentity(), identity);
  assert.match(identity.commit, /^[a-f0-9]{40}$/);
  assert.equal(identity.dmgPath, `release/Wisp-macos-arm64-${formatCommitTime(identity.committedAt)}.dmg`);
});

test('summary exposes exactly one DMG output and creates no extra attachments', async () => {
  const { mkdtemp, mkdir, writeFile, readFile, readdir, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const directory = await mkdtemp(join(tmpdir(), 'wisp-package-test-'));
  try {
    const identity = packageIdentity();
    await mkdir(join(directory, 'release'));
    await writeFile(join(directory, identity.dmgPath), 'fixture-only');
    await writeFile(join(directory, 'package.json'), JSON.stringify({ version: '0.1.0' }));
    const summaryPath = join(directory, 'summary.md');
    const outputPath = join(directory, 'output');
    execFileSync(process.execPath, [resolve('scripts/package-manifest.mjs')], {
      cwd: directory,
      env: { ...process.env, GIT_DIR: resolve('.git'), GITHUB_STEP_SUMMARY: summaryPath, GITHUB_OUTPUT: outputPath },
    });
    assert.equal(await readFile(outputPath, 'utf8'), `artifact_name=${identity.artifactName}\ndmg_path=${identity.dmgPath}\n`);
    const summary = await readFile(summaryPath, 'utf8');
    assert.ok(summary.includes(identity.commit));
    assert.match(summary, /SHA-256: `[a-f0-9]{64}`/);
    assert.deepEqual(await readdir(join(directory, 'release')), [`${identity.artifactName}.dmg`]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
