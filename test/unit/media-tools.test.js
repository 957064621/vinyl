import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import {
  main as buildCoverPlan,
  validateCoverPlan
} from '../../scripts/media/build-cover-plan.mjs';
import {
  MAX_IMAGE_BYTES,
  main as mirrorCovers,
  readBoundedResponseBody
} from '../../scripts/media/mirror-covers.mjs';
import {
  buildMetadataObjects,
  main as applyMetadata
} from '../../scripts/media/apply-metadata.mjs';
import {
  readRequiredContentLength,
  validateMediaResponse,
  validateMediaUrl,
  verifyAllMedia
} from '../../scripts/media/verify-oss.mjs';

const root = new URL('../../', import.meta.url);
const coverPlan = JSON.parse(readFileSync(new URL('ops/cover-sources.json', root), 'utf8'));
const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10);
const webp = Uint8Array.from(Buffer.from('RIFF\x04\x00\x00\x00WEBP', 'binary'));

const clone = (value) => structuredClone(value);
const fakeResponse = ({
  url,
  status = 200,
  headers = {},
  bytes = jpeg
}) => {
  const response = new Response(bytes, { status, headers });
  Object.defineProperty(response, 'url', { value: url });
  return response;
};

const applyEnv = (extra = {}) => ({
  OSS_REGION: 'oss-cn-hangzhou',
  OSS_ACCESS_KEY_ID: 'KEY_ID',
  OSS_ACCESS_KEY_SECRET: 'KEY_SECRET',
  OSS_COVER_BUCKET: 'yuko-vinyl',
  ...extra
});
const metadataEnv = (extra = {}) => ({
  OSS_REGION: 'oss-cn-hangzhou',
  OSS_ACCESS_KEY_ID: 'KEY_ID',
  OSS_ACCESS_KEY_SECRET: 'KEY_SECRET',
  OSS_LOADING_BUCKET: 'yuko-portfolio',
  OSS_AUDIO_BUCKET: 'yuko-vinyl',
  ...extra
});
const smallMetadataObjects = () => buildMetadataObjects({
  criticalManifest: [{
    id: 'archive-01',
    source: 'https://yuko-portfolio.oss-cn-hangzhou.aliyuncs.com/cover/1.jpg'
  }],
  tracks: [{
    title: 'Fixture',
    musicOssUrl: 'https://yuko-vinyl.oss-cn-hangzhou.aliyuncs.com/musics/Fixture.mp3'
  }]
});

test('operational media modules are inert when imported', () => {
  const generatedPaths = [
    new URL('ops/cover-sources.json', root),
    new URL('src/data/cover-map.js', root)
  ];
  const before = generatedPaths.map((url) => statSync(url).mtimeMs);

  for (const path of [
    './scripts/media/build-cover-plan.mjs',
    './scripts/media/mirror-covers.mjs',
    './scripts/media/apply-metadata.mjs',
    './scripts/media/verify-oss.mjs'
  ]) {
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', `await import(${JSON.stringify(path)})`],
      { cwd: root, encoding: 'utf8' }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '', `${path} produced import-time output`);
    assert.equal(result.stderr, '', `${path} produced import-time diagnostics`);
  }

  assert.deepEqual(generatedPaths.map((url) => statSync(url).mtimeMs), before);
});

test('cover generator treats a valid committed plan as authoritative after runtime cleanup', async () => {
  const reorderedPlan = {
    items: coverPlan.items.map(({ releaseTitle, sourceUrl, targetKey }) => ({
      targetKey,
      sourceUrl,
      releaseTitle
    })),
    version: coverPlan.version
  };
  const writes = [];
  const result = await buildCoverPlan({
    argv: [],
    releasesInput: coverPlan.items.map(({ releaseTitle }) => ({ title: releaseTitle })),
    readFileImpl: async () => JSON.stringify(reorderedPlan),
    writeFileImpl: async (url, content) => writes.push({ url: String(url), content }),
    mkdirImpl: async () => {}
  });

  assert.deepEqual(result, { mode: 'generated', count: 23, mapCount: 23, planCreated: false });
  assert.equal(writes.length, 1);
  assert.match(writes[0].url, /src\/data\/cover-map\.js$/);
  assert.match(writes[0].content, /v2026-07\/023\.jpg/);
  assert.equal(writes[0].content.endsWith('\n'), true);
});

