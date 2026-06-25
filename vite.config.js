import { defineConfig } from 'vite';

const MUSIC_OSS_ORIGIN = 'https://yuko-vinyl.oss-cn-hangzhou.aliyuncs.com';

const inlineMusicProxy = () => ({
  name: 'inline-music-proxy',
  configureServer(server) {
    server.middlewares.use('/music', async (req, res) => {
      await proxyMusicRequest(req, res);
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use('/music', async (req, res) => {
      await proxyMusicRequest(req, res);
    });
  }
});

const proxyMusicRequest = async (req, res) => {
  try {
    const rawUrl = req.url || '/';
    const [rawPath = '/', rawSearch = ''] = rawUrl.split('?');
    const objectName = rawPath.replace(/^\/+/, '');
    if (!objectName || objectName.includes('..')) {
      res.statusCode = 400;
      res.end('Bad music path');
      return;
    }

    const ossUrl = `${MUSIC_OSS_ORIGIN}/musics/${objectName}${rawSearch ? `?${rawSearch}` : ''}`;
    const headers = {};
    const range = req.headers.range;
    if (range) headers.Range = range;

    const upstream = await fetch(ossUrl, { headers });
    res.statusCode = upstream.status;
    res.statusMessage = upstream.statusText;

    upstream.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (lowerKey === 'content-disposition') return;
      if (lowerKey === 'content-encoding') return;
      if (lowerKey === 'transfer-encoding') return;
      res.setHeader(key, value);
    });

    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/mpeg');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', upstream.headers.get('cache-control') || 'public, max-age=31536000, immutable');

    if (!upstream.body) {
      res.end();
      return;
    }

    const reader = upstream.body.getReader();
    const pump = async () => {
      const { done, value } = await reader.read();
      if (done) {
        res.end();
        return;
      }
      res.write(Buffer.from(value));
      await pump();
    };

    await pump();
  } catch (error) {
    res.statusCode = 502;
    res.end('Music proxy failed');
  }
};

export default defineConfig({
  base: './',
  plugins: [inlineMusicProxy()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
    cssCodeSplit: true
  },
  server: {
    host: '0.0.0.0',
    port: 5173
  },
  preview: {
    host: '0.0.0.0',
    port: 4173
  }
});
