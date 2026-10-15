import assert from 'node:assert/strict';
import test from 'node:test';
import { validateMetadata, validatePublishedMetadata, validateRemoteTag } from '../scripts/verify-npm-release.mjs';
import { validatePackSummary } from '../scripts/verify-npm-package.mjs';

const version = '0.1.0-beta.3';
const manifest = {
  name: 'wireconform',
  version,
  repository: { url: 'git+https://github.com/eeerdsahum/wireconform.git' },
  publishConfig: { tag: 'beta' },
  engines: { node: '>=22.18.0' },
};
const lock = {
  name: 'wireconform',
  version,
  packages: { '': { name: 'wireconform', version } },
};
const versionSource = `export const wireconformVersion = '${version}';`;
const paths = ['CHANGELOG.md', 'CONTRIBUTING.md', 'LICENSE', 'README.md', 'SECURITY.md', 'dist/cli.js', 'dist/index.js', 'docs/conformance.md', 'docs/demo.md', 'examples/hey-api-positive.yaml', 'examples/files/tiny.bin', 'spec/openapi.yaml'];

test('release metadata matches an annotated beta tag and npm beta dist-tag', () => {
  assert.equal(validateMetadata({ tag: `v${version}`, manifest, lock, versionSource }), version);
});

test('release metadata accepts the verified beta.2 source without a publishConfig tag', () => {
  const beta2Manifest = { ...manifest, version: '0.1.0-beta.2', publishConfig: undefined };
  const beta2Lock = { ...lock, version: '0.1.0-beta.2', packages: { '': { name: 'wireconform', version: '0.1.0-beta.2' } } };
  const beta2VersionSource = "export const wireconformVersion = '0.1.0-beta.2';";
  assert.equal(validateMetadata({ tag: 'v0.1.0-beta.2', manifest: beta2Manifest, lock: beta2Lock, versionSource: beta2VersionSource }), '0.1.0-beta.2');
});

test('release metadata rejects mismatched versions, repository URLs, and non-beta tags', () => {
  assert.throws(() => validateMetadata({ tag: 'v0.1.0-beta.2', manifest, lock, versionSource }));
  assert.throws(() => validateMetadata({ tag: `v${version}`, manifest: { ...manifest, repository: { url: 'https://example.com/fork.git' } }, lock, versionSource }));
  assert.throws(() => validateMetadata({ tag: `v${version}`, manifest: { ...manifest, publishConfig: { tag: 'latest' } }, lock, versionSource }));
  assert.throws(() => validateMetadata({ tag: 'v0.1.0', manifest, lock, versionSource }));
});

test('packed package contains the CLI and public docs while excluding private build material', () => {
  const packageInfo = { name: 'wireconform', version, filename: `wireconform-${version}.tgz`, files: paths.map((filePath) => ({ path: filePath })), unpackedSize: 1_000 };
  assert.equal(validatePackSummary([packageInfo], { name: 'wireconform', version }), packageInfo);
  assert.throws(() => validatePackSummary([{ ...packageInfo, files: [...packageInfo.files, { path: '.npmrc' }] }], { name: 'wireconform', version }));
  assert.throws(() => validatePackSummary([{ ...packageInfo, files: [...packageInfo.files, { path: 'dist/../../.env' }] }], { name: 'wireconform', version }));
});

test('published release verification requires the beta tag and matching repository metadata', () => {
  const metadata = {
    name: 'wireconform',
    'dist-tags': { latest: '0.0.1', beta: version },
    versions: { [version]: { version, repository: { url: 'git+https://github.com/eeerdsahum/wireconform.git' } } },
  };
  assert.doesNotThrow(() => validatePublishedMetadata(metadata, version, '0.0.1'));
  assert.throws(() => validatePublishedMetadata({ ...metadata, 'dist-tags': { latest: version, beta: version } }, version, '0.0.1'));
  assert.throws(() => validatePublishedMetadata({ ...metadata, versions: { [version]: { version, repository: { url: 'https://example.com/fork.git' } } } }, version, '0.0.1'));
  assert.doesNotThrow(() => validatePublishedMetadata({ ...metadata, 'dist-tags': { beta: version } }, version, null));
  assert.throws(() => validatePublishedMetadata({ ...metadata, 'dist-tags': { latest: version, beta: version } }, version, null));
});

test('release verification rejects a moved or unannotated remote tag', () => {
  const tag = 'v0.1.0-beta.3';
  const object = 'a'.repeat(40);
  assert.doesNotThrow(() => validateRemoteTag(tag, object, `${object}\trefs/tags/${tag}`));
  assert.throws(() => validateRemoteTag(tag, object, `${'b'.repeat(40)}\trefs/tags/${tag}`));
  assert.throws(() => validateRemoteTag(tag, object, `${object}\trefs/tags/${tag}^{} `));
});
