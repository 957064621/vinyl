import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { releases } from '../../src/data.js';

export const COVER_PLAN_VERSION = '2026-07';
export const COVER_RUNTIME_ORIGIN = 'https://yuko-vinyl.oss-cn-hangzhou.aliyuncs.com/';

const APPLE_ORIGIN = 'https://is1-ssl.mzstatic.com';
const LEGACY_COVER_ORIGIN = 'https://yuko-portfolio.oss-cn-hangzhou.aliyuncs.com';
const planUrl = new URL('../../ops/cover-sources.json', import.meta.url);
const mapUrl = new URL('../../src/data/cover-map.js', import.meta.url);

const requireUnique = (items, field) => {
  const values = items.map((item) => item[field]);
  if (new Set(values).size !== values.length) {
    throw new Error(`Cover migration plan requires a unique ${field} for every item`);
  }
};

export function validateCoverPlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new TypeError('Cover migration plan must be an object');
  }
  if (plan.version !== COVER_PLAN_VERSION) {
    throw new Error(`Cover migration plan must use version ${COVER_PLAN_VERSION}`);
  }
  if (!Array.isArray(plan.items) || plan.items.length !== 23) {
    throw new Error('Cover migration plan must contain exactly 23 items');
  }

  const normalizedSources = [];
  plan.items.forEach((item, index) => {
    const ordinal = String(index + 1).padStart(3, '0');
    const expectedTarget = `covers/releases/v${COVER_PLAN_VERSION}/${ordinal}.jpg`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new TypeError(`Cover item ${ordinal} must be an object`);
    }
    if (typeof item.releaseTitle !== 'string' || item.releaseTitle.trim() !== item.releaseTitle || !item.releaseTitle) {
      throw new Error(`Cover item ${ordinal} requires a non-empty releaseTitle`);
    }
    if (item.targetKey !== expectedTarget) {
      throw new Error(`Cover item ${ordinal} must use ordinal target ${expectedTarget}`);
    }

    let source;
    try {
      source = new URL(item.sourceUrl);
    } catch {
      throw new Error(`Cover item ${ordinal} has an invalid sourceUrl`);
    }
    const expectedOrigin = index < 22 ? APPLE_ORIGIN : LEGACY_COVER_ORIGIN;
    if (source.protocol !== 'https:' || source.origin !== expectedOrigin) {
      throw new Error(`Cover item ${ordinal} has an unapproved source origin`);
    }
    if (source.username || source.password || source.hash) {
      throw new Error(`Cover item ${ordinal} sourceUrl contains unsupported URL components`);
    }
    if (index === 22 && source.pathname !== '/cover/1.jpg') {
      throw new Error('Cover item 023 must use the existing OSS cover/1.jpg source');
    }
    normalizedSources.push(source.href);
  });

  requireUnique(plan.items, 'releaseTitle');
  requireUnique(plan.items, 'targetKey');
  if (new Set(normalizedSources).size !== normalizedSources.length) {
    throw new Error('Cover migration plan requires a unique sourceUrl for every item');
  }
  return plan;
}

export function captureCoverPlan(releasesInput) {
  const sourceReleases = releasesInput.filter(({ sourceArtworkUrl }) => {
    if (!sourceArtworkUrl) return false;
    try {
      return new URL(sourceArtworkUrl).origin === APPLE_ORIGIN;
    } catch {
      return false;
    }
  });
  if (sourceReleases.length !== 22) {
    throw new Error(`Expected 22 existing external covers, found ${sourceReleases.length}`);
  }
  const liveRelease = releasesInput.find(({ title }) => title === '万兽之王演唱会录音');
  if (!liveRelease?.coverOssUrl) throw new Error('Expected the existing live release OSS cover');

  return validateCoverPlan({
    version: COVER_PLAN_VERSION,
    items: [
      ...sourceReleases.map((release, index) => ({
        releaseTitle: release.title,
        sourceUrl: release.sourceArtworkUrl,
        targetKey: `covers/releases/v${COVER_PLAN_VERSION}/${String(index + 1).padStart(3, '0')}.jpg`
      })),
      {
        releaseTitle: liveRelease.title,
        sourceUrl: liveRelease.coverOssUrl,
        targetKey: `covers/releases/v${COVER_PLAN_VERSION}/023.jpg`
      }
    ]
  });
}

export function renderCoverMap(plan) {
  const coverMap = Object.fromEntries(plan.items.map(({ releaseTitle, targetKey }) => [
    releaseTitle,
    new URL(targetKey, COVER_RUNTIME_ORIGIN).href
  ]));
  return `export const releaseCoverOssByTitle = Object.freeze(${JSON.stringify(coverMap, null, 2)});\n`;
}

export async function main({
  argv = process.argv.slice(2),
  releasesInput = releases,
  readFileImpl = readFile,
  writeFileImpl = writeFile,
  mkdirImpl = mkdir,
  planLocation = planUrl,
  mapLocation = mapUrl
} = {}) {
  if (argv.length > 0) throw new Error(`Unknown arguments: ${argv.join(' ')}`);

  let plan;
  let planCreated = false;
  try {
    plan = validateCoverPlan(JSON.parse(await readFileImpl(planLocation, 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    plan = captureCoverPlan(releasesInput);
    planCreated = true;
    await mkdirImpl(new URL('./', planLocation), { recursive: true });
    await writeFileImpl(planLocation, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  }

  await writeFileImpl(mapLocation, renderCoverMap(plan), 'utf8');
  return { mode: 'generated', count: plan.items.length, mapCount: 23, planCreated };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await main();
  console.log(`generated ${result.count} mirror entries and ${result.mapCount} runtime covers`);
}
