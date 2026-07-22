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
  assert.match(audioManifest, /\| 媚人 \| 万兽之王演唱会录音 \| 已填 6 行 \| OSS \|/);
  assert.match(libraryAudit, /\| 万兽之王演唱会录音 \| live-recording \| 待核对 \| 3 \| 0 \| 0 \| [YN] \| Y \|/);
});
