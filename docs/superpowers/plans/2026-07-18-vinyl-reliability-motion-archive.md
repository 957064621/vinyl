# Vinyl Reliability, Motion, and Light Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve `https://957064621.github.io/vinyl/` while reducing its critical GitHub path to one HTML response, gating entry on five decoded OSS covers, removing mobile motion bottlenecks, applying the existing-image-only light archive visual system, and shipping the approved lyric/library changes with durable project documentation.

**Architecture:** Keep the vanilla JavaScript player and GitHub Pages HTML origin, but turn `src/main.js` into a composition root around focused data, asset-loading, playlist, audio, lyric, and motion modules. Vite emits one navigation-critical HTML file; OSS remains media-only, and a non-blocking service worker improves repeat visits without claiming to solve a first-visit `github.io` DNS failure.

**Tech Stack:** Vanilla ES modules, CSS, Vite 8, Node 22 built-in test runner, JSDOM, Playwright, `vite-plugin-singlefile`, Alibaba Cloud OSS media URLs and SDK, GitHub Pages Actions.

---

## Fixed Constraints

- Keep the public URL exactly `https://957064621.github.io/vinyl/`.
- Do not host the primary HTML document on the unfiled mainland OSS bucket.
- Do not add searched reference images, stock images, generated images, or new visual providers.
- Only reuse the five current loading covers and existing release covers; resized/encoded derivatives of those same files are allowed.
- Do not describe a total `github.io` DNS failure as repaired. Frontend code cannot run before DNS and TLS succeed.
- Treat every authored lyric newline as a hard semantic boundary. Never silently split, merge, reorder, trim away, or discard a line.
- Keep audio out of offline precaching and keep OSS as the audio/media origin.

## Target File Map

| Path | Responsibility |
| --- | --- |
| `src/main.js` | Composition root only; calls `bootstrapApp()` |
| `src/app/bootstrap.js` | DOM lookup, critical loading, controller wiring, lifecycle, deferred service-worker registration |
| `src/app/player-app.js` | Player controller composition and named DOM event bindings |
| `src/app/register-service-worker.js` | Non-blocking, base-path-safe service-worker registration |
| `src/config/assets.js` | Approved OSS origins, five-image manifest, responsive derivative candidate selection |
| `src/media/asset-loader.js` | Image load/decode, timeout, retry, fallback, concurrency, progress, cancellation |
| `src/player/audio-controller.js` | Audio state, source loading, play/pause/retry, seek, Media Session, stale request protection |
| `src/motion/motion-controller.js` | Motion profile detection, exclusive/cancellable timelines, transition completion |
| `src/ui/loading-screen.js` | Archive contact-sheet progress, decoded image mounting, retry/error, exit transition |
| `src/ui/playlist.js` | First-open rendering, stable nodes, active-row updates, lazy cover images |
| `src/ui/lyrics-overlay.js` | Semantic lyric rendering and overlay open/close commands |
| `src/lyrics/format.js` | Strict semantic-line parsing and escaped HTML rendering |
| `src/data/lyrics.js` | Highlight/chorus excerpts only |
| `src/data/releases.js` | Release/track metadata and stable playlist identity |
| `src/data.js` | Compatibility re-export during migration |
| `src/style.css` | Import-only stylesheet entry |
| `src/styles/base.css` | Reset, archive tokens, typography, app shell |
| `src/styles/archive.css` | Loading contact sheet, accession labels, light cuts, metadata rules |
| `src/styles/turntable.css` | Turntable, tonearm, record, playback controls |
| `src/styles/overlays.css` | Lyrics, playlist, retry/error surfaces |
| `src/styles/motion.css` | Keyframes and `full`/`compact`/`reduce` profile rules |
| `scripts/generate-audits.mjs` | Pure audit document generation plus guarded CLI writer |
| `scripts/media/mirror-covers.mjs` | Mirror currently used external release art to OSS and set object metadata |
| `scripts/media/verify-oss.mjs` | Verify media type, inline disposition, ranges, caching, and size budgets |
| `agent.md` | Complete operating guide, data/motion contracts, release checklist, iteration history |
| `.github/workflows/deploy-pages.yml` | Build, verify, upload `dist`, deploy Pages without changing the URL |

## Task 1: Establish the Test and Verification Baseline

**Files:**
- Modify: `package.json:6-13`
- Modify: `package-lock.json`
- Create: `test/unit/baseline.test.js`
- Create: `playwright.config.js`
- Create: `test/e2e/app.spec.js`

- [ ] **Step 1: Install the implementation and verification dependencies**

Run:

```bash
npm ci
npm install --save-dev @playwright/test@^1.54.0 jsdom@^26.1.0 vite-plugin-singlefile@^2.3.0 ali-oss@^6.23.0
```

Expected: `node_modules/.bin/vite` and `node_modules/.bin/playwright` exist and `package-lock.json` changes only for these dependencies.

- [ ] **Step 2: Add a failing baseline test before adding the scripts**

Create `test/unit/baseline.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { lyricsPool, releases } from '../../src/data.js';

test('current library imports in Node without a browser global', () => {
  assert.equal(releases.length, 23);
  assert.ok(lyricsPool.length >= 141);
});
```

Run: `npm run test:unit`

Expected: FAIL with `Missing script: "test:unit"`.

- [ ] **Step 3: Add deterministic scripts and Playwright configuration**

Replace the `scripts` object in `package.json` with:

```json
{
  "dev": "vite --host 0.0.0.0",
  "build": "vite build",
  "preview": "vite preview --host 0.0.0.0",
  "audit": "node scripts/generate-audits.mjs",
  "audit:check": "node scripts/generate-audits.mjs --check",
  "test:unit": "node --test test/unit/*.test.js",
  "test:build": "node --test test/build/*.test.js",
  "test:e2e": "playwright test",
  "test": "npm run test:unit",
  "verify": "npm run test:unit && npm run audit:check && npm run build && npm run test:build"
}
```

Create `playwright.config.js`:

```js
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173',
    port: 4173,
    reuseExistingServer: !process.env.CI
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 5'], reducedMotion: 'no-preference' } },
    { name: 'mobile-reduce', use: { ...devices['Pixel 5'], reducedMotion: 'reduce' } }
  ]
});
```

Create the initial `test/e2e/app.spec.js`:

```js
import { test, expect } from '@playwright/test';
import assert from 'node:assert/strict';

test('serves the player shell', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#turntable')).toBeAttached();
  await expect(page.locator('#playButton')).toBeAttached();
});
```

- [ ] **Step 4: Run the baseline test**

Run: `npm run test:unit`

Expected: PASS with `1` test and no browser-global error.

- [ ] **Step 5: Commit the baseline**

```bash
git add package.json package-lock.json playwright.config.js test/unit/baseline.test.js test/e2e/app.spec.js
git commit -m "test: establish vinyl verification baseline"
```

## Task 2: Enforce Semantic Lyrics and Add the Approved Songs

**Files:**
- Create: `src/lyrics/format.js`
- Create: `test/unit/lyrics-format.test.js`
- Create: `test/unit/library.test.js`
- Modify: `src/data.js:17-149,558-579`
- Modify: `src/main.js:1011-1151,1461-1470`

- [ ] **Step 1: Write failing semantic-line tests**

Create `test/unit/lyrics-format.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_LYRIC_LINES,
  parseLyricLines,
  renderLyricLinesHTML
} from '../../src/lyrics/format.js';

const approvedLines = [
  '我们都疮痍满身',
  '再捏造缘分',
  '然后扮成 无辜的路人',
  '要粉饰半生',
  '残存体温',
  '献祭给假圣人'
];

test('preserves authored semantic line boundaries', () => {
  assert.equal(MAX_LYRIC_LINES, 6);
  assert.deepEqual(parseLyricLines(approvedLines.join('\r\n')), approvedLines);
});

test('keeps internal spaces as soft pauses', () => {
  assert.deepEqual(
    parseLyricLines('然后扮成   无辜的路人'),
    ['然后扮成 无辜的路人']
  );
});

test('rejects invalid excerpts instead of silently dropping lines', () => {
  assert.throws(
    () => parseLyricLines('第一行\n\n第三行'),
    { name: 'TypeError', message: /blank semantic line/i }
  );
  assert.throws(
    () => parseLyricLines('一\n二\n三\n四\n五\n六\n七'),
    { name: 'RangeError', message: /at most 6 semantic lines/i }
  );
});

test('renders one escaped span for every authored line', () => {
  assert.equal(
    renderLyricLinesHTML('<b>一</b>\n第二行 & 继续'),
    '<span class="lyric-line">&lt;b&gt;一&lt;/b&gt;</span>'
      + '<span class="lyric-line">第二行 &amp; 继续</span>'
  );
});
```

Run: `node --test test/unit/lyrics-format.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/lyrics/format.js`.

- [ ] **Step 2: Implement the strict formatter**

Create `src/lyrics/format.js`:

```js
export const MAX_LYRIC_LINES = 6;

const normalizeLine = (line) => String(line).replace(/[\t ]+/g, ' ').trim();

export function parseLyricLines(text) {
  if (typeof text !== 'string' || text.length === 0) {
    throw new TypeError('Lyric excerpt must be a non-empty string');
  }

  const lines = text.replace(/\r\n?/g, '\n').split('\n').map(normalizeLine);
  if (lines.some((line) => line.length === 0)) {
    throw new TypeError('Lyric excerpt contains a blank semantic line');
  }
  if (lines.length > MAX_LYRIC_LINES) {
    throw new RangeError(`Lyric excerpt supports at most ${MAX_LYRIC_LINES} semantic lines`);
  }
  return lines;
}

const escapeHTML = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export function renderLyricLinesHTML(text) {
  return parseLyricLines(text)
    .map((line) => `<span class="lyric-line">${escapeHTML(line)}</span>`)
    .join('');
}
```

Run: `node --test test/unit/lyrics-format.test.js`

Expected: PASS with `4` tests.

- [ ] **Step 3: Write failing data-contract tests for `粉钻` and `媚人`**

Create `test/unit/library.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { lyricsPool, releases } from '../../src/data.js';
import { MAX_LYRIC_LINES, parseLyricLines } from '../../src/lyrics/format.js';

const liveRelease = () => releases.find(
  (release) => release.title === '万兽之王演唱会录音'
);

test('uses the approved 粉钻 wording', () => {
  const track = liveRelease().tracks.find(({ title }) => title === '粉钻');
  assert.equal(
    track.text,
    '满地粉钻 无人看管\n'
      + '你若不甘 用挚爱交换\n'
      + '漫天红伞 无人生还\n'
      + '我的遗憾 是不能洁白的带你离开'
  );
  assert.doesNotMatch(track.text, /用爱交换/);
});

test('keeps 媚人 as a complete independent single release', () => {
  const release = releases.find(({ title }) => title === '媚人 - Single');
  const track = release.tracks[0];
  assert.equal(release.type, 'single');
  assert.equal(release.releaseDate, '2026-07-17');
  assert.deepEqual(
    release.tracks.map(({ title, trackNumber }) => ({ title, trackNumber })),
    [
      { title: '媚人', trackNumber: 1 }
    ]
  );
  assert.equal(track.artist, '薛之谦');
  assert.equal(track.recordingSource, undefined);
  assert.equal(
    track.musicOssUrl,
    'https://yuko-vinyl.oss-cn-hangzhou.aliyuncs.com/musics/%E5%AA%9A%E4%BA%BA.mp3'
  );
  assert.deepEqual(parseLyricLines(track.text), [
    '我们都疮痍满身',
    '再捏造缘分',
    '然后扮成 无辜的路人',
    '要粉饰半生',
    '残存体温',
    '献祭给假圣人'
  ]);
});

test('keeps every track identity unique and every excerpt valid', () => {
  const keys = lyricsPool.map(
    ({ album, trackNumber, title }) => [album, trackNumber, title].join('\0')
  );
  assert.equal(lyricsPool.length, 142);
  assert.equal(new Set(keys).size, keys.length);
  for (const track of lyricsPool) {
    const lines = parseLyricLines(track.text);
    assert.ok(lines.length > 0 && lines.length <= MAX_LYRIC_LINES);
  }
});
```

Run: `node --test test/unit/library.test.js`

Expected: FAIL on the old `粉钻` wording and the missing independent single; the total track count increases from `141` to `142`.

- [ ] **Step 4: Apply the two approved content changes**

In `lyricTextByTitle`, replace and add exactly:

```js
'粉钻': '满地粉钻 无人看管\n你若不甘 用挚爱交换\n漫天红伞 无人生还\n我的遗憾 是不能洁白的带你离开',
'媚人': '我们都疮痍满身\n再捏造缘分\n然后扮成 无辜的路人\n要粉饰半生\n残存体温\n献祭给假圣人',
```

Add a separate release after `万兽之王演唱会录音`:

```js
makeRelease({
  title: '媚人 - Single',
  type: 'single',
  releaseDate: '2026-07-17',
  sourceArtworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/6c/c8/3a/6cc83adf-7cd1-8dd0-6606-94106ac1f83f/4896016816485.jpg/600x600bb.jpg',
  coverOssUrl: '',
  palette: { a: [111, 45, 43], b: [188, 190, 186] },
  tracks: [makeTrack('媚人', {
    musicOssUrl: 'https://yuko-vinyl.oss-cn-hangzhou.aliyuncs.com/musics/%E5%AA%9A%E4%BA%BA.mp3',
    trackNumber: 1,
    artist: '薛之谦'
  })]
})
```

- [ ] **Step 5: Replace the destructive renderer**

Import the formatter at the top of `src/main.js`:

```js
import { renderLyricLinesHTML } from './lyrics/format.js';
```

Delete `stripLyricPunctuation` through `lyricToLinesHTML` at `src/main.js:1011-1151`, then replace the consumer at `src/main.js:1461-1470` with:

```js
const updateCurrentLyric = (index) => {
  const result = lyricsPool[index];
  lyricEl.innerHTML = renderLyricLinesHTML(result.text);
  songEl.textContent = `—— ${result.song}`;
  currentLyricIndex = index;
  void applyCoverVisual(index);
  consumeLyricIndexFromQueue(index);
  updateMediaSessionMetadata(index);
  renderPlaylist();
};
```

- [ ] **Step 6: Verify and commit the content contract**

Run:

```bash
npm run test:unit
git diff --check
```

Expected: all current unit tests PASS; `粉钻` contains `用挚爱交换`; `媚人` is an independent single with its official artwork and six unchanged semantic lines.

```bash
git add src/data.js src/main.js src/lyrics/format.js test/unit/lyrics-format.test.js test/unit/library.test.js
git commit -m "feat: preserve semantic lyrics and add meiren"
```

## Task 3: Split Data Ownership and Make Audits Reproducible

**Files:**
- Create: `src/data/lyrics.js`
- Create: `src/data/releases.js`
- Modify: `src/data.js:1-625`
- Modify: `scripts/generate-audits.mjs:1-116`
- Create: `test/unit/audits.test.js`
- Modify: `MUSIC_AUDIO_MANIFEST.md`
- Modify: `MUSIC_LIBRARY_AUDIT.md`

- [ ] **Step 1: Write a failing deterministic audit test**

Create `test/unit/audits.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { lyricsPool, releases } from '../../src/data.js';
import { buildAuditDocuments } from '../../scripts/generate-audits.mjs';

test('builds deterministic audit documents from library data', () => {
  const { audioManifest, libraryAudit } = buildAuditDocuments({
    releases,
    lyricsPool,
    updatedAt: '2026-07-18'
  });

  assert.match(audioManifest, /更新时间：2026-07-18/);
  assert.match(audioManifest, /\| 曲库歌曲条目 \| 142 \|/);
  assert.match(audioManifest, /\| 唯一音频标题 \| 131 \|/);
  assert.match(
    audioManifest,
    /\| 媚人 \| 媚人 - Single \| 已填 6 行 \| OSS \|/
  );
  assert.match(
    libraryAudit,
    /\| 万兽之王演唱会录音 \| live-recording \| 2026 \| 2 \| 0 \| 0 \| [YN] \| Y \|/
  );
});
```

Run: `node --test test/unit/audits.test.js`

Expected: FAIL because `buildAuditDocuments` is not exported and importing the script currently writes files immediately.

- [ ] **Step 2: Extract the source data without changing values or order**

Move the complete object literal from current `src/data.js:17-149` into `src/data/lyrics.js` without changing key order or string bytes. Add `export` before its declaration and wrap the literal with `Object.freeze`; those delimiters are the only edits to the moved object. Verify it still contains the exact `粉钻` and `媚人` strings from Task 2.