test('cover plan validation rejects duplicate fields and non-ordinal targets', () => {
  assert.doesNotThrow(() => validateCoverPlan(coverPlan));

  for (const [field, value] of [
    ['releaseTitle', coverPlan.items[0].releaseTitle],
    ['sourceUrl', coverPlan.items[0].sourceUrl],
    ['targetKey', coverPlan.items[0].targetKey]
  ]) {
    const invalid = clone(coverPlan);
    invalid.items[1][field] = value;
    const expected = field === 'targetKey' ? /ordinal target|unique targetKey/i : new RegExp(`unique ${field}`, 'i');
    assert.throws(() => validateCoverPlan(invalid), expected);
  }

  const invalidOrdinal = clone(coverPlan);
  invalidOrdinal.items[0].targetKey = 'covers/releases/v2026-07/1.jpg';
  assert.throws(() => validateCoverPlan(invalidOrdinal), /ordinal target/i);
});

test('cover mirror dry-run reads no credentials and rejects every unsupported argument', async () => {
  const touched = [];
  const env = new Proxy({}, { get: (_, key) => { touched.push(key); throw new Error('env read'); } });
  const result = await mirrorCovers({
    argv: [],
    env,
    planInput: coverPlan,
    fetchImpl: async () => { throw new Error('network used'); },
    clientFactory: async () => { throw new Error('client created'); }
  });

  assert.equal(result.mode, 'dry-run');
  assert.equal(result.count, 23);
  assert.equal(result.overwritePolicy, 'forbid');
  assert.match(result.rerunBehavior, /existing targets fail/i);
  assert.deepEqual(touched, []);
  for (const argv of [['--unknown'], ['--apply', '--apply'], ['--apply', '--dry-run']]) {
    await assert.rejects(() => mirrorCovers({ argv, planInput: coverPlan }), /arguments/i);
  }
});

test('cover mirror enforces the expected OSS region and destination bucket', async () => {
  for (const env of [
    applyEnv({ OSS_REGION: 'oss-cn-beijing' }),
    applyEnv({ OSS_COVER_BUCKET: 'other-bucket' })
  ]) {
    await assert.rejects(() => mirrorCovers({
      argv: ['--apply'],
      env,
      planInput: coverPlan,
      fetchImpl: async () => { throw new Error('network used'); },
      clientFactory: async () => { throw new Error('client created'); }
    }), /region|bucket/i);
  }
});

test('cover mirror rejects redirected origins, oversized bodies, and mismatched signatures', async () => {
  const scenarios = [
    () => fakeResponse({
      url: 'https://redirect.invalid/cover.jpg',
      headers: { 'content-type': 'image/jpeg', 'content-length': String(jpeg.length) }
    }),
    (url) => fakeResponse({
      url,
      headers: { 'content-type': 'image/jpeg', 'content-length': String(MAX_IMAGE_BYTES + 1) }
    }),
    (url) => fakeResponse({
      url,
      headers: { 'content-type': 'image/png', 'content-length': String(jpeg.length) },
      bytes: jpeg
    })
  ];

  for (const makeResponse of scenarios) {
    let puts = 0;
    await assert.rejects(() => mirrorCovers({
      argv: ['--apply'],
      env: applyEnv(),
      planInput: coverPlan,
      fetchImpl: async (url) => makeResponse(url),
      clientFactory: async () => ({ put: async () => { puts += 1; } })
    }), (error) => {
      assert.equal(error instanceof AggregateError, true);
      assert.equal(error.failures.length, 23);
      assert.deepEqual(error.outcomes.map(({ ordinal }) => ordinal), coverPlan.items.map((_, index) => index + 1));
      return true;
    });
    assert.equal(puts, 0);
  }
});

test('cover mirror uses bounded fetches and no-clobber uploads while aggregating item failures', async () => {
  const puts = [];
  const resultOrError = await mirrorCovers({
    argv: ['--apply'],
    env: applyEnv({ OSS_REGION: 'cn-hangzhou' }),
    planInput: coverPlan,
    fetchImpl: async (url, options) => {
      assert.equal(options.signal instanceof AbortSignal, true);
      if (url === coverPlan.items[1].sourceUrl) throw new Error('fixture download failure');
      return fakeResponse({
        url,
        headers: { 'content-type': 'image/jpeg', 'content-length': String(jpeg.length) }
      });
    },
    clientFactory: async (options) => {
      assert.equal(options.region, 'oss-cn-hangzhou');
      assert.equal(options.bucket, 'yuko-vinyl');
      return {
        put: async (key, body, options) => {
          puts.push({ key, body, options });
        }
      };
    }
  }).catch((error) => error);

  assert.equal(resultOrError instanceof AggregateError, true);
  assert.deepEqual(resultOrError.failures.map(({ ordinal }) => ordinal), [2]);
  assert.equal(resultOrError.outcomes.length, 23);
  assert.equal(puts.length, 22);
  assert.equal(puts.every(({ options }) => options.headers['x-oss-forbid-overwrite'] === 'true'), true);
  assert.equal(puts.every(({ options }) => options.headers['Content-Disposition'] === 'inline'), true);
});

