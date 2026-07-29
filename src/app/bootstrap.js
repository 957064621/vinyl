import {
  CRITICAL_IMAGE_MANIFEST,
  selectCriticalImageCandidates
} from '../config/assets.js';
import { loadCriticalImages } from '../media/asset-loader.js';
import { createLoadingScreen } from '../ui/loading-screen.js';

export function startCriticalAssetGate({
  documentRef = document,
  viewportWidth = window.innerWidth,
  motionProfile = 'compact',
  load = loadCriticalImages,
  createView = createLoadingScreen
} = {}) {
  const skipToken = Symbol('critical-asset-skip');
  let requestRunSkip = () => {};
  const view = createView(documentRef, {
    motionProfile,
    onSkip: () => requestRunSkip()
  });
  const appRoot = documentRef.querySelector('#appRoot');
  const appShell = documentRef.querySelector('#appShell');
  let currentMotionProfile = motionProfile;
  let motionProfileRevision = 0;
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });

  const setProfile = (nextProfile) => {
    const result = view.setProfile?.(nextProfile);
    currentMotionProfile = nextProfile;
    motionProfileRevision += 1;
    return result;
  };

  const run = async () => {
    appRoot.setAttribute('inert', '');
    appRoot.setAttribute('aria-hidden', 'true');
    appShell.classList.remove('is-ready');
    view.reset();
    const loadController = new AbortController();
    const loadedResults = new Map();
    let skipRequested = false;
    let resolveSkip;
    const skipped = new Promise((resolve) => {
      resolveSkip = () => {
        if (skipRequested) return;
        skipRequested = true;
        loadController.abort(new Error('Critical image loading skipped'));
        resolve(skipToken);
      };
    });
    requestRunSkip = resolveSkip;

    const onProgress = (event) => {
      if (event.status === 'ready' && event.result) {
        loadedResults.set(event.id, event.result);
      }
      view.setProgress(event);
    };

    try {
      const loading = Promise.resolve().then(() => load(CRITICAL_IMAGE_MANIFEST, {
        selectCandidates: (asset) => selectCriticalImageCandidates(asset, viewportWidth),
        retries: 2,
        concurrency: 2,
        signal: loadController.signal,
        onProgress
      }));
      const outcome = await Promise.race([loading, skipped]);
      let results = outcome;

      if (outcome === skipToken) {
        const finalAsset = CRITICAL_IMAGE_MANIFEST.at(-1);
        const loadedFinal = loadedResults.get(finalAsset.id);
        if (loadedFinal) {
          results = [loadedFinal];
        } else {
          results = await load([finalAsset], {
            selectCandidates: (asset) => selectCriticalImageCandidates(asset, viewportWidth),
            retries: 2,
            concurrency: 1,
            onProgress: (event) => view.setProgress({
              ...event,
              completed: event.status === 'ready' ? CRITICAL_IMAGE_MANIFEST.length : 0,
              total: CRITICAL_IMAGE_MANIFEST.length
            })
          });
        }
      }
      await view.playReadySequence(currentMotionProfile);
      let exitProfile = currentMotionProfile;
      let exitProfileRevision = motionProfileRevision;
      while (true) {
        const exited = await view.exit(exitProfile);
        if (exited !== false) break;
        if (motionProfileRevision === exitProfileRevision) return;
        exitProfile = currentMotionProfile;
        exitProfileRevision = motionProfileRevision;
      }
      appShell.classList.add('is-ready');
      view.completeHandoff?.();
      appRoot.removeAttribute('inert');
      appRoot.removeAttribute('aria-hidden');
      resolveReady(results);
    } catch (error) {
      appRoot.setAttribute('inert', '');
      appRoot.setAttribute('aria-hidden', 'true');
      appShell.classList.remove('is-ready');
      view.showError(error, () => {
        void run();
      });
    } finally {
      if (requestRunSkip === resolveSkip) requestRunSkip = () => {};
    }
  };

  void run();
  Object.defineProperty(ready, 'setProfile', {
    value: setProfile
  });
  return ready;
}
