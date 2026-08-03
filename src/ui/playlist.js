import { getTrackKey } from '../data.js';

export function createPlaylistSelectionGuard({ isLocked, onSelect }) {
  return (index) => {
    if (isLocked()) return;
    return onSelect(index);
  };
}

export function getPlaylistViewportItems(items, viewportRect, anchorIndex = -1) {
  const visibleItems = [];

  if (Number.isInteger(anchorIndex) && anchorIndex >= 0 && anchorIndex < items.length) {
    for (let index = anchorIndex; index >= 0; index -= 1) {
      const item = items[index];
      const itemRect = item.getBoundingClientRect();
      if (itemRect.bottom < viewportRect.top) break;
      if (itemRect.top <= viewportRect.bottom) visibleItems.unshift(item);
    }

    for (let index = anchorIndex + 1; index < items.length; index += 1) {
      const item = items[index];
      const itemRect = item.getBoundingClientRect();
      if (itemRect.top > viewportRect.bottom) break;
      if (itemRect.bottom >= viewportRect.top) visibleItems.push(item);
    }

    return visibleItems;
  }

  for (const item of items) {
    const itemRect = item.getBoundingClientRect();
    if (itemRect.bottom < viewportRect.top) continue;
    if (itemRect.top > viewportRect.bottom) break;
    visibleItems.push(item);
  }

  return visibleItems;
}

export function getPlaylistContextScrollTop(listEl, currentItem) {
  if (!listEl || !currentItem) return 0;

  const currentGroup = currentItem.closest?.('.playlist-group');
  const contextAnchor = currentGroup?.querySelector?.('.playlist-group-head')
    || currentGroup
    || currentItem;
  const listRect = listEl.getBoundingClientRect();
  const anchorRect = contextAnchor.getBoundingClientRect();
  const computedStyle = listEl.ownerDocument?.defaultView?.getComputedStyle?.(listEl);
  const paddingTop = Number.parseFloat(computedStyle?.paddingTop) || 0;
  const currentScrollTop = Number(listEl.scrollTop) || 0;
  const target = currentScrollTop + anchorRect.top - listRect.top - paddingTop;
  const maxScrollTop = Math.max(
    0,
    (Number(listEl.scrollHeight) || 0) - (Number(listEl.clientHeight) || 0)
  );

  return Math.min(maxScrollTop, Math.max(0, target));
}

const getReleaseYear = (releaseDate) => (
  String(releaseDate || '').match(/^\d{4}/)?.[0] || '待核对'
);

export function createPlaylist({ listEl, releases, tracks, getCoverCandidates, onSelect }) {
  const isTrackRecord = (track, requireAlbum = false) => Boolean(
    track
    && typeof track === 'object'
    && typeof track.title === 'string'
    && track.title.trim()
    && (track.trackNumber == null || Number.isInteger(track.trackNumber))
    && (!requireAlbum || (typeof track.album === 'string' && track.album.trim()))
  );
  const trackIndexByKey = new Map();
  tracks.forEach((track, index) => {
    if (!isTrackRecord(track, true)) return;
    trackIndexByKey.set(getTrackKey(track.album, track), index);
  });
  let rendered = false;
  let activeIndex = -1;

  const ensureRendered = () => {
    if (rendered) return;

    const document = listEl.ownerDocument;
    const fragment = document.createDocumentFragment();

    for (const release of releases) {
      if (!release || typeof release !== 'object' || typeof release.title !== 'string') continue;

      const releaseTracks = Array.isArray(release.tracks) ? release.tracks : [];
      const matchedTracks = [];
      releaseTracks.forEach((track, releaseTrackIndex) => {
        if (!isTrackRecord(track)) return;

        const index = trackIndexByKey.get(getTrackKey(release.title, track));
        if (!Number.isInteger(index)) return;
        matchedTracks.push({ index, releaseTrackIndex, track });
      });
      if (matchedTracks.length === 0) continue;

      const group = document.createElement('section');
      group.className = 'playlist-group';
      group.dataset.release = release.title;

      const heading = document.createElement('div');
      heading.className = 'playlist-group-head playlist-group-header';
      const cover = getCoverCandidates(release);

      const releaseIdentity = document.createElement('div');
      releaseIdentity.className = 'playlist-album-identity';

      const title = document.createElement('span');
      title.className = 'playlist-album-title';
      title.textContent = release.title;

      const year = document.createElement('span');
      year.className = 'playlist-album-meta';
      year.textContent = getReleaseYear(release.releaseDate);

      releaseIdentity.append(title, year);
      heading.append(releaseIdentity);

      if (cover?.src) {
        const image = document.createElement('img');
        image.className = 'playlist-cover';
        image.src = cover.src;
        image.srcset = cover.srcset || '';
        image.sizes = '64px';
        image.alt = '';
        image.loading = 'lazy';
        image.decoding = 'async';
        image.addEventListener('error', () => {
          image.srcset = '';
          if (cover.fallback && image.src !== cover.fallback) {
            image.src = cover.fallback;
          }
        }, { once: true });
        heading.append(image);
      }
      group.append(heading);

      for (const { index, releaseTrackIndex, track } of matchedTracks) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'playlist-item';
        button.dataset.index = String(index);

        const trackNumber = document.createElement('span');
        trackNumber.className = 'playlist-track-no playlist-index';
        const displayTrackNumber = Number.isInteger(track.trackNumber)
          ? track.trackNumber
          : releaseTrackIndex + 1;
        trackNumber.textContent = String(displayTrackNumber).padStart(2, '0');

        const trackName = document.createElement('span');
        trackName.className = 'playlist-track-name playlist-song';
        trackName.textContent = track.title;

        button.append(trackNumber, trackName);
        group.append(button);
      }

      fragment.append(group);
    }

    listEl.append(fragment);
    rendered = true;
  };

  const setActive = (index) => {
    if (!rendered || index === activeIndex) return;

    const previousItem = listEl.querySelector(`.playlist-item[data-index="${activeIndex}"]`);
    previousItem?.classList.remove('is-current');
    previousItem?.removeAttribute('aria-current');
    previousItem?.closest('.playlist-group')?.classList.remove('is-current-group');

    const nextItem = listEl.querySelector(`.playlist-item[data-index="${index}"]`);
    nextItem?.classList.add('is-current');
    nextItem?.setAttribute('aria-current', 'true');
    nextItem?.closest('.playlist-group')?.classList.add('is-current-group');
    activeIndex = index;
  };

  const handleClick = (event) => {
    const item = event.target.closest?.('.playlist-item');
    if (item) onSelect(Number(item.dataset.index));
  };

  listEl.addEventListener('click', handleClick);

  return {
    ensureRendered,
    setActive,
    get rendered() {
      return rendered;
    },
    destroy() {
      listEl.removeEventListener('click', handleClick);
    }
  };
}
