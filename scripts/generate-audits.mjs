import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { lyricsPool, releases } from '../src/data.js';

const audioManifestUrl = new URL('../MUSIC_AUDIO_MANIFEST.md', import.meta.url);
const libraryAuditUrl = new URL('../MUSIC_LIBRARY_AUDIT.md', import.meta.url);

const md = (value) => String(value ?? '')
  .replace(/\|/g, '\\|')
  .replace(/\n/g, '<br>');

const lineCount = (text) => String(text || '')
  .split('\n')
  .filter(Boolean).length;

export const buildAuditDocuments = ({ releases, lyricsPool, updatedAt }) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(updatedAt)) {
    throw new TypeError('updatedAt must use YYYY-MM-DD format');
  }

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

  const summary = `| 项目 | 数量 |
| --- | ---: |
| 曲库歌曲条目 | ${lyricsPool.length} |
| 唯一音频标题 | ${uniqueTracks.length} |
| 已配置 OSS 链接 | ${lyricsPool.filter((track) => Boolean(track.musicOssUrl)).length} |
| 待补 OSS | ${missingMusic.length} |
| 待补歌词 | ${missingLyrics.length} |
| 待补封面 OSS | ${missingCoverOss.length} |`;

  const audioManifest = `# Vinyl 音频清单

更新时间：${updatedAt}

## 总览

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
};

const utcDate = () => new Date().toISOString().slice(0, 10);

const readCommittedDate = async () => {
  try {
    const libraryAudit = await readFile(libraryAuditUrl, 'utf8');
    return libraryAudit.match(/^更新时间：(\d{4}-\d{2}-\d{2})$/m)?.[1] || utcDate();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return utcDate();
  }
};

const main = async () => {
  const check = process.argv.includes('--check');
  const updatedAt = check ? await readCommittedDate() : utcDate();
  const documents = buildAuditDocuments({ releases, lyricsPool, updatedAt });
  const outputs = [
    [audioManifestUrl, documents.audioManifest],
    [libraryAuditUrl, documents.libraryAudit]
  ];

  if (check) {
    for (const [url, expected] of outputs) {
      const actual = await readFile(url, 'utf8');
      if (actual !== expected) {
        throw new Error(`${fileURLToPath(url)} is stale; run npm run audit`);
      }
    }
    return;
  }

  await Promise.all(outputs.map(([url, content]) => writeFile(url, content, 'utf8')));
};

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
