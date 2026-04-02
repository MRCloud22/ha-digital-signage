export const APP_CACHE_NAME = 'signage-app-v1';
export const MEDIA_CACHE_NAME = 'signage-media-v1';

const RUNTIME_CACHE_PREFIX = 'signage-runtime-cache-v1:';
const PREVIEW_CACHE_PREFIX = 'signage-preview-cache-v1:';
const SYNC_STATE_PREFIX = 'signage-sync-state-v1:';

function readJsonStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJsonStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function toAbsoluteUrl(url, base = window.location.href.split('#')[0]) {
  if (!url) return null;

  try {
    return new URL(url, base).toString();
  } catch {
    return null;
  }
}

export function readCachedRuntime(screenId) {
  return readJsonStorage(`${RUNTIME_CACHE_PREFIX}${screenId}`);
}

export function writeCachedRuntime(screenId, runtime) {
  writeJsonStorage(`${RUNTIME_CACHE_PREFIX}${screenId}`, {
    updatedAt: new Date().toISOString(),
    value: runtime,
  });
}

export function readCachedPreview(playlistId) {
  return readJsonStorage(`${PREVIEW_CACHE_PREFIX}${playlistId}`);
}

export function writeCachedPreview(playlistId, preview) {
  writeJsonStorage(`${PREVIEW_CACHE_PREFIX}${playlistId}`, {
    updatedAt: new Date().toISOString(),
    value: preview,
  });
}

export function readSyncState(screenId) {
  return readJsonStorage(`${SYNC_STATE_PREFIX}${screenId}`);
}

export function writeSyncState(screenId, state) {
  writeJsonStorage(`${SYNC_STATE_PREFIX}${screenId}`, {
    updatedAt: new Date().toISOString(),
    ...state,
  });
}

export function clearOfflineStorage(screenId = null) {
  const keysToDelete = [];

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key) continue;

    if (
      (screenId && (key === `${RUNTIME_CACHE_PREFIX}${screenId}` || key === `${SYNC_STATE_PREFIX}${screenId}`))
      || (!screenId && (key.startsWith(RUNTIME_CACHE_PREFIX) || key.startsWith(SYNC_STATE_PREFIX)))
    ) {
      keysToDelete.push(key);
      continue;
    }

    if (key.startsWith(PREVIEW_CACHE_PREFIX)) {
      keysToDelete.push(key);
    }
  }

  keysToDelete.forEach((key) => localStorage.removeItem(key));
}

export async function clearOfflineCaches() {
  if (!('caches' in window)) return;

  await Promise.all([APP_CACHE_NAME, MEDIA_CACHE_NAME].map(async (cacheName) => {
    const exists = await caches.has(cacheName);
    if (exists) {
      await caches.delete(cacheName);
    }
  }));
}

export function derivePlaylistIdsFromRuntime(runtime) {
  const playlistIds = new Set();

  if (runtime?.effective?.mode === 'playlist' && runtime?.effective?.playlist_id) {
    playlistIds.add(runtime.effective.playlist_id);
  }

  runtime?.layout?.zones?.forEach((zone) => {
    if (zone.playlist_id) {
      playlistIds.add(zone.playlist_id);
    }
  });

  return [...playlistIds];
}

export function deriveAssetUrlsFromPreview(preview) {
  const urls = new Set();

  (preview?.flattenedItems || []).forEach((item) => {
    if (!item?.filepath) return;
    if (!['image', 'video', 'document'].includes(item.type)) return;

    const absoluteUrl = toAbsoluteUrl(item.filepath);
    if (absoluteUrl) {
      urls.add(absoluteUrl);
    }
  });

  return [...urls];
}

export async function prefetchMediaAssets(urls) {
  if (!('caches' in window)) {
    return urls.map((url) => ({ url, ok: false, reason: 'cache_api_unavailable' }));
  }

  const cache = await caches.open(MEDIA_CACHE_NAME);
  const results = [];

  for (const url of urls) {
    try {
      const request = new Request(url, {
        method: 'GET',
        credentials: 'same-origin',
      });

      const existing = await cache.match(request);
      if (!existing) {
        const response = await fetch(request);
        if (!response.ok) {
          throw new Error(`http_${response.status}`);
        }
        await cache.put(request, response.clone());
      }

      results.push({ url, ok: true });
    } catch (error) {
      results.push({
        url,
        ok: false,
        reason: error instanceof Error ? error.message : 'cache_failed',
      });
    }
  }

  return results;
}

export async function pruneMediaCache(keepUrls) {
  if (!('caches' in window)) return;

  const cache = await caches.open(MEDIA_CACHE_NAME);
  const keepSet = new Set(keepUrls.map((url) => toAbsoluteUrl(url)).filter(Boolean));
  const keys = await cache.keys();

  await Promise.all(keys.map((request) => {
    if (keepSet.has(request.url)) return Promise.resolve();
    return cache.delete(request);
  }));
}

export async function warmAppShellAssets() {
  if (!('caches' in window)) return 0;

  const cache = await caches.open(APP_CACHE_NAME);
  const urls = new Set();
  const baseUrl = window.location.href.split('#')[0];
  const candidates = [
    baseUrl,
    './',
    'index.html',
  ];

  document.querySelectorAll('script[src], link[rel="stylesheet"][href]').forEach((node) => {
    const url = node.getAttribute('src') || node.getAttribute('href');
    if (url) {
      candidates.push(url);
    }
  });

  candidates.forEach((candidate) => {
    const absoluteUrl = toAbsoluteUrl(candidate);
    if (absoluteUrl) {
      urls.add(absoluteUrl);
    }
  });

  let cachedCount = 0;

  for (const url of urls) {
    try {
      const request = new Request(url, {
        method: 'GET',
        credentials: 'same-origin',
      });
      const existing = await cache.match(request);
      if (!existing) {
        const response = await fetch(request);
        if (!response.ok) continue;
        await cache.put(request, response.clone());
      }
      cachedCount += 1;
    } catch {
      // App shell caching is best-effort only.
    }
  }

  return cachedCount;
}
