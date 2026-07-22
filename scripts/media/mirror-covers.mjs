import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { validateCoverPlan } from './build-cover-plan.mjs';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const EXPECTED_REGION = 'oss-cn-hangzhou';
const EXPECTED_BUCKET = 'yuko-vinyl';
const APPROVED_SOURCE_ORIGINS = new Set([
  'https://is1-ssl.mzstatic.com',
  'https://yuko-portfolio.oss-cn-hangzhou.aliyuncs.com'
]);
const planUrl = new URL('../../ops/cover-sources.json', import.meta.url);

const parseApplyArg = (argv) => {
  if (!Array.isArray(argv)) throw new TypeError('Arguments must be an array');
  if (argv.length === 0) return false;
  if (argv.length === 1 && argv[0] === '--apply') return true;
  throw new Error(`Unsupported or conflicting arguments: ${argv.join(' ')}`);
};

export function normalizeOssRegion(region) {
  const normalized = String(region || '').trim().toLowerCase();
  if (normalized === 'cn-hangzhou') return EXPECTED_REGION;
  if (normalized === EXPECTED_REGION) return normalized;
  throw new Error(`OSS region must be ${EXPECTED_REGION}`);
}

export function normalizeImageMediaType(value) {
  const type = String(value || '').split(';', 1)[0].trim().toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) {
    throw new Error('Cover response must use image/jpeg, image/png, or image/webp');
  }
  return type;
}

export function validateImageSignature(bytes, type) {
  const matches = type === 'image/jpeg'
    ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : type === 'image/png'
      ? bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
        .every((value, index) => bytes[index] === value)
      : bytes.length >= 12
        && Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF'
        && Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP';
  if (!matches) throw new Error(`Cover body does not match declared ${type} signature`);
}

const cancelResponseBody = async (response) => {
  if (!response?.body || response.body.locked) return;
  try { await response.body.cancel(); } catch {}
};

export async function readBoundedResponseBody(response, maxBytes = MAX_IMAGE_BYTES) {
  const declared = response.headers.get('content-length');
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isInteger(length) || length <= 0) throw new Error('Cover Content-Length must be positive');
    if (length > maxBytes) throw new Error(`Cover body exceeds ${maxBytes} byte limit`);
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new Error('Cover response requires a readable body');
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) throw new Error(`Cover body exceeds ${maxBytes} byte limit`);
      chunks.push(Buffer.from(value));
    }
  } finally {
    if (!complete) {
      try { await reader.cancel(); } catch {}
    }
    reader.releaseLock?.();
  }
  if (total === 0) throw new Error('Cover response returned an empty body');
  return Buffer.concat(chunks, total);
}

const validateFinalOrigin = (response) => {
  let finalUrl;
  try {
    finalUrl = new URL(response.url);
  } catch {
    throw new Error('Cover response did not expose a valid final URL');
  }
  if (!APPROVED_SOURCE_ORIGINS.has(finalUrl.origin)) {
    throw new Error(`Cover response redirected to unapproved origin ${finalUrl.origin}`);
  }
};

const redact = (message, env) => {
  let value = String(message || 'Unknown media operation failure');
  for (const name of ['OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET']) {
    const secret = env[name];
    if (secret) value = value.split(secret).join('[REDACTED]');
  }
  return value;
};

const aggregateFailure = (failures, outcomes) => {
  const error = new AggregateError(
    failures.map(({ ordinal, message }) => new Error(`${ordinal}: ${message}`)),
    `Cover mirroring failed for ${failures.length} of ${outcomes.length} items`
  );
  error.failures = failures;
  error.outcomes = outcomes;
  return error;
};

const defaultClientFactory = async (options) => {
  const { default: OSS } = await import('ali-oss');
  return new OSS(options);
};

export async function main({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = fetch,
  clientFactory = defaultClientFactory,
  planInput,
  readFileImpl = readFile,
  timeoutMs = 12000,
  maxImageBytes = MAX_IMAGE_BYTES
} = {}) {
  const apply = parseApplyArg(argv);
  const plan = validateCoverPlan(planInput || JSON.parse(await readFileImpl(planUrl, 'utf8')));
  const dryRun = {
    mode: 'dry-run',
    count: plan.items.length,
    targets: plan.items.map(({ targetKey }) => targetKey),
    overwritePolicy: 'forbid',
    rerunBehavior: 'existing targets fail and are never overwritten'
  };
  if (!apply) return dryRun;

  for (const name of ['OSS_REGION', 'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET', 'OSS_COVER_BUCKET']) {
    if (!env[name]) throw new Error(`Missing ${name}`);
  }
  const region = normalizeOssRegion(env.OSS_REGION);
  if (env.OSS_COVER_BUCKET !== EXPECTED_BUCKET) {
    throw new Error(`OSS cover bucket must be ${EXPECTED_BUCKET}`);
  }
  const client = await clientFactory({
    region,
    accessKeyId: env.OSS_ACCESS_KEY_ID,
    accessKeySecret: env.OSS_ACCESS_KEY_SECRET,
    bucket: EXPECTED_BUCKET
  });

  const outcomes = [];
  const failures = [];
  for (let index = 0; index < plan.items.length; index += 1) {
    const item = plan.items[index];
    const ordinal = index + 1;
    let response;
    try {
      response = await fetchImpl(item.sourceUrl, { signal: AbortSignal.timeout(timeoutMs) });
      if (response.status !== 200 || !response.ok) {
        throw new Error(`Cover download returned ${response.status}`);
      }
      validateFinalOrigin(response);
      const type = normalizeImageMediaType(response.headers.get('content-type'));
      const body = await readBoundedResponseBody(response, maxImageBytes);
      response = null;
      validateImageSignature(body, type);
      await client.put(item.targetKey, body, {
        headers: {
          'Content-Type': type,
          'Content-Disposition': 'inline',
          'Cache-Control': 'public, max-age=31536000, immutable',
          'x-oss-forbid-overwrite': 'true'
        }
      });
      outcomes.push({ ordinal, targetKey: item.targetKey, status: 'uploaded' });
    } catch (error) {
      await cancelResponseBody(response);
      const failure = {
        ordinal,
        targetKey: item.targetKey,
        status: 'failed',
        message: redact(error.message, env)
      };
      failures.push(failure);
      outcomes.push(failure);
    }
  }
  if (failures.length > 0) throw aggregateFailure(failures, outcomes);
  return {
    mode: 'apply',
    count: outcomes.length,
    outcomes,
    overwritePolicy: 'forbid',
    rerunBehavior: 'existing targets fail and are never overwritten'
  };
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
