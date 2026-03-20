import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import axios from 'axios';
import { Clock3, Monitor } from 'lucide-react';
import './Player.css';

const SERVER_URL = window.location.origin;
const API_URL = `${SERVER_URL}/api`;

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

function SingleZoneRenderer({ playlistId, refreshVersion }) {
  const [preview, setPreview] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [rssTextByPlaylist, setRssTextByPlaylist] = useState({});

  const timerRef = useRef(null);
  const rssTimersRef = useRef({});

  const loadRss = useCallback(async (sourcePlaylistId, rssUrl) => {
    if (!sourcePlaylistId || !rssUrl) return;

    try {
      const response = await axios.get(`${API_URL}/rss-proxy?url=${encodeURIComponent(rssUrl)}`);
      const titles = parseRssItems(response.data);
      if (titles.length > 0) {
        setRssTextByPlaylist((current) => ({
          ...current,
          [sourcePlaylistId]: titles.join('  ·  '),
        }));
      }
    } catch (error) {
      console.error('Failed to load RSS feed', error);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const response = await axios.get(`${API_URL}/playlists/${playlistId}/preview`);
        if (cancelled) return;
        setPreview(response.data);
        setCurrentIndex(0);
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load playlist preview', error);
          setPreview(null);
        }
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [playlistId, refreshVersion]);

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

    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }

    if (activeItem.type !== 'video') {
      const duration = (activeItem.effective_duration || 10) * 1000;
      timerRef.current = window.setTimeout(() => {
        setCurrentIndex((value) => (value + 1) % preview.flattenedItems.length);
      }, duration);
    }

    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, [currentIndex, preview]);

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
        {renderMedia(activeItem, preview.flattenedItems.length, setCurrentIndex)}
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

function renderMedia(media, totalItems, setCurrentIndex) {
  switch (media.type) {
    case 'image':
      return <img src={`${SERVER_URL}${media.filepath}`} alt={media.name} className="player-image" />;
    case 'video':
      return (
        <video
          key={`${media.id}-${media.name}`}
          src={`${SERVER_URL}${media.filepath}`}
          className="player-video"
          autoPlay
          muted
          onEnded={() => setCurrentIndex((value) => (value + 1) % totalItems)}
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
  const [isPaired, setIsPaired] = useState(!!localStorage.getItem('screen_token'));
  const [pairingCode, setPairingCode] = useState('');
  const [screenToken, setScreenToken] = useState(localStorage.getItem('screen_token') || null);
  const [runtime, setRuntime] = useState(null);
  const [runtimeVersion, setRuntimeVersion] = useState(0);
  const [loading, setLoading] = useState(true);

  const socketRef = useRef(null);
  const pairingSocketRef = useRef(null);
  const heartbeatIntervalRef = useRef(null);
  const runtimePollIntervalRef = useRef(null);
  const hasLoadedRuntimeRef = useRef(false);

  const fetchRuntime = useCallback(async () => {
    const screenId = localStorage.getItem('screen_id');
    if (!screenId) {
      setLoading(false);
      return;
    }

    try {
      if (!hasLoadedRuntimeRef.current) {
        setLoading(true);
      }
      const response = await axios.get(`${API_URL}/screens/${screenId}/runtime`);
      setRuntime(response.data);
      setRuntimeVersion((value) => value + 1);
      hasLoadedRuntimeRef.current = true;
    } catch (error) {
      if (error.response?.status === 404) {
        localStorage.removeItem('screen_token');
        localStorage.removeItem('screen_id');
        setScreenToken(null);
        setIsPaired(false);
        hasLoadedRuntimeRef.current = false;
      }
      console.error('Failed to fetch runtime', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const clearConnectionState = () => {
    if (heartbeatIntervalRef.current) {
      window.clearInterval(heartbeatIntervalRef.current);
    }
    if (runtimePollIntervalRef.current) {
      window.clearInterval(runtimePollIntervalRef.current);
    }
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    if (pairingSocketRef.current) {
      pairingSocketRef.current.disconnect();
      pairingSocketRef.current = null;
    }
  };

  const startPairingProcess = useCallback(async () => {
    try {
      const response = await axios.post(`${API_URL}/screens/pair`, {
        name: `Screen (${navigator.platform || 'Browser'})`,
      });

      setPairingCode(response.data.pairingCode);

      const socket = io(SERVER_URL);
      pairingSocketRef.current = socket;

      socket.on('paired', (payload) => {
        if (payload.screenId !== response.data.id || !payload.token) return;

        localStorage.setItem('screen_token', payload.token);
        localStorage.setItem('screen_id', payload.screenId);
        setScreenToken(payload.token);
        setIsPaired(true);
        socket.disconnect();
      });
    } catch (error) {
      console.error('Failed to start pairing', error);
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

    socket.on('auth_success', () => {
      socket.emit('heartbeat', buildDevicePayload());
    });

    socket.on('playlist_changed', fetchRuntime);
    socket.on('layout_changed', fetchRuntime);
    socket.on('runtime_changed', fetchRuntime);

    socket.on('auth_error', () => {
      localStorage.removeItem('screen_token');
      localStorage.removeItem('screen_id');
      setScreenToken(null);
      setIsPaired(false);
    });
  }, [fetchRuntime, screenToken]);

  useEffect(() => {
    document.body.classList.add('player-mode');

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
    } else {
      setIsPaired(false);
      hasLoadedRuntimeRef.current = false;
      setLoading(false);
      startPairingProcess();
    }

    return () => {
      document.body.classList.remove('player-mode');
      clearConnectionState();
    };
  }, [connectWebSocket, fetchRuntime, screenToken, startPairingProcess]);

  if (!isPaired) {
    return (
      <div className="player-page-root">
        <div className="pairing-card glass-card">
          <div className="pairing-header">
            <Monitor size={48} className="pairing-icon" />
            <h2>Display Setup</h2>
            <p>Gib diesen Code im Dashboard unter Screens ein, um das Display zu koppeln.</p>
          </div>
          <div className="pairing-code-display">{pairingCode || '---'}</div>
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
              <SingleZoneRenderer playlistId={zone.playlist_id} refreshVersion={runtimeVersion} />
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
        <SingleZoneRenderer
          key={`${runtime.effective.playlist_id}-${runtimeVersion}`}
          playlistId={runtime.effective.playlist_id}
          refreshVersion={runtimeVersion}
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
        <div className="screen-info">ID: {(localStorage.getItem('screen_id') || '').slice(0, 8)}...</div>
      </div>
    </div>
  );
}

export default PlayerPage;