test('cover mirror redacts credential values from aggregate outcomes', async () => {
  const error = await mirrorCovers({
    argv: ['--apply'],
    env: applyEnv(),
    planInput: coverPlan,
    fetchImpl: async (url) => fakeResponse({
      url,
      headers: { 'content-type': 'image/jpeg', 'content-length': String(jpeg.length) }
    }),
    clientFactory: async () => ({
      put: async () => { throw new Error('remote failure included KEY_SECRET'); }
    })
  }).catch((nextError) => nextError);

  assert.equal(JSON.stringify(error.outcomes).includes('KEY_SECRET'), false);
  assert.equal(error.failures.every(({ message }) => message.includes('[REDACTED]')), true);
});

test('cover streaming limit cancels an oversized undeclared response body', async () => {
  let cancelled = 0;
  const response = {
    headers: new Headers(),
    body: {
      getReader: () => ({
        read: async () => ({ done: false, value: Uint8Array.of(1, 2, 3, 4, 5) }),
        cancel: async () => { cancelled += 1; },
        releaseLock: () => {}
      })
    }
  };

  await assert.rejects(() => readBoundedResponseBody(response, 4), /exceeds 4 byte limit/i);
  assert.equal(cancelled, 1);
});

test('metadata dry-run lists every unique role, key, and intended header without reading credentials', async () => {
  const touched = [];
  const env = new Proxy({}, { get: (_, key) => { touched.push(key); throw new Error('env read'); } });
  const result = await applyMetadata({
    argv: [],
    env,
    clientFactory: async () => { throw new Error('client created'); }
  });

  assert.equal(result.mode, 'dry-run');
  assert.equal(result.count, 136);
  assert.equal(result.objects.length, 136);
  assert.deepEqual(new Set(result.objects.map(({ bucketRole }) => bucketRole)), new Set(['loading', 'audio']));
  assert.equal(result.objects.every(({ key }) => typeof key === 'string' && key.length > 0), true);
  assert.equal(result.objects.every(({ headers }) => headers['Content-Disposition'] === 'inline'), true);
  assert.deepEqual(touched, []);
  for (const argv of [['--unknown'], ['--apply', '--apply'], ['--apply', '--dry-run']]) {
    await assert.rejects(() => applyMetadata({ argv }), /arguments/i);
  }
});

test('metadata object derivation rejects role origin mismatches and duplicate bucket keys', () => {
  assert.throws(() => buildMetadataObjects({
    criticalManifest: [{ id: 'bad', source: 'https://yuko-vinyl.oss-cn-hangzhou.aliyuncs.com/cover/1.jpg' }],
    tracks: []
  }), /loading.*origin/i);
  assert.throws(() => buildMetadataObjects({
    criticalManifest: [],
    tracks: [{ title: 'bad', musicOssUrl: 'https://yuko-portfolio.oss-cn-hangzhou.aliyuncs.com/musics/x.mp3' }]
  }), /audio.*origin/i);
  assert.throws(() => buildMetadataObjects({
    criticalManifest: [
      { id: 'one', source: 'https://yuko-portfolio.oss-cn-hangzhou.aliyuncs.com/cover/1.jpg' },
      { id: 'two', source: 'https://yuko-portfolio.oss-cn-hangzhou.aliyuncs.com/cover/1.jpg' }
    ],
    tracks: []
  }), /unique.*key/i);
});

test('metadata main revalidates injected object ownership before dry-run or apply', async () => {
  const [object] = smallMetadataObjects();
  await assert.rejects(() => applyMetadata({
    argv: [],
    objectsInput: [{ ...object, expectedBucket: 'other-bucket' }]
  }), /bucket/i);
  await assert.rejects(() => applyMetadata({
    argv: [],
    objectsInput: [{ ...object, sourceUrl: 'https://example.com/cover/1.jpg' }]
  }), /origin/i);
});