Move constants, constructors, releases, flattening, and exports from current `src/data.js:1-16,155-625` to `src/data/releases.js`. Import the lyric map and add a stable identity helper:

```js
import { lyricTextByTitle } from './lyrics.js';

export const getTrackKey = (releaseTitle, track) => [
  releaseTitle,
  track.trackNumber,
  track.title
].join('\0');
```

Keep `src/data.js` as the compatibility facade:

```js
export { lyricTextByTitle } from './data/lyrics.js';
export * from './data/releases.js';
```

Run: `node --test test/unit/baseline.test.js test/unit/library.test.js`

Expected: PASS with the same 23-release/142-track ordering and unique `album + trackNumber + title` keys.

- [ ] **Step 3: Refactor the audit script into a pure builder and guarded CLI**

Replace the script with this pure builder and guarded CLI, retaining the current table columns:

```js
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { lyricsPool, releases } from '../src/data.js';

const md = (value) => String(value ?? '')
  .replace(/\|/g, '\\|')
  .replace(/\n/g, '<br>');
const lineCount = (text) => String(text || '').split('\n').filter(Boolean).length;

const root = new URL('../', import.meta.url);
const outputs = {
  audioManifest: new URL('MUSIC_AUDIO_MANIFEST.md', root),
  libraryAudit: new URL('MUSIC_LIBRARY_AUDIT.md', root)
};

export function buildAuditDocuments({ releases, lyricsPool, updatedAt }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(updatedAt)) {
    throw new TypeError('updatedAt must use YYYY-MM-DD');
  }

  const uniqueTracks = [...new Map(lyricsPool.map((track) => [track.title, track])).values()]
    .sort((left, right) => left.title.localeCompare(right.title, 'zh-Hans-CN'));
  const missingLyrics = lyricsPool.filter((track) => track.needsLyric);
  const missingMusic = lyricsPool.filter((track) => !track.musicOssUrl);
  const missingCoverOss = releases.filter((release) => !release.coverOssUrl);
  const releaseRows = releases.map((release) => {
    const tracks = release.tracks || [];
    return `| ${md(release.title)} | ${md(release.type)} | ${md(release.releaseDate || '待核对')} | ${tracks.length} | ${tracks.filter((track) => track.needsLyric).length} | ${tracks.filter((track) => !track.musicOssUrl).length} | ${release.sourceArtworkUrl ? 'Y' : 'N'} | ${release.coverOssUrl ? 'Y' : 'N'} |`;
  }).join('\n');
  const trackRows = lyricsPool.map((track) => {
    const lyricState = track.needsLyric ? '待补歌词' : `已填 ${lineCount(track.text)} 行`;
    const musicState = track.musicOssUrl ? 'OSS' : '待补 OSS';
    const coverState = track.coverOssUrl || track.sourceArtworkUrl || '待补封面';
    return `| ${md(track.title)} | ${md(track.album)} | ${md(lyricState)} | ${md(musicState)} | ${md(coverState)} |`;
  }).join('\n');
  const missingLyricRows = missingLyrics.map((track) => (
    `| ${md(track.title)} | ${md(track.album)} | ${md(track.musicOssUrl || '待补 OSS')} | ${md(track.sourceArtworkUrl || track.coverOssUrl || '待补封面')} |`
  )).join('\n') || '| 无 |  |  |  |';

  const summary = `| 曲库歌曲条目 | ${lyricsPool.length} |\n| 唯一音频标题 | ${uniqueTracks.length} |\n| 已配置 OSS 链接 | ${lyricsPool.filter((track) => Boolean(track.musicOssUrl)).length} |\n| 待补 OSS | ${missingMusic.length} |\n| 待补歌词 | ${missingLyrics.length} |\n| 待补封面 OSS | ${missingCoverOss.length} |`;
  const audioManifest = `# Vinyl 音频清单

更新时间：${updatedAt}

## 总览

| 项目 | 数量 |
| --- | ---: |
${summary}

## 当前曲库

| 歌曲 | 专辑 | 歌词 | 音频 | 封面 |
| --- | --- | --- | --- | --- |
${trackRows}

## 待补歌词

| 歌曲 | 专辑 | 音频 | 封面 |
| --- | --- | --- | --- |
${missingLyricRows}

## 维护方式

1. 所有歌曲音频链接统一在源数据的 musicOssUrl 字段维护。
2. 播放层直接读取 musicOssUrl，所有歌曲音频都使用 OSS 直链。
3. 修改歌曲、歌词、封面或音频后运行 npm run audit。
`;
  const libraryAudit = `# Vinyl 曲库统计表

更新时间：${updatedAt}

## 总览

| 项目 | 数量 |
| --- | ---: |
${summary}

## 发行组统计

| 发行 | 类型 | 日期 | 歌曲数 | 缺歌词 | 缺音频 | source 封面 | OSS 封面 |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
${releaseRows}

## 当前曲库

| 歌曲 | 专辑 | 歌词状态 | 音频状态 | 封面 |
| --- | --- | --- | --- | --- |
${trackRows}

## 缺高潮歌词

| 歌曲 | 专辑 | 音频 | 封面 |
| --- | --- | --- | --- |
${missingLyricRows}

## 使用方式

1. 源数据是曲库事实来源，修改后运行 npm run audit。
2. 页面播放统一读取 musicOssUrl，所有歌曲音频都使用 OSS 直链。
3. 新增歌曲必须补齐音频、高潮摘录和 OSS 封面后再发布。
`;
  return { audioManifest, libraryAudit };
}

const readCommittedDate = async () => {
  const current = await readFile(outputs.libraryAudit, 'utf8');
  return current.match(/更新时间：(\d{4}-\d{2}-\d{2})/)?.[1]
    || new Date().toISOString().slice(0, 10);
};

async function main() {
  const check = process.argv.includes('--check');
  const updatedAt = check
    ? await readCommittedDate()
    : new Date().toISOString().slice(0, 10);
  const documents = buildAuditDocuments({ releases, lyricsPool, updatedAt });

  for (const [name, url] of Object.entries(outputs)) {
    if (check) {
      const current = await readFile(url, 'utf8');
      if (current !== documents[name]) {
        throw new Error(`${fileURLToPath(url)} is stale; run npm run audit`);
      }
    } else {
      await writeFile(url, documents[name], 'utf8');
    }
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
```

- [ ] **Step 4: Regenerate and verify the audits**

Run:

```bash
npm run audit
npm run audit:check
npm run test:unit
```

Expected: PASS. Both manifests report `24` releases, `142` track references, `131` unique titles, `142` configured audio URLs, and the six-line `媚人` excerpt.

- [ ] **Step 5: Commit the data boundary**

```bash
git add src/data.js src/data/lyrics.js src/data/releases.js scripts/generate-audits.mjs test/unit/audits.test.js MUSIC_AUDIO_MANIFEST.md MUSIC_LIBRARY_AUDIT.md
git commit -m "refactor: separate vinyl data and reproducible audits"
```

## Task 4: Document the Complete Project and Its Iteration History

**Files:**
- Create: `agent.md`
- Create: `test/unit/project-documentation.test.js`

- [ ] **Step 1: Write a failing documentation-contract test**

Create `test/unit/project-documentation.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const path = new URL('../../agent.md', import.meta.url);

test('agent.md records every operating contract', async () => {
  const document = await readFile(path, 'utf8');
  const required = [
    '# Vinyl 项目指南',
    '## 产品与用户流程',
    '## 架构与文件职责',
    '## 本地开发与命令',
    '## GitHub Pages 与 OSS 边界',
    '## 媒体命名、元数据与缓存',
    '## 发行与歌曲数据契约',
    '## 高潮歌词与语义断句',
    '## 动效档位与性能预算',
    '## 无障碍与弱动效',
    '## 测试、发布、回滚',
    '## 迭代历史',
    '## 新增歌曲步骤'
  ];
  for (const heading of required) assert.match(document, new RegExp(heading));
  assert.match(document, /github\.io.*DNS.*前端代码.*无法/si);
  assert.match(document, /换行.*硬语义边界/);
  assert.match(document, /高潮|副歌/);
  assert.match(document, /120 KiB/);
  assert.match(document, /50 ms/);
  assert.match(document, /MUSIC_LIBRARY_AUDIT\.md/);
  assert.match(document, /7ee756c/);
  assert.match(document, /48d1161/);
  assert.match(document, /8e1d874/);
  assert.match(document, /src\/app\/transitions\.js/);
  assert.match(document, /src\/app\/register-service-worker\.js/);
  assert.match(document, /src\/data\/cover-map\.js/);
  assert.match(document, /scripts\/media\/build-cover-plan\.mjs/);
  assert.match(document, /scripts\/media\/apply-metadata\.mjs/);
});
```

Run: `node --test test/unit/project-documentation.test.js`

Expected: FAIL with `ENOENT` for lowercase root `agent.md`.

- [ ] **Step 2: Create `agent.md` with concrete project instructions**

Write the document in Chinese. It must state all of the following as operational rules, not aspirational prose:

```markdown
# Vinyl 项目指南

## 产品与用户流程
这是一个移动优先的黑胶歌词抽取与播放页面。用户进入后先等待五张现有 OSS 封面完成加载和解码，再进入唱盘；抽取后显示高潮或副歌摘录并播放对应 OSS 音频；歌单与歌词是全屏工作层，不是营销页面。

## 架构与文件职责
`src/main.js` 只导入样式并调用 `bootstrapApp()`。`src/app/bootstrap.js` 管理启动生命周期，`src/app/player-app.js` 组合控制器并绑定命名事件，`src/app/transitions.js` 定义完成驱动的业务时间线，`src/app/register-service-worker.js` 延迟注册回访缓存。`src/config/assets.js` 定义五张既有封面及同图派生候选；`src/media/asset-loader.js` 负责加载、解码、重试和回退；`src/player/audio-controller.js`、`turntable-controller.js`、`track-selector.js` 分别管理音频、唱盘和选曲；`src/motion/motion-controller.js` 独占并取消时间线；`src/ui/` 管理加载页、歌词层和延迟歌单；`src/data/lyrics.js` 与 `releases.js` 是内容事实来源，`src/data/cover-map.js` 是版本化 OSS 封面映射；`src/styles/` 按基础、档案视觉、唱盘、覆盖层和动效拆分。`scripts/media/build-cover-plan.mjs` 固化迁移清单，`mirror-covers.mjs` 默认 dry-run 镜像，`apply-metadata.mjs` 默认 dry-run 修正 inline 元数据，`verify-oss.mjs` 做发布前远端验证。完整曲库表链接见 [MUSIC_LIBRARY_AUDIT.md](MUSIC_LIBRARY_AUDIT.md)，音频表链接见 [MUSIC_AUDIO_MANIFEST.md](MUSIC_AUDIO_MANIFEST.md)。

## 本地开发与命令
要求 Node 22。`npm ci` 按锁文件安装；`npm run dev` 启动本地 Vite；`npm run test:unit` 验证数据和纯控制器；`npm run audit` 重建两份清单；`npm run audit:check` 检查清单未过期；`npm run media:mirror` 与 `npm run media:metadata` 只输出 dry-run，带 `:apply` 的命令才执行已授权 OSS 写入；`npm run media:verify` 检查 OSS 响应；`npm run build` 生成 dist；`npm run test:build` 检查单文档和大小预算；`npm run test:e2e` 执行浏览器流程；`npm run verify` 顺序执行单元、审计、构建和构建产物检查。

## GitHub Pages 与 OSS 边界
公共地址固定为 `https://957064621.github.io/vinyl/`。项目没有 ICP 备案，因此 GitHub Pages 只提供单文档应用、manifest 和 service worker；两个现有 OSS 桶只提供图像和音频，不能把大陆 OSS 默认域名当 HTML 站点。首次访问时若 `github.io` DNS 完全失败，前端代码尚未执行，无法修复；单文档构建只减少间歇性失败的请求面。

## 媒体命名、元数据与缓存
图像和 MP3 必须使用正确 Content-Type、`Content-Disposition: inline`。版本化图像使用 `public,max-age=31536000,immutable`；音频必须通过 `Range: bytes=0-0` 返回 206 和 Content-Range。新版本上线后至少保留上一发布窗口的对象，不删除仍可能被旧 HTML 引用的 key。

## 发行与歌曲数据契约
发行由 title/type/releaseDate/coverOssUrl/palette/tracks 组成。歌曲身份是 `album + trackNumber + title`，不能只用标题，因为曲库存在跨发行重复歌曲。音频由 `musicOssUrl` 明确指定。

## 高潮歌词与语义断句
歌词字段只保存高潮或副歌摘录。每个换行都是硬语义边界，行内空格是软停顿；渲染器不得拆分、合并、重排或静默删除作者行。每段最多六行，超限要编辑源歌词或调整响应式字号。

## 动效档位与性能预算
无弱动效请求的桌面细指针使用 full；触控设备、iOS、Android 和微信使用 compact；`prefers-reduced-motion` 使用 reduce。动画默认只改 transform 和 opacity；compact/reduce 禁止全屏实时模糊、背景位移和阴影动画。压缩 HTML 不超过 120 KiB；移动首屏五图目标不超过 1.2 MiB；主要交互不得出现超过 50 ms 长任务；参考设备目标 60 fps、最低持续 50 fps；隐藏层不得继续装饰动画或保留 will-change。

## 无障碍与弱动效
`prefers-reduced-motion` 使用 reduce；触控设备默认 compact；错误状态可读、可重试；关闭按钮有可访问名称；歌词字号适配容器但不按视口宽度连续缩放。

## 测试、发布、回滚
发布前依次运行 `npm run verify`、`npm run media:verify`、`npm run test:e2e`，再完成 iOS Safari、Android Chrome 和微信 WebView 真机清单。Pages 只通过 Actions 部署 dist。回滚时重新部署已验证提交，并保留该提交引用的 OSS key；service worker 不调用 skipWaiting 或 clients.claim，不在当前会话强制接管。

## 迭代历史
按仓库 diff 记录：4db78ea 初版唱盘与歌词抽取；2434dd9 将大媒体迁到 OSS；a37bc22 加入 PWA manifest；c7ac3b9 到 cd39b0a 完善移动体验、加载和封面驱动视觉；51835a1 到 0dc9495 收敛控制区闪烁、位移和回弹；7ee756c 引入 Vite、完整曲库和审计，但也把“用挚爱交换”回退并引入破坏语义行的格式器；48d1161 优化移动歌单，8e1d874 又重新启用模糊背景漂移，4f892a1 只降低其成本；f184629 固化本轮可靠性、动效和光影档案馆设计。模糊提交信息不推断未被 diff 证明的故事。

## 新增歌曲步骤
1. 在 `src/data/lyrics.js` 写入不超过六行的高潮或副歌摘录。
2. 在 `src/data/releases.js` 的正确发行中加入歌曲和稳定 trackNumber。
3. 填写经过 Range 验证的 OSS `musicOssUrl`，并确认发行 `coverOssUrl` 已存在。
4. 运行 `npm run test:unit` 和 `npm run media:verify`。
5. 运行 `npm run audit` 并检查 142 行基线按新增数量递增。
6. 本地检查抽取、播放、歌词断句、歌单选中和音频重试。
7. 提交源数据、生成审计和受影响文档，不提交凭据或媒体二进制。
```

- [ ] **Step 3: Verify and commit the guide**

Run:

```bash
node --test test/unit/project-documentation.test.js
git diff --check
```

Expected: PASS and the filename is exactly lowercase `agent.md`.

```bash
git add agent.md test/unit/project-documentation.test.js
git commit -m "docs: add complete vinyl agent guide"
```

## Task 5: Add the Five-Image Manifest and Decoded Asset Loader

**Files:**
- Create: `src/config/assets.js`
- Create: `src/media/asset-loader.js`
- Create: `test/unit/assets.test.js`
- Create: `test/unit/asset-loader.test.js`

- [ ] **Step 1: Write failing manifest and loader tests**

Create `test/unit/assets.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CRITICAL_IMAGE_MANIFEST,
  selectCriticalImageCandidates
} from '../../src/config/assets.js';

