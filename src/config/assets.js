export const COVER_OSS_ORIGIN = 'https://yuko-vinyl.oss-cn-hangzhou.aliyuncs.com/covers/';

const COVER_FILES = [
  '1.jpg',
  '2.jpg',
  '3.jpg',
  '4.jpg',
  '5.jpg',
  '6.jpg',
  '7.jpg',
  '8.jpg',
  '9.jpg',
  'end.jpg'
];

export function ossImageDerivative(source, width) {
  return `${source}${source.includes('?') ? '&' : '?'}x-oss-process=image/resize,w_${width}/format,webp`;
}

export const CRITICAL_IMAGE_MANIFEST = Object.freeze(COVER_FILES.map((file, index) => {
  const source = new URL(file, COVER_OSS_ORIGIN).href;
  return Object.freeze({
    id: `archive-${String(index + 1).padStart(2, '0')}`,
    alt: `加载封面图${index + 1}`,
    source,
    mobile: ossImageDerivative(source, 480),
    desktop: ossImageDerivative(source, 960),
    fallback: ossImageDerivative(source, 320)
  });
}));

export function selectCriticalImageCandidates(asset, viewportWidth) {
  const primary = viewportWidth < 768 ? asset.mobile : asset.desktop;
  return [...new Set([primary, asset.fallback, asset.source].filter(Boolean))];
}
