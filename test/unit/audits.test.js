import test from 'node:test';
import assert from 'node:assert/strict';

import { lyricsPool, releases } from '../../src/data.js';
import { buildAuditDocuments } from '../../scripts/generate-audits.mjs';

const currentLibraryRows = (document) => {
  const match = document.match(/## 当前曲库\n\n\|[^\n]+\|\n\|[^\n]+\|\n(?<rows>[\s\S]*?)\n\n## /);
  assert.ok(match);
  return match.groups.rows.split('\n');
};

test('builds deterministic audit documents from library data', () => {
  const { audioManifest, libraryAudit } = buildAuditDocuments({
    releases,
    lyricsPool,
    updatedAt: '2026-07-18'
  });
  const summary = `| 项目 | 数量 |
| --- | ---: |
| 曲库歌曲条目 | 142 |
| 唯一音频标题 | 131 |
| 已配置 OSS 链接 | 142 |
| 待补 OSS | 0 |
| 待补歌词 | 0 |
| 待补封面 OSS | 23 |`;

  assert.match(audioManifest, /更新时间：2026-07-18/);
  assert.ok(audioManifest.includes(summary));
  assert.ok(libraryAudit.includes(summary));
  for (const document of [audioManifest, libraryAudit]) {
    const rows = currentLibraryRows(document);
    assert.equal(rows.length, 142);
    assert.ok(rows.some((row) => row.startsWith('| 认真的雪 | 薛之谦 |')));
    assert.ok(rows.some((row) => row.startsWith('| 认真的雪 | 未完成的歌 |')));
  }
  assert.match(audioManifest, /\| 曲库歌曲条目 \| 142 \|/);
  assert.match(audioManifest, /\| 唯一音频标题 \| 131 \|/);
  assert.match(
    audioManifest,
    /\| 媚人 \| 媚人 - Single \| 已填 6 行 \| OSS \| https:\/\/is1-ssl\.mzstatic\.com\/image\/thumb\/Music221\/v4\/6c\/c8\/3a\/6cc83adf-7cd1-8dd0-6606-94106ac1f83f\/4896016816485\.jpg\/600x600bb\.jpg \|/
  );
  assert.match(libraryAudit, /\| 万兽之王演唱会录音 \| live-recording \| 2026 \| 2 \| 0 \| 0 \| Y \| Y \|/);
  assert.match(libraryAudit, /\| 媚人 - Single \| single \| 2026-07-17 \| 1 \| 0 \| 0 \| Y \| N \|/);
});