test('contains exactly five responsive variants of existing OSS covers', () => {
  assert.equal(CRITICAL_IMAGE_MANIFEST.length, 5);
  assert.equal(new Set(CRITICAL_IMAGE_MANIFEST.map(({ id }) => id)).size, 5);
  for (const asset of CRITICAL_IMAGE_MANIFEST) {
    const urls = ['source', 'mobile', 'desktop', 'fallback'].map((key) => new URL(asset[key]));
    assert.ok(urls.every((url) => url.origin === 'https://yuko-portfolio.oss-cn-hangzhou.aliyuncs.com'));
    assert.equal(new Set(urls.map(({ pathname }) => pathname)).size, 1);
    assert.match(asset.mobile, /resize,w_480/);
    assert.match(asset.desktop, /resize,w_960/);
    assert.match(asset.fallback, /resize,w_320/);
  }
  assert.equal(selectCriticalImageCandidates(CRITICAL_IMAGE_MANIFEST[0], 390)[0], CRITICAL_IMAGE_MANIFEST[0].mobile);
  assert.equal(selectCriticalImageCandidates(CRITICAL_IMAGE_MANIFEST[0], 1440)[0], CRITICAL_IMAGE_MANIFEST[0].desktop);
});
```

Create `test/unit/asset-loader.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CriticalAssetError,
  loadAndDecodeImage,
  loadCriticalImages
} from '../../src/media/asset-loader.js';

const asset = {
  id: 'archive-01',
  alt: '封面',
  desktop: 'desktop.webp',
  fallback: 'small.webp',
  source: 'source.jpg'
};

test('requires decode success and rejects timeout', async () => {
  const decodeFailure = {
    naturalWidth: 100,
    decode: async () => { throw new Error('decode failed'); },
    set src(value) { this.currentSrc = value; queueMicrotask(() => this.onload()); }
  };
  await assert.rejects(
    loadAndDecodeImage('bad.webp', { createImage: () => decodeFailure, timeoutMs: 50 }),
    /decode failed/
  );
  await assert.rejects(
    loadAndDecodeImage('slow.webp', { createImage: () => ({}), timeoutMs: 1 }),
    /timed out/
  );
});

test('retries the selected derivative twice before a smaller fallback', async () => {
  const calls = [];
  const result = await loadCriticalImages([asset], {
    selectCandidates: (entry) => [entry.desktop, entry.fallback, entry.source],
    loadImage: async (src) => {
      calls.push(src);
      if (src === asset.desktop) throw new Error('network');
      return { src, image: { src } };
    },
    retries: 2,
    retryDelayMs: 0
  });
  assert.deepEqual(calls, ['desktop.webp', 'desktop.webp', 'desktop.webp', 'small.webp']);
  assert.equal(result[0].src, 'small.webp');
});

test('limits concurrency and reports completed decoded slots', async () => {
  let active = 0;
  let maxActive = 0;
  const progress = [];
  const manifest = Array.from({ length: 5 }, (_, index) => ({ id: `a${index}`, source: `${index}.jpg` }));
  await loadCriticalImages(manifest, {
    selectCandidates: (entry) => [entry.source],
    concurrency: 2,
    loadImage: async (src) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return { src, image: { src } };
    },
    onProgress: (event) => progress.push(event)
  });
  assert.equal(maxActive, 2);
  assert.deepEqual(
    progress.filter(({ status }) => status === 'ready').map(({ completed }) => completed).sort(),
    [1, 2, 3, 4, 5]
  );
});

test('names failed slots instead of resolving an incomplete player', async () => {
  await assert.rejects(
    loadCriticalImages([asset], {
      selectCandidates: (entry) => [entry.desktop, entry.fallback, entry.source],
      loadImage: async () => { throw new Error('decode'); },
      retries: 0,
      retryDelayMs: 0
    }),
    (error) => error instanceof CriticalAssetError && error.failures[0].id === 'archive-01'
  );
});
```

Run: `node --test test/unit/assets.test.js test/unit/asset-loader.test.js`

Expected: FAIL with two `ERR_MODULE_NOT_FOUND` errors.

- [ ] **Step 2: Create the approved derivative manifest**

Create `src/config/assets.js`:

```js
export const COVER_OSS_ORIGIN = 'https://yuko-portfolio.oss-cn-hangzhou.aliyuncs.com/cover/';

const COVER_FILES = [
  '3.jpg',
  '4.jpg',
  '1.jpg',
  '2.jpg',
  '%E5%A4%A9%E5%A4%96%E6%9D%A5%E7%89%A9.jpg'
];

export function ossImageDerivative(source, width) {
  return `${source}${source.includes('?') ? '&' : '?'}x-oss-process=image/resize,w_${width}/format,webp`;
}

export const CRITICAL_IMAGE_MANIFEST = Object.freeze(COVER_FILES.map((file, index) => {
  const source = new URL(file, COVER_OSS_ORIGIN).href;
  return Object.freeze({
    id: `archive-${String(index + 1).padStart(2, '0')}`,
    alt: `加载封面图${index + 1}`,
    source,
    mobile: ossImageDerivative(source, 480),
    desktop: ossImageDerivative(source, 960),
    fallback: ossImageDerivative(source, 320)
  });
}));

export function selectCriticalImageCandidates(asset, viewportWidth) {
  const primary = viewportWidth < 768 ? asset.mobile : asset.desktop;
  return [...new Set([primary, asset.fallback, asset.source].filter(Boolean))];
}
```

- [ ] **Step 3: Implement load, decode, retry, fallback, and bounded concurrency**

Create `src/media/asset-loader.js` with these public invariants:

```js
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class CriticalAssetError extends Error {
  constructor(failures) {
    super(`Critical images failed: ${failures.map(({ id }) => id).join(', ')}`);
    this.name = 'CriticalAssetError';
    this.failures = failures;
  }
}

export function loadAndDecodeImage(src, {
  createImage = () => new Image(),
  timeoutMs = 12000,
  signal
} = {}) {
  return new Promise((resolve, reject) => {
    const image = createImage();
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      image.onload = null;
      image.onerror = null;
    };
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const abort = () => settle(reject, new Error(`Image load aborted: ${src}`));
    const timer = setTimeout(
      () => settle(reject, new Error(`Image load timed out: ${src}`)),
      timeoutMs
    );

    image.onload = async () => {
      try {
        if (typeof image.decode === 'function') await image.decode();
        if ('naturalWidth' in image && image.naturalWidth === 0) {
          throw new Error(`Image has no decoded bitmap: ${src}`);
        }
        settle(resolve, { src, image });
      } catch (error) {
        settle(reject, error);
      }
    };
    image.onerror = () => settle(reject, new Error(`Image load failed: ${src}`));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    image.decoding = 'async';
    image.src = src;
  });
}

async function loadSlot(asset, options) {
  const candidates = options.selectCandidates(asset);
  const attempts = [];
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const src = candidates[candidateIndex];
    const limit = candidateIndex === 0 ? options.retries + 1 : 1;
    for (let attempt = 1; attempt <= limit; attempt += 1) {
      try {
        return { ...await options.loadImage(src), id: asset.id, alt: asset.alt };
      } catch (error) {
        attempts.push({ src, attempt, error });
        if (attempt < limit) await wait(options.retryDelayMs);
      }
    }
  }
  const error = new Error(`No usable image for ${asset.id}`);
  error.attempts = attempts;
  throw error;
}

export async function loadCriticalImages(manifest, {
  selectCandidates,
  loadImage = loadAndDecodeImage,
  retries = 2,
  concurrency = 2,
  retryDelayMs = 250,
  onProgress = () => {}
}) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new TypeError('concurrency must be a positive integer');
  }
  const results = new Array(manifest.length);
  const failures = [];
  let nextIndex = 0;
  let completed = 0;

  const worker = async () => {
    while (nextIndex < manifest.length) {
      const index = nextIndex;
      nextIndex += 1;
      const entry = manifest[index];
      onProgress({ id: entry.id, status: 'loading', completed, total: manifest.length });
      try {
        results[index] = await loadSlot(entry, {
          selectCandidates,
          loadImage,
          retries,
          retryDelayMs
        });
        completed += 1;
        onProgress({
          id: entry.id,
          status: 'ready',
          completed,
          total: manifest.length,
          src: results[index].src,
          result: results[index]
        });
      } catch (error) {
        failures.push({ id: entry.id, error, attempts: error.attempts });
        onProgress({ id: entry.id, status: 'failed', completed, total: manifest.length });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, manifest.length) }, () => worker())
  );
  if (failures.length > 0) throw new CriticalAssetError(failures);
  return results;
}
```

- [ ] **Step 4: Verify and commit the loader**

Run:

```bash
node --test test/unit/assets.test.js test/unit/asset-loader.test.js
git diff --check
```

Expected: PASS with `5` tests; decode rejection and timeout fail; primary derivative calls are exactly three before fallback; all returned entries preserve manifest order.

```bash
git add src/config/assets.js src/media/asset-loader.js test/unit/assets.test.js test/unit/asset-loader.test.js
git commit -m "feat: gate critical covers on decoded images"
```

## Task 6: Replace the Loading Sequence with an Explicit Recoverable Gate

**Files:**
- Create: `src/ui/loading-screen.js`
- Create: `src/app/bootstrap.js`
- Create: `test/unit/loading-screen.test.js`
- Modify: `index.html:20-86,189`
- Modify: `src/main.js:1-8,682-794,892-902`
- Modify: `src/style.css:44,176-353`

- [ ] **Step 1: Write a failing loading-screen state test**

Create `test/unit/loading-screen.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { createLoadingScreen } from '../../src/ui/loading-screen.js';

const markup = `
  <div id="loadingScreen" data-state="loading">
    <output id="loadingProgress">00 / 05</output>
    <p id="loadingCopy"></p>
    <div data-loading-slot="archive-01"></div>
    <button id="loadingRetry" type="button" hidden>重新载入</button>
  </div>`;

test('mounts decoded images and exposes an actionable retry state', () => {
  const dom = new JSDOM(markup);
  const document = dom.window.document;
  const view = createLoadingScreen(document);
  const image = document.createElement('img');
  image.src = 'https://example.test/decoded.webp';

  view.setProgress({
    id: 'archive-01',
    status: 'ready',
    completed: 1,
    total: 5,
    result: { id: 'archive-01', alt: '现有封面', src: image.src, image }
  });
  assert.equal(document.querySelector('#loadingProgress').textContent, '01 / 05');
  assert.equal(document.querySelector('[data-loading-slot] img'), image);
  assert.equal(image.alt, '现有封面');

  let retries = 0;
  view.showError(new Error('archive-01'), () => { retries += 1; });
  assert.equal(document.querySelector('#loadingScreen').dataset.state, 'error');
  assert.equal(document.querySelector('#loadingRetry').hidden, false);
  document.querySelector('#loadingRetry').click();
  assert.equal(retries, 1);
});

test('ignores bubbled child transitions when exiting', async () => {
  const dom = new JSDOM(markup);
  const document = dom.window.document;
  const root = document.querySelector('#loadingScreen');
  const child = document.querySelector('[data-loading-slot]');
  const view = createLoadingScreen(document);
  const transition = (target) => {
    const event = new dom.window.Event('transitionend', { bubbles: true });
    Object.defineProperty(event, 'propertyName', { value: 'opacity' });
    target.dispatchEvent(event);
  };
  const exiting = view.exit('compact');
  transition(child);
  assert.equal(root.isConnected, true);
  transition(root);
  await exiting;
  assert.equal(root.isConnected, false);
});
```

Run: `node --test test/unit/loading-screen.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 2: Replace eager image markup with five empty archive slots**

Replace the contents of `#loadingScreen` in `index.html` with:

```html
<div class="loading-screen" id="loadingScreen" data-state="loading" aria-live="polite">
  <div class="loading-intake">
    <div class="loading-intake-head">
      <span>LIGHT ARCHIVE / INTAKE</span>
      <output id="loadingProgress">00 / 05</output>
    </div>
    <div class="loading-contact-sheet" id="loadingContactSheet">
      <figure class="loading-frame" data-loading-slot="archive-01"><figcaption>AR-01</figcaption></figure>
      <figure class="loading-frame" data-loading-slot="archive-02"><figcaption>AR-02</figcaption></figure>
      <figure class="loading-frame" data-loading-slot="archive-03"><figcaption>AR-03</figcaption></figure>
      <figure class="loading-frame" data-loading-slot="archive-04"><figcaption>AR-04</figcaption></figure>
      <figure class="loading-frame" data-loading-slot="archive-05"><figcaption>AR-05</figcaption></figure>
    </div>
    <p class="loading-copy" id="loadingCopy">影像读取中</p>
    <button class="loading-retry" id="loadingRetry" type="button" hidden>重新载入</button>
  </div>
</div>
```

There must be no `src` attribute inside the loading screen. Set the current CSS defaults `--hero-bg` and `--cover-art-url` to `none` so pseudo-elements cannot bypass loader concurrency with an eager request.

- [ ] **Step 3: Implement the view contract**

Create `src/ui/loading-screen.js`:

```js
const twoDigits = (value) => String(value).padStart(2, '0');

const waitForTransition = (element, {
  propertyName = 'opacity',
  timeoutMs = 900
} = {}) => new Promise((resolve) => {
  let settled = false;
  const finish = (event) => {
    if (event && (event.target !== element || event.propertyName !== propertyName)) return;
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    element.removeEventListener('transitionend', finish);
    resolve();
  };
  const timer = setTimeout(finish, timeoutMs);
  element.addEventListener('transitionend', finish, { once: true });
});

export function createLoadingScreen(documentRef = document) {
  const root = documentRef.querySelector('#loadingScreen');
  const progress = documentRef.querySelector('#loadingProgress');
  const copy = documentRef.querySelector('#loadingCopy');
  const retry = documentRef.querySelector('#loadingRetry');
  const slots = new Map(
    [...root.querySelectorAll('[data-loading-slot]')]
      .map((slot) => [slot.dataset.loadingSlot, slot])
  );
  const mountImage = (result) => {
    const slot = slots.get(result.id);
    slot.querySelector('img')?.remove();
    result.image.alt = result.alt;
    result.image.className = 'loading-image';
    result.image.dataset.assetId = result.id;
    slot.insertBefore(result.image, slot.firstChild);
  };

  return {
    reset() {
      root.dataset.state = 'loading';
      retry.hidden = true;
      retry.onclick = null;
      copy.textContent = '影像读取中';
      progress.textContent = '00 / 05';
      for (const slot of slots.values()) {
        delete slot.dataset.status;
        slot.classList.remove('is-ready', 'is-failed');
        slot.querySelector('img')?.remove();
      }
    },
    setProgress({ id, status, completed, total, result }) {
      progress.textContent = `${twoDigits(completed)} / ${twoDigits(total)}`;
      const slot = slots.get(id);
      if (slot) {
        slot.dataset.status = status;
        slot.classList.toggle('is-ready', status === 'ready');
        slot.classList.toggle('is-failed', status === 'failed');
      }
      if (status === 'ready' && result) mountImage(result);
      if (status === 'ready') copy.textContent = `已归档 ${completed} / ${total}`;
    },
    showError(error, onRetry) {
      root.dataset.state = 'error';
      for (const failure of error.failures || []) {
        const slot = slots.get(failure.id);
        if (slot) {
          slot.dataset.status = 'failed';
          slot.classList.add('is-failed');
        }
      }
      copy.textContent = `影像读取失败：${error.failures?.map(({ id }) => id).join('、') || error.message}`;
      retry.hidden = false;
      retry.onclick = () => {
        this.reset();
        onRetry();
      };
    },
    async playReadySequence(profile) {
      root.dataset.state = 'ready';
      copy.textContent = '档案接入完成';
      if (profile !== 'reduce') await waitForTransition(root, { timeoutMs: 520 });
    },
    async exit(profile) {
      root.classList.add('is-exiting');
      if (profile !== 'reduce') await waitForTransition(root, { timeoutMs: 900 });
      root.remove();
    }
  };
}
```

- [ ] **Step 4: Start the gate at module evaluation, not `window.load`**

Create `src/app/bootstrap.js`:

```js
import { CRITICAL_IMAGE_MANIFEST, selectCriticalImageCandidates } from '../config/assets.js';
import { loadCriticalImages } from '../media/asset-loader.js';
import { createLoadingScreen } from '../ui/loading-screen.js';

export function startCriticalAssetGate({
  documentRef = document,
  viewportWidth = window.innerWidth,
  motionProfile = 'compact',
  load = loadCriticalImages
} = {}) {
  const view = createLoadingScreen(documentRef);
  const appShell = documentRef.querySelector('#appShell');
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });

  const run = async () => {
    view.reset();
    try {
      const results = await load(CRITICAL_IMAGE_MANIFEST, {
        selectCandidates: (asset) => selectCriticalImageCandidates(asset, viewportWidth),
        retries: 2,
        concurrency: 2,
        onProgress: (event) => view.setProgress(event)
      });
      await view.playReadySequence(motionProfile);
      appShell.classList.add('is-ready');
      await view.exit(motionProfile);
      resolveReady(results);
    } catch (error) {
      view.showError(error, () => { void run(); });
    }
  };

  void run();
  return ready;
}
```

