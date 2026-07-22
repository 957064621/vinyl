const twoDigits = (value) => String(value).padStart(2, '0');

const waitForTransition = (element, {
  propertyName = 'opacity',
  timeoutMs = 900
} = {}) => new Promise((resolve) => {
  let settled = false;
  let timer;

  const cleanup = () => {
    clearTimeout(timer);
    element.removeEventListener('transitionend', handleTransitionEnd);
  };
  const finish = () => {
    if (settled) return;
    settled = true;
    cleanup();
    resolve();
  };
  const handleTransitionEnd = (event) => {
    if (event.target !== element || event.propertyName !== propertyName) return;
    finish();
  };

  timer = setTimeout(finish, timeoutMs);
  element.addEventListener('transitionend', handleTransitionEnd);
});

export function createLoadingScreen(documentRef = document) {
  const root = documentRef.querySelector('#loadingScreen');
  const progress = documentRef.querySelector('#loadingProgress');
  const copy = documentRef.querySelector('#loadingCopy');
  const retry = documentRef.querySelector('#loadingRetry');
  const slots = new Map(
    [...root.querySelectorAll('[data-loading-slot]')]
      .map((slot) => [slot.dataset.loadingSlot, slot])
  );

  const mountImage = (result) => {
    const slot = slots.get(result.id);
    if (!slot) return;
    slot.querySelector('img')?.remove();
    result.image.alt = result.alt;
    result.image.className = 'loading-image';
    result.image.dataset.assetId = result.id;
    slot.insertBefore(result.image, slot.firstChild);
  };

  const view = {
    reset() {
      root.dataset.state = 'loading';
      root.classList.remove('is-exiting');
      retry.hidden = true;
      retry.onclick = null;
      copy.textContent = '影像读取中';
      progress.textContent = '00 / 05';
      for (const slot of slots.values()) {
        delete slot.dataset.status;
        slot.classList.remove('is-ready', 'is-failed');
        slot.querySelector('img')?.remove();
      }
    },
    setProgress({ id, status, completed, total, result }) {
      progress.textContent = `${twoDigits(completed)} / ${twoDigits(total)}`;
      const slot = slots.get(id);
      if (slot) {
        slot.dataset.status = status;
        slot.classList.toggle('is-ready', status === 'ready');
        slot.classList.toggle('is-failed', status === 'failed');
      }
      if (status === 'ready' && result) mountImage(result);
      if (status === 'ready') copy.textContent = `已归档 ${completed} / ${total}`;
    },
    showError(error, onRetry) {
      root.dataset.state = 'error';
      for (const failure of error.failures || []) {
        const slot = slots.get(failure.id);
        if (slot) {
          slot.dataset.status = 'failed';
          slot.classList.remove('is-ready');
          slot.classList.add('is-failed');
        }
      }
      const failureIds = error.failures?.map(({ id }) => id).join('、');
      copy.textContent = `影像读取失败：${failureIds || error.message}`;
      retry.hidden = false;
      retry.onclick = () => {
        view.reset();
        onRetry();
      };
      retry.focus();
    },
    async playReadySequence(profile) {
      root.dataset.state = 'ready';
      copy.textContent = '档案接入完成';
      if (profile !== 'reduce') {
        await waitForTransition(root, { timeoutMs: 520 });
      }
    },
    async exit(profile) {
      root.classList.add('is-exiting');
      if (profile !== 'reduce') {
        await waitForTransition(root, { timeoutMs: 900 });
      }
      root.remove();
    }
  };

  return view;
}
