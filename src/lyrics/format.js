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
