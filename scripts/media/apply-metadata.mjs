import OSS from 'ali-oss';

import { CRITICAL_IMAGE_MANIFEST } from '../../src/config/assets.js';
import { lyricsPool } from '../../src/data.js';

const apply = process.argv.includes('--apply');
const uniqueAudio = [...new Set(lyricsPool.map(({ musicOssUrl }) => musicOssUrl))];
const objects = [
  ...CRITICAL_IMAGE_MANIFEST.map(({ source }) => ({
    bucketEnv: 'OSS_LOADING_BUCKET',
    key: decodeURIComponent(new URL(source).pathname.slice(1)),
    type: 'image/jpeg',
    cache: 'public, max-age=86400'
  })),
  ...uniqueAudio.map((url) => ({
    bucketEnv: 'OSS_AUDIO_BUCKET',
    key: decodeURIComponent(new URL(url).pathname.slice(1)),
    type: 'audio/mpeg',
    cache: 'public, max-age=86400'
  }))
];

if (!apply) {
  console.log(JSON.stringify({ mode: 'dry-run', count: objects.length }, null, 2));
  process.exit(0);
}

for (const name of [
  'OSS_REGION',
  'OSS_ACCESS_KEY_ID',
  'OSS_ACCESS_KEY_SECRET',
  'OSS_LOADING_BUCKET',
  'OSS_AUDIO_BUCKET'
]) {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
}

const clients = new Map();
const getClient = (bucket) => {
  if (!clients.has(bucket)) {
    clients.set(bucket, new OSS({
      region: process.env.OSS_REGION,
      accessKeyId: process.env.OSS_ACCESS_KEY_ID,
      accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
      bucket
    }));
  }
  return clients.get(bucket);
};

for (const object of objects) {
  const bucket = process.env[object.bucketEnv];
  const client = getClient(bucket);
  await client.copy(object.key, `/${bucket}/${object.key}`, {
    headers: {
      'x-oss-metadata-directive': 'REPLACE',
      'Content-Type': object.type,
      'Content-Disposition': 'inline',
      'Cache-Control': object.cache
    }
  });
  console.log(`updated ${bucket}/${object.key}`);
}
