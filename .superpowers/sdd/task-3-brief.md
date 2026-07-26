### Task 3: Add Archive Identity And Track State

**Files:**
- Modify: `index.html`
- Modify: `src/main.js`
- Create: `test/unit/archive-ui.test.js`

**Interfaces:**
- Consumes: the selected `lyricsPool[index]` object and audio controller state `{ status, track }`.
- Produces: `updateArchiveMetadata(index, audioStatus)` and DOM nodes `#archiveTrackNumber`, `#archiveRelease`, `#archiveSource`, `#archivePlaybackState`.

- [ ] **Step 1: Write the DOM contract test**

Assert the title is exactly `光影档案馆`, the subtitle is the only additional visible header line, the metadata rail has four `dt/dd` pairs, and no archive kicker or decorative accession sentence exists.

```js
assert.equal(document.querySelector('.header h1').textContent.trim(), '光影档案馆');
assert.equal(document.querySelectorAll('#archiveTrackMeta > div').length, 4);
assert.equal(document.querySelector('.archive-kicker'), null);
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test test/unit/archive-ui.test.js`

Expected: FAIL because the current heading is `歌词抽取机` and no metadata rail exists.

- [ ] **Step 3: Add factual archive markup**

Use:

```html
<header class="header">
  <h1>光影档案馆</h1>
  <p>按下按钮，为你抽取一段专属歌词</p>
</header>
```

Add below `.vinyl-wrapper`:

```html
<dl class="archive-track-meta" id="archiveTrackMeta" aria-live="polite">
  <div><dt>编号</dt><dd id="archiveTrackNumber">--</dd></div>
  <div><dt>发行</dt><dd id="archiveRelease">未抽取</dd></div>
  <div><dt>来源</dt><dd id="archiveSource">档案库</dd></div>
  <div><dt>状态</dt><dd id="archivePlaybackState">待机</dd></div>
</dl>
```

- [ ] **Step 4: Update metadata only on real state changes**

Map selected track index to a two-digit archive number, release/album name, a stable source label, and audio states `待机`, `读取`, `播放`, `暂停`, `故障`. Do not update these fields on animation frames.

- [ ] **Step 5: Verify and commit archive identity**

Run:

```bash
node --test test/unit/archive-ui.test.js test/unit/library.test.js
npm run build
```

Expected: PASS; all track data remains unchanged and the new rail reflects selection/playback state.

```bash
git add index.html src/main.js test/unit/archive-ui.test.js
git commit -m "feat: add archive player identity"
```

