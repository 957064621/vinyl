# Task 5A: Lock Archive Shell Color And Visible Dash Copy

## Files

- Modify: `index.html`
- Modify: `manifest.webmanifest`
- Modify: `public/manifest.webmanifest`
- Modify: `src/main.js`
- Modify: `src/style.css`
- Modify: focused unit tests only

## Requirements

- Set the HTML `theme-color`, both inline first-paint backgrounds, and the loading-screen first-paint background to archive void `#070808`.
- Set `background_color` and `theme_color` in both tracked manifests to `#070808`; keep their existing names, start URL, display mode, and orientation.
- Remove the remaining production `#070a12` uses. Use `var(--archive-void)` inside `src/style.css` where the root token is available.
- Replace the visible result prefix ``—— ${result.song}`` with a regular ASCII hyphen and spaces: ``- ${result.song}``.
- Add focused regression assertions for all of the above and for the absence of visible em/en dash characters in the affected production copy.
- Do not alter layout, animation, data flow, loading requests, controls, labels, manifests beyond the named color fields, or dependencies.
- Preserve untracked `.superpowers/` and `test-results/`.

## Verification

Run:

```bash
node --test test/unit/archive-ui.test.js test/unit/archive-styles.test.js
npm run verify
git diff --check
```

Commit only the scoped tracked files with message:

```text
refine: align archive shell metadata
```

Append actual commands, exit status, and results to `.superpowers/sdd/task-5a-report.md` without staging the report.