test('metadata apply validates bucket ownership and normalizes only the Hangzhou region', async () => {
  for (const env of [
    metadataEnv({ OSS_REGION: 'oss-cn-beijing' }),
    metadataEnv({ OSS_LOADING_BUCKET: 'yuko-vinyl' }),
    metadataEnv({ OSS_AUDIO_BUCKET: 'other' })
  ]) {
    await assert.rejects(() => applyMetadata({
      argv: ['--apply'],
      env,
      objectsInput: smallMetadataObjects(),
      clientFactory: async () => { throw new Error('client created'); }
    }), /region|bucket/i);
  }
});

test('metadata apply preserves metadata, ACL, system fields, and ETag in same-key copies', async () => {
  const calls = [];
  const clients = new Map();
  const result = await applyMetadata({
    argv: ['--apply'],
    env: metadataEnv({ OSS_REGION: 'cn-hangzhou' }),
    objectsInput: smallMetadataObjects(),
    clientFactory: async ({ bucket, region }) => {
      assert.equal(region, 'oss-cn-hangzhou');
      const client = {
        head: async (key) => {
          calls.push({ method: 'head', bucket, key });
          return {
            meta: { owner: 'yuko' },
            res: { headers: {
              etag: '"fixture-etag"',
              'content-encoding': 'identity',
              'content-language': 'zh-CN',
              'x-oss-storage-class': 'IA'
            } }
          };
        },
        getACL: async (key) => {
          calls.push({ method: 'getACL', bucket, key });
          return { acl: 'public-read' };
        },
        copy: async (key, sourceKey, options) => {
          calls.push({ method: 'copy', bucket, key, sourceKey, options });
        }
      };
      clients.set(bucket, client);
      return client;
    }
  });

  assert.equal(result.mode, 'apply');
  assert.equal(result.outcomes.length, 2);
  const copies = calls.filter(({ method }) => method === 'copy');
  assert.equal(copies.length, 2);
  for (const copy of copies) {
    assert.equal(copy.sourceKey, copy.key);
    assert.deepEqual(copy.options.meta, { owner: 'yuko' });
    assert.equal(copy.options.headers['If-Match'], '"fixture-etag"');
    assert.equal(copy.options.headers['x-oss-object-acl'], 'public-read');
    assert.equal(copy.options.headers['content-encoding'], 'identity');
    assert.equal(copy.options.headers['content-language'], 'zh-CN');
    assert.equal(copy.options.headers['x-oss-storage-class'], 'IA');
    assert.equal(copy.options.headers['x-oss-metadata-directive'], 'REPLACE');
    assert.equal(copy.options.headers['Content-Disposition'], 'inline');
  }
  assert.deepEqual([...clients.keys()].sort(), ['yuko-portfolio', 'yuko-vinyl']);
});

test('metadata apply continues independent objects and reports ordered aggregate outcomes', async () => {
  let copies = 0;
  const error = await applyMetadata({
    argv: ['--apply'],
    env: metadataEnv(),
    objectsInput: smallMetadataObjects(),
    clientFactory: async ({ bucket }) => ({
      head: async () => {
        if (bucket === 'yuko-portfolio') throw new Error('fixture HEAD failure');
        return { meta: null, res: { headers: { etag: '"audio-etag"' } } };
      },
      getACL: async () => ({ acl: 'private' }),
      copy: async () => { copies += 1; }
    })
  }).catch((nextError) => nextError);

  assert.equal(error instanceof AggregateError, true);
  assert.deepEqual(error.failures.map(({ id }) => id), ['loading:archive-01']);
  assert.deepEqual(error.outcomes.map(({ status }) => status), ['failed', 'updated']);
  assert.equal(copies, 1);
});

