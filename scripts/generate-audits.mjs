import { writeFileSync } from 'node:fs';

import { lyricsPool, releases } from '../src/data.js';

const today = new Date().toISOString().slice(0, 10);

const md = (value) => String(value ?? '')
  .replace(/\|/g, '\\|')
  .replace(/\n/g, '<br>');

const lineCount = (text) => String(text || '')
  .split(/\n/)
  .filter(Boolean).length;

const uniqueTracks = [...new Map(lyricsPool.map((track) => [track.title, track])).values()]
  .sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'));

const missingLyrics = lyricsPool.filter((track) => track.needsLyric);
const missingMusic = lyricsPool.filter((track) => !track.musicOssUrl);
const missingCoverOss = releases.filter((release) => !release.coverOssUrl);

const releaseRows = releases.map((release) => {
  const tracks = release.tracks || [];
  const missingLyricCount = tracks.filter((track) => track.needsLyric).length;
  const missingMusicCount = tracks.filter((track) => !track.musicOssUrl).length;
  return `| ${md(release.title)} | ${md(release.type)} | ${md(release.releaseDate || '待核对')} | ${tracks.length} | ${missingLyricCount} | ${missingMusicCount} | ${release.sourceArtworkUrl ? 'Y' : 'N'} | ${release.coverOssUrl ? 'Y' : 'N'} |`;
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

const audioManifest = `# Vinyl 音频清单

更新时间：${today}

## 总览

| 项目 | 数量 |
| --- | ---: |
| 曲库歌曲条目 | ${lyricsPool.length} |
| 唯一音频标题 | ${uniqueTracks.length} |
| 已配置 OSS 链接 | ${lyricsPool.filter((track) => Boolean(track.musicOssUrl)).length} |
| 待补 OSS | ${missingMusic.length} |
| 待补歌词 | ${missingLyrics.length} |
| 待补封面 OSS | ${missingCoverOss.length} |

## 当前曲库

| 歌曲 | 专辑 | 歌词 | 音频 | 封面 |
| --- | --- | --- | --- | --- |
${trackRows}

## 待补歌词

| 歌曲 | 专辑 | 音频 | 封面 |
| --- | --- | --- | --- |
${missingLyricRows}

## 维护方式

1. 所有歌曲音频链接统一在 \`src/data.js\` 的 \`musicOssUrl\` 字段维护。
2. 播放层直接读取 \`musicOssUrl\`，所有歌曲音频都使用 OSS 直链。
3. 任何新增歌曲，补完 \`musicOssUrl\`、歌词和封面后，重新运行 \`node scripts/generate-audits.mjs\`。
`;

const libraryAudit = `# Vinyl 曲库统计表

更新时间：${today}

## 总览

| 项目 | 数量 |
| --- | ---: |
| 发行组 | ${releases.length} |
| 已入库歌曲条目 | ${lyricsPool.length} |
| 唯一音频标题 | ${uniqueTracks.length} |
| 缺高潮歌词 | ${missingLyrics.length} |
| 待补 OSS | ${missingMusic.length} |
| 已配置 OSS | ${lyricsPool.filter((track) => Boolean(track.musicOssUrl)).length} |
| 缺封面 OSS | ${missingCoverOss.length} |

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

1. \`src/data.js\` 是曲库源数据，修改发行、歌曲、歌词、封面或音频链接后，重新运行 \`node scripts/generate-audits.mjs\`。
2. 页面播放统一读取 \`musicOssUrl\`，所有歌曲音频都使用 OSS 直链。
3. 新增歌曲只要补齐 \`musicOssUrl\`、歌词和封面，就会自动进入清单。
`;

writeFileSync('MUSIC_AUDIO_MANIFEST.md', audioManifest, 'utf8');
writeFileSync('MUSIC_LIBRARY_AUDIT.md', libraryAudit, 'utf8');
