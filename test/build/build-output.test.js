import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const distUrl = new URL('../../dist/', import.meta.url);
const deploymentUrl = new URL('https://957064621.github.io/vinyl/');
const manifestUrl = new URL('manifest.webmanifest', deploymentUrl);
const html = await readFile(new URL('index.html', distUrl), 'utf8');
const document = new JSDOM(html).window.document;
const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', distUrl), 'utf8'));

const toDistPath = (pathname) => {
  const deploymentPath = deploymentUrl.pathname;
  assert.ok(pathname.startsWith(deploymentPath), `${pathname} escapes ${deploymentPath}`);
  const relativePath = pathname.slice(deploymentPath.length);
  return resolve(fileURLToPath(distUrl), relativePath);
};

test('emits the web manifest at the deployment root', async () => {
  const manifestLink = document.querySelector('link[rel="manifest"]');

  assert.ok(manifestLink);
  assert.equal(manifestLink.getAttribute('href'), './manifest.webmanifest');
  assert.equal(new URL(manifestLink.href, deploymentUrl).href, manifestUrl.href);

  const builtFiles = await readdir(new URL('assets/', distUrl), { recursive: true });
  assert.equal(builtFiles.some((file) => file.endsWith('.webmanifest')), false);
});

test('keeps manifest navigation and icon paths inside the application scope', async () => {
  assert.equal(manifest.start_url, './');
  assert.equal(new URL(manifest.start_url, manifestUrl).href, deploymentUrl.href);

  for (const icon of manifest.icons ?? []) {
    assert.equal(typeof icon.src, 'string');
    const iconUrl = new URL(icon.src, manifestUrl);
    assert.equal(iconUrl.origin, deploymentUrl.origin);
    await access(toDistPath(iconUrl.pathname));
  }
});

test('references only emitted local application assets', async () => {
  const assetReferences = [
    ...document.querySelectorAll('script[src], link[rel="stylesheet"][href], link[rel~="icon"][href]')
  ].map((node) => node.getAttribute(node.matches('script') ? 'src' : 'href'));

  assert.ok(assetReferences.length > 0);

  for (const reference of assetReferences) {
    const assetUrl = new URL(reference, deploymentUrl);
    assert.equal(assetUrl.origin, deploymentUrl.origin);
    await access(toDistPath(assetUrl.pathname));
  }
});
