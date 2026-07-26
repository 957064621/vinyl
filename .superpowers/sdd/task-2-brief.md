### Task 2: Implement Exclusive, Cancellable Motion Ownership

**Files:**
- Create: `src/motion/motion-controller.js`
- Create: `src/app/transitions.js`
- Modify: `src/main.js`
- Preserve/complete: `test/unit/motion-controller.test.js`
- Preserve/complete: `test/unit/audio-controller.test.js`

**Interfaces:**
- Produces: `detectMotionProfile(options) -> 'full' | 'compact' | 'reduce'`.
- Produces: `createMotionController({ profile, transitions, onActivityChange })` with `draw`, `switchTrack`, `openOverlay`, `closeOverlay`, `cancel`, `setDocumentVisible`, `isActive`, and `dispose`.
- Produces: `animateWithCleanup(element, keyframes, options, signal, animate?) -> Promise<{status}>` and `tweenWithCleanup(options) -> Promise<{status}>`.
- Produces: `createAppTransitions({ turntable, overlays, controls, audio, selectTrack })`.

- [ ] **Step 1: Record the current red state**

Run:

```bash
node --test test/unit/motion-controller.test.js test/unit/audio-controller.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/motion/motion-controller.js` and the current rejected-playback visual still using independent tween owners.

- [ ] **Step 2: Implement the motion core**

Use immutable tokens and exclusive ownership:

```js
export const MOTION_TOKENS = Object.freeze({
  full: Object.freeze({ enter: 520, move: 900, settle: 720, itemStagger: 16 }),
  compact: Object.freeze({ enter: 280, move: 460, settle: 360, itemStagger: 0 }),
  reduce: Object.freeze({ enter: 0, move: 0, settle: 0, itemStagger: 0 })
});
```

`runExclusive(name, task)` must increment a request id, abort the prior record, await its settled cleanup, skip superseded queued requests, publish activity changes, and return `{ status: 'completed' | 'cancelled', name }`. Unknown profiles throw `TypeError`.

`tweenWithCleanup` must settle on abort, settle immediately at `duration <= 0`, cancel its scheduled frame, remove its abort listener, and reject if `render` throws. `animateWithCleanup` must use the injected animation adapter when provided, fall back to applying the last keyframe when `.finished` is unavailable, and always remove `data-motion-active`.

- [ ] **Step 3: Implement completion-driven app transitions**

The transition order is:

```text
draw: close overlays -> stop old audio -> arm/rate prepare -> select/load -> arm/rate settle -> open lyrics -> play -> final label
switch: snapshot overlay -> pause -> select/load -> refresh -> play -> restore overlay
open/close: delegate one overlay operation with the same AbortSignal
```

Every boundary calls `assertActive(signal)`. Playback rejection calls `turntable.resetAfterPlaybackError({ signal, duration })` as the final recovery operation, then rethrows.

- [ ] **Step 4: Route current turntable cancellation through one owner**

In `src/main.js`, introduce:

```js
const cancelTurntableMotion = () => {
  tonearmTween.cancel();
  rateTween.cancel();
  cancelVolumeFade();
};
```

Use it before resetting playback visuals and before any new draw or switch timeline. Replace independent fixed-delay advancement in the draw/switch/overlay handlers with the controller commands. New commands must be allowed to supersede old commands rather than returning early behind `isDrawing`, `isOverlayClosing`, or `isTrackSwitching`.

- [ ] **Step 5: Verify cancellation and audio recovery**

Run:

```bash
node --test test/unit/motion-controller.test.js test/unit/audio-controller.test.js
npm run build
git diff --check
```

Expected: PASS; triple-request races start only the latest request, every aborted animation/tween settles, and rejected playback leaves a stable paused turntable.

- [ ] **Step 6: Commit the motion owner**

```bash
git add src/motion/motion-controller.js src/app/transitions.js src/main.js test/unit/motion-controller.test.js test/unit/audio-controller.test.js
git commit -m "refactor: coordinate cancellable player motion"
```