test('media response validation parses exact disposition, cache, type, and range tokens', () => {
  assert.doesNotThrow(() => validateMediaResponse({
    kind: 'image',
    status: 200,
    immutable: true,
    headers: new Headers({
      'content-type': 'image/jpeg; charset=binary',
      'content-disposition': 'inline; filename="cover.jpg"',
      'cache-control': 'public, immutable, max-age=31536000',
      'content-length': '6'
    })
  }));
  assert.doesNotThrow(() => validateMediaResponse({
    kind: 'audio',
    status: 206,
    headers: new Headers({
      'content-type': 'audio/mpeg',
      'content-disposition': 'inline',
      'content-range': 'bytes 0-0/100',
      'content-length': '1'
    })
  }));
  assert.equal(readRequiredContentLength(new Headers({ 'content-length': '1' })), 1);

  const invalidImages = [
    { 'content-type': 'image/svg+xml', 'content-disposition': 'inline', 'cache-control': 'max-age=31536000, immutable' },
    { 'content-type': 'image/jpeg', 'content-disposition': 'x-inline', 'cache-control': 'max-age=31536000, immutable' },
    { 'content-type': 'image/jpeg', 'content-disposition': 'inline, attachment', 'cache-control': 'max-age=31536000, immutable' },
    { 'content-type': 'image/jpeg', 'content-disposition': 'inline', 'cache-control': 'x-max-age=31536000, immutable' },
    { 'content-type': 'image/jpeg', 'content-disposition': 'inline', 'cache-control': 'max-age=315360000, immutable' },
    { 'content-type': 'image/jpeg', 'content-disposition': 'inline', 'cache-control': 'max-age=31536000, immutablex' }
  ];
  for (const headers of invalidImages) {
    assert.throws(() => validateMediaResponse({
      kind: 'image', status: 200, immutable: true, headers: new Headers(headers)
    }));
  }

  for (const headers of [
    { 'content-type': 'audio/mpegurl', 'content-disposition': 'inline', 'content-range': 'bytes 0-0/100', 'content-length': '1' },
    { 'content-type': 'audio/mpeg', 'content-disposition': 'inline', 'content-range': 'bytes 0-0/0', 'content-length': '1' },
    { 'content-type': 'audio/mpeg', 'content-disposition': 'inline', 'content-range': 'bytes 0-1/100', 'content-length': '1' },
    { 'content-type': 'audio/mpeg', 'content-disposition': 'inline', 'content-range': 'bytes 0-0/100', 'content-length': '2' }
  ]) {
    assert.throws(() => validateMediaResponse({ kind: 'audio', status: 206, headers: new Headers(headers) }));
  }
});

test('media URL validation enforces each configured OSS role', () => {
  assert.doesNotThrow(() => validateMediaUrl(
    'https://yuko-vinyl.oss-cn-hangzhou.aliyuncs.com/covers/releases/v2026-07/001.jpg',
    'versioned-cover'
  ));
  assert.doesNotThrow(() => validateMediaUrl(
    'https://yuko-portfolio.oss-cn-hangzhou.aliyuncs.com/cover/1.jpg',
    'critical'
  ));
  assert.doesNotThrow(() => validateMediaUrl(
    'https://yuko-vinyl.oss-cn-hangzhou.aliyuncs.com/musics/a.mp3',
    'audio'
  ));
  assert.throws(() => validateMediaUrl(
    'https://yuko-portfolio.oss-cn-hangzhou.aliyuncs.com/cover/1.jpg',
    'versioned-cover'
  ), /origin/i);
  assert.throws(() => validateMediaUrl('https://example.com/a.mp3', 'audio'), /origin/i);
});

const verifierFixtures = () => ({
  releasesInput: [{
    title: 'Release',
    coverOssUrl: 'https://yuko-vinyl.oss-cn-hangzhou.aliyuncs.com/covers/releases/v2026-07/001.jpg'
  }],
  criticalManifest: [{
    id: 'archive-01',
    source: 'https://yuko-portfolio.oss-cn-hangzhou.aliyuncs.com/cover/1.jpg',
    mobile: 'https://yuko-portfolio.oss-cn-hangzhou.aliyuncs.com/cover/1.jpg?x-oss-process=image/resize,w_480/format,webp'
  }],
  tracks: [{
    title: 'Audio',
    musicOssUrl: 'https://yuko-vinyl.oss-cn-hangzhou.aliyuncs.com/musics/Audio.mp3'
  }]
});

const mediaHeaders = ({ type, immutable = false, length, range } = {}) => ({
  'content-type': type,
  'content-disposition': 'inline',
  ...(immutable ? { 'cache-control': 'public, max-age=31536000, immutable' } : {}),
  ...(length === undefined ? {} : { 'content-length': String(length) }),
  ...(range ? { 'content-range': range } : {})
});