At the top of `src/main.js`, immediately after imports, call:

```js
import { startCriticalAssetGate } from './app/bootstrap.js';

startCriticalAssetGate({
  motionProfile: window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'reduce'
    : 'compact'
});
```

Delete `preloadImage`, `runLoadingSequence`, the `window.load` branch, and the old loading-screen `transitionend` remover from `src/main.js:682-794,892-902`.

- [ ] **Step 5: Verify that failure never opens an incomplete player**

Run:

```bash
node --test test/unit/loading-screen.test.js test/unit/assets.test.js test/unit/asset-loader.test.js
npm run build
```

Expected: PASS. Inspect `dist/index.html` and confirm none of the five loading slots has an eager `src` and neither CSS custom property contains a default image URL.

- [ ] **Step 6: Commit the loading gate**

```bash
git add index.html src/main.js src/style.css src/app/bootstrap.js src/ui/loading-screen.js test/unit/loading-screen.test.js
git commit -m "feat: make archive loading decoded and recoverable"
```

## Task 7: Lazy-Render the Playlist and Keep Nodes Stable

**Files:**
- Create: `src/ui/playlist.js`
- Create: `test/unit/playlist.test.js`
- Modify: `src/main.js:1194-1265,1461-1470,1704,1810-1870,2046-2067`
- Modify: `src/style.css:1310-1703,2444-2730`

- [ ] **Step 1: Write a failing first-open/stable-node test**

Create `test/unit/playlist.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { releases, lyricsPool } from '../../src/data.js';
import { createPlaylist } from '../../src/ui/playlist.js';
import { ossImageDerivative } from '../../src/config/assets.js';

test('renders only on first open and updates active rows without rebuilding', () => {
  const dom = new JSDOM('<div id="list"></div>');
  const listEl = dom.window.document.querySelector('#list');
  const playlist = createPlaylist({
    listEl,
    releases,
    tracks: lyricsPool,
    getCoverCandidates: (release) => ({
      src: ossImageDerivative(release.coverOssUrl, 480),
      srcset: `${ossImageDerivative(release.coverOssUrl, 480)} 480w, ${ossImageDerivative(release.coverOssUrl, 960)} 960w`,
      fallback: release.coverOssUrl
    }),
    onSelect: () => {}
  });

  assert.equal(listEl.querySelectorAll('.playlist-item').length, 0);
  playlist.ensureRendered();
  assert.equal(listEl.querySelectorAll('.playlist-item').length, 142);
  const cover = listEl.querySelector('.playlist-cover');
  assert.match(cover.srcset, /480w.*960w/);
  assert.equal(cover.loading, 'lazy');
  const firstNode = listEl.querySelector('.playlist-item');
  playlist.ensureRendered();
  assert.equal(listEl.querySelector('.playlist-item'), firstNode);

  playlist.setActive(4);
  assert.equal(listEl.querySelectorAll('.playlist-item.is-current').length, 1);
  assert.equal(listEl.querySelector('.playlist-item.is-current').dataset.index, '4');
  playlist.setActive(5);
  assert.equal(listEl.querySelector('.playlist-item[data-index="4"]').classList.contains('is-current'), false);
  assert.equal(listEl.querySelector('.playlist-item[data-index="5"]').classList.contains('is-current'), true);
});
```

Run: `node --test test/unit/playlist.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 2: Implement one-time DOM construction and incremental active state**

Create `src/ui/playlist.js`:

```js
import { getTrackKey } from '../data.js';

export function createPlaylist({ listEl, releases, tracks, getCoverCandidates, onSelect }) {
  const trackIndexByKey = new Map(
    tracks.map((track, index) => [getTrackKey(track.album, track), index])
  );
  let rendered = false;
  let activeIndex = -1;

  const ensureRendered = () => {
    if (rendered) return;
    const fragment = listEl.ownerDocument.createDocumentFragment();
    for (const release of releases) {
      const group = listEl.ownerDocument.createElement('section');
      group.className = 'playlist-group';
      group.dataset.release = release.title;

      const heading = listEl.ownerDocument.createElement('div');
      heading.className = 'playlist-group-head';
      const cover = getCoverCandidates(release);
      if (cover?.src) {
        const image = listEl.ownerDocument.createElement('img');
        image.className = 'playlist-cover';
        image.src = cover.src;
        image.srcset = cover.srcset;
        image.sizes = '64px';
        image.alt = '';
        image.loading = 'lazy';
        image.decoding = 'async';
        image.addEventListener('error', () => {
          if (image.src !== cover.fallback) {
            image.srcset = '';
            image.src = cover.fallback;
          }
        }, { once: true });
        heading.append(image);
      }
      const title = listEl.ownerDocument.createElement('span');
      title.textContent = release.title;
      heading.append(title);
      group.append(heading);

      for (const track of release.tracks) {
        const index = trackIndexByKey.get(getTrackKey(release.title, track));
        const button = listEl.ownerDocument.createElement('button');
        button.type = 'button';
        button.className = 'playlist-item';
        button.dataset.index = String(index);
        button.innerHTML = `<span class="playlist-track-no">${String(track.trackNumber).padStart(2, '0')}</span><span class="playlist-track-name"></span>`;
        button.querySelector('.playlist-track-name').textContent = track.title;
        group.append(button);
      }
      fragment.append(group);
    }
    listEl.append(fragment);
    rendered = true;
  };

  const setActive = (index) => {
    if (!rendered || index === activeIndex) return;
    listEl.querySelector(`[data-index="${activeIndex}"]`)?.classList.remove('is-current');
    listEl.querySelector(`[data-index="${index}"]`)?.classList.add('is-current');
    activeIndex = index;
  };

  const handleClick = (event) => {
    const item = event.target.closest('.playlist-item');
    if (item) onSelect(Number(item.dataset.index));
  };
  listEl.addEventListener('click', handleClick);

  return {
    ensureRendered,
    setActive,
    get rendered() { return rendered; },
    destroy() { listEl.removeEventListener('click', handleClick); }
  };
}
```

- [ ] **Step 3: Wire first-open rendering and remove full re-renders**

Create the controller once during bootstrap, but do not call `ensureRendered()`:

```js
import { ossImageDerivative } from './config/assets.js';

const playlist = createPlaylist({
  listEl: playlistList,
  releases,
  tracks: lyricsPool,
  getCoverCandidates: (release) => ({
    src: ossImageDerivative(release.coverOssUrl, 480),
    srcset: `${ossImageDerivative(release.coverOssUrl, 480)} 480w, ${ossImageDerivative(release.coverOssUrl, 960)} 960w`,
    fallback: release.coverOssUrl
  }),
  onSelect: (index) => switchToTrackWithTransition(index, { stopDuration: 320 })
});

const updatePlaylistActiveTrack = (index) => playlist.setActive(index);
```

In `updateCurrentLyric`, replace only its final `renderPlaylist();` statement with:

```js
updatePlaylistActiveTrack(index);
```

Replace the playlist button handler with:

```js
playlistToggleBtn.addEventListener('click', () => {
  if (isDrawing || currentLyricIndex === -1) return;
  playlist.ensureRendered();
  playlist.setActive(currentLyricIndex);
  setFloatingButtonsVisible(false);
  animatePlaylistIn();
});
```

Delete the old `renderPlaylist()` function, its startup call at `src/main.js:1704`, the duplicate list click handler, and every track-change full rebuild. For full motion, animate only rows intersecting the playlist viewport; for compact/reduce, animate only `.playlist-content`.

- [ ] **Step 4: Remove persistent playlist compositor hints**

Delete permanent `will-change` from `.playlist-item`, `.playlist-content`, and hidden playlist pseudo-elements. Add it only through the motion helper immediately before a transition; Task 10 removes it on settlement. Remove mobile `.playlist-area::before` animation at current `src/style.css:2494-2499` now, so this commit fixes the highest-confidence regression before the broader redesign.

- [ ] **Step 5: Verify and commit lazy rendering**

Run:

```bash
node --test test/unit/playlist.test.js test/unit/library.test.js
npm run build
```

Expected: PASS; before first playlist open the DOM contains `0` `.playlist-item` nodes; first open creates `142`; later opens preserve node identity.

```bash
git add src/ui/playlist.js src/main.js src/style.css test/unit/playlist.test.js
git commit -m "perf: lazy render the archive playlist"
```

## Task 8: Mirror Existing Release Covers and Verify OSS Metadata

**Files:**
- Create: `ops/cover-sources.json`
- Create: `src/data/cover-map.js`
- Create: `scripts/media/build-cover-plan.mjs`
- Create: `scripts/media/mirror-covers.mjs`
- Create: `scripts/media/apply-metadata.mjs`
- Create: `scripts/media/verify-oss.mjs`
- Create: `test/unit/media-policy.test.js`
- Modify: `src/data/releases.js`
- Modify: `package.json`
- Modify: `MUSIC_AUDIO_MANIFEST.md`
- Modify: `MUSIC_LIBRARY_AUDIT.md`

- [ ] **Step 1: Write failing runtime-origin and metadata-policy tests**

Create `test/unit/media-policy.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { lyricsPool, releases } from '../../src/data.js';
import {
  readRequiredContentLength,
  validateMediaResponse
} from '../../scripts/media/verify-oss.mjs';

test('runtime releases use OSS covers only', () => {
  assert.equal(releases.length, 23);
  for (const release of releases) {
    assert.match(
      release.coverOssUrl,
      /^https:\/\/[^/]+\.oss-cn-hangzhou\.aliyuncs\.com\//
    );
    assert.equal('sourceArtworkUrl' in release, false);
  }
});

test('accepts inline immutable images and ranged audio', () => {
  assert.doesNotThrow(() => validateMediaResponse({
    kind: 'image',
    status: 200,
    immutable: true,
    headers: new Headers({
      'content-type': 'image/jpeg',
      'content-disposition': 'inline',
      'cache-control': 'public, max-age=31536000, immutable'
    })
  }));
  assert.doesNotThrow(() => validateMediaResponse({
    kind: 'audio',
    status: 206,
    headers: new Headers({
      'content-type': 'audio/mpeg',
      'content-disposition': 'inline',
      'content-range': 'bytes 0-0/1000'
    })
  }));
});

test('rejects forced downloads and audio without byte ranges', () => {
  assert.throws(() => validateMediaResponse({
    kind: 'image',
    status: 200,
    headers: new Headers({
      'content-type': 'image/jpeg',
      'content-disposition': 'attachment'
    })
  }), /inline/);
  assert.throws(() => validateMediaResponse({
    kind: 'audio',
    status: 200,
    headers: new Headers({ 'content-type': 'audio/mpeg' })
  }), /206/);
  assert.throws(() => readRequiredContentLength(new Headers()), /Content-Length/);
});

test('keeps every production audio URL on the approved OSS origin', () => {
  assert.equal(lyricsPool.length, 142);
  for (const track of lyricsPool) {
    assert.equal(new URL(track.musicOssUrl).origin, 'https://yuko-vinyl.oss-cn-hangzhou.aliyuncs.com');
  }
});
```

Run: `node --test test/unit/media-policy.test.js`

Expected: FAIL because 22 releases have empty `coverOssUrl`, runtime releases expose Apple `sourceArtworkUrl`, and `verify-oss.mjs` does not exist.

- [ ] **Step 2: Generate and freeze the existing 23-cover migration input**

Create `scripts/media/build-cover-plan.mjs` before removing `sourceArtworkUrl` from runtime data:

```js
import { readFile, writeFile } from 'node:fs/promises';

import { releases } from '../../src/data.js';

const planUrl = new URL('../../ops/cover-sources.json', import.meta.url);
const mapUrl = new URL('../../src/data/cover-map.js', import.meta.url);
const version = '2026-07';
const runtimeOrigin = 'https://yuko-vinyl.oss-cn-hangzhou.aliyuncs.com/';
let plan;

await mkdir(new URL('../../ops/', import.meta.url), { recursive: true });

