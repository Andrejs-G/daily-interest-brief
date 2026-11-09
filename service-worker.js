/*
 * Change CACHE_VERSION whenever the HTML, CSS, JavaScript, manifest or icons change.
 * news.json is network-first and does not require a version change.
 * All URLs and cache names are scoped to this installation, including /repo/.
 */
'use strict';

importScripts('./feed.js');

const CACHE_VERSION = 'v5';
const SCOPE = self.registration.scope;
const CACHE_PREFIX = 'daily-interest-brief:' + encodeURIComponent(SCOPE) + ':';
const SHELL_PREFIX = CACHE_PREFIX + 'shell:';
const SHELL_CACHE = SHELL_PREFIX + CACHE_VERSION;
// Retain the last valid edition when a new shell version is installed.
const FEED_CACHE = CACHE_PREFIX + 'feed';
const INDEX_URL = new URL('index.html', SCOPE).href;
const FEED_URL = new URL('news.json', SCOPE).href;
const TIMEOUT_MS = 7000;
const SHELL_URLS = [
  'index.html',
  'styles.css',
  'app.js',
  'renderer.js',
  'edition.js',
  'feed.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'icons/icon.svg'
].map(function (path) { return new URL(path, SCOPE).href; });

async function validatedFeed(response) {
  if (!response || !response.ok) {
    throw new Error('Feed request was unsuccessful.');
  }
  // Parse and validate a clone so the original response remains readable.
  BriefFeed.validateBrief(await response.clone().json());
  return response;
}

async function fetchFeed(request) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
  try {
    const response = await fetch(request, {
      cache: 'no-store',
      signal: controller.signal
    });
    return await validatedFeed(response);
  } finally {
    clearTimeout(timer);
  }
}

async function cachedFeed() {
  const cache = await caches.open(FEED_CACHE);
  return validatedFeed(await cache.match(FEED_URL));
}

function offlineResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Brief-Cache', 'offline');
  // The body exposed by Fetch is already decoded.
  headers.delete('Content-Encoding');
  headers.delete('Content-Length');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: headers
  });
}

async function newsResponse(request) {
  try {
    const response = await fetchFeed(request);
    try {
      const cache = await caches.open(FEED_CACHE);
      await cache.put(FEED_URL, response.clone());
    } catch (_) {
      // Storage may be unavailable or full; still deliver valid online news.
    }
    return response;
  } catch (_) {
    try {
      return offlineResponse(await cachedFeed());
    } catch (_) {
      return new Response(JSON.stringify({ error: 'No saved edition is available.' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }
  }
}

self.addEventListener('install', function (event) {
  event.waitUntil((async function () {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL_URLS.map(function (url) {
      return new Request(url, { cache: 'reload' });
    }));
    try {
      const response = await fetchFeed(FEED_URL);
      const feed = await caches.open(FEED_CACHE);
      await feed.put(FEED_URL, response);
    } catch (error) {
      // An existing valid edition can survive an update during a feed outage.
      try { await cachedFeed(); } catch (_) { throw error; }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    const names = await caches.keys();
    await Promise.all(names.map(function (name) {
      if (name.startsWith(SHELL_PREFIX) && name !== SHELL_CACHE) {
        return caches.delete(name);
      }
      return Promise.resolve(false);
    }));
    await self.clients.claim();
  })());
});

self.addEventListener('message', function (event) {
  if (!event.data || event.data.type !== 'BRIEF_CACHE_STATUS' || !event.source) return;
  event.waitUntil((async function () {
    let ready = false;
    try {
      const shell = await caches.open(SHELL_CACHE);
      const saved = await Promise.all(SHELL_URLS.map(function (url) {
        return shell.match(url);
      }));
      // Report readiness from the stored resources, not merely worker activation.
      if (saved.every(function (response) { return response && response.ok; })) {
        await cachedFeed();
        ready = true;
      }
    } catch (_) {
      // Missing, inaccessible or invalid cached data is not offline-ready.
    }
    try {
      event.source.postMessage({ type: 'BRIEF_CACHE_STATUS', ready: ready });
    } catch (_) {
      // The requesting page may have closed while its cache was being checked.
    }
  })());
});

async function navigationResponse(request) {
  // Keep HTML and its cache-first assets on the same installed shell version.
  // A newly activated worker supplies the next complete shell after app reload.
  try {
    const shell = await caches.open(SHELL_CACHE);
    const saved = await shell.match(INDEX_URL);
    if (saved && saved.ok) return saved;
  } catch (_) {
    // If storage is unavailable, try opening the page directly from the network.
  }
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
  try {
    const response = await fetch(request, { signal: controller.signal });
    if (response.ok) return response;
    throw new Error('Page request was unsuccessful.');
  } catch (_) {
    return new Response('Open Daily Brief online once to save it for offline use.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function shellResponse(request) {
  const shell = await caches.open(SHELL_CACHE);
  const saved = await shell.match(request, { ignoreSearch: true });
  return saved || fetch(request);
}

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Do not intercept source links, third-party content or neighbouring apps.
  if (url.origin !== self.location.origin || !url.href.startsWith(SCOPE)) return;

  if (url.origin + url.pathname === FEED_URL) {
    event.respondWith(newsResponse(request));
  } else if (request.mode === 'navigate') {
    event.respondWith(navigationResponse(request));
  } else if (SHELL_URLS.includes(url.origin + url.pathname)) {
    event.respondWith(shellResponse(request));
  }
});
