import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = 'eeerdsahum/wireconform';
const packageName = 'wireconform';
const sourceRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const run = (command, args, cwd = sourceRoot) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('Release source verification failed.');
  return result.stdout.trim();
};

const readPackageMetadata = async (root) => {
  const [manifestText, lockText, versionSource] = await Promise.all([
    readFile(path.join(root, 'package.json'), 'utf8'),
    readFile(path.join(root, 'package-lock.json'), 'utf8'),
    readFile(path.join(root, 'src', 'version.ts'), 'utf8'),
  ]);
  return {
    manifest: JSON.parse(manifestText),
    lock: JSON.parse(lockText),
    versionSource,
  };
};

const validateMetadata = ({ tag, manifest, lock, versionSource }) => {
  assert.match(tag, /^v0\.1\.0-beta\.\d+$/, 'Only an explicit 0.1.0 beta tag may use this workflow.');
  assert.equal(manifest.name, packageName);
  assert.equal(manifest.version, tag.slice(1));
  assert.equal(lock.name, packageName);
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages?.['']?.name, packageName);
  assert.equal(lock.packages?.['']?.version, manifest.version);
  assert.ok(versionSource.includes(`export const wireconformVersion = '${manifest.version}';`));
  assert.equal(manifest.repository?.url, 'git+https://github.com/eeerdsahum/wireconform.git');
  assert.ok(manifest.publishConfig?.tag === undefined || manifest.publishConfig.tag === 'beta');
  assert.equal(manifest.engines?.node, '>=22.18.0');
  return manifest.version;
};

const verifyRuntime = () => {
  const node = process.versions.node.split('.').map(Number);
  const npmVersion = run('npm', ['--version']);
  const npm = npmVersion.split('.').map(Number);
  assert.ok(node[0] > 22 || (node[0] === 22 && node[1] >= 14), 'Trusted publishing requires Node.js 22.14.0 or newer.');
  assert.ok(npm[0] > 11 || (npm[0] === 11 && (npm[1] > 5 || (npm[1] === 5 && npm[2] >= 1))), 'Trusted publishing requires npm 11.5.1 or newer.');
};

const verifyRegistryVersionUnused = async (version) => {
  const response = await fetch(`https://registry.npmjs.org/${packageName}`, { redirect: 'error' });
  if (response.status === 404) return null;
  assert.equal(response.status, 200, 'Could not verify whether this npm version is unused.');
  const metadata = await response.json();
  assert.equal(metadata.versions?.[version], undefined, 'This npm version already exists and must never be reused.');
  const latest = metadata['dist-tags']?.latest ?? null;
  if (latest !== null) assert.match(latest, /^[0-9A-Za-z][0-9A-Za-z._-]*$/, 'The current latest dist-tag could not be safely recorded.');
  return latest;
};

const validateRemoteTag = (tag, localObject, remoteRef) => {
  const [remoteObject, remoteName] = remoteRef.split('\t');
  assert.equal(remoteName, `refs/tags/${tag}`, 'The release tag is not available on origin.');
  assert.equal(remoteObject, localObject, 'The remote release tag changed during verification.');
};

const verifyRemoteTag = (tag) => {
  const localObject = run('git', ['rev-parse', `refs/tags/${tag}`]);
  const remoteRef = run('git', ['ls-remote', '--refs', 'origin', `refs/tags/${tag}`]);
  validateRemoteTag(tag, localObject, remoteRef);
};

const verifyMainHead = async () => {
  const token = process.env.WIRECONFORM_GITHUB_TOKEN;
  const expectedHead = process.env.WIRECONFORM_GITHUB_SHA;
  assert.ok(token && expectedHead, 'GitHub Actions release context is required.');
  const response = await fetch(`https://api.github.com/repos/${repository}/commits/main`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
    },
  });
  assert.equal(response.status, 200, 'Could not verify the current main branch.');
  const current = await response.json();
  assert.equal(current.sha, expectedHead, 'main advanced after this publishing workflow was dispatched.');
};