try {
  plan = JSON.parse(await readFile(planUrl, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const sourceReleases = releases.filter(({ sourceArtworkUrl }) => (
    sourceArtworkUrl && new URL(sourceArtworkUrl).origin === 'https://is1-ssl.mzstatic.com'
  ));
  if (sourceReleases.length !== 22) {
    throw new Error(`Expected 22 existing external covers, found ${sourceReleases.length}`);
  }
  const liveRelease = releases.find(({ title }) => title === '万兽之王演唱会录音');
  plan = {
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
  await writeFile(planUrl, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
}

if (plan.version !== version || plan.items.length !== 23) {
  throw new Error('Cover migration plan must contain 23 items for version 2026-07');
}
const coverMap = Object.fromEntries(plan.items.map(({ releaseTitle, targetKey }) => [
  releaseTitle,
  new URL(targetKey, runtimeOrigin).href
]));
await writeFile(
  mapUrl,
  `export const releaseCoverOssByTitle = Object.freeze(${JSON.stringify(coverMap, null, 2)});\n`,
  'utf8'
);
console.log(`generated ${plan.items.length} mirror entries and ${Object.keys(coverMap).length} runtime covers`);
```

Run: `node scripts/media/build-cover-plan.mjs`

Expected: `generated 23 mirror entries and 23 runtime covers`. Review the diff to confirm the inputs are exactly the 22 current Apple release covers plus the existing OSS `cover/1.jpg` used by `万兽之王演唱会录音`; neither generated file may introduce another source or a searched reference image.

- [ ] **Step 3: Implement safe-by-default cover mirroring**

Create `scripts/media/mirror-covers.mjs`:

```js
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
const targetPrefix = `covers/releases/v${plan.version}/`;

for (const item of plan.items) {
  if (!allowedSources.has(new URL(item.sourceUrl).origin)) throw new Error(`Unapproved source: ${item.sourceUrl}`);
  if (!item.targetKey.startsWith(targetPrefix) || item.targetKey.includes('..')) {
    throw new Error(`Unapproved target: ${item.targetKey}`);
  }
}

if (!apply) {
  console.log(JSON.stringify({ mode: 'dry-run', count: plan.items.length, targets: plan.items.map(({ targetKey }) => targetKey) }, null, 2));
  process.exit(0);
}

const required = ['OSS_REGION', 'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET', 'OSS_COVER_BUCKET'];
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
  if (!response.ok) throw new Error(`Download failed ${response.status}: ${item.releaseTitle}`);
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
```

No credential value may be printed or stored in the repository. Dry-run must be the default; `--apply` is an explicit owner-authorized remote write.

- [ ] **Step 4: Correct existing loading-image and audio metadata safely**

Create `scripts/media/apply-metadata.mjs`:

```js
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
```

This server-side self-copy changes headers without downloading media. It defaults to dry-run; do not run `--apply` without the owner-provided credentials and bucket names.

- [ ] **Step 5: Implement remote response verification and critical-image budget checks**

Create `scripts/media/verify-oss.mjs`:

```js
import { pathToFileURL } from 'node:url';
import { lyricsPool, releases } from '../../src/data.js';
import { CRITICAL_IMAGE_MANIFEST } from '../../src/config/assets.js';

export function validateMediaResponse({ kind, status, headers, immutable = false }) {
  const disposition = headers.get('content-disposition') || '';
  const type = headers.get('content-type') || '';
  if (/attachment/i.test(disposition) || !/inline/i.test(disposition)) {
    throw new Error(`${kind} Content-Disposition must be inline`);
  }
  if (kind === 'image') {
    if (status !== 200 || !/^image\//i.test(type)) throw new Error('Image must return 200 with an image Content-Type');
    if (immutable && (!/max-age=31536000/i.test(headers.get('cache-control') || '') || !/immutable/i.test(headers.get('cache-control') || ''))) {
      throw new Error('Versioned image cache policy must be immutable for one year');
    }
  }
  if (kind === 'audio') {
    if (status !== 206) throw new Error('Audio Range request must return 206');
    if (!/^audio\/mpeg/i.test(type)) throw new Error('Audio Content-Type must be audio/mpeg');
    if (!/^bytes 0-0\/\d+$/i.test(headers.get('content-range') || '')) {
      throw new Error('Audio response must include Content-Range');
    }
  }
}

export function readRequiredContentLength(headers) {
  const bytes = Number(headers.get('content-length'));
  if (!Number.isInteger(bytes) || bytes <= 0) {
    throw new Error('Critical derivative requires a positive Content-Length');
  }
  return bytes;
}

export async function verifyAllMedia({ fetchImpl = fetch } = {}) {
  const images = [
    ...releases.map(({ title, coverOssUrl }) => ({ title, url: coverOssUrl, immutable: true })),
    ...CRITICAL_IMAGE_MANIFEST.map(({ id, source }) => ({ title: id, url: source, immutable: false }))
  ];
  const audio = [...new Map(lyricsPool.map((track) => [track.musicOssUrl, track])).values()];
  const failures = [];
  let criticalMobileBytes = 0;

  for (const image of images) {
    try {
      const response = await fetchImpl(image.url, { method: 'HEAD', signal: AbortSignal.timeout(12000) });
      validateMediaResponse({ kind: 'image', status: response.status, headers: response.headers, immutable: image.immutable });
    } catch (error) {
      failures.push({ kind: 'image', id: image.title, message: error.message });
    }
  }
  for (const asset of CRITICAL_IMAGE_MANIFEST) {
    try {
      let response = await fetchImpl(asset.mobile, { method: 'HEAD', signal: AbortSignal.timeout(12000) });
      let headBytes = 0;
      if (response.status === 200) {
        validateMediaResponse({ kind: 'image', status: response.status, headers: response.headers });
        try { headBytes = readRequiredContentLength(response.headers); } catch {}
      }
      if (headBytes > 0) {
        criticalMobileBytes += headBytes;
      } else {
        response = await fetchImpl(asset.mobile, { signal: AbortSignal.timeout(12000) });
        validateMediaResponse({ kind: 'image', status: response.status, headers: response.headers });
        const bytes = (await response.arrayBuffer()).byteLength;
        if (bytes <= 0) throw new Error('Critical derivative returned an empty body');
        criticalMobileBytes += bytes;
      }
    } catch (error) {
      failures.push({ kind: 'critical-size', id: asset.id, message: error.message });
    }
  }
  if (criticalMobileBytes > 1.2 * 1024 * 1024) {
    failures.push({ kind: 'critical-size', id: 'total', message: `${criticalMobileBytes} bytes exceeds 1.2 MiB` });
  }
  for (const track of audio) {
    try {
      const response = await fetchImpl(track.musicOssUrl, {
        headers: { Range: 'bytes=0-0' },
        signal: AbortSignal.timeout(12000)
      });
      validateMediaResponse({ kind: 'audio', status: response.status, headers: response.headers });
    } catch (error) {
      failures.push({ kind: 'audio', id: track.title, message: error.message });
    }
  }
  if (failures.length > 0) throw new Error(JSON.stringify(failures, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifyAllMedia();
  console.log(`verified ${releases.length + CRITICAL_IMAGE_MANIFEST.length} images and ${new Set(lyricsPool.map(({ musicOssUrl }) => musicOssUrl)).size} audio objects`);
}
```

- [ ] **Step 6: Upload, repair metadata, verify, then switch runtime data**

Run the non-mutating check first:

```bash
node scripts/media/mirror-covers.mjs
```

Expected: JSON reports `mode: dry-run` and `count: 23`.

With owner-provided OSS environment variables, run:

```bash
node scripts/media/mirror-covers.mjs --apply
```

Expected: exactly 23 `uploaded covers/releases/v2026-07/NNN.jpg` lines. If credentials are absent, stop at dry-run and report the external deployment gate; do not claim that metadata is fixed.

Run metadata dry-run, then the authorized write:

```bash
node scripts/media/apply-metadata.mjs
node scripts/media/apply-metadata.mjs --apply
```

Expected: dry-run reports `136` objects (`5` loading sources plus `131` unique audio objects); apply reports one updated object per line. This is the step that changes the five current `attachment` responses and production audio metadata to `inline`.

Only after upload succeeds, import `releaseCoverOssByTitle` in `src/data/releases.js`, set `coverOssUrl` from that map, delete runtime `sourceArtworkUrl` properties, and remove every fallback to `sourceArtworkUrl` from `src/main.js`. Add scripts:

```json
{
  "media:mirror": "node scripts/media/mirror-covers.mjs",
  "media:mirror:apply": "node scripts/media/mirror-covers.mjs --apply",
  "media:metadata": "node scripts/media/apply-metadata.mjs",
  "media:metadata:apply": "node scripts/media/apply-metadata.mjs --apply",
  "media:verify": "node scripts/media/verify-oss.mjs"
}
```

Run:

```bash
npm run media:verify
npm run audit
npm run audit:check
node --test test/unit/media-policy.test.js
```

Expected: `verified 28 images and 131 audio objects`; mobile critical derivatives total at most `1.2 MiB`; audits report `0` missing OSS covers and `0` missing audio URLs.

- [ ] **Step 7: Commit media policy and runtime origin cleanup**

```bash
git add ops/cover-sources.json src/data/cover-map.js src/data/releases.js src/main.js scripts/media/build-cover-plan.mjs scripts/media/mirror-covers.mjs scripts/media/apply-metadata.mjs scripts/media/verify-oss.mjs test/unit/media-policy.test.js package.json package-lock.json MUSIC_AUDIO_MANIFEST.md MUSIC_LIBRARY_AUDIT.md
git commit -m "feat: move release artwork to verified OSS media"
```

## Task 9: Extract Audio State and Show Playback Retry

**Files:**
- Create: `src/player/audio-controller.js`
- Create: `test/unit/audio-controller.test.js`
- Modify: `index.html:129-148`
- Modify: `src/main.js:75-84,271-620,1485-1503,1594-1700`
- Modify: `src/style.css`

- [ ] **Step 1: Write failing state/retry tests**

Create `test/unit/audio-controller.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createAudioController } from '../../src/player/audio-controller.js';

class FakeAudio extends EventEmitter {
  constructor() {
    super();
    this.paused = true;
    this.currentTime = 0;
    this.duration = 100;
    this.src = '';
    this.pauseCalls = 0;
  }
  addEventListener(name, fn) { this.on(name, fn); }
  removeEventListener(name, fn) { this.off(name, fn); }
  setAttribute() {}
  load() {}
  pause() { this.pauseCalls += 1; this.paused = true; this.emit('pause'); }
  async play() { this.paused = false; this.emit('play'); }
}

test('does not report playing until play resolves', async () => {
  const audio = new FakeAudio();
  let resolvePlay;
  audio.play = () => {
    audio.emit('play');
    return new Promise((resolve) => { resolvePlay = resolve; });
  };
  const states = [];
  const controller = createAudioController({ audio, onStateChange: (state) => states.push(state.status) });
  await controller.load({ title: '媚人', musicOssUrl: 'https://example.test/meiren.mp3' });
  const pending = controller.play();
  assert.equal(states.at(-1), 'loading');
  resolvePlay();
  await pending;
  assert.equal(states.at(-1), 'playing');
});

test('surfaces play rejection and retries the selected source', async () => {
  const audio = new FakeAudio();
  let attempts = 0;
  audio.play = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('autoplay denied');
  };
  const states = [];
  const controller = createAudioController({ audio, onStateChange: (state) => states.push(state) });
  await controller.load({ title: '媚人', musicOssUrl: 'https://example.test/meiren.mp3' });
  await assert.rejects(controller.play(), /autoplay denied/);
  assert.equal(states.at(-1).status, 'error');
  assert.equal(audio.pauseCalls, 1);
  await controller.retry();
  assert.equal(attempts, 2);
  assert.equal(states.at(-1).status, 'playing');
});

test('seeks by a clamped fraction', async () => {
  const audio = new FakeAudio();
  const controller = createAudioController({ audio });
  await controller.load({ title: '媚人', musicOssUrl: 'https://example.test/meiren.mp3' });
  controller.seekToFraction(1.4);
  assert.equal(audio.currentTime, 100);
});

test('pauses and publishes error when the media element fails', async () => {
  const audio = new FakeAudio();
  const states = [];
  const controller = createAudioController({ audio, onStateChange: (state) => states.push(state) });
  await controller.load({ title: '媚人', musicOssUrl: 'https://example.test/meiren.mp3' });
  audio.emit('error');
  assert.equal(audio.pauseCalls, 1);
  assert.equal(states.at(-1).status, 'error');
});
```

Run: `node --test test/unit/audio-controller.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 2: Implement the controller around one audio element**

Create `src/player/audio-controller.js`:

```js
export function createAudioController({
  audio,
  onStateChange = () => {},
  onEnded = () => {},
  onTimeUpdate = () => {},
  mediaSession = typeof navigator !== 'undefined' ? navigator.mediaSession : null
}) {
  let track = null;
  let requestId = 0;
  let status = 'idle';
  let error = null;

  const publish = () => onStateChange({ status, error, track });
  const setStatus = (next, nextError = null) => {
    status = next;
    error = nextError;
    publish();
  };
  const onError = () => {
    audio.pause();
    setStatus('error', new Error(`Audio failed: ${track?.title || 'unknown'}`));
  };
  const onPlay = () => { if (status !== 'loading') setStatus('playing'); };
  const onPause = () => { if (status !== 'error') setStatus('paused'); };
  const handleEnded = () => onEnded(track);
  const handleTimeUpdate = () => onTimeUpdate({
    currentTime: audio.currentTime,
    duration: audio.duration,
    track
  });
  audio.addEventListener('error', onError);
  audio.addEventListener('play', onPlay);
  audio.addEventListener('pause', onPause);
  audio.addEventListener('ended', handleEnded);
  audio.addEventListener('timeupdate', handleTimeUpdate);
  audio.preload = 'metadata';
  audio.setAttribute('playsinline', '');

  const load = async (nextTrack) => {
    const id = ++requestId;
    track = nextTrack;
    if (!nextTrack?.musicOssUrl) {
      const nextError = new Error(`Missing audio URL: ${nextTrack?.title || 'unknown'}`);
      setStatus('error', nextError);
      throw nextError;
    }
    setStatus('loading');
    audio.src = nextTrack.musicOssUrl;
    audio.load();
    if (id !== requestId) return false;
    if (mediaSession) {
      mediaSession.metadata = new MediaMetadata({
        title: nextTrack.title,
        artist: nextTrack.artist || '薛之谦',
        album: nextTrack.album
      });
    }
    setStatus('ready');
    return true;
  };

  const play = async ({ signal } = {}) => {
    if (!track) throw new Error('No audio track is loaded');
    if (signal?.aborted) return false;
    setStatus('loading');
    let abort;
    const aborted = new Promise((resolve) => {
      abort = () => resolve({ aborted: true });
      signal?.addEventListener('abort', abort, { once: true });
    });
    const attempt = Promise.resolve(audio.play()).then(
      () => ({ played: true }),
      (playError) => ({ playError })
    );
    try {
      const result = signal ? await Promise.race([attempt, aborted]) : await attempt;
      if (result.aborted) {
        audio.pause();
        setStatus('paused');
        return false;
      }
      if (result.playError) throw result.playError;
      setStatus('playing');
      return true;
    } catch (nextError) {
      audio.pause();
      setStatus('error', nextError);
      throw nextError;
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  };

  const bindMediaActions = ({ nextTrack, previousTrack }) => {
    if (!mediaSession?.setActionHandler) return;
    const actions = {
      play: () => { void play(); },
      pause: () => audio.pause(),
      nexttrack: nextTrack,
      previoustrack: previousTrack,
      seekto: ({ seekTime, fastSeek }) => {
        if (!Number.isFinite(seekTime)) return;
        if (fastSeek && typeof audio.fastSeek === 'function') audio.fastSeek(seekTime);
        else audio.currentTime = Math.max(0, Math.min(audio.duration || seekTime, seekTime));
      },
      seekforward: ({ seekOffset = 10 }) => {
        audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + seekOffset);
      },
      seekbackward: ({ seekOffset = 10 }) => {
        audio.currentTime = Math.max(0, audio.currentTime - seekOffset);
      }
    };
    for (const [name, handler] of Object.entries(actions)) {
      try { mediaSession.setActionHandler(name, handler); } catch {}
    }
  };

  return {
    load,
    play,
    pause() { audio.pause(); },
    async retry() {
      if (!track) throw new Error('No audio track is loaded');
      audio.load();
      await play();
    },
    seekToFraction(fraction) {
      if (!Number.isFinite(audio.duration)) return;
      audio.currentTime = Math.max(0, Math.min(1, fraction)) * audio.duration;
    },
    bindMediaActions,
    getState() { return { status, error, track }; },
    destroy() {
      requestId += 1;
      audio.removeEventListener('error', onError);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.pause();
    }
  };
}
```

- [ ] **Step 3: Add the visible paused/error command**

Add next to `.player-pill` in `index.html`:

```html
<div class="audio-status" id="audioStatus" role="status" hidden>
  <span id="audioStatusText">音频加载失败</span>
  <button class="audio-retry" id="audioRetry" type="button">重新加载</button>
</div>
```

Wire the state and retry command with this concrete block in the current composition module:

```js
const audioStatus = document.getElementById('audioStatus');
const audioStatusText = document.getElementById('audioStatusText');
const audioRetry = document.getElementById('audioRetry');
const renderAudioState = ({ status, error }) => {
  const failed = status === 'error';
  audioStatus.hidden = !failed;
  audioStatusText.textContent = failed ? `音频加载失败：${error.message}` : '';
  audioRetry.disabled = status === 'loading';
  dynamicIsland.setAttribute('aria-busy', String(status === 'loading'));
  document.body.dataset.audioState = status;
};
const audioController = createAudioController({
  audio: audioEl,
  onStateChange: renderAudioState,
  onEnded: () => { void handleTrackEnded(); },
  onTimeUpdate: ({ currentTime, duration }) => {
    if (!Number.isFinite(duration) || duration <= 0) return;
    trackFill.style.width = `${(currentTime / duration) * 100}%`;
    playerTime.textContent = formatAudioTime(currentTime);
  }
});
audioRetry.addEventListener('click', async () => {
  audioRetry.disabled = true;
  try { await audioController.retry(); }
  finally { audioRetry.disabled = false; }
});
```

A failed play leaves the tonearm/record in the paused state until `play()` resolves.

- [ ] **Step 4: Move existing Media Session, seek, ended, and time-update handlers**

Delete the old duplicate audio listeners at `src/main.js:271-620,1594-1700`, then bind the remaining controls exactly once:

```js
playerToggleBtn.addEventListener('click', () => {
  if (audioController.getState().status === 'playing') audioController.pause();
  else void audioController.play();
});
let isSeeking = false;
const seekFromPointer = (event) => {
  const rect = trackWrap.getBoundingClientRect();
  audioController.seekToFraction((event.clientX - rect.left) / rect.width);
};
trackWrap.addEventListener('pointerdown', (event) => {
  isSeeking = true;
  trackWrap.setPointerCapture(event.pointerId);
  seekFromPointer(event);
});
trackWrap.addEventListener('pointermove', (event) => {
  if (isSeeking) seekFromPointer(event);
});
trackWrap.addEventListener('pointerup', (event) => {
  isSeeking = false;
  trackWrap.releasePointerCapture(event.pointerId);
});
trackWrap.addEventListener('pointercancel', () => { isSeeking = false; });
audioController.bindMediaActions({
  nextTrack: () => { void switchToTrackWithTransition(pickNextAutoLyricIndex()); },
  previousTrack: () => { void switchToTrackWithTransition(pickPreviousLyricIndex()); }
});
```

Delete the old audio-element listeners and mouse/touch seek duplication; the pointer handlers above cover mouse, touch, and pen. Keep source selection based only on `musicOssUrl`; remove the local `/music` rewrite from production behavior. `requestId` remains checked before each asynchronous `load()` publication so a stale selection cannot overwrite the current track.

- [ ] **Step 5: Verify and commit audio recovery**

Run:

```bash
node --test test/unit/audio-controller.test.js
npm run build
```

Expected: PASS with `4` tests; rejected playback and media-element errors pause the player, display `重新加载`, and a successful retry returns to `playing`.

```bash
git add src/player/audio-controller.js src/main.js index.html src/style.css test/unit/audio-controller.test.js
git commit -m "feat: expose recoverable audio playback state"
```

## Task 10: Centralize Motion Profiles and Cancellable Timelines

**Files:**
- Create: `src/motion/motion-controller.js`
- Create: `src/app/transitions.js`
- Create: `test/unit/motion-controller.test.js`
- Modify: `src/main.js:648-680,927-1010,1153-1192,1505-2003,2069-2187`

- [ ] **Step 1: Write failing profile, ordering, and cancellation tests**

Create `test/unit/motion-controller.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMotionController,
  detectMotionProfile,
  tweenWithCleanup
} from '../../src/motion/motion-controller.js';

const media = (reduce, coarse) => (query) => ({
  matches: query.includes('reduced-motion') ? reduce : coarse
});

test('selects reduce first, compact for coarse/mobile, and full for desktop', () => {
  assert.equal(detectMotionProfile({ matchMedia: media(true, false), userAgent: '' }), 'reduce');
  assert.equal(detectMotionProfile({ matchMedia: media(false, true), userAgent: '' }), 'compact');
  assert.equal(detectMotionProfile({ matchMedia: media(false, false), userAgent: 'MicroMessenger iPhone' }), 'compact');
  assert.equal(detectMotionProfile({ matchMedia: media(false, false), userAgent: 'Desktop Chrome' }), 'full');
});

test('runs one transition at a time and settles the interrupted promise', async () => {
  const events = [];
  const transitions = {
    draw: ({ signal }) => new Promise((resolve) => {
      events.push('draw:start');
      signal.addEventListener('abort', () => {
        events.push('draw:abort');
        setImmediate(() => {
          events.push('draw:cleanup');
          resolve();
        });
      }, { once: true });
    }),
    openOverlay: async ({ kind }) => { events.push(`open:${kind}`); }
  };
  const motion = createMotionController({ profile: 'compact', transitions });
  const draw = motion.draw(3);
  const open = motion.openOverlay('playlist');
  assert.deepEqual(await draw, { status: 'cancelled', name: 'draw' });
  assert.deepEqual(await open, { status: 'completed', name: 'open:playlist' });
  assert.deepEqual(events, ['draw:start', 'draw:abort', 'draw:cleanup', 'open:playlist']);
});

test('pauses decorative motion when the document becomes hidden', async () => {
  const visibility = [];
  const motion = createMotionController({
    profile: 'full',
    transitions: { setDocumentVisible: (visible) => visibility.push(visible) }
  });
  motion.setDocumentVisible(false);
  motion.setDocumentVisible(true);
  assert.deepEqual(visibility, [false, true]);
});

test('settles an aborted numeric tween', async () => {
  const controller = new AbortController();
  const frames = [];
  const tween = tweenWithCleanup({
    from: 0,
    to: 1,
    duration: 100,
    easing: (value) => value,
    render: () => {},
    signal: controller.signal,
    requestFrame: (callback) => { frames.push(callback); return frames.length; },
    cancelFrame: () => {}
  });
  controller.abort();
  assert.deepEqual(await tween, { status: 'cancelled' });
});
```

Run: `node --test test/unit/motion-controller.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 2: Implement exclusive transition ownership**

Create `src/motion/motion-controller.js`:

```js
export const MOTION_TOKENS = Object.freeze({
  full: Object.freeze({ enter: 520, move: 900, settle: 720, itemStagger: 16 }),
  compact: Object.freeze({ enter: 260, move: 420, settle: 320, itemStagger: 0 }),
  reduce: Object.freeze({ enter: 0, move: 0, settle: 0, itemStagger: 0 })
});

export function detectMotionProfile({
  matchMedia = window.matchMedia.bind(window),
  userAgent = navigator.userAgent
} = {}) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return 'reduce';
  if (matchMedia('(hover: none) and (pointer: coarse)').matches) return 'compact';
  if (/Android|iPhone|iPad|iPod|MicroMessenger|Mobile/i.test(userAgent)) return 'compact';
  return 'full';
}

export function createMotionController({ profile, transitions }) {
  if (!MOTION_TOKENS[profile]) throw new TypeError(`Unknown motion profile: ${profile}`);
  let active = null;
  let latestRequestId = 0;

  const runExclusive = async (name, task) => {
    const requestId = ++latestRequestId;
    const previous = active;
    previous?.controller.abort(`superseded by ${name}`);
    if (previous) await previous.settled;
    if (requestId !== latestRequestId) return { status: 'cancelled', name };

    const controller = new AbortController();
    const record = { name, controller, settled: null };
    active = record;
    record.settled = (async () => {
      try {
        await task({ signal: controller.signal, profile, tokens: MOTION_TOKENS[profile] });
        return controller.signal.aborted
          ? { status: 'cancelled', name }
          : { status: 'completed', name };
      } catch (error) {
        if (controller.signal.aborted) return { status: 'cancelled', name };
        throw error;
      } finally {
        if (active === record) active = null;
      }
    })();
    return record.settled;
  };

  return {
    profile,
    draw: (targetIndex) => runExclusive('draw', (context) => transitions.draw({ ...context, targetIndex })),
    switchTrack: (targetIndex, options = {}) => runExclusive(
      'switch-track',
      (context) => transitions.switchTrack({ ...context, targetIndex, ...options })
    ),
    openOverlay: (kind) => runExclusive(
      `open:${kind}`,
      (context) => transitions.openOverlay({ ...context, kind })
    ),
    closeOverlay: (kind) => runExclusive(
      `close:${kind}`,
      (context) => transitions.closeOverlay({ ...context, kind })
    ),
    setDocumentVisible(visible) {
      if (!visible) active?.controller.abort('document hidden');
      transitions.setDocumentVisible?.(visible);
    },
    cancel(reason = 'cancelled') {
      const pending = active?.settled || Promise.resolve();
      active?.controller.abort(reason);
      return pending;
    },
    async dispose() {
      const pending = active?.settled;
      active?.controller.abort('disposed');
      if (pending) await pending;
      transitions.dispose?.();
      active = null;
    }
  };
}

export async function animateWithCleanup(element, keyframes, options, signal) {
  if (signal.aborted) return;
  element.dataset.motionActive = '';
  const animation = element.animate(keyframes, options);
  const cancel = () => animation.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    await animation.finished;
  } catch (error) {
    if (!signal.aborted) throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
    animation.cancel();
    delete element.dataset.motionActive;
  }
}

export function tweenWithCleanup({
  from,
  to,
  duration,
  easing,
  render,
  signal,
  requestFrame = requestAnimationFrame,
  cancelFrame = cancelAnimationFrame
}) {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve({ status: 'cancelled' });
      return;
    }
    if (duration === 0) {
      render(to);
      resolve({ status: 'completed' });
      return;
    }
    let frameId = 0;
    let startedAt = null;
    let settled = false;
    const finish = (status) => {
      if (settled) return;
      settled = true;
      cancelFrame(frameId);
      signal.removeEventListener('abort', abort);
      resolve({ status });
    };
    const abort = () => finish('cancelled');
    const frame = (time) => {
      if (startedAt === null) startedAt = time;
      const progress = Math.min(1, (time - startedAt) / duration);
      render(from + (to - from) * easing(progress));
      if (progress === 1) finish('completed');
      else frameId = requestFrame(frame);
    };
    signal.addEventListener('abort', abort, { once: true });
    frameId = requestFrame(frame);
  });
}
```

- [ ] **Step 3: Define completion-driven application transitions**

Create `src/app/transitions.js`:

```js
export function createAppTransitions({
  turntable,
  overlays,
  controls,
  audio,
  selectTrack
}) {
  const assertActive = (signal) => {
    if (signal.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
  };

  return {
    async draw({ signal, targetIndex, tokens }) {
      await overlays.closeAll({ signal, duration: tokens.enter });
      assertActive(signal);
      const current = turntable.readState();
      turntable.setSpinning(true);
      await Promise.all([
        controls.setLabel('读取中', { signal, duration: tokens.enter }),
        turntable.moveArmTo('rest', { signal, duration: tokens.move, from: current.arm }),
        turntable.rampRateTo(5.2, { signal, duration: tokens.move, from: current.rate })
      ]);
      assertActive(signal);
      const track = await selectTrack(targetIndex, { signal });
      await audio.load(track);
      await Promise.all([
        turntable.moveArmTo('play', { signal, duration: tokens.settle }),
        turntable.rampRateTo(0.68, { signal, duration: tokens.settle })
      ]);
      assertActive(signal);
      await overlays.open('lyrics', { signal, duration: tokens.enter });
      try {
        await audio.play({ signal });
      } catch (error) {
        await Promise.all([
          turntable.moveArmTo('rest', { signal, duration: tokens.enter }),
          turntable.rampRateTo(0, { signal, duration: tokens.settle })
        ]);
        turntable.setSpinning(false);
        throw error;
      }
      assertActive(signal);
      await controls.setLabel('再次抽取', { signal, duration: tokens.enter });
    },
    async switchTrack({ signal, targetIndex, tokens, headless = false }) {
      audio.pause();
      assertActive(signal);
      const track = await selectTrack(targetIndex, { signal });
      await audio.load(track);
      if (!headless) await overlays.refresh({ signal, duration: tokens.enter });
      try {
        await audio.play({ signal });
      } catch (error) {
        await Promise.all([
          turntable.moveArmTo('rest', { signal, duration: tokens.enter }),
          turntable.rampRateTo(0, { signal, duration: tokens.settle })
        ]);
        turntable.setSpinning(false);
        throw error;
      }
      assertActive(signal);
    },
    openOverlay: ({ signal, kind, tokens }) => overlays.open(kind, { signal, duration: tokens.enter }),
    closeOverlay: ({ signal, kind, tokens }) => overlays.close(kind, { signal, duration: tokens.enter }),
    setDocumentVisible(visible) {
      turntable.setDocumentVisible(visible);
      overlays.setDocumentVisible(visible);
    },
    dispose() {
      turntable.dispose();
      overlays.dispose();
    }
  };
}
```

Every adapter method above must return a Promise that settles on completion or abort. `turntable.readState()` reads computed arm angle and current playback rate once at interruption; it must not reuse stale cached values.

- [ ] **Step 4: Replace blind waits and independent overlay animations**

Replace the old overlay/tween functions with these adapters in the current composition module:

```js
import {
  animateWithCleanup,
  createMotionController,
  detectMotionProfile,
  tweenWithCleanup
} from './motion/motion-controller.js';
import { createAppTransitions } from './app/transitions.js';

const turntableController = {
  readState() {
    return { arm: getCurrentArmAngle(), rate: spinAnimation.playbackRate || 0 };
  },
  moveArmTo(target, { signal, duration, from = getCurrentArmAngle() }) {
    const to = target === 'play' ? ARM_PLAY_ANGLE : ARM_REST_ANGLE;
    return tweenWithCleanup({
      from,
      to,
      duration,
      easing: easeInOutCubic,
      render: setTonearmAngle,
      signal
    });
  },
  async rampRateTo(to, { signal, duration, from = spinAnimation.playbackRate || 0 }) {
    if (to > 0) spinAnimation.play();
    const result = await tweenWithCleanup({
      from,
      to,
      duration,
      easing: easeInOutCubic,
      render: (rate) => {
        spinAnimation.playbackRate = rate;
        updateSheenByRate(rate);
      },
      signal
    });
    if (to === 0 && result.status === 'completed') spinAnimation.pause();
    return result;
  },
  setSpinning(active) {
    if (active) spinAnimation.play();
    else spinAnimation.pause();
  },
  setDocumentVisible(visible) {
    if (!visible) {
      spinAnimation.pause();
      sheenAnimation.pause();
    } else if (audioController.getState().status === 'playing') {
      spinAnimation.play();
      sheenAnimation.play();
    }
  },
  dispose() {
    spinAnimation.cancel();
    sheenAnimation.cancel();
  }
};

const overlayElement = (kind) => kind === 'lyrics' ? resultArea : playlistArea;
const overlayContent = (kind) => kind === 'lyrics' ? resultContent : playlistContent;
const overlays = {
  async open(kind, { signal, duration }) {
    if (kind === 'playlist') {
      playlist.ensureRendered();
      playlist.setActive(currentLyricIndex);
    }
    const element = overlayElement(kind);
    element.classList.add('is-visible');
    document.body.classList.toggle('has-lyric-overlay', kind === 'lyrics');
    document.body.classList.toggle('has-playlist-overlay', kind === 'playlist');
    setFloatingButtonsVisible(false);
    await animateWithCleanup(element, [
      { opacity: 0, transform: 'translateY(12px)' },
      { opacity: 1, transform: 'translateY(0)' }
    ], { duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }, signal);
    if (!signal.aborted) setOverlayControlsVisible(true);
  },
  async close(kind, { signal, duration }) {
    const element = overlayElement(kind);
    if (!element.classList.contains('is-visible')) return;
    await animateWithCleanup(element, [
      { opacity: 1, transform: 'translateY(0)' },
      { opacity: 0, transform: 'translateY(-8px)' }
    ], { duration, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }, signal);
    if (signal.aborted) return;
    element.classList.remove('is-visible');
    document.body.classList.remove(
      kind === 'lyrics' ? 'has-lyric-overlay' : 'has-playlist-overlay'
    );
    setFloatingButtonsVisible(true);
  },
  closeAll({ signal, duration }) {
    return Promise.all([
      this.close('lyrics', { signal, duration }),
      this.close('playlist', { signal, duration })
    ]);
  },
  async refresh({ signal, duration }) {
    const kind = playlistArea.classList.contains('is-visible') ? 'playlist' : 'lyrics';
    await animateWithCleanup(overlayContent(kind), [
      { opacity: 0.55, transform: 'translateY(4px)' },
      { opacity: 1, transform: 'translateY(0)' }
    ], { duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }, signal);
  },
  setDocumentVisible() {},
  dispose() {}
};

const controls = {
  async setLabel(label, { signal, duration }) {
    if (btnTextEl.textContent === label) return;
    await animateWithCleanup(btnTextEl, [
      { opacity: 1, transform: 'translateY(0)' },
      { opacity: 0, transform: 'translateY(-4px)' }
    ], { duration: duration / 2, easing: 'ease-out' }, signal);
    if (signal.aborted) return;
    btnTextEl.textContent = label;
    await animateWithCleanup(btnTextEl, [
      { opacity: 0, transform: 'translateY(4px)' },
      { opacity: 1, transform: 'translateY(0)' }
    ], { duration: duration / 2, easing: 'ease-out' }, signal);
  }
};

const selectTrack = async (index) => {
  updateCurrentLyric(index);
  return lyricsPool[index];
};
```

Wire one controller during app bootstrap:

```js
const motionProfile = detectMotionProfile();
document.documentElement.dataset.motionProfile = motionProfile;
const motion = createMotionController({
  profile: motionProfile,
  transitions: createAppTransitions({
    turntable: turntableController,
    overlays,
    controls,
    audio: audioController,
    selectTrack
  })
});
document.addEventListener('visibilitychange', () => {
  motion.setDocumentVisible(!document.hidden);
});
```

Replace the draw, track-switch, lyric-open/close, and playlist-open/close handlers with `motion.draw`, `motion.switchTrack`, `motion.openOverlay`, and `motion.closeOverlay`. Remove the draw waits at current `src/main.js:2135,2164`, the split-control timers at `1169-1183`, and the button ghost timer at `648-678`; their replacement adapters resolve from transition/animation completion. Route tonearm angle and record playback-rate interpolation through `tweenWithCleanup`, then delete the old `createTweenRunner`, `tonearmTween`, and `rateTween` block at current `src/main.js:940-1009`.

- [ ] **Step 5: Verify and commit coordinated motion**

Run:

```bash
node --test test/unit/motion-controller.test.js test/unit/audio-controller.test.js
npm run build
```

Expected: PASS; starting a second interaction resolves the first with `status: cancelled`; no core draw/overlay sequence advances through an unrelated fixed delay.

```bash
git add src/motion/motion-controller.js src/app/transitions.js src/main.js test/unit/motion-controller.test.js
git commit -m "refactor: coordinate cancellable player motion"
```

## Task 11: Finish the Module Refactor and Composition Root

**Files:**
- Create: `src/player/turntable-controller.js`
- Create: `src/player/track-selector.js`
- Create: `src/ui/lyrics-overlay.js`
- Create: `src/app/player-app.js`
- Modify: `src/app/bootstrap.js`
- Replace: `src/main.js`
- Create: `test/unit/track-selector.test.js`

- [ ] **Step 1: Write a failing deterministic track-selector test**

Create `test/unit/track-selector.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { createTrackSelector } from '../../src/player/track-selector.js';

test('draw queue uses each index once and avoids the current track first', () => {
  const values = [0.1, 0.8, 0.3, 0.6];
  let call = 0;
  const selector = createTrackSelector({
    size: 4,
    random: () => values[call++ % values.length]
  });
  const picks = Array.from({ length: 4 }, () => selector.nextRandom(2));
  assert.equal(picks[0] === 2, false);
  assert.deepEqual([...picks].sort(), [0, 1, 2, 3]);
});

test('supports ordered previous/next and single-loop selection', () => {
  const selector = createTrackSelector({ size: 4, random: () => 0.5 });
  assert.equal(selector.nextOrdered(3), 0);
  assert.equal(selector.previous(0), 3);
  assert.equal(selector.nextForMode('single-loop', 2), 2);
});
```

Run: `node --test test/unit/track-selector.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 2: Move pure selection logic and DOM-specific controllers**

Move current shuffle, random, ordered, previous, and playback-mode logic from `src/main.js:796-890` into `src/player/track-selector.js` behind this complete API:

```js
export function createTrackSelector({ size, random = Math.random }) {
  let queue = [];
  const refill = (avoidIndex) => {
    queue = Array.from({ length: size }, (_, index) => index);
    for (let index = queue.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [queue[index], queue[swap]] = [queue[swap], queue[index]];
    }
    if (queue.length > 1 && queue.at(-1) === avoidIndex) {
      [queue[0], queue[queue.length - 1]] = [queue.at(-1), queue[0]];
    }
  };
  const nextRandom = (avoidIndex = -1) => {
    if (queue.length === 0) refill(avoidIndex);
    return queue.pop();
  };
  const nextOrdered = (current) => (current + 1 + size) % size;
  const previous = (current) => (current - 1 + size) % size;
  const nextForMode = (mode, current) => {
    if (mode === 'single-loop') return current;
    if (mode === 'list-loop') return nextOrdered(current);
    return nextRandom(current);
  };
  return { nextRandom, nextOrdered, previous, nextForMode };
}
```

Extract the already-tested Task 10 adapters without changing their public names. `src/player/turntable-controller.js` exports `createTurntableController()` with `readState`, `setTrack`, `moveArmTo`, `rampRateTo`, `setSpinning`, `setDocumentVisible`, and `dispose`. `src/ui/lyrics-overlay.js` exports `createLyricsOverlay()` with `setTrack`, `open`, `close`, `refresh`, `setDocumentVisible`, and `dispose`; `setTrack` must call `renderLyricLinesHTML`. Every motion method accepts `{ signal, duration }` and settles after completion or abort. Preserve cover-derived palettes but sample only mirrored OSS covers; delete the `mzstatic` host heuristic.

Move the working controller construction and named event handlers from the passing Task 10 `src/main.js` into `src/app/player-app.js`. Wrap the moved statements in `export function createPlayerApp({ documentRef = document, windowRef = window } = {})`, replace global document/window access with those arguments, and return `{ motion, audio: audioController, playlist, turntable, destroy }`. The `destroy` function removes the exact named listeners that the moved composition registered, then disposes motion, audio, playlist, turntable, and lyrics overlay in that order. This is a behavior-preserving extraction: compare the pre/post move with `git diff --word-diff` and do not change event bodies in the same step.

- [ ] **Step 3: Make `bootstrapApp()` the only DOM composition owner**

Make `src/app/bootstrap.js` own startup and deferred caching while `player-app.js` owns controller composition and event binding:

```js
import { createPlayerApp } from './player-app.js';

export function bootstrapApp({ documentRef = document, windowRef = window } = {}) {
  const app = createPlayerApp({ documentRef, windowRef });
  const criticalAssets = startCriticalAssetGate({
    documentRef,
    viewportWidth: windowRef.innerWidth,
    motionProfile: app.motion.profile
  });
  return {
    criticalAssets,
    destroy: () => app.destroy()
  };
}
```

- [ ] **Step 4: Reduce `src/main.js` to the composition root**

Replace `src/main.js` completely with:

```js
import './style.css';
import { bootstrapApp } from './app/bootstrap.js';

bootstrapApp();
```

Remove `<link rel="stylesheet" href="./src/style.css">` from `index.html`; the module import lets Vite inline CSS in Task 13 while dev mode still resolves modules normally.

- [ ] **Step 5: Run the complete unit suite and commit the refactor**

Run:

```bash
npm run test:unit
npm run build
git diff --check
```

Expected: PASS; `src/main.js` has exactly three nonblank lines; all 142 tracks remain selectable; loading, playlist, audio, overlays, and motion controllers dispose cleanly.

```bash
git add src/main.js src/app/bootstrap.js src/app/player-app.js src/player/turntable-controller.js src/player/track-selector.js src/ui/lyrics-overlay.js index.html test/unit/track-selector.test.js
git commit -m "refactor: compose vinyl from focused controllers"
```

## Task 12: Apply the Existing-Image-Only Light Archive Visual System

**Files:**
- Replace: `src/style.css`
- Create: `src/styles/base.css`
- Create: `src/styles/archive.css`
- Create: `src/styles/turntable.css`
- Create: `src/styles/overlays.css`
- Create: `src/styles/motion.css`
- Create: `test/unit/styles.test.js`
- Modify: `index.html:88-150`
- Modify: `src/app/bootstrap.js`

- [ ] **Step 1: Write failing static performance/design guardrails**

Create `test/unit/styles.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const paths = ['base.css', 'archive.css', 'turntable.css', 'overlays.css', 'motion.css'];
const entry = await readFile(new URL('../../src/style.css', import.meta.url), 'utf8');
const parts = await Promise.all(paths.map((name) => (
  readFile(new URL(`../../src/styles/${name}`, import.meta.url), 'utf8')
)));
const css = parts.join('\n');

test('uses a local system font stack and an import-only entry', () => {
  assert.equal(
    entry.trim(),
    paths.map((name) => `@import './styles/${name}';`).join('\n')
  );
  assert.doesNotMatch(css, /fonts\.googleapis|fonts\.gstatic|@import\s+url/i);
});

test('does not continuously scale typography or add spaced-out labels', () => {
  assert.doesNotMatch(css, /font-size\s*:[^;]*(?:vw|cqw|cqi)/i);
  const spacing = css.match(/letter-spacing\s*:\s*[^;]+/gi) || [];
  assert.ok(spacing.every((declaration) => /:\s*0(?:px|em|rem)?\s*$/i.test(declaration)));
});

test('keeps mobile and reduced overlays free of live full-screen blur', () => {
  assert.match(css, /data-motion-profile="compact"[^}]+backdrop-filter:\s*none/is);
  assert.match(css, /data-motion-profile="reduce"[^}]+backdrop-filter:\s*none/is);
  assert.doesNotMatch(css, /playlist-backdrop-drift|background-position[^}]+infinite/is);
});

test('limits persistent animation and compositor hints', () => {
  const infinite = css.match(/\binfinite\b/g) || [];
  const willChange = css.match(/will-change\s*:[^;]+/g) || [];
  assert.ok(infinite.length <= 2);
  assert.deepEqual(willChange, ['will-change: transform, opacity']);
});
```

Run: `node --test test/unit/styles.test.js`

Expected: FAIL because the split files do not exist; the current monolith imports Google Fonts, has mobile full-screen blur/drift, 9 infinite rules, and 31 `will-change` declarations.

- [ ] **Step 2: Split styles by ownership before changing their behavior**

Set `src/style.css` to exactly:

```css
@import './styles/base.css';
@import './styles/archive.css';
@import './styles/turntable.css';
@import './styles/overlays.css';
@import './styles/motion.css';
```

Mechanically move reset/tokens/layout rules to `base.css`, loading/archive metadata rules to `archive.css`, turntable/control rules to `turntable.css`, lyric/playlist rules to `overlays.css`, and keyframes/profile rules to `motion.css`. Preserve selectors while moving, then use `git diff --word-diff` to confirm behavioral edits begin only after the split. Delete the Google Fonts import rather than replacing it with another network font.

- [ ] **Step 3: Establish the archive palette and type system**

Use these exact tokens at the top of `src/styles/base.css`:

```css
:root {
  color-scheme: dark;
  --archive-black: #070808;
  --archive-graphite: #17191a;
  --archive-panel: #222526;
  --archive-silver: #adb4b7;
  --archive-white: #f3f2ec;
  --archive-red: #a43b42;
  --cover-accent: #8aa9bf;
  --cover-secondary: #c9b687;
  --rule: rgba(216, 223, 224, 0.24);
  --panel-radius: 6px;
  --font-lyric: "Songti SC", "Noto Serif CJK SC", STSong, serif;
  --font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  --ease-archive: cubic-bezier(0.22, 1, 0.36, 1);
  --cover-art-url: none;
}

html,
body {
  margin: 0;
  min-height: 100%;
  background: var(--archive-black);
  color: var(--archive-white);
  font-family: var(--font-ui);
  letter-spacing: 0;
}
```

Replace viewport-scaled heading/label sizes with fixed responsive breakpoints. Use the serif stack only for lyric excerpts; use the compact sans stack for controls, accession numbers, and metadata.

- [ ] **Step 4: Add archive identity without wrapping the turntable in a card**

Change the header in `index.html` to:

```html
<header class="header">
  <span class="archive-kicker">VINYL LYRIC ARCHIVE / 023</span>
  <h1>光影档案馆</h1>
  <p>万兽之王 · 歌词抽取记录</p>
</header>
```

Add this unframed metadata strip directly below the turntable:

```html
<dl class="archive-track-meta" id="archiveTrackMeta" aria-live="polite">
  <div><dt>编号</dt><dd id="archiveTrackNumber">--</dd></div>
  <div><dt>发行</dt><dd id="archiveRelease">未抽取</dd></div>
  <div><dt>来源</dt><dd id="archiveSource">档案库</dd></div>
  <div><dt>状态</dt><dd id="archivePlaybackState">待机</dd></div>
</dl>
```

Update these fields only when the selected track or audio state changes. Keep the turntable full-bleed/unframed within its existing stage.

- [ ] **Step 5: Style the contact sheet and overlays with static light cuts**

Use a stable contact-sheet grid in `src/styles/archive.css`:

```css
.loading-intake {
  width: min(88vw, 560px);
  color: var(--archive-white);
}

.loading-intake-head,
.archive-track-meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  border-block: 1px solid var(--rule);
  padding-block: 9px;
  font-size: 11px;
  letter-spacing: 0;
}

.loading-contact-sheet {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  margin-block: 12px;
}

.loading-frame {
  position: relative;
  margin: 0;
  aspect-ratio: 4 / 5;
  overflow: hidden;
  border: 1px solid var(--rule);
  border-radius: 2px;
  background: var(--archive-graphite);
}

.loading-frame:last-child {
  grid-column: span 2;
  aspect-ratio: 8 / 5;
}

.loading-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transform: translateY(8px);
}

.loading-frame.is-ready .loading-image {
  opacity: 1;
  transform: none;
}

.loading-frame figcaption {
  position: absolute;
  inset: auto 5px 5px auto;
  padding: 2px 4px;
  background: var(--archive-black);
  color: var(--archive-white);
  font-size: 10px;
  letter-spacing: 0;
}
```

In `overlays.css`, use opaque graphite/projector surfaces with thin rules and maximum `8px` panel radius. Remove nested glass-card treatment, animated blurred cover backdrops, breathing current-row glow, animated box-shadow, and mobile/reduce `backdrop-filter`. Identify the current row with a static `2px` archival-red rule and type weight.

- [ ] **Step 6: Enforce profile-specific motion in CSS**

Put the only temporary compositor hint and profile overrides in `src/styles/motion.css`:

```css
[data-motion-active] {
  will-change: transform, opacity;
}

@keyframes vinyl-rotate {
  to { transform: translateZ(0) rotate(360deg); }
}

.vinyl-record.is-spinning {
  animation: vinyl-rotate 14s linear infinite;
}

html[data-motion-profile="compact"] .result-area,
html[data-motion-profile="compact"] .playlist-area,
html[data-motion-profile="compact"] .playlist-area::before,
html[data-motion-profile="compact"] .loading-screen {
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  filter: none;
}

html[data-motion-profile="compact"] .playlist-item,
html[data-motion-profile="compact"] .loading-frame {
  animation: none;
}

html[data-motion-profile="reduce"] *,
html[data-motion-profile="reduce"] *::before,
html[data-motion-profile="reduce"] *::after {
  animation: none !important;
  transition-duration: 0.01ms !important;
  scroll-behavior: auto !important;
}

html[data-motion-profile="reduce"] .result-area,
html[data-motion-profile="reduce"] .playlist-area,
html[data-motion-profile="reduce"] .loading-screen {
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  filter: none;
}
```

No hidden overlay may have an active animation. The record rotation runs only while audio is playing; page visibility pauses it. Permit at most one additional local, playback-only highlight animation in `full`; keep compact/reduce static apart from required state transitions.

- [ ] **Step 7: Verify visual rules and commit**

Run:

```bash
node --test test/unit/styles.test.js
npm run build
git diff --check
```

Expected: PASS. Search results contain no Google Font, background-position animation, permanent playlist `will-change`, full-screen mobile blur, nonzero letter-spacing, or new image URL.

```bash
git add index.html src/app/bootstrap.js src/style.css src/styles test/unit/styles.test.js
git commit -m "feat: apply light archive visual system"
```

## Task 13: Produce One Navigation-Critical HTML Document

**Files:**
- Modify: `vite.config.js:1-91`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `test/build/build-output.test.js`
- Delete: `manifest.webmanifest`
- Modify: `public/manifest.webmanifest`

- [ ] **Step 1: Write a failing structured build-output test**

Create `test/build/build-output.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { JSDOM } from 'jsdom';

const dist = new URL('../../dist/', import.meta.url);
const html = await readFile(new URL('index.html', dist), 'utf8');
const document = new JSDOM(html).window.document;

test('inlines every navigation-critical application asset', () => {
  assert.equal(document.querySelectorAll('script[src]').length, 0);
  const blockingLinks = [...document.querySelectorAll('link')].filter((node) => (
    ['stylesheet', 'modulepreload', 'preload'].includes(node.rel)
  ));
  assert.equal(blockingLinks.length, 0);
  assert.ok([...document.querySelectorAll('style')].some((node) => node.textContent.length > 1000));
  assert.ok([...document.querySelectorAll('script:not([src])')].some((node) => node.textContent.length > 10000));
});

test('stays inside delivery budgets and approved origins', async () => {
  assert.ok(gzipSync(html).byteLength <= 120 * 1024);
  assert.doesNotMatch(
    html,
    /fonts\.googleapis|fonts\.gstatic|flickr|openverse|mzstatic|(?:src|href)=["'][^"']*\/assets\//i
  );
  assert.deepEqual((await readdir(dist)).sort(), ['index.html', 'manifest.webmanifest']);
});
```

Run:

```bash
npm run build
npm run test:build
```

Expected: FAIL because current output still links generated CSS/JS assets and does not satisfy the two-file dist contract.

- [ ] **Step 2: Replace the local proxy/build config with a single-file build**

Replace `vite.config.js` with:

```js
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    rollupOptions: {
      output: { inlineDynamicImports: true }
    }
  },
  server: { host: '0.0.0.0', port: 5173 },
  preview: { host: '0.0.0.0', port: 4173 }
});
```

The deleted dev proxy never affected production `musicOssUrl`; correct production OSS metadata is enforced by Task 8 instead.

- [ ] **Step 3: Remove duplicate/static drift and update manifest colors**

Delete root `manifest.webmanifest`; keep only `public/manifest.webmanifest`. Set both `theme_color` and `background_color` to the archive black `#070808`; keep the existing app name, start URL `./`, and display mode. The manifest link is allowed because it is not render-blocking.

- [ ] **Step 4: Verify the build twice and commit**

Run:

```bash
npm run build
npm run test:build
gzip -c dist/index.html | wc -c
find dist -type f | sort
```

Expected: tests PASS; gzip output is at most `122880`; files are only `dist/index.html` and `dist/manifest.webmanifest`; HTML contains inline application CSS, JS, and library data.

```bash
git add vite.config.js package.json package-lock.json public/manifest.webmanifest test/build/build-output.test.js
git rm manifest.webmanifest
git commit -m "build: inline navigation-critical Pages assets"
```

## Task 14: Add Repeat-Visit Shell Caching Without Mid-Session Takeover

**Files:**
- Create: `public/sw.js`
- Create: `src/app/register-service-worker.js`
- Create: `test/unit/service-worker.test.js`
- Modify: `src/app/bootstrap.js`
- Modify: `test/build/build-output.test.js`

- [ ] **Step 1: Write failing service-worker policy tests**

Create `test/unit/service-worker.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  registerServiceWorker,
  scheduleAfterCriticalAssets
} from '../../src/app/register-service-worker.js';

test('registers relative to the deployed project base', async () => {
  let registration;
  const navigatorRef = {
    serviceWorker: {
      register: async (url, options) => {
        registration = { url: String(url), options };
        return registration;
      }
    }
  };
  const result = await registerServiceWorker({
    navigatorRef,
    documentRef: { baseURI: 'https://957064621.github.io/vinyl/' }
  });
  assert.equal(registration.url, 'https://957064621.github.io/vinyl/sw.js');
  assert.equal(registration.options.scope, '/vinyl/');
  assert.equal(registration.options.updateViaCache, 'none');
  assert.equal(result, registration);
});

test('does not force a new worker into the active session', async () => {
  const source = await readFile(new URL('../../public/sw.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /skipWaiting\s*\(/);
  assert.doesNotMatch(source, /clients\.claim\s*\(/);
  assert.doesNotMatch(source, /musics\//);
});

test('schedules registration only after five successful critical assets', async () => {
  let calls = 0;
  const schedule = () => { calls += 1; };
  assert.equal(await scheduleAfterCriticalAssets(Promise.resolve(null), { schedule }), false);
  assert.equal(calls, 0);
  assert.equal(
    await scheduleAfterCriticalAssets(Promise.resolve(Array.from({ length: 5 })), { schedule }),
    true
  );
  assert.equal(calls, 1);
});
```

Run: `node --test test/unit/service-worker.test.js`

Expected: FAIL with missing module/file errors.

- [ ] **Step 2: Implement navigation-only network-first caching**

Create `public/sw.js`:

```js
const CACHE_NAME = 'vinyl-shell-v1';
const SHELL_URL = new URL('./', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => (
      cache.add(new Request(SHELL_URL, { cache: 'reload' }))
    ))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((names) => Promise.all(
    names
      .filter((name) => name.startsWith('vinyl-shell-') && name !== CACHE_NAME)
      .map((name) => caches.delete(name))
  )));
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(event.request);
      if (response.ok) await cache.put(SHELL_URL, response.clone());
      return response;
    } catch {
      return (await cache.match(SHELL_URL)) || new Response(
        '当前网络无法访问页面，请恢复网络后重试。',
        { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
      );
    }
  })());
});
```

Do not cache the audio library. OSS versioned images rely on HTTP caching; the service worker owns only same-origin navigation fallback.

- [ ] **Step 3: Register after successful critical loading without awaiting it**

Create `src/app/register-service-worker.js`:

```js
export function registerServiceWorker({
  navigatorRef = navigator,
  documentRef = document
} = {}) {
  if (!('serviceWorker' in navigatorRef)) return Promise.resolve(null);
  const base = new URL('./', documentRef.baseURI);
  return navigatorRef.serviceWorker.register(new URL('sw.js', base), {
    scope: base.pathname,
    updateViaCache: 'none'
  });
}

export function scheduleServiceWorkerRegistration(options = {}) {
  const windowRef = options.windowRef || window;
  const run = () => registerServiceWorker(options).catch((error) => {
    console.warn('[vinyl] Service worker registration failed', error);
    return null;
  });
  if ('requestIdleCallback' in windowRef) windowRef.requestIdleCallback(run, { timeout: 2000 });
  else windowRef.setTimeout(run, 0);
}

export async function scheduleAfterCriticalAssets(criticalAssets, options = {}) {
  const { schedule = scheduleServiceWorkerRegistration, ...registrationOptions } = options;
  const results = await criticalAssets;
  if (!Array.isArray(results) || results.length !== 5) return false;
  schedule(registrationOptions);
  return true;
}
```

Import and call the helper in `bootstrapApp()` immediately after creating `criticalAssets`:

```js
import { scheduleAfterCriticalAssets } from './register-service-worker.js';

void scheduleAfterCriticalAssets(criticalAssets, {
  windowRef,
  navigatorRef: windowRef.navigator,
  documentRef
});
```

Do not await this helper in application startup. A loading error keeps `criticalAssets` pending until the user retries successfully, so registration cannot run from an incomplete state.

- [ ] **Step 4: Update build expectations and verify**

Change the expected files in `test/build/build-output.test.js` to:

```js
assert.deepEqual(
  (await readdir(dist)).sort(),
  ['index.html', 'manifest.webmanifest', 'sw.js']
);
```

Run:

```bash
node --test test/unit/service-worker.test.js
npm run build
npm run test:build
```

Expected: PASS. `dist/sw.js` contains neither `skipWaiting()` nor `clients.claim()`, so updates activate only after old controlled pages close.

- [ ] **Step 5: Commit repeat-visit caching**

```bash
git add public/sw.js src/app/register-service-worker.js src/app/bootstrap.js test/unit/service-worker.test.js test/build/build-output.test.js
git commit -m "feat: cache the Pages shell for repeat visits"
```

## Task 15: Add Pages Actions and Prove the Release in Browsers

**Files:**
- Create: `.github/workflows/deploy-pages.yml`
- Create: `test/unit/deploy-workflow.test.js`
- Replace: `test/e2e/app.spec.js`
- Create: `test/e2e/performance.spec.js`
- Create: `docs/verification/2026-07-18-release-checklist.md`
- Modify: `agent.md`

- [ ] **Step 1: Write a failing workflow-policy test**

Create `test/unit/deploy-workflow.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('deploys verified dist through GitHub Pages Actions', async () => {
  const yaml = await readFile(
    new URL('../../.github/workflows/deploy-pages.yml', import.meta.url),
    'utf8'
  );
  assert.match(yaml, /branches:\s*\[main\]/);
  assert.match(yaml, /contents:\s*read/);
  assert.match(yaml, /pages:\s*write/);
  assert.match(yaml, /id-token:\s*write/);
  assert.match(yaml, /node-version:\s*22/);
  assert.match(yaml, /npm run verify/);
  assert.match(yaml, /actions\/upload-pages-artifact@v3/);
  assert.match(yaml, /path:\s*dist/);
  assert.match(yaml, /actions\/deploy-pages@v4/);
  assert.match(yaml, /cancel-in-progress:\s*false/);
});
```

Run: `node --test test/unit/deploy-workflow.test.js`

Expected: FAIL with `ENOENT`.

- [ ] **Step 2: Create the GitHub Pages Actions workflow**

Create `.github/workflows/deploy-pages.yml`:

```yaml
name: Deploy GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run verify
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Deploy
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 3: Replace the smoke test with critical workflow tests**

Replace `test/e2e/app.spec.js` with:

```js
import { test, expect } from '@playwright/test';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

const fulfillImage = (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG });

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.load = function load() {};
    HTMLMediaElement.prototype.play = async function play() {
      Object.defineProperty(this, 'paused', { configurable: true, value: false });
      this.dispatchEvent(new Event('play'));
    };
    HTMLMediaElement.prototype.pause = function pause() {
      Object.defineProperty(this, 'paused', { configurable: true, value: true });
      this.dispatchEvent(new Event('pause'));
    };
  });
});

