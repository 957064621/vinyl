import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { releases } from '../../src/data.js';

const planUrl = new URL('../../ops/cover-sources.json', import.meta.url);
const mapUrl = new URL('../../src/data/cover-map.js', import.meta.url);
const version = '2026-07';
const runtimeOrigin = 'https://yuko-vinyl.oss-cn-hangzhou.aliyuncs.com/';

const sourceReleases = releases.filter(({ sourceArtworkUrl }) => (
  sourceArtworkUrl && new URL(sourceArtworkUrl).origin === 'https://is1-ssl.mzstatic.com'
));
if (sourceReleases.length !== 22) {
  throw new Error(`Expected 22 existing external covers, found ${sourceReleases.length}`);
}

const liveRelease = releases.find(({ title }) => title === '万兽之王演唱会录音');
if (!liveRelease?.coverOssUrl) {
  throw new Error('Expected the existing live release OSS cover');
}

const expectedPlan = {
  version,
  items: [
    ...sourceReleases.map((release, index) => ({
      releaseTitle: release.title,
      sourceUrl: release.sourceArtworkUrl,
      targetKey: `covers/releases/v${version}/${String(index + 1).padStart(3, '0')}.jpg`
    })),
    {
      releaseTitle: liveRelease.title,
      sourceUrl: liveRelease.coverOssUrl,
      targetKey: `covers/releases/v${version}/023.jpg`
    }
  ]
};

await mkdir(new URL('../../ops/', import.meta.url), { recursive: true });

let plan;
try {
  plan = JSON.parse(await readFile(planUrl, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  plan = expectedPlan;
  await writeFile(planUrl, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
}

if (plan.version !== version) {
  throw new Error(`Cover migration plan must use version ${version}`);
}
if (!Array.isArray(plan.items) || plan.items.length !== 23) {
  throw new Error('Cover migration plan must contain 23 items');
}
if (JSON.stringify(plan) !== JSON.stringify(expectedPlan)) {
  throw new Error('Cover migration plan does not match the current release sources and order');
}

const coverMap = Object.fromEntries(plan.items.map(({ releaseTitle, targetKey }) => [
  releaseTitle,
  new URL(targetKey, runtimeOrigin).href
]));
if (Object.keys(coverMap).length !== 23) {
  throw new Error('Cover migration plan must contain 23 unique release titles');
}

await writeFile(
  mapUrl,
  `export const releaseCoverOssByTitle = Object.freeze(${JSON.stringify(coverMap, null, 2)});\n`,
  'utf8'
);
console.log(`generated ${plan.items.length} mirror entries and ${Object.keys(coverMap).length} runtime covers`);
