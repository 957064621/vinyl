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
  assert.deepEqual(parseLyricLines('然后扮成   无辜的路人'), ['然后扮成 无辜的路人']);
});

test('rejects invalid excerpts instead of silently dropping lines', () => {
  assert.throws(() => parseLyricLines('第一行\n\n第三行'), { name: 'TypeError', message: /blank semantic line/i });
  assert.throws(() => parseLyricLines('一\n二\n三\n四\n五\n六\n七'), { name: 'RangeError', message: /at most 6 semantic lines/i });
});

test('renders one escaped span for every authored line', () => {
  assert.equal(
    renderLyricLinesHTML('<b>一</b>\n第二行 & 继续'),
    '<span class="lyric-line">&lt;b&gt;一&lt;/b&gt;</span>'
      + '<span class="lyric-line">第二行 &amp; 继续</span>'
  );
});