test('keeps entry gated until all five decoded slots are usable', async ({ page }) => {
  let releaseLast;
  const gate = new Promise((resolve) => { releaseLast = resolve; });
  await page.route('https://yuko-portfolio.oss-cn-hangzhou.aliyuncs.com/cover/**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    if (path.endsWith('/天外来物.jpg')) await gate;
    await fulfillImage(route);
  });
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loadingProgress')).toHaveText('04 / 05');
  await expect(page.locator('#appShell')).not.toHaveClass(/is-ready/);
  releaseLast();
  await expect(page.locator('#appShell')).toHaveClass(/is-ready/);
  await expect(page.locator('#loadingScreen')).not.toBeAttached();
});

test('falls back after three primary attempts', async ({ page }) => {
  let primaryAttempts = 0;
  await page.route('https://yuko-portfolio.oss-cn-hangzhou.aliyuncs.com/cover/**', async (route) => {
    const url = route.request().url();
    const path = decodeURIComponent(new URL(url).pathname);
    if (path.endsWith('/3.jpg') && /resize,w_(480|960)/.test(url)) {
      primaryAttempts += 1;
      await route.abort('failed');
      return;
    }
    await fulfillImage(route);
  });
  await page.goto('./');
  await expect(page.locator('#appShell')).toHaveClass(/is-ready/);
  assert.equal(primaryAttempts, 3);
});

