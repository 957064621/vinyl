import { pathToFileURL } from 'node:url';

import { CRITICAL_IMAGE_MANIFEST } from '../../src/config/assets.js';
import { lyricsPool } from '../../src/data.js';
import { normalizeOssRegion } from './mirror-covers.mjs';

const ROLE_CONFIG = Object.freeze({
  loading: Object.freeze({
    origin: 'https://yuko-portfolio.oss-cn-hangzhou.aliyuncs.com',
    bucketEnv: 'OSS_LOADING_BUCKET',
    expectedBucket: 'yuko-portfolio',
    type: 'image/jpeg'
  }),
  audio: Object.freeze({
    origin: 'https://yuko-vinyl.oss-cn-hangzhou.aliyuncs.com',
    bucketEnv: 'OSS_AUDIO_BUCKET',
    expectedBucket: 'yuko-vinyl',
    type: 'audio/mpeg'
  })
});
const CACHE_CONTROL = 'public, max-age=86400';
const PRESERVED_SYSTEM_HEADERS = [
  'content-encoding',
  'content-language',
  'expires',
  'x-oss-storage-class',
  'x-oss-server-side-encryption',
  'x-oss-server-side-encryption-key-id',
  'x-oss-website-redirect-location'
];

const parseApplyArg = (argv) => {
  if (!Array.isArray(argv)) throw new TypeError('Arguments must be an array');
  if (argv.length === 0) return false;
  if (argv.length === 1 && argv[0] === '--apply') return true;
  throw new Error(`Unsupported or conflicting arguments: ${argv.join(' ')}`);
};

