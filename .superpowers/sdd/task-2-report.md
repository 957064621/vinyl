# Task 2 Report: Exclusive, Cancellable Motion Ownership

## Status

Complete. The player now has one cancellable motion owner for draw, track
switch, overlay, visibility, and recovery interactions.

Commit: `104c9fa2f89cc03af1850930871278af8df5de6e`
`refactor: coordinate cancellable player motion`

## Implementation

- Added `src/motion/motion-controller.js` with immutable full/compact/reduce
  tokens, motion-profile detection, latest-request ownership, cancellation,
  hidden-page handling, disposal, WAAPI cleanup, and RAF tween cleanup.
- Added `src/app/transitions.js` with completion-driven draw/switch/overlay
  timelines. Draw closes overlays before pausing old audio; track switching
  snapshots/restores overlays; playback and load failures reset the turntable
  and rethrow.
- Integrated the controller into `src/main.js` without restructuring unrelated
  player behavior. Draw, foreground/headless switching, overlay open/close,
  visibility, direct player controls, Media Session controls, retry, and
  rejected playback now yield or route through the owner.
- Preserved the existing turntable cancellation boundary through
  `cancelTurntableMotion()`. Its RAF owners and volume fade now settle when
  cancelled.
- Replaced handler-level fixed-delay progression and `isDrawing`,
  `isOverlayClosing`, and `isTrackSwitching` command gates with controller
  ownership. The booleans remain only as derived display/state guards for
  non-command playback visuals.

## TDD Evidence

Initial focused state reflected the pre-existing partial Task 2 files:

```text
node --test test/unit/motion-controller.test.js test/unit/audio-controller.test.js
29 passed, 0 failed
```

I added a composition-root integration test before wiring `main.js`. It failed
as expected because the source did not yet import or instantiate the motion
controller:

```text
not ok - the composition root routes player commands through exclusive motion ownership
The input did not match the regular expression /createMotionController/
```

The completed focused suite verifies exclusive triple-request behavior,
aborted animation/tween settlement, visibility cancellation, hidden headless
switching, protected controller context, activity-observer failures,
load/play rejection recovery, pending-play cancellation recovery, direct
playback handoff, and composition-root command routing.

## Verification

```text
node --test test/unit/motion-controller.test.js test/unit/audio-controller.test.js
39 passed, 0 failed

npm run test:unit
155 passed, 0 failed

node --test test/unit/loading-screen.test.js
23 passed, 0 failed

npm run build
PASS: Vite production build completed

git diff --check
PASS: exit 0, no output
```

## Task Files

- `src/motion/motion-controller.js`
- `src/app/transitions.js`
- `src/main.js`
- `test/unit/motion-controller.test.js`
- `test/unit/audio-controller.test.js`

## Self-Review

- A newer command aborts the active request, waits for it to settle, and skips
  superseded queued work.
- Hidden pages cancel decorative work and invalidate queued requests, while
  headless media-track switching remains available for Media Session and
  background auto-advance.
- Only the controller supplies `signal`, profile, tokens, and target index to
  transitions; caller options cannot replace them.
- Playback rejection, source-load failure, and an aborted pending play all
  leave the turntable in its stable paused/reset state before the command
  settles.
- Direct playback controls cancel active motion before acting, so they do not
  race turntable ownership.

## Concerns

- The pre-existing rich overlay helper functions remain in `src/main.js` but
  are no longer used by draw, switch, or overlay command handlers. Removing
  that dead visual code would be a separate cleanup in this intentionally
  tangled composition module.
- Unrelated user changes remain unstaged in the redesign plan/spec files,
  `.superpowers/`, and `test-results/`.

---

## Review Fix Wave: Motion Ownership Race Gaps

Status: DONE

Commit: `37d0ed8258193052140ccb81003c1aba2765bd28`
`fix: close motion ownership race gaps`

### Implementation

- Separated decorative visibility invalidation from semantic request ownership.
  Backgrounding now cancels decorative queued/active work without superseding a
  queued headless track switch.
- Initialized each active record's `settled` promise before publishing activity,
  and deferred transition task launch to a microtask with an abort check. A
  synchronous observer re-entry now settles the old record before starting the
  replacement.
- Converted live `false` results from audio load/play into transition errors.
  Both paths perform the stable turntable reset as their final recovery action
  and cannot continue to a draw label or switch overlay restore.
- Updated existing ownership tests to yield one microtask only when they intend
  to exercise cleanup of work that has already started, matching the new task
  launch contract.

### Exact Verification

```text
node --test test/unit/motion-controller.test.js test/unit/audio-controller.test.js
Initial review-fix red state: 43 tests, 39 passed, 4 failed, exit 1.
Failures: queued headless switch during backgrounding; synchronous activity
re-entry; live false load; live false play.

node --test test/unit/motion-controller.test.js test/unit/audio-controller.test.js
Final result: 45 tests, 45 passed, 0 failed, exit 0.

node --test test/unit/*.test.js
Result: 161 tests, 161 passed, 0 failed, exit 0.

npm run build
Result: Vite v8.0.16 transformed 20 modules and completed the production build
in 103ms, exit 0.

git diff --check
Result: no output, exit 0.

git add src/motion/motion-controller.js src/app/transitions.js test/unit/motion-controller.test.js && git diff --cached --check && git commit -m 'fix: close motion ownership race gaps'
Result: commit 37d0ed8 created; 3 files changed, 157 insertions, 12 deletions;
exit 0.
```

### Self-Review

- The semantic request id still provides latest-request-wins ownership; only
  decorative visibility invalidation moved to its own epoch.
- Hidden decorative requests remain cancelled, while a headless request queued
  behind decorative cleanup remains eligible to start in the background.
- `record.settled` exists before any observer can re-enter the controller, and
  an aborted record cannot invoke its transition task from the queued microtask.
- Undefined audio results remain accepted for compatibility with simple
  adapters; only the controller's explicit stale/cancel sentinel `false` aborts
  the transition.
- False load/play paths are covered for both the draw final label and the track
  switch overlay restore. Recovery reset remains the final recorded operation.
- No CSS, HTML, composition-root, audio-controller, or unrelated test files were
  changed in this fix wave.

### Concerns

None.
