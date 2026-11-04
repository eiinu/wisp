import { pathToFileURL } from 'node:url';
import { checkRelease } from './release-check.mjs';
import { verifyBundle } from './release-bundle.mjs';

// No update/publish endpoint: this writer can only create drafts and append missing assets.
export async function ensureDraft(info, assets, api) {
  if (!assets.length || assets.some(a => !a.size || !/^[a-f0-9]{64}$/.test(a.sha256))) throw new Error('Empty or invalid release assets');
  const body = `${info.notes}\n> macOS arm64：ad-hoc 签名，无 Developer ID，未公证。此为待验证草稿。\n\nCommit: \`${info.commit}\`\n\n${assets.map(a => `- ${a.name}: \`${a.sha256}\``).join('\n')}\n`;
  await api.assertSource(info);
  let release = await api.find(info.tag);
  let created = false;
  const validate = r => {
    if (!r.draft || r.tag_name !== info.tag || r.body !== body || r.target_commitish !== info.commit) throw new Error('Existing release is public or has a different identity/body; refusing to modify');
  };
  const sameAsset = (remote, local) => remote.state === 'uploaded' && remote.size === local.size && remote.digest === `sha256:${local.sha256}`;
  if (release) validate(release);
  else {
    await api.assertSource(info);
    release = await api.create({ tag_name: info.tag, target_commitish: info.commit, name: `Wisp ${info.tag}`, body, draft: true, prerelease: false, make_latest: 'false' });
    created = true;
    validate(release);
  }
  try {
    for (const asset of assets) {
      // Re-read for retries and manual edits; never overwrite or delete existing attachments.
      await api.assertSource(info);
      release = await api.get(release.id);
      validate(release);
      const existing = release.assets.filter(item => item.name === asset.name);
      if (existing.length) {
        if (existing.length !== 1 || !sameAsset(existing[0], asset)) throw new Error(`Asset conflict: ${asset.name}; refusing overwrite`);
      } else {
        const uploaded = await api.upload(release.id, asset);
        if (!sameAsset(uploaded, asset)) throw new Error(`Upload verification failed: ${asset.name}`);
      }
    }
    release = await api.get(release.id);
    validate(release);
    if (!assets.every(a => release.assets.some(r => r.name === a.name && sameAsset(r, a)))) throw new Error('Incomplete draft');
    return release.html_url;
  } catch (error) {
    if (created) {
      // REST cannot create a release and assets atomically. Remove only our still-empty draft.
      try {
        const current = await api.get(release.id);
        validate(current);
        if (current.assets.length === 0) await api.removeEmpty(current.id);
      } catch { console.error('Could not confirm/clean the new empty draft; inspect GitHub before retrying.'); }
    }
    throw error;
  }
}
export function githubAPI(repository, token) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !token) throw new Error('Missing repository/token');
  const base = `https://api.github.com/repos/${repository}`;
  async function request(url, method = 'GET', data, binary = false) {
    const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(binary ? 600_000 : 60_000), headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', ...(data ? { 'Content-Type': binary ? 'application/octet-stream' : 'application/json' } : {}) }, body: data ? (binary ? data : JSON.stringify(data)) : undefined });
    if (!response.ok) throw new Error(`GitHub ${method} failed: HTTP ${response.status}`);
    return response.status === 204 ? undefined : response.json();
  }
  return {
    async assertSource(info) {
      // Checkout may reconstruct a deleted trigger tag locally; query GitHub, not just local refs.
      let ref = (await request(`${base}/git/ref/tags/${encodeURIComponent(info.tag)}`)).object;
      for (let depth = 0; ref?.type === 'tag' && depth < 8; depth++) {
        if (!/^[a-f0-9]{40}$/.test(ref.sha)) throw new Error('Invalid remote tag');
        ref = (await request(`${base}/git/tags/${ref.sha}`)).object;
      }
      if (ref?.type !== 'commit' || ref.sha !== info.commit) throw new Error('Remote tag missing or changed');
      const comparison = await request(`${base}/compare/${info.commit}...main`);
      if (!['ahead', 'identical'].includes(comparison.status)) throw new Error('Release commit is not on remote main');
    },
    async find(tag) {
      for (let page = 1; page <= 100; page++) {
        const releases = await request(`${base}/releases?per_page=100&page=${page}`);
        const found = releases.filter(r => r.tag_name === tag);
        if (found.length > 1) throw new Error('Multiple releases for tag');
        if (found.length) return found[0];
        if (releases.length < 100) return undefined;
      }
      throw new Error('Release listing limit reached');
    },
    create: data => request(`${base}/releases`, 'POST', data),
    get: id => request(`${base}/releases/${id}`),
    upload: (id, asset) => request(`https://uploads.github.com/repos/${repository}/releases/${id}/assets?name=${encodeURIComponent(asset.name)}`, 'POST', asset.data, true),
    removeEmpty: id => request(`${base}/releases/${id}`, 'DELETE'),
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const info = checkRelease(process.env.RELEASE_TAG);
  const assets = verifyBundle(info, process.env.RELEASE_BUNDLE ?? 'release/draft');
  console.log(await ensureDraft(info, assets, githubAPI(process.env.GITHUB_REPOSITORY, process.env.GH_TOKEN)));
}
