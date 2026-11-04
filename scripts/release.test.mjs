import { test, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';
import { prepareBundle, verifyBundle, digest } from './release-bundle.mjs';
import { ensureDraft, githubAPI } from './release-draft.mjs';

const info = { tag: 'v0.1.0', version: '0.1.0', commit: 'a'.repeat(40), notes: '## [0.1.0] - 待发布\n- Test\n' };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'wisp-release-'));
  const source = join(root, 'input.dmg'), pkg = join(root, 'package.json'), out = join(root, 'bundle');
  writeFileSync(source, 'fixture DMG'); writeFileSync(pkg, JSON.stringify({ version: info.version }));
  return { root, source, pkg, out, clean: () => rmSync(root, { recursive: true, force: true }) };
}
test('bundle binds packaged app version, commit and every attachment hash; rejects tampering and symlinks', () => {
  const f = fixture();
  try {
    writeFileSync(f.pkg, '{"version":"0.0.0"}');
    expect(() => prepareBundle(info, f.source, f.pkg, f.out)).toThrow(/version/);
    writeFileSync(f.pkg, '{"version":"0.1.0"}');
    const assets = prepareBundle(info, f.source, f.pkg, f.out);
    expect(assets).toHaveLength(3);
    expect(() => verifyBundle({ ...info, commit: 'b'.repeat(40) }, f.out)).toThrow(/identity/);
    writeFileSync(assets[0].path, 'changed');
    expect(() => verifyBundle(info, f.out)).toThrow(/identity/);
    rmSync(assets[0].path); symlinkSync(f.source, assets[0].path);
    expect(() => verifyBundle(info, f.out)).toThrow(/Invalid/);
  } finally { f.clean(); }
});
test('release guard accepts main ancestors, rejects feature tags, moved tags, wrong SHA/version and missing notes', () => {
  const f = fixture();
  const script = resolve('scripts/release-check.mjs');
  const git = (...args) => execFileSync('git', args, { cwd: f.root, encoding: 'utf8', stdio: 'pipe' }).trim();
  const run = (tag = info.tag, sha = '') => execFileSync(process.execPath, [script], { cwd: f.root, env: { ...process.env, RELEASE_TAG: tag, GITHUB_SHA: sha }, stdio: 'pipe' });
  try {
    for (const path of ['apps/desktop', 'apps/host', 'packages/core']) {
      mkdirSync(join(f.root, path), { recursive: true });
      writeFileSync(join(f.root, path, 'package.json'), '{"version":"0.1.0"}');
    }
    writeFileSync(join(f.root, 'CHANGELOG.md'), info.notes);
    git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
    git('add', '.'); git('commit', '-m', 'fixture');
    const sha = git('rev-parse', 'HEAD'); git('update-ref', 'refs/remotes/origin/main', sha); git('tag', '-a', info.tag, '-m', 'test');
    expect(JSON.parse(run(info.tag, sha)).commit).toBe(sha);
    expect(() => run('v9.9.9')).toThrow(); expect(() => run(info.tag, 'b'.repeat(40))).toThrow();
    writeFileSync(join(f.root, 'packages/core/package.json'), '{"version":"0.0.0"}'); expect(() => run()).toThrow();
    writeFileSync(join(f.root, 'packages/core/package.json'), '{"version":"0.1.0"}');
    writeFileSync(join(f.root, 'CHANGELOG.md'), '# Empty'); expect(() => run()).toThrow();
    writeFileSync(join(f.root, 'CHANGELOG.md'), info.notes);
    git('switch', '-c', 'feature'); writeFileSync(join(f.root, 'feature'), 'x'); git('add', '.'); git('commit', '-m', 'feature');
    expect(() => run()).toThrow(); // HEAD no longer tag.
    git('tag', '-d', info.tag); git('tag', info.tag); expect(() => run()).toThrow(); // Not on trusted main.
  } finally { f.clean(); }
});
function fakeAPI() {
  let release; let uploads = 0; let creates = 0; let removes = 0; let failName;
  return {
    get release() { return release; }, get uploads() { return uploads; }, get creates() { return creates; }, get removes() { return removes; },
    fail(name) { failName = name; },
    assertSource: async () => {},
    find: async () => release,
    create: async body => { creates++; release = { ...body, id: 1, assets: [], html_url: 'https://example.invalid/draft' }; return release; },
    get: async () => release,
    upload: async (id, asset) => {
      if (asset.name === failName) throw new Error('fixture upload failed');
      uploads++;
      const remote = { name: asset.name, size: asset.size, digest: `sha256:${asset.sha256}`, state: 'uploaded' };
      release.assets.push(remote); return remote;
    },
    removeEmpty: async () => { if (release.assets.length) throw new Error('not empty'); removes++; release = undefined; },
  };
}
const assets = ['app.dmg', 'SHA256SUMS', 'build-info.json'].map(name => ({ name, data: Buffer.from(name), size: name.length, sha256: digest(name) }));
test('draft-only creation is idempotent, rejects published releases and conflicts without overwriting', async () => {
  const api = fakeAPI();
  await ensureDraft(info, assets, api);
  expect(api.release.draft).toBe(true); expect(api.release.make_latest).toBe('false');
  await ensureDraft(info, assets, api); expect(api.creates).toBe(1); expect(api.uploads).toBe(3);
  api.release.assets[0].digest = 'sha256:wrong';
  await expect(ensureDraft(info, assets, api)).rejects.toThrow(/conflict/);
  expect(api.uploads).toBe(3); expect(api.removes).toBe(0);
  api.release.draft = false;
  await expect(ensureDraft(info, assets, api)).rejects.toThrow(/public/);
});
test('initial failed upload cleans only its new empty draft; partial retries append only missing assets', async () => {
  const api = fakeAPI(); api.fail(assets[0].name);
  await expect(ensureDraft(info, assets, api)).rejects.toThrow(/failed/); expect(api.removes).toBe(1);
  api.fail(assets[1].name);
  await expect(ensureDraft(info, assets, api)).rejects.toThrow(/failed/);
  expect(api.release.assets).toHaveLength(1); expect(api.removes).toBe(1);
  api.fail(undefined); await ensureDraft(info, assets, api);
  expect(api.release.assets).toHaveLength(3); expect(api.uploads).toBe(3);
});
test('manual packaging stays read-only; only isolated draft job gets write; actions pin SHAs', () => {
  const load = path => parse(readFileSync(path, 'utf8'));
  const release = load('.github/workflows/release-draft.yml');
  const build = load('.github/workflows/package-macos-arm64.yml');
  expect(release.on.push.tags).toEqual(['v*']);
  expect(release.permissions.contents).toBe('read');
  expect(release.jobs.draft.permissions.contents).toBe('write');
  expect(release.jobs.draft.needs).toBe('build'); expect(release.jobs.build.needs).toBe('validate');
  expect(build.on).toHaveProperty('workflow_dispatch'); expect(build.on).toHaveProperty('workflow_call');
  expect(build.permissions.contents).toBe('read');
  for (const workflow of [release, build]) for (const job of Object.values(workflow.jobs)) for (const step of job.steps ?? []) {
    if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
  }
  expect(release.jobs.draft.steps.some(s => /pnpm|npm install/.test(s.run ?? ''))).toBe(false);
  expect(build.jobs.package.steps.findIndex(s => s.run === 'node scripts/release-bundle.mjs')).toBeGreaterThan(build.jobs.package.steps.findIndex(s => s.run?.includes('verify-package.mjs')));
});