const verifyGitHubRelease = async (tag) => {
  const token = process.env.WIRECONFORM_GITHUB_TOKEN;
  const response = await fetch(`https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
    },
  });
  assert.equal(response.status, 200, 'The requested GitHub release could not be found.');
  const release = await response.json();
  assert.equal(release.tag_name, tag);
  assert.equal(release.draft, false);
  assert.equal(release.prerelease, true);
};

const validatePublishedMetadata = (metadata, version, latestBefore) => {
  assert.equal(metadata.name, packageName);
  assert.equal(metadata['dist-tags']?.beta, version);
  assert.equal(metadata.versions?.[version]?.version, version);
  assert.equal(metadata.versions?.[version]?.repository?.url, 'git+https://github.com/eeerdsahum/wireconform.git');
  assert.equal(metadata['dist-tags']?.latest ?? null, latestBefore, 'Publishing changed the npm latest dist-tag.');
};

const verifyPublishedMetadata = async (version) => {
  const latestBefore = process.env.WIRECONFORM_LATEST_BEFORE || null;
  let lastStatus = 0;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await fetch(`https://registry.npmjs.org/${packageName}`, { redirect: 'error' });
    lastStatus = response.status;
    if (response.status === 200) {
      const metadata = await response.json();
      if (metadata.versions?.[version]?.version === version && metadata['dist-tags']?.beta === version) {
        validatePublishedMetadata(metadata, version, latestBefore);
        process.stdout.write(`Verified npm ${packageName}@${version} on the beta dist-tag.\n`);
        return;
      }
      await delay(5_000);
      continue;
    }
    if (response.status !== 404) throw new Error('The npm package could not be verified after publishing. Do not repeat the publish without checking the registry.');
    await delay(5_000);
  }
  throw new Error(`The publish command completed, but npm metadata was still unavailable (HTTP ${lastStatus}). Verify the registry before taking further action.`);
};

const verifySourceCheckout = async (tag) => {
  const releaseRoot = process.env.WIRECONFORM_RELEASE_SOURCE;
  assert.ok(releaseRoot, 'The verified release source checkout is required.');
  const controlRoot = sourceRoot;
  const expectedCommit = run('git', ['rev-parse', `${tag}^{commit}`], controlRoot);
  const actualCommit = run('git', ['rev-parse', 'HEAD'], releaseRoot);
  assert.equal(actualCommit, expectedCommit, 'The release source checkout does not match the annotated tag.');
  assert.equal(run('git', ['status', '--porcelain'], releaseRoot), '', 'The release source checkout must be clean before installing dependencies.');
  const version = validateMetadata({ tag, ...(await readPackageMetadata(releaseRoot)) });
  process.stdout.write(`Verified source checkout ${tag} at ${actualCommit} for ${packageName}@${version}.\n`);
};

const main = async () => {
  const mode = process.argv[2] ?? 'preflight';
  const tag = process.env.WIRECONFORM_RELEASE_TAG ?? '';
  if (mode === 'source') {
    await verifySourceCheckout(tag);
    return;
  }
  if (mode === 'published') {
    const version = process.env.WIRECONFORM_RELEASE_VERSION ?? '';
    assert.match(version, /^0\.1\.0-beta\.\d+$/);
    await verifyPublishedMetadata(version);
    return;
  }

  verifyRuntime();
  assert.equal(process.env.WIRECONFORM_GITHUB_REF, 'refs/heads/main', 'Publishing can only be dispatched from main.');
  assert.match(tag, /^v0\.1\.0-beta\.\d+$/);
  assert.equal(run('git', ['cat-file', '-t', `refs/tags/${tag}`]), 'tag', 'The release tag must be annotated.');
  const tagCommit = run('git', ['rev-parse', `${tag}^{commit}`]);
  verifyRemoteTag(tag);
  run('git', ['merge-base', '--is-ancestor', tagCommit, 'HEAD']);
  const confirmation = process.env.WIRECONFORM_RELEASE_CONFIRMATION;
  const { manifest, lock, versionSource } = await readPackageMetadataFromTag(tag);
  const version = validateMetadata({ tag, manifest, lock, versionSource });
  assert.equal(confirmation, `PUBLISH ${packageName}@${version}`);
  await verifyMainHead();
  await verifyGitHubRelease(tag);
  const latestBefore = await verifyRegistryVersionUnused(version);
  process.stdout.write(`tag=${tag}\nversion=${version}\nsource_commit=${tagCommit}\nlatest_before=${latestBefore ?? ''}\n`);
};

const readPackageMetadataFromTag = async (tag) => {
  const manifest = JSON.parse(run('git', ['show', `${tag}:package.json`]));
  const lock = JSON.parse(run('git', ['show', `${tag}:package-lock.json`]));
  const versionSource = run('git', ['show', `${tag}:src/version.ts`]);
  return { manifest, lock, versionSource };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Release source verification failed.'}\n`);
    process.exitCode = 1;
  }
}

export { validateMetadata, validatePublishedMetadata, validateRemoteTag, verifyRegistryVersionUnused };
