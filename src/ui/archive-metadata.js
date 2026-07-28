const AUDIO_STATE_LABELS = Object.freeze({
  idle: '待机',
  drawing: '抽取中',
  loading: '读取',
  playing: '播放',
  ready: '暂停',
  paused: '暂停',
  error: '故障'
});

export function getArchiveMetadata(tracks, index, audioStatus) {
  const track = Number.isInteger(index) && index >= 0 ? tracks[index] : null;

  if (!track) {
    return {
      song: '未抽取',
      release: '未抽取',
      year: '----',
      state: AUDIO_STATE_LABELS[audioStatus] || '待机'
    };
  }

  const releaseYear = String(track.releaseDate || '').match(/^\d{4}/)?.[0];

  return {
    song: track.title || '未标注',
    release: track.album || '未标注',
    year: releaseYear || '待核对',
    state: AUDIO_STATE_LABELS[audioStatus] || '待机'
  };
}

export function createArchiveMetadata({ documentRef, tracks }) {
  const elements = {
    song: documentRef.getElementById('archiveTrackSong')
      || documentRef.getElementById('archiveTrackNumber'),
    release: documentRef.getElementById('archiveRelease'),
    year: documentRef.getElementById('archiveYear')
      || documentRef.getElementById('archiveSource'),
    state: documentRef.getElementById('archivePlaybackState')
  };

  if (Object.values(elements).some((element) => !element)) {
    throw new TypeError('Archive metadata requires all four value elements');
  }

  return function updateArchiveMetadata(index, audioStatus) {
    const metadata = getArchiveMetadata(tracks, index, audioStatus);
    for (const [key, value] of Object.entries(metadata)) {
      elements[key].textContent = value;
    }
    return metadata;
  };
}
