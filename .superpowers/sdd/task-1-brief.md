### Task 1: Remove Visible Loading Chrome Without Removing Status

**Files:**
- Modify: `index.html`
- Modify: `src/style.css`
- Modify: `test/unit/loading-screen.test.js`
- Modify: `test/e2e/loading-poster-transition.spec.js`

**Interfaces:**
- Consumes: `createLoadingScreen().setProgress({ completed, total })` and `#loadingProgress` as the polite live region.
- Produces: an accessible `#loadingProgress.sr-only`, no `.loading-progress-rail`, and unchanged retry/error behavior.

- [ ] **Step 1: Add failing static assertions**

Add assertions that production markup has exactly one `#loadingProgress`, that it has class `sr-only`, and that `.loading-progress-rail` is absent. Keep the existing assertion that progress text updates to `01 / 05`.

```js
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const page = new JSDOM(html).window.document;
assert.equal(page.querySelectorAll('#loadingProgress.sr-only').length, 1);
assert.equal(page.querySelector('.loading-progress-rail'), null);
```

- [ ] **Step 2: Run the focused test and verify the intended failure**

Run: `node --test test/unit/loading-screen.test.js`

Expected: FAIL because the progress output is visible and the rail still exists.

- [ ] **Step 3: Make progress screen-reader-only and remove the rail**

Change production and test fixtures to:

```html
<output class="sr-only" id="loadingProgress" aria-label="加载进度" aria-live="polite" aria-atomic="true">00 / 05</output>
```

Delete:

```html
<div class="loading-progress-rail" aria-hidden="true"><span></span></div>
```

Add the reusable utility without hiding content from assistive technology:

```css
.sr-only {
  position: absolute !important;
  width: 1px !important;
  height: 1px !important;
  padding: 0 !important;
  margin: -1px !important;
  overflow: hidden !important;
  clip: rect(0, 0, 0, 0) !important;
  white-space: nowrap !important;
  border: 0 !important;
}
```

Delete `.loading-intake-head`, `.loading-progress-rail`, and related fill/animation rules that no longer have a production node.

- [ ] **Step 4: Run loading unit and browser coverage**

Run:

```bash
node --test test/unit/loading-screen.test.js test/unit/poster-transition.test.js
npx playwright test test/e2e/loading-poster-transition.spec.js
```

Expected: PASS; screenshots show only poster, directional light, short bottom status, and retry when forced.

- [ ] **Step 5: Commit the isolated loading change**

```bash
git add index.html src/style.css test/unit/loading-screen.test.js test/e2e/loading-poster-transition.spec.js
git commit -m "refine: remove loading poster chrome"
```

