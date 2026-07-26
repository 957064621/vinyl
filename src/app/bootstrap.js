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
  const view = createView(documentRef, { motionProfile });
  const appRoot = documentRef.querySelector('#appRoot');
  const appShell = documentRef.querySelector('#appShell');
  let currentMotionProfile = motionProfile;
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });

  const setProfile = (nextProfile) => {
    const result = view.setProfile?.(nextProfile);
    currentMotionProfile = nextProfile;
    return result;
  };

  const run = async () => {
    view.reset();
    try {
      const results = await load(CRITICAL_IMAGE_MANIFEST, {
        selectCandidates: (asset) => selectCriticalImageCandidates(asset, viewportWidth),
        retries: 2,
        concurrency: 2,
        onProgress: (event) => view.setProgress(event)
      });
      await view.playReadySequence(currentMotionProfile);
      appRoot.removeAttribute('inert');
      appRoot.removeAttribute('aria-hidden');
      appShell.classList.add('is-ready');
      await view.exit(currentMotionProfile);
      resolveReady(results);
    } catch (error) {
      appRoot.setAttribute('inert', '');
      appRoot.setAttribute('aria-hidden', 'true');
      appShell.classList.remove('is-ready');
      view.showError(error, () => {
        void run();
      });
    }
  };

  void run();
  Object.defineProperty(ready, 'setProfile', {
    value: setProfile
  });
  return ready;
}
