import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const guide = await readFile(new URL('../../agent.md', import.meta.url), 'utf8');

test('project guide documents the complete operational contract and history', () => {
  assert.deepEqual(guide.match(/^#{1,2} .+$/gm), [
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
    '## 新增歌曲步骤',
  ]);

  assert.match(guide, /github\.io.*DNS.*前端代码.*无法/si);
  assert.match(guide, /换行.*硬语义边界/si);
  assert.match(guide, /高潮|副歌/);
  assert.match(guide, /120 KiB/);
  assert.match(guide, /50 ms/);
  assert.match(guide, /MUSIC_LIBRARY_AUDIT\.md/);
  assert.match(guide, /7ee756c.*48d1161.*8e1d874/s);

  for (const path of [
    'src/app/transitions.js',
    'src/app/register-service-worker.js',
    'src/data/cover-map.js',
    'scripts/media/build-cover-plan.mjs',
    'scripts/media/apply-metadata.mjs',
  ]) {
    assert.ok(guide.includes(path), `expected guide to mention ${path}`);
  }
});
