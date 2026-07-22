import { getTrackKey } from '../data.js';

export function createPlaylist({ listEl, releases, tracks, getCoverCandidates, onSelect }) {
  const trackIndexByKey = new Map(
    tracks.map((track, index) => [getTrackKey(track.album, track), index])
  );
  let rendered = false;
  let activeIndex = -1;

  const ensureRendered = () => {
    if (rendered) return;

    const document = listEl.ownerDocument;
    const fragment = document.createDocumentFragment();

    for (const release of releases) {
      const group = document.createElement('section');
      group.className = 'playlist-group';
      group.dataset.release = release.title;

      const heading = document.createElement('div');
      heading.className = 'playlist-group-head playlist-group-header';
      const cover = getCoverCandidates(release);

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

      const title = document.createElement('span');
      title.className = 'playlist-album-title';
      title.textContent = release.title;
      heading.append(title);
      group.append(heading);

      for (const track of release.tracks) {
        const index = trackIndexByKey.get(getTrackKey(release.title, track));
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'playlist-item';
        button.dataset.index = String(index);

        const trackNumber = document.createElement('span');
        trackNumber.className = 'playlist-track-no playlist-index';
        trackNumber.textContent = String(track.trackNumber).padStart(2, '0');

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

    listEl.querySelector(`.playlist-item[data-index="${activeIndex}"]`)?.classList.remove('is-current');
    listEl.querySelector(`.playlist-item[data-index="${index}"]`)?.classList.add('is-current');
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
