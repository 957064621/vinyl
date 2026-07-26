import test from 'node:test';
import assert from 'node:assert/strict';

import { lyricsPool, releases } from '../../src/data.js';
import { MAX_LYRIC_LINES, parseLyricLines } from '../../src/lyrics/format.js';

const liveRelease = () => releases.find((release) => release.title === '万兽之王演唱会录音');
const meirenRelease = () => releases.find((release) => release.title === '媚人 - Single');

test('uses the approved 粉钻 wording', () => {
  const track = liveRelease().tracks.find(({ title }) => title === '粉钻');
  assert.equal(track.text, '满地粉钻 无人看管\n' + '你若不甘 用挚爱交换\n' + '漫天红伞 无人生还\n' + '我的遗憾 是不能洁白的带你离开');
  assert.doesNotMatch(track.text, /用爱交换/);
});

test('keeps the 2026 live recording limited to 粉钻 and 造物', () => {
  const release = liveRelease();
  assert.equal(release.releaseDate, '2026');
  assert.deepEqual(release.tracks.map(({ title, trackNumber }) => ({ title, trackNumber })), [
    { title: '粉钻', trackNumber: 1 },
    { title: '造物', trackNumber: 2 }
  ]);
});

test('keeps 媚人 as a complete independent single release', () => {
    const release = meirenRelease();
    const [track] = release.tracks;

  assert.equal(release.type, 'single');
  assert.equal(release.releaseDate, '2026-07-17');
  assert.equal(
    release.sourceArtworkUrl,
    'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/6c/c8/3a/6cc83adf-7cd1-8dd0-6606-94106ac1f83f/4896016816485.jpg/600x600bb.jpg'
  );
  assert.equal(release.coverOssUrl, '');
  assert.deepEqual(release.palette, { a: [111, 45, 43], b: [188, 190, 186] });
  assert.equal(track.title, '媚人');
  assert.equal(track.trackNumber, 1);
  assert.equal(track.artist, '薛之谦');
  assert.equal(track.recordingSource, undefined);
  assert.equal(track.musicOssUrl, 'https://yuko-vinyl.oss-cn-hangzhou.aliyuncs.com/musics/%E5%AA%9A%E4%BA%BA.mp3');
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
  const keys = lyricsPool.map(({ album, trackNumber, title }) => [album, trackNumber, title].join('\0'));
  assert.equal(lyricsPool.length, 142);
  assert.equal(new Set(keys).size, keys.length);
  for (const track of lyricsPool) {
    const lines = parseLyricLines(track.text);
    assert.ok(lines.length > 0 && lines.length <= MAX_LYRIC_LINES);
  }
});