test('media verifier bounds concurrency, validates signatures, and consumes every GET body', async () => {
  const fixtures = verifierFixtures();
  const getResponses = [];
  const headResponses = [];
  let active = 0;
  let maxActive = 0;
  const fetchImpl = async (url, options = {}) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    const method = options.method || 'GET';
    if (method === 'HEAD') {
      let response;
      if (url.includes('covers/releases')) {
        response = fakeResponse({ url, headers: mediaHeaders({ type: 'image/jpeg', immutable: true, length: jpeg.length }), bytes: Uint8Array.of(1) });
      } else if (url.includes('x-oss-process')) {
        response = fakeResponse({ url, headers: mediaHeaders({ type: 'image/webp', length: webp.length }), bytes: Uint8Array.of(1) });
      } else {
        response = fakeResponse({ url, headers: mediaHeaders({ type: 'image/jpeg', length: jpeg.length }), bytes: Uint8Array.of(1) });
      }
      headResponses.push(response);
      return response;
    }
    let response;
    if (url.includes('/musics/')) {
      response = fakeResponse({
        url,
        status: 206,
        headers: mediaHeaders({ type: 'audio/mpeg', length: 1, range: 'bytes 0-0/100' }),
        bytes: Uint8Array.of(0)
      });
    } else if (url.includes('x-oss-process')) {
      response = fakeResponse({
        url,
        status: 206,
        headers: mediaHeaders({ type: 'image/webp', length: webp.length }),
        bytes: webp
      });
    } else {
      response = fakeResponse({
        url,
        status: 206,
        headers: mediaHeaders({ type: 'image/jpeg', immutable: true, length: jpeg.length }),
        bytes: jpeg
      });
    }
    getResponses.push(response);
    return response;
  };

  const result = await verifyAllMedia({
    ...fixtures,
    fetchImpl,
    concurrency: 2,
    deadlineMs: 1000
  });

  assert.equal(maxActive <= 2, true);
  assert.equal(getResponses.length, 3);
  assert.equal(getResponses.every(({ bodyUsed }) => bodyUsed), true);
  assert.equal(headResponses.every(({ bodyUsed }) => bodyUsed), true);
  assert.deepEqual(result, {
    imageCount: 2,
    derivativeCount: 1,
    audioCount: 1,
    criticalMobileBytes: webp.length
  });
});

test('media verifier rejects final redirects and signatures but completes independent checks', async () => {
  const fixtures = verifierFixtures();
  const requested = [];
  const error = await verifyAllMedia({
    ...fixtures,
    concurrency: 2,
    deadlineMs: 1000,
    fetchImpl: async (url, options = {}) => {
      requested.push(url);
      const method = options.method || 'GET';
      if (url.includes('/musics/')) {
        return fakeResponse({
          url,
          status: 206,
          headers: mediaHeaders({ type: 'audio/mpeg', length: 1, range: 'bytes 0-0/100' }),
          bytes: Uint8Array.of(0)
        });
      }
      const redirectedUrl = url.includes('covers/releases') && method === 'HEAD'
        ? 'https://redirect.invalid/cover.jpg'
        : url;
      const derivative = url.includes('x-oss-process');
      const bytes = derivative ? jpeg : jpeg;
      return fakeResponse({
        url: redirectedUrl,
        status: method === 'HEAD' ? 200 : 206,
        headers: mediaHeaders({
          type: derivative ? 'image/webp' : 'image/jpeg',
          immutable: url.includes('covers/releases'),
          length: bytes.length
        }),
        bytes: method === 'HEAD' ? null : bytes
      });
    }
  }).catch((nextError) => nextError);

  assert.equal(error instanceof AggregateError, true);
  assert.equal(error.failures.some(({ kind }) => kind === 'image'), true);
  assert.equal(error.failures.some(({ kind }) => kind === 'critical-size'), true);
  assert.equal(requested.some((url) => url.includes('/musics/')), true);
  assert.deepEqual(error.failures.map(({ order }) => order), [...error.failures.map(({ order }) => order)].sort((a, b) => a - b));
});

test('media verifier applies a global deadline and reports deterministic failures', async () => {
  const fixtures = verifierFixtures();
  const error = await verifyAllMedia({
    ...fixtures,
    concurrency: 2,
    deadlineMs: 15,
    requestTimeoutMs: 1000,
    fetchImpl: async (_url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('fixture aborted')), { once: true });
    })
  }).catch((nextError) => nextError);

  assert.equal(error instanceof AggregateError, true);
  assert.equal(error.failures.length > 0, true);
  const orders = error.failures.map(({ order }) => order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
});