test('shows retry after total failure and succeeds on user command', async ({ page }) => {
  let fail = true;
  await page.route('https://yuko-portfolio.oss-cn-hangzhou.aliyuncs.com/cover/**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    if (fail && path.endsWith('/3.jpg')) {
      await route.abort('failed');
      return;
    }
    await fulfillImage(route);
  });
  await page.goto('./');
  await expect(page.locator('#loadingRetry')).toBeVisible();
  await expect(page.locator('#appShell')).not.toHaveClass(/is-ready/);
  fail = false;
  await page.locator('#loadingRetry').click();
  await expect(page.locator('#appShell')).toHaveClass(/is-ready/);
});

test('does not build the playlist or request third-party images at startup', async ({ page }) => {
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.route('https://yuko-portfolio.oss-cn-hangzhou.aliyuncs.com/cover/**', fulfillImage);
  await page.route('https://yuko-vinyl.oss-cn-hangzhou.aliyuncs.com/**', fulfillImage);
  await page.goto('./');
  await expect(page.locator('#appShell')).toHaveClass(/is-ready/);
  await expect(page.locator('.playlist-item')).toHaveCount(0);
  expect(requests.join('\n')).not.toMatch(/googleapis|gstatic|mzstatic|flickr|openverse/i);
});

test('renders the archive index once after a draw', async ({ page }) => {
  await page.route('https://yuko-portfolio.oss-cn-hangzhou.aliyuncs.com/cover/**', fulfillImage);
  await page.route('https://yuko-vinyl.oss-cn-hangzhou.aliyuncs.com/**', fulfillImage);
  await page.goto('./');
  await page.locator('#playButton').click();
  await expect(page.locator('#resultArea')).toHaveClass(/is-visible/);
  await page.locator('#lyricCloseBtn').click();
  await page.locator('#playlistToggleBtn').click();
  await expect(page.locator('.playlist-item')).toHaveCount(142);
  const first = await page.locator('.playlist-item').first().elementHandle();
  await page.locator('#playlistCloseBtn').click();
  await page.locator('#playlistToggleBtn').click();
  const second = await page.locator('.playlist-item').first().elementHandle();
  const same = await first.evaluate((node, other) => node === other, second);
  expect(same).toBe(true);
});
```

- [ ] **Step 4: Add mobile style and long-task checks**

Create `test/e2e/performance.spec.js`:

```js
import { test, expect } from '@playwright/test';
import assert from 'node:assert/strict';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

