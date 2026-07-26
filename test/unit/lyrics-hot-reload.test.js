import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lyricsSource = readFileSync(new URL('../../src/data/lyrics.js', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');

test('the editable lyric file self-accepts HMR and publishes an in-place update', () => {
  assert.match(lyricsSource, /if \(import\.meta\.hot\)/);
  assert.match(lyricsSource, /import\.meta\.hot\.accept\(\(nextModule\) =>/);
  assert.match(lyricsSource, /new CustomEvent\('vinyl:lyrics-updated'/);
  assert.match(lyricsSource, /else \{\s*Object\.freeze\(lyricTextByTitle\);\s*\}/s);
});

test('lyric HMR refreshes visible text without starting or restarting playback', () => {
  const syncBlock = mainSource.match(
    /const syncEditableLyrics = \(nextLyrics = lyricTextByTitle\) => \{(?<body>[\s\S]*?)\n        \};\n\n        window\.addEventListener\('vinyl:lyrics-updated'/
  );

  assert.ok(syncBlock?.groups?.body);
  assert.match(syncBlock.groups.body, /track\.text = nextText/);
  assert.match(syncBlock.groups.body, /lyricEl\.innerHTML = renderLyricLinesHTML\(currentTrack\.text\)/);
  assert.match(syncBlock.groups.body, /revealLyricContentImmediately\(\)/);
  assert.doesNotMatch(syncBlock.groups.body, /audioController\.(?:load|play|pause)/);
  assert.doesNotMatch(syncBlock.groups.body, /runLoadingSequence|switchToTrack/);
});
