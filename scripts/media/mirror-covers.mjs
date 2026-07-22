import OSS from 'ali-oss';
import { readFile } from 'node:fs/promises';

const plan = JSON.parse(await readFile(
  new URL('../../ops/cover-sources.json', import.meta.url),
  'utf8'
));
const apply = process.argv.includes('--apply');
const allowedSources = new Set([
  'https://is1-ssl.mzstatic.com',
  'https://yuko-portfolio.oss-cn-hangzhou.aliyuncs.com'
]);

if (plan.version !== '2026-07' || !Array.isArray(plan.items) || plan.items.length !== 23) {
  throw new Error('Cover migration plan must contain 23 items for version 2026-07');
}

const targetPrefix = `covers/releases/v${plan.version}/`;
for (const item of plan.items) {
  if (!allowedSources.has(new URL(item.sourceUrl).origin)) {
    throw new Error(`Unapproved source: ${item.sourceUrl}`);
  }
  if (!item.targetKey.startsWith(targetPrefix) || item.targetKey.includes('..')) {
    throw new Error(`Unapproved target: ${item.targetKey}`);
  }
}

if (!apply) {
  console.log(JSON.stringify({
    mode: 'dry-run',
    count: plan.items.length,
    targets: plan.items.map(({ targetKey }) => targetKey)
  }, null, 2));
  process.exit(0);
}

const required = [
  'OSS_REGION',
  'OSS_ACCESS_KEY_ID',
  'OSS_ACCESS_KEY_SECRET',
  'OSS_COVER_BUCKET'
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
}

const client = new OSS({
  region: process.env.OSS_REGION,
  accessKeyId: process.env.OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  bucket: process.env.OSS_COVER_BUCKET
});

for (const item of plan.items) {
  const response = await fetch(item.sourceUrl);
  if (!response.ok) {
    throw new Error(`Download failed ${response.status}: ${item.releaseTitle}`);
  }
  const body = Buffer.from(await response.arrayBuffer());
  await client.put(item.targetKey, body, {
    headers: {
      'Content-Type': response.headers.get('content-type') || 'image/jpeg',
      'Content-Disposition': 'inline',
      'Cache-Control': 'public, max-age=31536000, immutable'
    }
  });
  console.log(`uploaded ${item.targetKey}`);
}