test('compact mode has static overlays and no principal long task', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium' || testInfo.project.name !== 'mobile-chromium');
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.addInitScript(() => {
    window.__longTasks = [];
    new PerformanceObserver((list) => {
      window.__longTasks.push(...list.getEntries().map(({ duration, startTime }) => ({ duration, startTime })));
    }).observe({ type: 'longtask', buffered: true });
    HTMLMediaElement.prototype.load = function load() {};
    HTMLMediaElement.prototype.play = async function play() { this.dispatchEvent(new Event('play')); };
  });
  await page.route('https://**.oss-cn-hangzhou.aliyuncs.com/**', (route) => (
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
  ));
  await page.goto('./');
  await expect(page.locator('#appShell')).toHaveClass(/is-ready/);
  assert.equal(await page.locator('html').getAttribute('data-motion-profile'), 'compact');
  await page.evaluate(() => { window.__longTasks = []; });
  await page.locator('#playButton').click();
  await expect(page.locator('#resultArea')).toHaveClass(/is-visible/);

  const styles = await page.evaluate(() => {
    const result = getComputedStyle(document.querySelector('#resultArea'));
    const playlist = getComputedStyle(document.querySelector('#playlistArea'), '::before');
    return {
      resultBackdrop: result.backdropFilter || result.webkitBackdropFilter,
      playlistAnimation: playlist.animationName,
      activeHints: document.querySelectorAll('[data-motion-active]').length,
      longTasks: window.__longTasks
    };
  });
  expect(styles.resultBackdrop).toBe('none');
  expect(styles.playlistAnimation).toBe('none');
  expect(styles.activeHints).toBe(0);
  expect(styles.longTasks.filter(({ duration }) => duration > 50)).toEqual([]);
});
```

Scope Long Task collection to start immediately before the principal interaction so initial browser/JIT work does not create a false regression.

- [ ] **Step 5: Install Chromium and run automated release verification**

Run:

```bash
npx playwright install chromium
npm run verify
npm run test:e2e
```

Expected: unit, audit, build, build-output, desktop Chromium, and 390x844 mobile Chromium checks PASS. Capture and inspect screenshots at desktop `1440x900` and mobile `390x844`; confirm no overlap, blank canvas, clipped text, nested card, imported image, or offscreen close/retry control.

- [ ] **Step 6: Execute and record the real-device release checklist**

Create `docs/verification/2026-07-18-release-checklist.md` with a result table for:

```text
iOS Safari: 10 consecutive draws; lyric open/close; playlist first/second open; seek; background/foreground; audio failure/retry.
Android Chrome: the same workflow on a mid-range device with network throttling.
WeChat WebView: the same workflow from the distributed github.io URL.
Mainland networks: China Mobile, China Unicom, and China Telecom first visit and repeat visit.
Failure injection: primary derivative fails then smaller same-image fallback succeeds; all candidates fail then user retry succeeds.
Compositor: hidden overlays have no running decoration or persistent will-change.
Frame timing: target 60 fps, sustained minimum 50 fps, no principal long task above 50 ms.
```

Record device/OS/browser/network, UTC+8 timestamp, PASS/FAIL, measured fps/long tasks, and evidence filename for each row. A total `github.io` DNS failure is recorded as the known external limitation, not a release success.

- [ ] **Step 7: Synchronize the final operating guide**

Re-read every path and command in `agent.md` against the finished tree. Set the final library facts to 24 releases, 142 track references, 131 unique audio objects, 23 OSS release covers plus the direct official artwork for `媚人 - Single`, and five decoded critical slots. Ensure it documents `src/app/transitions.js`, `src/app/register-service-worker.js`, `src/data/cover-map.js`, `scripts/media/build-cover-plan.mjs`, `scripts/media/apply-metadata.mjs`, the three-file `dist` contract, the Pages Actions command, and the rule that both OSS write scripts are dry-run unless `--apply` is explicit.

Run:

```bash
node --test test/unit/project-documentation.test.js
npm run audit:check
```

Expected: PASS; no documented path or package script is absent from the final repository.

- [ ] **Step 8: Commit workflow and verification artifacts**

```bash
git add .github/workflows/deploy-pages.yml test/unit/deploy-workflow.test.js test/e2e/app.spec.js test/e2e/performance.spec.js docs/verification/2026-07-18-release-checklist.md agent.md
git commit -m "ci: verify and deploy vinyl Pages release"
```

- [ ] **Step 9: Switch Pages source only when the verified branch is ready**

After the implementation branch is reviewed, OSS writes are verified, and the owner authorizes publishing, merge to `main`, then change Pages from legacy branch publishing to Actions:

```bash
gh api --method PUT repos/957064621/vinyl/pages -f build_type=workflow
run_id=$(gh run list --workflow deploy-pages.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$run_id" --exit-status
```

Expected: the Actions deployment succeeds and the public URL remains exactly `https://957064621.github.io/vinyl/`.

## Final Acceptance Gate

Run locally from a clean checkout:

```bash
npm ci
npm run verify
npm run media:verify
npm run test:e2e
git diff --check
git status --short
```

Release only when:

- `git status --short` is empty after generated audits are checked in.
- `dist/index.html` is at most `120 KiB` gzip and is the only navigation-critical GitHub response.
- The five critical slots load and decode before the app becomes ready; total failure remains on an explicit retry state.
- Startup makes no Google Fonts, Apple, Flickr, Openverse, stock-image, searched-reference-image, or generated-image request.
- All release art and audio use the approved OSS origins with inline media behavior; audio range checks return 206.
- The startup DOM contains no playlist items; first open creates 142 stable items.
- Mobile/reduce overlays have no full-screen live blur, background drift, or persistent compositor hints.
- `粉钻` says `你若不甘 用挚爱交换`; `媚人` is an independent 2026 single with official artwork and the approved six semantic lines.
- `agent.md`, generated audits, build checks, browser checks, and real-device evidence agree with the released implementation.
- The release notes explicitly retain the limitation that a total first-visit `github.io` DNS failure cannot be repaired by this frontend.
