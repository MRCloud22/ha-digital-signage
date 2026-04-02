import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import axios from 'axios';
import { Clock3, Monitor } from 'lucide-react';
import {
  clearOfflineCaches,
  clearOfflineStorage,
  deriveAssetUrlsFromPreview,
  derivePlaylistIdsFromRuntime,
  prefetchMediaAssets,
  pruneMediaCache,
  readCachedPreview,
  readCachedRuntime,
  readSyncState,
  writeCachedPreview,
  writeCachedRuntime,
  writeSyncState,
} from '../../offlineCache';
import './Player.css';

const SERVER_URL = window.location.origin;
const API_URL = `${SERVER_URL}/api`;
const PLAYER_VERSION = '2.1.0';
const PENDING_PLAYER_EVENTS_KEY = 'signage_pending_events_v1';
const PLAYER_VOLUME_KEY = 'signage_player_volume_v1';

function createClientEventId(prefix = 'evt') {
  if (window.crypto?.randomUUID) {
    return `${prefix}-${window.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

function loadPendingPlayerEvents() {
  try {
    const raw = localStorage.getItem(PENDING_PLAYER_EVENTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function savePendingPlayerEvents(events) {
  if (!events.length) {
    localStorage.removeItem(PENDING_PLAYER_EVENTS_KEY);
    return;
  }

  localStorage.setItem(PENDING_PLAYER_EVENTS_KEY, JSON.stringify(events));
}

function enqueuePendingPlayerEvent(event) {
  const current = loadPendingPlayerEvents();
  current.push(event);
  savePendingPlayerEvents(current.slice(-250));
}

function buildInitialSyncState() {
  return {
    mode: 'idle',
    lastSyncedAt: null,
    cachedRuntimeAt: null,
    playlistCount: 0,
    assetCount: 0,
    cachedAssetCount: 0,
    failedAssetCount: 0,
    previewFallbackCount: 0,
    usingCachedRuntime: false,
  };
}

function buildRuntimeSyncSignature(runtime) {
  const zoneSignature = runtime?.layout?.zones
    ?.map((zone) => `${zone.id}:${zone.playlist_id || 'none'}`)
    .join('|') || '';

  return [
    runtime?.effective?.mode || 'none',
    runtime?.effective?.source || 'none',
    runtime?.effective?.playlist_id || 'none',
    runtime?.effective?.layout_id || 'none',
    zoneSignature,
  ].join('::');
}

function formatSyncTimestamp(value) {
  if (!value) return 'nie';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unbekannt';
  return date.toLocaleString('de-DE');
}

function hexToRgba(hex, opacityPercent) {
  const value = `${hex || '#1a1a2e'}`.replace('#', '');
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  const alpha = (opacityPercent ?? 90) / 100;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function parseRssItems(xmlString) {
  try {
    const parser = new DOMParser();
    const documentNode = parser.parseFromString(xmlString, 'application/xml');
    return [...documentNode.querySelectorAll('item title')]
      .map((node) => node.textContent?.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function buildDevicePayload() {
  return {
    resolution: `${window.innerWidth}x${window.innerHeight}`,
    deviceInfo: {
      platform: navigator.platform,
      userAgent: navigator.userAgent,
      language: navigator.language,
      browser: navigator.userAgentData?.brands?.map((entry) => entry.brand).join(', ') || null,
    },
  };
}

function buildScreenDisplayName() {
  const platform = `${navigator.userAgentData?.platform || navigator.platform || 'Browser'}`.replace(/\s+/g, ' ').trim();
  return `Screen (${platform || 'Browser'})`;
}

function clampVolumeLevel(value, fallback = 100) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(100, Math.max(0, Math.round(numeric)));
}

function readStoredPlayerVolume() {
  return clampVolumeLevel(localStorage.getItem(PLAYER_VOLUME_KEY), 100);
}

function readScreenBootstrapFromLocation() {
  const directSearchParams = new URLSearchParams(window.location.search);
  const directScreenId = directSearchParams.get('screenId');
  const directScreenToken = directSearchParams.get('screenToken');
  if (directScreenId && directScreenToken) {
    return {
      screenId: directScreenId.trim(),
      screenToken: directScreenToken.trim(),
    };
  }

  const hash = window.location.hash || '';
  const queryIndex = hash.indexOf('?');
  if (queryIndex === -1) return null;

  const hashParams = new URLSearchParams(hash.slice(queryIndex + 1));
  const screenId = (hashParams.get('screenId') || '').trim();
  const screenToken = (hashParams.get('screenToken') || '').trim();
  if (!screenId || !screenToken) {
    return null;
  }

  return { screenId, screenToken };
}

function readProvisioningTokenFromLocation() {
  const searchParams = new URLSearchParams(window.location.search);
  const directToken = searchParams.get('provisioning');
  if (directToken) return directToken.trim();

  const hash = window.location.hash || '';
  const queryIndex = hash.indexOf('?');
  if (queryIndex === -1) return '';

  const hashParams = new URLSearchParams(hash.slice(queryIndex + 1));
  return (hashParams.get('provisioning') || '').trim();
}

function clearProvisioningTokenFromLocation() {
  const url = new URL(window.location.href);
  url.searchParams.delete('provisioning');

  if (url.hash.includes('?')) {
    const [hashPath, hashQuery] = url.hash.split('?');
    const hashParams = new URLSearchParams(hashQuery);
    hashParams.delete('provisioning');
    url.hash = hashParams.toString() ? `${hashPath}?${hashParams.toString()}` : hashPath;
  }

  window.history.replaceState(null, '', url.toString());
}

function clearBootstrapSessionFromLocation() {
  const url = new URL(window.location.href);
  url.searchParams.delete('screenId');
  url.searchParams.delete('screenToken');

  if (url.hash.includes('?')) {
    const [hashPath, hashQuery] = url.hash.split('?');
    const hashParams = new URLSearchParams(hashQuery);
    hashParams.delete('screenId');
    hashParams.delete('screenToken');
    url.hash = hashParams.toString() ? `${hashPath}?${hashParams.toString()}` : hashPath;
  }

  window.history.replaceState(null, '', url.toString());
}

function TextSlide({ media }) {
  const settings = media.settings || {};

  return (
    <div
      className="text-slide-player"
      style={{
        background: settings.backgroundColor || '#0f172a',
        color: settings.textColor || '#f8fafc',
        textAlign: settings.align || 'center',
      }}
    >
      <div className="text-slide-player-accent" style={{ background: settings.accentColor || '#0ea5e9' }} />
      <div className="text-slide-player-content" style={{ fontSize: `${settings.fontSize || 42}px` }}>
        {media.content}
      </div>
    </div>
  );
}

function SingleZoneRenderer({
  playlistId,
  refreshVersion,
  runtimeMode,
  runtimeSource,
  playerVolume,
  reportPlayback,
  reportPlayerEvent,
}) {
  const [preview, setPreview] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [rssTextByPlaylist, setRssTextByPlaylist] = useState({});

  const timerRef = useRef(null);
  const rssTimersRef = useRef({});
  const playbackSessionRef = useRef(null);
  const previewFallbackSignatureRef = useRef(null);

  const loadRss = useCallback(async (sourcePlaylistId, rssUrl) => {
    if (!sourcePlaylistId || !rssUrl) return;

    try {
      const response = await axios.get(`${API_URL}/rss-proxy?url=${encodeURIComponent(rssUrl)}`);
      const titles = parseRssItems(response.data);
      if (titles.length > 0) {
        setRssTextByPlaylist((current) => ({
          ...current,
          [sourcePlaylistId]: titles.join(' | '),
        }));
      }
    } catch (error) {
      console.error('Failed to load RSS feed', error);
      reportPlayerEvent?.('warning', 'rss', 'RSS-Ticker konnte nicht geladen werden.', {
        playlistId: sourcePlaylistId,
        url: rssUrl,
        message: error.message,
      });
    }
  }, [reportPlayerEvent]);

  const markPlaybackStarted = useCallback((details = null) => {
    const session = playbackSessionRef.current;
    if (!session || session.startedPosted) return;

    session.startedPosted = true;
    reportPlayback?.({
      playbackId: session.playbackId,
      action: 'started',
      rootPlaylistId: session.rootPlaylistId,
      sourcePlaylistId: session.sourcePlaylistId,
      sourcePlaylistName: session.sourcePlaylistName,
      mediaId: session.mediaId,
      mediaName: session.mediaName,
      mediaType: session.mediaType,
      startedAt: session.startedAt,
      expectedDurationSeconds: session.expectedDurationSeconds,
      runtimeMode: session.runtimeMode,
      runtimeSource: session.runtimeSource,
      details,
    });
  }, [reportPlayback]);

  const finishPlayback = useCallback((status, extra = {}) => {
    const session = playbackSessionRef.current;
    if (!session || session.finished) return;

    session.finished = true;

    const endedAt = extra.endedAt || new Date().toISOString();
    const durationSeconds = extra.durationSeconds ?? Math.max(
      (new Date(endedAt).getTime() - new Date(session.startedAt).getTime()) / 1000,
      0,
    );

    reportPlayback?.({
      playbackId: session.playbackId,
      action: status,
      rootPlaylistId: session.rootPlaylistId,
      sourcePlaylistId: session.sourcePlaylistId,
      sourcePlaylistName: session.sourcePlaylistName,
      mediaId: session.mediaId,
      mediaName: session.mediaName,
      mediaType: session.mediaType,
      startedAt: session.startedAt,
      endedAt,
      durationSeconds: Number.isFinite(durationSeconds) ? Number(durationSeconds.toFixed(2)) : null,
      expectedDurationSeconds: session.expectedDurationSeconds,
      runtimeMode: session.runtimeMode,
      runtimeSource: session.runtimeSource,
      details: extra.details || null,
    });
  }, [reportPlayback]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const response = await axios.get(`${API_URL}/playlists/${playlistId}/preview`);
        if (cancelled) return;
        writeCachedPreview(playlistId, response.data);
        setPreview(response.data);
        setCurrentIndex(0);
        previewFallbackSignatureRef.current = null;
      } catch (error) {
        if (!cancelled) {
          const cachedPreviewRecord = readCachedPreview(playlistId);
          if (cachedPreviewRecord?.value) {
            setPreview(cachedPreviewRecord.value);
            setCurrentIndex(0);

            const signature = `${playlistId}:${cachedPreviewRecord.updatedAt || 'cached'}`;
            if (previewFallbackSignatureRef.current !== signature) {
              previewFallbackSignatureRef.current = signature;
              reportPlayerEvent?.('warning', 'offline-cache', 'Playlist-Preview aus lokalem Cache geladen.', {
                playlistId,
                cachedAt: cachedPreviewRecord.updatedAt || null,
                status: error.response?.status || null,
              });
            }
          } else {
            console.error('Failed to load playlist preview', error);
            setPreview(null);
            reportPlayerEvent?.('error', 'playlist-preview', 'Playlist-Preview konnte nicht geladen werden.', {
              playlistId,
              status: error.response?.status || null,
              message: error.message,
            });
          }
        }
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [playlistId, refreshVersion, reportPlayerEvent]);

  useEffect(() => {
    const rssTimerStore = rssTimersRef.current;

    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
      Object.values(rssTimerStore).forEach((timer) => window.clearInterval(timer));
    };
  }, []);

  useEffect(() => {
    if (!preview?.flattenedItems?.length) return undefined;

    const activeItem = preview.flattenedItems[currentIndex];
    if (!activeItem) return undefined;

    playbackSessionRef.current = {
      playbackId: createClientEventId('play'),
      rootPlaylistId: playlistId,
      sourcePlaylistId: activeItem.source_playlist_id || playlistId,
      sourcePlaylistName: activeItem.source_playlist_name || preview.playlist?.name || null,
      mediaId: activeItem.media_id || null,
      mediaName: activeItem.name || 'Unbekanntes Medium',
      mediaType: activeItem.type || null,
      expectedDurationSeconds: activeItem.effective_duration || null,
      runtimeMode,
      runtimeSource,
      startedAt: new Date().toISOString(),
      startedPosted: false,
      finished: false,
    };

    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }

    if (activeItem.type !== 'video') {
      markPlaybackStarted();
      const duration = (activeItem.effective_duration || 10) * 1000;
      timerRef.current = window.setTimeout(() => {
        finishPlayback('completed', { durationSeconds: duration / 1000 });
        setCurrentIndex((value) => (value + 1) % preview.flattenedItems.length);
      }, duration);
    }

    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, [currentIndex, finishPlayback, markPlaybackStarted, playlistId, preview, runtimeMode, runtimeSource]);

  useEffect(() => {
    const items = preview?.flattenedItems || [];
    items.forEach((item) => {
      if (!item.source_playlist_id || !item.source_playlist_rss_ticker_url) return;
      if (rssTimersRef.current[item.source_playlist_id]) return;

      loadRss(item.source_playlist_id, item.source_playlist_rss_ticker_url);
      rssTimersRef.current[item.source_playlist_id] = window.setInterval(() => {
        loadRss(item.source_playlist_id, item.source_playlist_rss_ticker_url);
      }, 5 * 60 * 1000);
    });
  }, [loadRss, preview]);

  if (!preview?.flattenedItems?.length) {
    return (
      <div className="zone-placeholder">
        <Clock3 size={24} />
        <span>Zone wartet auf Inhalte...</span>
      </div>
    );
  }

  const activeItem = preview.flattenedItems[currentIndex];

  return (
    <div className="zone-player-shell">
      <div className="zone-player-media">
        <MediaRenderer
          media={activeItem}
          playerVolume={playerVolume}
          totalItems={preview.flattenedItems.length}
          setCurrentIndex={setCurrentIndex}
          onPlaybackStart={markPlaybackStarted}
          onPlaybackComplete={(details) => finishPlayback('completed', details)}
          onPlaybackError={(details) => {
            finishPlayback('error', { details });
            reportPlayerEvent?.('error', 'media', 'Medienwiedergabe fehlgeschlagen.', details);
          }}
        />
      </div>
      {renderTicker(activeItem, rssTextByPlaylist)}
    </div>
  );
}

function renderTicker(item, rssTextByPlaylist) {
  if (!item?.source_playlist_rss_ticker_url) return null;

  const tickerText = rssTextByPlaylist[item.source_playlist_id];
  if (!tickerText) return null;

  const speed = item.source_playlist_rss_ticker_speed || 60;
  const fontSize = item.source_playlist_rss_ticker_font_size || 16;
  const estimatedWidth = tickerText.length * (fontSize * 0.62);
  const duration = Math.max(estimatedWidth / speed, 12);

  return (
    <div
      className="ticker-container"
      style={{
        background: hexToRgba(item.source_playlist_rss_ticker_bg_color || '#1a1a2e', item.source_playlist_rss_ticker_bg_opacity),
        height: `${fontSize * 2.4}px`,
      }}
    >
      <div
        className="ticker-content"
        style={{
          color: item.source_playlist_rss_ticker_color || '#ffffff',
          fontSize: `${fontSize}px`,
          animationDuration: `${duration}s`,
        }}
      >
        {tickerText}
      </div>
    </div>
  );
}

function MediaRenderer({ media, playerVolume, totalItems, setCurrentIndex, onPlaybackStart, onPlaybackComplete, onPlaybackError }) {
  switch (media.type) {
    case 'image':
      return (
        <img
          src={`${SERVER_URL}${media.filepath}`}
          alt={media.name}
          className="player-image"
          onError={() => onPlaybackError?.({ mediaName: media.name, mediaType: media.type, reason: 'image_load_failed' })}
        />
      );
    case 'video':
      return (
        <video
          key={`${media.id}-${media.name}`}
          src={`${SERVER_URL}${media.filepath}`}
          className="player-video"
          autoPlay
          ref={(node) => {
            if (node) {
              node.volume = clampVolumeLevel(playerVolume, 100) / 100;
            }
          }}
          muted={clampVolumeLevel(playerVolume, 100) === 0}
          onPlay={() => onPlaybackStart?.()}
          onEnded={() => {
            onPlaybackComplete?.();
            setCurrentIndex((value) => (value + 1) % totalItems);
          }}
          onError={() => {
            onPlaybackError?.({ mediaName: media.name, mediaType: media.type, reason: 'video_playback_failed' });
            setCurrentIndex((value) => (value + 1) % totalItems);
          }}
        />
      );
    case 'document':
      return (
        <iframe
          src={`${SERVER_URL}${media.filepath}#toolbar=0&navpanes=0&scrollbar=0`}
          title={media.name}
          className="player-frame"
        />
      );
    case 'webpage':
      return <iframe src={media.url} title={media.name} className="player-frame" />;
    case 'text':
      return <TextSlide media={media} />;
    default:
      return <div className="zone-placeholder">Nicht unterstuetzter Inhalt</div>;
  }
}

