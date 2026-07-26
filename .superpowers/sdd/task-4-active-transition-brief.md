# Task 4 Re-Review: Active-State Transition Guardrail

This is a focused follow-up to Task 4. Read `task-4-brief.md` for the original
visual-system constraints, then apply only this addendum.

## Files

- Modify: `src/style.css`
- Modify: `test/unit/archive-styles.test.js`
- Append evidence only: `.superpowers/sdd/task-4-report.md`

## Required Change

1. The terminal directional archive active rules for `.play-btn:active`,
   `.player-ctrl-btn:active`, and the grouped visible-toggle/overlay-close/
   playback-mode/audio-retry active selector must explicitly transition only
   `transform` and `opacity`. Preserve their existing press transforms, custom
   properties, and instantaneous background, border-color, and box-shadow
   changes.
2. Replace the two legacy active declarations that currently transition
   `background` and `box-shadow` with transform/opacity-only transitions:
   `.play-btn:active` and the grouped visible lyric/playlist toggle active
   selector.
3. Extend the archive styles unit test with direct assertions for the terminal
   active rules and a stylesheet-wide active-rule guard. The guard must reject
   `all`, `background`, `box-shadow`, `filter`, dimensions/layout properties,
   `border-color`, and any other transition property outside `transform`,
   `opacity`, and `none` in a `:active` rule.
4. Preserve DOM, motion-controller behavior, visible copy, audio/retry
   behavior, assets, accessibility, Task 5 perimeter-loop behavior, and
   `test/unit/draw-button-flow.test.js` unless coverage strictly requires a
   change.

## Verification

Run exactly:

```sh
node --test test/unit/archive-styles.test.js test/unit/draw-button-flow.test.js
npm run verify
git diff --check
```

Do not stage `.superpowers/` or `test-results/`. Commit only the intended
tracked CSS and unit-test files with a focused fix commit.