test('HTTP client sends only draft creation/binary assets, does not follow credential redirects or leak API response errors', async () => {
  const calls = [];
  const fetchMock = vi.fn(async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ id: 1, draft: true }), { status: 201 });
  });
  vi.stubGlobal('fetch', fetchMock);
  try {
    const api = githubAPI('eiinu/wisp', 'fixture-token');
    await api.create({ tag_name: info.tag, draft: true });
    await api.upload(1, assets[0]);
    expect(JSON.parse(calls[0].options.body).draft).toBe(true);
    expect(calls[1].url).toBe('https://uploads.github.com/repos/eiinu/wisp/releases/1/assets?name=app.dmg');
    expect(calls.every(c => c.options.redirect === 'error')).toBe(true);
    expect(calls[1].options.body).toEqual(assets[0].data);
    fetchMock.mockResolvedValue(new Response('sensitive server details', { status: 403 }));
    await expect(api.get(1)).rejects.toThrow('GitHub GET failed: HTTP 403');
    expect(() => githubAPI('evil/../../host', 'token')).toThrow();
  } finally { vi.unstubAllGlobals(); }
});
test('empty assets fail before creating a draft, edited or ambiguous attachments are never overwritten', async () => {
  const api = fakeAPI();
  await expect(ensureDraft(info, [], api)).rejects.toThrow(/Empty/); expect(api.creates).toBe(0);
  await ensureDraft(info, assets, api);
  api.release.assets[0].state = 'starter';
  await expect(ensureDraft(info, assets, api)).rejects.toThrow(/conflict/);
  api.release.body += 'edited';
  await expect(ensureDraft(info, assets, api)).rejects.toThrow(/identity/);
  expect(api.uploads).toBe(3); expect(api.removes).toBe(0);
});

test('remote source validation peels annotated tags and fails on deleted/moved tags or diverged main before writes', async () => {
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  const response = value => new Response(JSON.stringify(value), { status: 200 });
  try {
    const api = githubAPI('eiinu/wisp', 'fixture-token');
    fetchMock.mockResolvedValueOnce(response({ object: { type: 'tag', sha: 'b'.repeat(40) } }))
      .mockResolvedValueOnce(response({ object: { type: 'commit', sha: info.commit } }))
      .mockResolvedValueOnce(response({ status: 'ahead' }));
    await api.assertSource(info);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fetchMock.mockResolvedValueOnce(response({ object: { type: 'commit', sha: 'c'.repeat(40) } }));
    await expect(api.assertSource(info)).rejects.toThrow(/changed/);
    fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }));
    await expect(api.assertSource(info)).rejects.toThrow(/404/);
    fetchMock.mockResolvedValueOnce(response({ object: { type: 'commit', sha: info.commit } }))
      .mockResolvedValueOnce(response({ status: 'diverged' }));
    await expect(api.assertSource(info)).rejects.toThrow(/remote main/);
    const fake = fakeAPI(); fake.assertSource = async () => { throw new Error('tag deleted'); };
    await expect(ensureDraft(info, assets, fake)).rejects.toThrow(/tag deleted/);
    expect(fake.creates).toBe(0);
  } finally { vi.unstubAllGlobals(); }
});