const objectKeyFromUrl = (url, role) => {
  const config = ROLE_CONFIG[role];
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${role} media URL is invalid`);
  }
  if (parsed.protocol !== 'https:' || parsed.origin !== config.origin) {
    throw new Error(`${role} media origin must be ${config.origin}`);
  }
  const key = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  if (!key || key.split('/').some((part) => part === '..' || part === '.')) {
    throw new Error(`${role} media key is invalid`);
  }
  return key;
};

export function buildMetadataObjects({
  criticalManifest = CRITICAL_IMAGE_MANIFEST,
  tracks = lyricsPool
} = {}) {
  const audioByUrl = new Map();
  for (const track of tracks) {
    if (!audioByUrl.has(track.musicOssUrl)) audioByUrl.set(track.musicOssUrl, track);
  }
  const objects = [
    ...criticalManifest.map(({ id, source }) => ({
      id: `loading:${id}`,
      bucketRole: 'loading',
      sourceUrl: source
    })),
    ...[...audioByUrl].map(([sourceUrl]) => ({
      id: `audio:${sourceUrl}`,
      bucketRole: 'audio',
      sourceUrl
    }))
  ].map((object) => {
    const config = ROLE_CONFIG[object.bucketRole];
    return Object.freeze({
      ...object,
      bucketEnv: config.bucketEnv,
      expectedBucket: config.expectedBucket,
      key: objectKeyFromUrl(object.sourceUrl, object.bucketRole),
      headers: Object.freeze({
        'Content-Type': config.type,
        'Content-Disposition': 'inline',
        'Cache-Control': CACHE_CONTROL
      })
    });
  });

  return validateMetadataObjects(objects);
}

export function validateMetadataObjects(objects) {
  if (!Array.isArray(objects)) throw new TypeError('Metadata objects must be an array');
  for (const object of objects) {
    const config = ROLE_CONFIG[object?.bucketRole];
    if (!config) throw new Error(`Unknown metadata bucket role: ${object?.bucketRole}`);
    if (object.bucketEnv !== config.bucketEnv || object.expectedBucket !== config.expectedBucket) {
      throw new Error(`${object.bucketRole} metadata object has an invalid bucket mapping`);
    }
    const expectedKey = objectKeyFromUrl(object.sourceUrl, object.bucketRole);
    if (object.key !== expectedKey) throw new Error(`${object.bucketRole} metadata object key does not match its URL`);
    const expectedHeaders = {
      'Content-Type': config.type,
      'Content-Disposition': 'inline',
      'Cache-Control': CACHE_CONTROL
    };
    if (!object.headers
      || Object.keys(object.headers).length !== Object.keys(expectedHeaders).length
      || Object.entries(expectedHeaders).some(([name, value]) => object.headers[name] !== value)) {
      throw new Error(`${object.bucketRole} metadata object has invalid intended headers`);
    }
    if (typeof object.id !== 'string' || !object.id) throw new Error('Metadata object requires an id');
  }
  const keys = objects.map(({ expectedBucket, key }) => `${expectedBucket}/${key}`);
  if (new Set(keys).size !== keys.length) {
    throw new Error('Metadata objects require a unique bucket role and key');
  }
  if (new Set(objects.map(({ id }) => id)).size !== objects.length) {
    throw new Error('Metadata objects require a unique id');
  }
  return objects;
}

const normalizeHeaders = (value) => {
  const entries = value instanceof Headers ? value.entries() : Object.entries(value || {});
  return Object.fromEntries([...entries].map(([key, headerValue]) => [key.toLowerCase(), String(headerValue)]));
};

const extractUserMetadata = (head, headers) => {
  if (head.meta) return { ...head.meta };
  return Object.fromEntries(Object.entries(headers)
    .filter(([key]) => key.startsWith('x-oss-meta-'))
    .map(([key, value]) => [key.slice('x-oss-meta-'.length), value]));
};

const defaultClientFactory = async (options) => {
  const { default: OSS } = await import('ali-oss');
  return new OSS(options);
};

const redact = (message, env) => {
  let value = String(message || 'Unknown metadata operation failure');
  for (const name of ['OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET']) {
    const secret = env[name];
    if (secret) value = value.split(secret).join('[REDACTED]');
  }
  return value;
};

const aggregateFailure = (failures, outcomes) => {
  const error = new AggregateError(
    failures.map(({ id, message }) => new Error(`${id}: ${message}`)),
    `Metadata update failed for ${failures.length} of ${outcomes.length} objects`
  );
  error.failures = failures;
  error.outcomes = outcomes;
  return error;
};

export async function main({
  argv = process.argv.slice(2),
  env = process.env,
  clientFactory = defaultClientFactory,
  objectsInput,
  criticalManifest = CRITICAL_IMAGE_MANIFEST,
  tracks = lyricsPool
} = {}) {
  const apply = parseApplyArg(argv);
  const objects = validateMetadataObjects(
    objectsInput || buildMetadataObjects({ criticalManifest, tracks })
  );
  const dryRun = {
    mode: 'dry-run',
    count: objects.length,
    objects: objects.map(({ id, bucketRole, expectedBucket, key, headers }) => ({
      id,
      bucketRole,
      expectedBucket,
      key,
      headers
    }))
  };
  if (!apply) return dryRun;

  for (const name of [
    'OSS_REGION',
    'OSS_ACCESS_KEY_ID',
    'OSS_ACCESS_KEY_SECRET',
    'OSS_LOADING_BUCKET',
    'OSS_AUDIO_BUCKET'
  ]) {
    if (!env[name]) throw new Error(`Missing ${name}`);
  }
  const region = normalizeOssRegion(env.OSS_REGION);
  for (const config of Object.values(ROLE_CONFIG)) {
    if (env[config.bucketEnv] !== config.expectedBucket) {
      throw new Error(`${config.bucketEnv} must name bucket ${config.expectedBucket}`);
    }
  }

  const clients = new Map();
  const getClient = async (bucket) => {
    if (!clients.has(bucket)) {
      clients.set(bucket, await clientFactory({
        region,
        accessKeyId: env.OSS_ACCESS_KEY_ID,
        accessKeySecret: env.OSS_ACCESS_KEY_SECRET,
        bucket
      }));
    }
    return clients.get(bucket);
  };

  const outcomes = [];
  const failures = [];
  for (const object of objects) {
    try {
      const client = await getClient(object.expectedBucket);
      const head = await client.head(object.key);
      const headers = normalizeHeaders(head.res?.headers || head.headers);
      const etag = headers.etag;
      if (!etag) throw new Error('HEAD response is missing ETag');
      const { acl } = await client.getACL(object.key);
      if (!acl) throw new Error('Object ACL response is missing ACL');
      const preserved = Object.fromEntries(PRESERVED_SYSTEM_HEADERS
        .filter((name) => headers[name] !== undefined)
        .map((name) => [name, headers[name]]));

      await client.copy(object.key, object.key, {
        meta: extractUserMetadata(head, headers),
        headers: {
          ...preserved,
          'If-Match': etag,
          'x-oss-object-acl': acl,
          'x-oss-metadata-directive': 'REPLACE',
          ...object.headers
        }
      });
      outcomes.push({ id: object.id, key: object.key, status: 'updated' });
    } catch (error) {
      const failure = {
        id: object.id,
        key: object.key,
        status: 'failed',
        message: redact(error.message, env)
      };
      failures.push(failure);
      outcomes.push(failure);
    }
  }
  if (failures.length > 0) throw aggregateFailure(failures, outcomes);
  return { mode: 'apply', count: outcomes.length, outcomes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await main(), null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      error: redact(error.message, process.env),
      failures: error.failures || [],
      outcomes: error.outcomes || []
    }, null, 2));
    process.exitCode = 1;
  }
}
