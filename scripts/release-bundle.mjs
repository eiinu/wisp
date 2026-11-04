import { readFileSync, writeFileSync, mkdirSync, copyFileSync, lstatSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkRelease } from './release-check.mjs';
import { packageIdentity } from './package-identity.mjs';

export const digest = data => createHash('sha256').update(data).digest('hex');
export function bundleNames(version) {
  return [`Wisp-${version}-macos-arm64.dmg`, 'SHA256SUMS', 'build-info.json'];
}
export function prepareBundle(info, source, appPackage, directory = 'release/draft') {
  if (JSON.parse(readFileSync(appPackage, 'utf8')).version !== info.version) throw new Error('Packaged app version mismatch');
  if (!lstatSync(source).isFile() || !lstatSync(source).size) throw new Error('Missing DMG');
  mkdirSync(directory, { recursive: true });
  if (readdirSync(directory).length) throw new Error('Bundle directory must be empty');
  const [name] = bundleNames(info.version);
  copyFileSync(source, join(directory, name));
  const sha256 = digest(readFileSync(source));
  writeFileSync(join(directory, 'build-info.json'), `${JSON.stringify({ version: info.version, tag: info.tag, commit: info.commit, architecture: 'arm64', signing: 'ad-hoc; no Developer ID; not notarized', dmg: name, sha256 }, null, 2)}\n`);
  const manifestHash = digest(readFileSync(join(directory, 'build-info.json')));
  writeFileSync(join(directory, 'SHA256SUMS'), `${sha256}  ${name}\n${manifestHash}  build-info.json\n`);
  return verifyBundle(info, directory);
}
export function verifyBundle(info, directory) {
  const names = bundleNames(info.version);
  if (JSON.stringify(readdirSync(directory).sort()) !== JSON.stringify([...names].sort())) throw new Error('Unexpected bundle files');
  const assets = names.map(name => {
    const path = join(directory, name);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size <= 0 || stat.size > 2_000_000_000) throw new Error('Invalid bundle file');
    const data = readFileSync(path);
    return { name, path, data, size: stat.size, sha256: digest(data) };
  });
  const manifest = JSON.parse(assets[2].data.toString('utf8'));
  if (manifest.version !== info.version || manifest.tag !== info.tag || manifest.commit !== info.commit || manifest.architecture !== 'arm64' || manifest.dmg !== names[0] || manifest.sha256 !== assets[0].sha256 || manifest.signing !== 'ad-hoc; no Developer ID; not notarized') throw new Error('Bundle identity mismatch');
  if (assets[1].data.toString('utf8') !== `${assets[0].sha256}  ${names[0]}\n${assets[2].sha256}  build-info.json\n`) throw new Error('Checksum mismatch');
  return assets;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const info = checkRelease(process.env.RELEASE_TAG);
  prepareBundle(info, packageIdentity().dmgPath, 'release/mac-arm64/Wisp.app/Contents/Resources/app/package.json');
  console.log(`Prepared validated draft bundle for ${info.tag} at ${info.commit}`);
}
