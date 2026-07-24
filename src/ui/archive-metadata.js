const AUDIO_STATE_LABELS = Object.freeze({
  idle: '待机',
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
      number: '--',
      release: '未抽取',
      source: '档案库',
      state: '待机'
    };
  }

  return {
    number: String(index + 1).padStart(2, '0'),
    release: track.album || '未标注',
    source: track.recordingSource || '正式发行',
    state: AUDIO_STATE_LABELS[audioStatus] || '待机'
  };
}

export function createArchiveMetadata({ documentRef, tracks }) {
  const elements = {
    number: documentRef.getElementById('archiveTrackNumber'),
    release: documentRef.getElementById('archiveRelease'),
    source: documentRef.getElementById('archiveSource'),
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