function PlayerPage() {
  const bootstrapSession = readScreenBootstrapFromLocation();
  const [isPaired, setIsPaired] = useState(!!(bootstrapSession?.screenToken || localStorage.getItem('screen_token')));
  const [pairingCode, setPairingCode] = useState('');
  const [screenId, setScreenId] = useState(bootstrapSession?.screenId || localStorage.getItem('screen_id') || null);
  const [screenToken, setScreenToken] = useState(bootstrapSession?.screenToken || localStorage.getItem('screen_token') || null);
  const [runtime, setRuntime] = useState(null);
  const [runtimeVersion, setRuntimeVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [playerVolume, setPlayerVolume] = useState(() => readStoredPlayerVolume());
  const [syncState, setSyncState] = useState(() => {
    const initialScreenId = bootstrapSession?.screenId || localStorage.getItem('screen_id');
    return initialScreenId ? readSyncState(initialScreenId) || buildInitialSyncState() : buildInitialSyncState();
  });
  const [setupMode, setSetupMode] = useState(() => (readProvisioningTokenFromLocation() ? 'provisioning' : 'pairing'));
  const [setupNotice, setSetupNotice] = useState('');

  const socketRef = useRef(null);
  const pairingSocketRef = useRef(null);
  const heartbeatIntervalRef = useRef(null);
  const runtimePollIntervalRef = useRef(null);
  const deviceHealthIntervalRef = useRef(null);
  const commandPollIntervalRef = useRef(null);
  const hasLoadedRuntimeRef = useRef(false);
  const lastRuntimeErrorSignatureRef = useRef(null);
  const lastSyncWarningSignatureRef = useRef(null);
  const lastSyncSignatureRef = useRef(null);
  const lastRendererRuntimeSignatureRef = useRef(null);
  const offlineSyncRef = useRef({ signature: null, promise: null });
  const setupAttemptRef = useRef(null);
  const processingCommandsRef = useRef(false);
  const runtimeRef = useRef(runtime);
  const syncStateRef = useRef(syncState);
  const playerVolumeRef = useRef(playerVolume);

  useEffect(() => {
    if (!bootstrapSession?.screenId || !bootstrapSession?.screenToken) return;

    localStorage.setItem('screen_id', bootstrapSession.screenId);
    localStorage.setItem('screen_token', bootstrapSession.screenToken);
    setScreenId(bootstrapSession.screenId);
    setScreenToken(bootstrapSession.screenToken);
    setIsPaired(true);
    setSetupNotice('');
    setSetupMode('pairing');
    clearBootstrapSessionFromLocation();
  }, [bootstrapSession?.screenId, bootstrapSession?.screenToken]);

  useEffect(() => {
    if (!screenId) {
      setSyncState(buildInitialSyncState());
      lastSyncSignatureRef.current = null;
      return;
    }

    lastSyncSignatureRef.current = null;
    setSyncState(readSyncState(screenId) || buildInitialSyncState());
  }, [screenId]);

  useEffect(() => {
    localStorage.setItem(PLAYER_VOLUME_KEY, `${playerVolume}`);
  }, [playerVolume]);

  useEffect(() => {
    runtimeRef.current = runtime;
  }, [runtime]);

  useEffect(() => {
    syncStateRef.current = syncState;
  }, [syncState]);

  useEffect(() => {
    playerVolumeRef.current = playerVolume;
  }, [playerVolume]);

  const clearStoredSession = useCallback(() => {
    localStorage.removeItem('screen_token');
    localStorage.removeItem('screen_id');
    setPairingCode('');
    setScreenToken(null);
    setScreenId(null);
    setIsPaired(false);
    setRuntime(null);
    setSyncState(buildInitialSyncState());
    setSetupMode(readProvisioningTokenFromLocation() ? 'provisioning' : 'pairing');
    setSetupNotice('');
    runtimeRef.current = null;
    syncStateRef.current = buildInitialSyncState();
    lastRendererRuntimeSignatureRef.current = null;
    offlineSyncRef.current = { signature: null, promise: null };
    hasLoadedRuntimeRef.current = false;
    lastSyncSignatureRef.current = null;
    setupAttemptRef.current = null;
  }, []);

  const postScreenEvent = useCallback(async (screenIdValue, tokenValue, path, payload) => {
    await axios.post(`${API_URL}/screens/${screenIdValue}/${path}`, payload, {
      headers: {
        'x-screen-token': tokenValue,
      },
    });
  }, []);

  const flushPendingEvents = useCallback(async (screenIdValue = screenId, tokenValue = screenToken) => {
    if (!screenIdValue || !tokenValue) return;

    const pendingEvents = loadPendingPlayerEvents();
    if (!pendingEvents.length) return;

    const remaining = [];

    for (const event of pendingEvents) {
      if (event.screenId !== screenIdValue) {
        remaining.push(event);
        continue;
      }

      try {
        await postScreenEvent(
          screenIdValue,
          tokenValue,
          event.kind === 'playback' ? 'playback-events' : 'player-events',
          event.payload,
        );
      } catch {
        remaining.push(event);
      }
    }

    savePendingPlayerEvents(remaining);
  }, [postScreenEvent, screenId, screenToken]);

  const queueOrSendEvent = useCallback(async (kind, payload) => {
    if (!screenId || !screenToken) return;

    try {
      await postScreenEvent(
        screenId,
        screenToken,
        kind === 'playback' ? 'playback-events' : 'player-events',
        payload,
      );
    } catch {
      enqueuePendingPlayerEvent({ kind, screenId, payload });
    }
  }, [postScreenEvent, screenId, screenToken]);

  const reportPlayback = useCallback((payload) => {
    void queueOrSendEvent('playback', payload);
  }, [queueOrSendEvent]);

  const reportPlayerEvent = useCallback((level, category, message, details = null) => {
    if (!screenId || !screenToken) return;

    void queueOrSendEvent('player', {
      eventId: createClientEventId('pev'),
      level,
      category,
      message,
      details,
      createdAt: new Date().toISOString(),
    });
  }, [queueOrSendEvent, screenId, screenToken]);

  const postDeviceHealth = useCallback(async (screenIdValue, tokenValue, payload) => {
    await axios.post(`${API_URL}/screens/${screenIdValue}/device-health`, payload, {
      headers: {
        'x-screen-token': tokenValue,
      },
    });
  }, []);

  const buildBrowserHealthPayload = useCallback(() => {
    const currentRuntime = runtimeRef.current;
    const currentSyncState = syncStateRef.current;

    return {
      playerVersion: PLAYER_VERSION,
      capabilities: ['refresh_runtime', 'reload_player', 'clear_offline_cache', 'restart_pairing', 'set_player_volume'],
      reportedAt: new Date().toISOString(),
      health: {
        playerVolume: playerVolumeRef.current,
        online: navigator.onLine,
        language: navigator.language,
        platform: navigator.platform,
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency || null,
        deviceMemory: navigator.deviceMemory || null,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        visibilityState: document.visibilityState,
        syncMode: currentSyncState?.mode || 'idle',
        usingCachedRuntime: !!currentSyncState?.usingCachedRuntime,
        runtimeMode: currentRuntime?.effective?.mode || 'none',
        runtimeSource: currentRuntime?.effective?.source || 'none',
      },
    };
  }, []);

  const reportDeviceHealth = useCallback(async (screenIdValue = screenId, tokenValue = screenToken) => {
    if (!screenIdValue || !tokenValue) return;

    try {
      await postDeviceHealth(screenIdValue, tokenValue, buildBrowserHealthPayload());
    } catch (error) {
      console.error('Failed to report device health', error);
    }
  }, [buildBrowserHealthPayload, postDeviceHealth, screenId, screenToken]);

  const updateDeviceCommandStatus = useCallback(async (
    commandId,
    status,
    message,
    result = null,
    screenIdValue = screenId,
    tokenValue = screenToken,
  ) => {
    if (!screenIdValue || !tokenValue || !commandId) return;

    await axios.post(`${API_URL}/screens/${screenIdValue}/device-commands/${commandId}/status`, {
      status,
      message,
      result,
      reportedAt: new Date().toISOString(),
    }, {
      headers: {
        'x-screen-token': tokenValue,
      },
    });
  }, [screenId, screenToken]);

  const fetchPendingPlayerCommands = useCallback(async (screenIdValue = screenId, tokenValue = screenToken) => {
    if (!screenIdValue || !tokenValue) return [];

    const response = await axios.get(`${API_URL}/screens/${screenIdValue}/device-commands/pending`, {
      headers: {
        'x-screen-token': tokenValue,
      },
      params: {
        target: 'player',
        limit: 5,
      },
    });

    return Array.isArray(response.data) ? response.data : [];
  }, [screenId, screenToken]);

  const syncRuntimeOfflineData = useCallback(async (screenIdValue, runtimeValue) => {
    if (!screenIdValue || !runtimeValue) return;

    const runtimeSignature = buildRuntimeSyncSignature(runtimeValue);
    const currentSyncState = readSyncState(screenIdValue);
    if (offlineSyncRef.current.signature === runtimeSignature && offlineSyncRef.current.promise) {
      return offlineSyncRef.current.promise;
    }
    if (lastSyncSignatureRef.current === runtimeSignature && currentSyncState?.mode === 'ready' && !currentSyncState?.usingCachedRuntime) {
      return;
    }
    lastSyncSignatureRef.current = runtimeSignature;

    const syncPromise = (async () => {
      try {
        const syncStartedAt = new Date().toISOString();
        const syncingState = {
          ...(currentSyncState || buildInitialSyncState()),
          mode: 'syncing',
          usingCachedRuntime: false,
          cachedRuntimeAt: syncStartedAt,
        };

        setSyncState(syncingState);
        writeSyncState(screenIdValue, syncingState);

        const playlistIds = derivePlaylistIdsFromRuntime(runtimeValue);
        const assetUrls = new Set();
        let previewFallbackCount = 0;

        for (const playlistId of playlistIds) {
          try {
            const response = await axios.get(`${API_URL}/playlists/${playlistId}/preview`);
            writeCachedPreview(playlistId, response.data);
            deriveAssetUrlsFromPreview(response.data).forEach((url) => assetUrls.add(url));
          } catch {
            const cachedPreviewRecord = readCachedPreview(playlistId);
            if (cachedPreviewRecord?.value) {
              previewFallbackCount += 1;
              deriveAssetUrlsFromPreview(cachedPreviewRecord.value).forEach((url) => assetUrls.add(url));
            }
          }
        }

        const prefetchResults = await prefetchMediaAssets([...assetUrls]);
        const failedAssetCount = prefetchResults.filter((entry) => !entry.ok).length;

        if (previewFallbackCount === 0) {
          await pruneMediaCache([...assetUrls]);
        }

        const nextState = {
          mode: 'ready',
          lastSyncedAt: syncStartedAt,
          cachedRuntimeAt: syncStartedAt,
          playlistCount: playlistIds.length,
          assetCount: assetUrls.size,
          cachedAssetCount: prefetchResults.filter((entry) => entry.ok).length,
          failedAssetCount,
          previewFallbackCount,
          usingCachedRuntime: false,
        };

        setSyncState(nextState);
        writeSyncState(screenIdValue, nextState);

        if (failedAssetCount > 0 || previewFallbackCount > 0) {
          const signature = `${failedAssetCount}:${previewFallbackCount}:${playlistIds.length}`;
          if (lastSyncWarningSignatureRef.current !== signature) {
            lastSyncWarningSignatureRef.current = signature;
            reportPlayerEvent('warning', 'offline-cache', 'Offline-Sync ist unvollstaendig.', {
              playlistCount: playlistIds.length,
              assetCount: assetUrls.size,
              failedAssetCount,
              previewFallbackCount,
            });
          }
        } else {
          lastSyncWarningSignatureRef.current = null;
        }
      } catch (error) {
        reportPlayerEvent('warning', 'offline-cache', 'Offline-Sync konnte nicht abgeschlossen werden.', {
          message: error instanceof Error ? error.message : 'sync_failed',
          runtimeSignature,
        });
      } finally {
        if (offlineSyncRef.current.signature === runtimeSignature) {
          offlineSyncRef.current = { signature: null, promise: null };
        }
      }
    })();

    offlineSyncRef.current = {
      signature: runtimeSignature,
      promise: syncPromise,
    };

    return syncPromise;
  }, [reportPlayerEvent]);

  const fetchRuntime = useCallback(async (options = {}) => {
    const { refreshRenderer = false } = options;

    if (!screenId) {
      setLoading(false);
      return;
    }

    try {
      if (!hasLoadedRuntimeRef.current) {
        setLoading(true);
      }

      const response = await axios.get(`${API_URL}/screens/${screenId}/runtime`);
      const nextRuntime = response.data;
      const runtimeSignature = buildRuntimeSyncSignature(nextRuntime);
      const shouldRefreshRenderer = refreshRenderer || lastRendererRuntimeSignatureRef.current !== runtimeSignature;

      writeCachedRuntime(screenId, nextRuntime);
      setRuntime(nextRuntime);
      runtimeRef.current = nextRuntime;
      if (shouldRefreshRenderer) {
        setRuntimeVersion((value) => value + 1);
      }
      lastRendererRuntimeSignatureRef.current = runtimeSignature;
      hasLoadedRuntimeRef.current = true;
      lastRuntimeErrorSignatureRef.current = null;
      setSyncState((current) => ({
        ...(current || buildInitialSyncState()),
        mode: current?.mode === 'syncing' ? 'syncing' : 'ready',
        usingCachedRuntime: false,
        cachedRuntimeAt: new Date().toISOString(),
      }));
      await flushPendingEvents(screenId, screenToken);
      void syncRuntimeOfflineData(screenId, nextRuntime);
    } catch (error) {
      if (error.response?.status === 404) {
        clearStoredSession();
      } else {
        const cachedRuntimeRecord = readCachedRuntime(screenId);
        if (cachedRuntimeRecord?.value) {
          const nextRuntime = cachedRuntimeRecord.value;
          const runtimeSignature = buildRuntimeSyncSignature(nextRuntime);
          const shouldRefreshRenderer = refreshRenderer || lastRendererRuntimeSignatureRef.current !== runtimeSignature;

          setRuntime(nextRuntime);
          runtimeRef.current = nextRuntime;
          if (shouldRefreshRenderer) {
            setRuntimeVersion((value) => value + 1);
          }
          lastRendererRuntimeSignatureRef.current = runtimeSignature;
          hasLoadedRuntimeRef.current = true;

          const fallbackState = {
            ...(readSyncState(screenId) || buildInitialSyncState()),
            mode: 'offline',
            usingCachedRuntime: true,
            cachedRuntimeAt: cachedRuntimeRecord.updatedAt || null,
          };

          setSyncState(fallbackState);
          writeSyncState(screenId, fallbackState);
        }

        const signature = `${error.response?.status || 'na'}:${error.message}`;
        if (lastRuntimeErrorSignatureRef.current !== signature) {
          lastRuntimeErrorSignatureRef.current = signature;
          reportPlayerEvent('warning', 'runtime', 'Runtime konnte nicht geladen werden.', {
            status: error.response?.status || null,
            message: error.message,
            usingCachedRuntime: !!cachedRuntimeRecord?.value,
          });
        }
      }

      console.error('Failed to fetch runtime', error);
    } finally {
      setLoading(false);
    }
  }, [clearStoredSession, flushPendingEvents, reportPlayerEvent, screenId, screenToken, syncRuntimeOfflineData]);

  const executePlayerCommand = useCallback(async (command) => {
    switch (command.command_type) {
      case 'refresh_runtime':
        await fetchRuntime({ refreshRenderer: true });
        return {
          message: 'Runtime wurde neu geladen.',
          result: {
            runtimeMode: runtimeRef.current?.effective?.mode || 'none',
          },
        };
      case 'reload_player':
        return {
          message: 'Player wird neu geladen.',
          afterComplete: 'reload',
        };
      case 'clear_offline_cache':
        clearOfflineStorage(screenId);
        await clearOfflineCaches();
        setSyncState(buildInitialSyncState());
        lastSyncSignatureRef.current = null;
        lastRendererRuntimeSignatureRef.current = null;
        hasLoadedRuntimeRef.current = false;
        await fetchRuntime({ refreshRenderer: true });
        return {
          message: 'Offline-Cache wurde geloescht.',
          result: {
            screenId,
          },
        };
      case 'restart_pairing':
        return {
          message: 'Player-Session wird zurueckgesetzt.',
          afterComplete: 'restart_pairing',
        };
      case 'set_player_volume': {
        const level = clampVolumeLevel(command.payload?.level, playerVolume);
        setPlayerVolume(level);
        return {
          message: `Player-Lautstaerke auf ${level}% gesetzt.`,
          result: {
            level,
          },
        };
      }
      default:
        throw new Error(`Unsupported player command: ${command.command_type}`);
    }
  }, [fetchRuntime, playerVolume, screenId]);

  const processPendingPlayerCommands = useCallback(async (screenIdValue = screenId, tokenValue = screenToken) => {
    if (!screenIdValue || !tokenValue || processingCommandsRef.current) return;

    processingCommandsRef.current = true;

    try {
      const commands = await fetchPendingPlayerCommands(screenIdValue, tokenValue);
      for (const command of commands) {
        try {
          await updateDeviceCommandStatus(command.id, 'acknowledged', 'Player fuehrt den Befehl aus.', null, screenIdValue, tokenValue);
          const execution = await executePlayerCommand(command);
          await updateDeviceCommandStatus(
            command.id,
            'completed',
            execution.message,
            execution.result || null,
            screenIdValue,
            tokenValue,
          );
          await reportDeviceHealth(screenIdValue, tokenValue);

          if (execution.afterComplete === 'reload') {
            window.setTimeout(() => window.location.reload(), 250);
            break;
          }

          if (execution.afterComplete === 'restart_pairing') {
            clearStoredSession();
            break;
          }
        } catch (error) {
          await updateDeviceCommandStatus(
            command.id,
            'failed',
            error instanceof Error ? error.message : 'Command failed.',
            {
              commandType: command.command_type,
            },
            screenIdValue,
            tokenValue,
          );
        }
      }
    } catch (error) {
      console.error('Failed to process pending player commands', error);
    } finally {
      processingCommandsRef.current = false;
    }
  }, [
    clearStoredSession,
    executePlayerCommand,
    fetchPendingPlayerCommands,
    reportDeviceHealth,
    screenId,
    screenToken,
    updateDeviceCommandStatus,
  ]);

  const clearConnectionState = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      window.clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (runtimePollIntervalRef.current) {
      window.clearInterval(runtimePollIntervalRef.current);
      runtimePollIntervalRef.current = null;
    }
    if (deviceHealthIntervalRef.current) {
      window.clearInterval(deviceHealthIntervalRef.current);
      deviceHealthIntervalRef.current = null;
    }
    if (commandPollIntervalRef.current) {
      window.clearInterval(commandPollIntervalRef.current);
      commandPollIntervalRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    if (pairingSocketRef.current) {
      pairingSocketRef.current.disconnect();
      pairingSocketRef.current = null;
    }
  }, []);

  const claimProvisionedScreen = useCallback(async (provisioningToken) => {
    if (!provisioningToken) {
      return false;
    }

    setPairingCode('');
    setSetupMode('provisioning');
    setSetupNotice('Installer erkannt. Dieses Display registriert sich jetzt automatisch.');

    try {
      const response = await axios.post(`${API_URL}/provisioning/claim`, {
        provisioningToken,
        screenName: buildScreenDisplayName(),
        ...buildDevicePayload(),
      });

      localStorage.setItem('screen_token', response.data.token);
      localStorage.setItem('screen_id', response.data.screenId);
      setScreenToken(response.data.token);
      setScreenId(response.data.screenId);
      setIsPaired(true);
      setSetupNotice('');
      clearProvisioningTokenFromLocation();
      hasLoadedRuntimeRef.current = false;
      return true;
    } catch (error) {
      const status = error.response?.status || null;
      const message = error.response?.data?.error;

      console.error('Failed to claim provisioning token', error);

      if (status === 404 || status === 410) {
        clearProvisioningTokenFromLocation();
      }

      setSetupNotice(
        status === 404
          ? 'Installer-Link nicht gefunden. Es wird auf manuelles Pairing umgestellt.'
          : status === 410
            ? `${message || 'Installer-Link ist nicht mehr gueltig.'} Es wird auf manuelles Pairing umgestellt.`
            : 'Provisioning konnte nicht abgeschlossen werden. Es wird auf manuelles Pairing umgestellt.',
      );

      return false;
    }
  }, []);

  const startPairingProcess = useCallback(async () => {
    try {
      setSetupMode('pairing');
      savePendingPlayerEvents([]);

      const response = await axios.post(`${API_URL}/screens/pair`, {
        name: buildScreenDisplayName(),
      });

      setPairingCode(response.data.pairingCode);

      const socket = io(SERVER_URL);
      pairingSocketRef.current = socket;

      socket.on('paired', (payload) => {
        if (payload.screenId !== response.data.id || !payload.token) return;

        localStorage.setItem('screen_token', payload.token);
        localStorage.setItem('screen_id', payload.screenId);
        setScreenToken(payload.token);
        setScreenId(payload.screenId);
        setIsPaired(true);
        setPairingCode('');
        setSetupNotice('');
        hasLoadedRuntimeRef.current = false;
        setupAttemptRef.current = null;
        socket.disconnect();
      });
    } catch (error) {
      console.error('Failed to start pairing', error);
      setSetupNotice('Pairing-Code konnte nicht angefordert werden. Bitte Serververbindung pruefen und erneut laden.');
      setupAttemptRef.current = null;
    }
  }, []);

  const connectWebSocket = useCallback(() => {
    if (!screenToken) return;

    const socket = io(SERVER_URL);
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('authenticate', {
        token: screenToken,
        ...buildDevicePayload(),
      });
    });

    socket.on('auth_success', async () => {
      socket.emit('heartbeat', buildDevicePayload());
      setSyncState((current) => ({
        ...(current || buildInitialSyncState()),
        mode: current?.usingCachedRuntime ? 'offline' : 'ready',
      }));
      reportPlayerEvent('info', 'connection', 'Player authentifiziert.', {
        screenId,
      });
      await flushPendingEvents(screenId, screenToken);
      await reportDeviceHealth(screenId, screenToken);
      await processPendingPlayerCommands(screenId, screenToken);
    });

    socket.on('playlist_changed', () => {
      void fetchRuntime({ refreshRenderer: true });
    });
    socket.on('layout_changed', () => {
      void fetchRuntime({ refreshRenderer: true });
    });
    socket.on('runtime_changed', () => {
      void fetchRuntime({ refreshRenderer: true });
    });
    socket.on('device_command_available', async (payload) => {
      if (payload?.target && payload.target !== 'player') return;
      await processPendingPlayerCommands(screenId, screenToken);
    });

    socket.on('connect_error', (error) => {
      console.error('Socket connection failed', error);
      setSyncState((current) => ({
        ...(current || buildInitialSyncState()),
        mode: 'offline',
      }));
      reportPlayerEvent('warning', 'connection', 'Socket-Verbindung fehlgeschlagen.', {
        message: error.message,
      });
    });

    socket.on('disconnect', (reason) => {
      setSyncState((current) => ({
        ...(current || buildInitialSyncState()),
        mode: 'offline',
      }));
      reportPlayerEvent('warning', 'connection', 'Socket-Verbindung getrennt.', { reason });
    });

    socket.on('auth_error', () => {
      clearStoredSession();
    });
  }, [
    clearStoredSession,
    fetchRuntime,
    flushPendingEvents,
    processPendingPlayerCommands,
    reportDeviceHealth,
    reportPlayerEvent,
    screenId,
    screenToken,
  ]);

  useEffect(() => {
    document.body.classList.add('player-mode');

    let cancelled = false;

    const initializePlayer = async () => {
      if (screenToken) {
        setIsPaired(true);
        connectWebSocket();
        fetchRuntime();

        heartbeatIntervalRef.current = window.setInterval(() => {
          socketRef.current?.emit('heartbeat', buildDevicePayload());
        }, 15000);

        runtimePollIntervalRef.current = window.setInterval(() => {
          fetchRuntime();
        }, 30000);

        deviceHealthIntervalRef.current = window.setInterval(() => {
          void reportDeviceHealth();
        }, 60000);

        commandPollIntervalRef.current = window.setInterval(() => {
          void processPendingPlayerCommands();
        }, 12000);
        return;
      }

      setIsPaired(false);
      hasLoadedRuntimeRef.current = false;
      setLoading(false);

      const provisioningToken = readProvisioningTokenFromLocation();
      const attemptKey = provisioningToken ? `provisioning:${provisioningToken}` : 'pairing';
      if (setupAttemptRef.current === attemptKey) {
        return;
      }

      setupAttemptRef.current = attemptKey;

      if (provisioningToken) {
        const claimed = await claimProvisionedScreen(provisioningToken);
        if (claimed || cancelled) {
          return;
        }

        setupAttemptRef.current = 'pairing';
      } else {
        setSetupMode('pairing');
      }

      if (!cancelled) {
        await startPairingProcess();
      }
    };

    void initializePlayer();

    return () => {
      cancelled = true;
      document.body.classList.remove('player-mode');
      clearConnectionState();
    };
  }, [
    claimProvisionedScreen,
    clearConnectionState,
    connectWebSocket,
    fetchRuntime,
    processPendingPlayerCommands,
    reportDeviceHealth,
    screenToken,
    startPairingProcess,
  ]);

  if (!isPaired) {
    const isProvisioning = setupMode === 'provisioning';

    return (
      <div className="player-page-root">
        <div className="pairing-card glass-card">
          <div className="pairing-header">
            <Monitor size={48} className="pairing-icon" />
            <h2>{isProvisioning ? 'Provisioning laeuft' : 'Display Setup'}</h2>
            <p>
              {isProvisioning
                ? 'Dieses Geraet wird jetzt automatisch als neuer Screen registriert.'
                : 'Gib diesen Code im Dashboard unter Screens ein, um das Display zu koppeln.'}
            </p>
          </div>
          {setupNotice ? <div className="pairing-status">{setupNotice}</div> : null}
          {isProvisioning ? (
            <div className="pairing-spinner-shell">
              <div className="spinner" />
            </div>
          ) : (
            <div className="pairing-code-display">{pairingCode || '---'}</div>
          )}
          <div className="pairing-footer">Server: {SERVER_URL}</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="player-page-root">
        <div className="loader">
          <div className="spinner" />
          <p>Runtime wird geladen...</p>
        </div>
      </div>
    );
  }

  if (runtime?.effective?.mode === 'layout' && runtime.layout) {
    return (
      <div className="player-content-root" style={{ backgroundColor: runtime.layout.bg_color || '#000000' }}>
        <SyncStatusBadge syncState={syncState} />
        {runtime.layout.zones?.map((zone) => (
          <div
            key={`${zone.id}-${zone.playlist_id || 'empty'}-${runtimeVersion}`}
            className="layout-zone-shell"
            style={{
              left: `${zone.x_percent}%`,
              top: `${zone.y_percent}%`,
              width: `${zone.width_percent}%`,
              height: `${zone.height_percent}%`,
              zIndex: zone.z_index || 1,
            }}
          >
            {zone.playlist_id ? (
              <SingleZoneRenderer
                playlistId={zone.playlist_id}
                refreshVersion={runtimeVersion}
                runtimeMode={runtime.effective.mode}
                runtimeSource={runtime.effective.source}
                playerVolume={playerVolume}
                reportPlayback={reportPlayback}
                reportPlayerEvent={reportPlayerEvent}
              />
            ) : (
              <div className="zone-placeholder">
                <Clock3 size={24} />
                <span>Keine Playlist zugewiesen</span>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (runtime?.effective?.mode === 'playlist' && runtime?.effective?.playlist_id) {
    return (
      <div className="player-content-root" style={{ backgroundColor: '#000000' }}>
        <SyncStatusBadge syncState={syncState} />
        <SingleZoneRenderer
          key={`${runtime.effective.playlist_id}-${runtimeVersion}`}
          playlistId={runtime.effective.playlist_id}
          refreshVersion={runtimeVersion}
          runtimeMode={runtime.effective.mode}
          runtimeSource={runtime.effective.source}
          playerVolume={playerVolume}
          reportPlayback={reportPlayback}
          reportPlayerEvent={reportPlayerEvent}
        />
      </div>
    );
  }

  return (
    <div className="player-page-root">
      <div className="status-card glass-card">
        <div className="success-icon">OK</div>
        <h2>Display bereit</h2>
        <p>Warte auf zugewiesene Inhalte oder einen aktiven Zeitplan.</p>
        <div className="screen-info">ID: {(screenId || '').slice(0, 8)}...</div>
        <SyncStatusBadge syncState={syncState} compact />
      </div>
    </div>
  );
}

function SyncStatusBadge({ syncState, compact = false }) {
  const mode = syncState?.mode || 'idle';
  const title = mode === 'offline'
    ? syncState?.usingCachedRuntime ? 'Offline Cache aktiv' : 'Offline'
    : mode === 'syncing'
      ? 'Offline-Sync laeuft'
      : mode === 'ready'
        ? 'Offline-Cache bereit'
        : 'Offline-Cache wartet';

  return (
    <div className={`player-sync-indicator ${mode} ${compact ? 'compact' : ''}`}>
      <div className="player-sync-title">{title}</div>
      <div>Letzter Sync: {formatSyncTimestamp(syncState?.lastSyncedAt || syncState?.cachedRuntimeAt)}</div>
      <div>
        Assets: {syncState?.cachedAssetCount || 0}/{syncState?.assetCount || 0}
        {syncState?.failedAssetCount ? ` | Fehler: ${syncState.failedAssetCount}` : ''}
      </div>
    </div>
  );
}

export default PlayerPage;
