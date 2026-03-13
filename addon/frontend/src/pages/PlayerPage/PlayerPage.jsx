import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import axios from 'axios';
import './Player.css';

const SERVER_URL = window.location.origin;
const API_URL = `${SERVER_URL}/api`;

// Helper: hex color + 0-100 opacity => rgba
function hexToRgba(hex, opacityPercent) {
    const h = hex?.replace('#', '') || '1a1a2e';
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = (opacityPercent ?? 90) / 100;
    return `rgba(${r},${g},${b},${a})`;
}

// Parse RSS XML and extract item titles
function parseRssItems(xmlString) {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlString, 'application/xml');
        const items = doc.querySelectorAll('item');
        const titles = [];
        items.forEach(item => {
            const raw = item.querySelector('title')?.textContent || '';
            const title = raw.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
            if (title) titles.push(title);
        });
        return titles;
    } catch (e) {
        return [];
    }
}

// ----------------------------------------------------------------------------
// SingleZoneRenderer: Handles playback of a single Playlist.
// Used for the legacy full-screen playlist OR inside a specific Layout Zone.
// ----------------------------------------------------------------------------
const SingleZoneRenderer = ({ playlistId, playlistsData }) => {
    const [mediaItems, setMediaItems] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);

    const [activeTicker, setActiveTicker] = useState(null); 
    const [rssTexts, setRssTexts] = useState({}); 
    const rssTimers = useRef({});
    const timerRef = useRef(null);

    const flattenPlaylist = useCallback(async (pid, visited = new Set()) => {
        if (!pid) return [];
        if (visited.has(pid)) return [];
        visited.add(pid);

        try {
            const itemsRes = await axios.get(`${API_URL}/playlists/${pid}/items`);
            const items = itemsRes.data;
            const flatItems = [];

            for (const item of items) {
                if (item.sub_playlist_id) {
                    const subPl = playlistsData.find(p => p.id === item.sub_playlist_id);
                    const subItems = await flattenPlaylist(item.sub_playlist_id, visited);
                    subItems.forEach(si => flatItems.push({ ...si, _sourcePlaylist: subPl }));
                } else {
                    flatItems.push({
                        ...item,
                        duration: item.duration_override || item.duration || 10,
                        _sourcePlaylist: playlistsData.find(p => p.id === pid),
                    });
                }
            }
            return flatItems;
        } catch (err) {
            console.error('Error fetching playlist items:', err);
            return [];
        }
    }, [playlistsData]);

    const loadRss = useCallback(async (pl) => {
        if (!pl?.rss_ticker_url) return;
        try {
            const res = await axios.get(`${API_URL}/rss-proxy?url=${encodeURIComponent(pl.rss_ticker_url)}`);
            const items = parseRssItems(res.data);
            if (items.length > 0) {
                setRssTexts(prev => ({ ...prev, [pl.id]: items.join('  ·  ') }));
            }
        } catch (e) {
            console.error('RSS load error:', e);
        }
    }, []);

    const scheduleRssForPlaylist = useCallback((pl) => {
        if (!pl?.rss_ticker_url) return;
        if (rssTimers.current[pl.id]) return;
        loadRss(pl);
        rssTimers.current[pl.id] = setInterval(() => loadRss(pl), 5 * 60 * 1000);
    }, [loadRss]);

    useEffect(() => {
        if (!mediaItems.length) return;
        const item = mediaItems[currentIndex];
        const sourcePl = item?._sourcePlaylist;
        if (sourcePl?.rss_ticker_url) {
            setActiveTicker(sourcePl);
            scheduleRssForPlaylist(sourcePl);
        } else {
            setActiveTicker(null);
        }
    }, [currentIndex, mediaItems, scheduleRssForPlaylist]);

    // Fetch and flatten the playlist whenever playlistId changes
    useEffect(() => {
        let isMounted = true;
        const init = async () => {
            if (!playlistId) {
                if (isMounted) setMediaItems([]);
                return;
            }
            
            const topPl = playlistsData.find(p => p.id === playlistId);
            const flat = await flattenPlaylist(playlistId);
            
            if (!isMounted) return;

            const seen = new Set();
            flat.forEach(item => {
                const pl = item._sourcePlaylist;
                if (pl?.rss_ticker_url && !seen.has(pl.id)) {
                    seen.add(pl.id);
                    scheduleRssForPlaylist(pl);
                }
            });
            if (topPl?.rss_ticker_url && !seen.has(topPl.id)) {
                scheduleRssForPlaylist(topPl);
            }

            const taggedFlat = flat.map(item => ({
                ...item,
                _sourcePlaylist: item._sourcePlaylist || topPl,
            }));

            setMediaItems(taggedFlat);
            setCurrentIndex(0);
        };
        init();

        return () => {
            isMounted = false;
            Object.values(rssTimers.current).forEach(clearInterval);
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [playlistId, flattenPlaylist, playlistsData, scheduleRssForPlaylist]);

    // Timer logic for images/documents
    useEffect(() => {
        if (!mediaItems.length) return;
        const item = mediaItems[currentIndex];
        if (item.type !== 'video') {
            const duration = (item.duration || 10) * 1000;
            timerRef.current = setTimeout(() => setCurrentIndex(prev => (prev + 1) % mediaItems.length), duration);
        }
        return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    }, [currentIndex, mediaItems]);

    if (!mediaItems.length) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center bg-transparent">
                <p style={{ color: '#a0aec0', padding: '20px', textAlign: 'center' }}>Zone wartet auf Inhalte...</p>
            </div>
        );
    }

    const currentMedia = mediaItems[currentIndex];

    const getMediaUrl = (filepath) => {
        if (!filepath) return '';
        if (filepath.startsWith('http')) return filepath;
        return `${SERVER_URL}${filepath}`;
    };

    const renderMedia = (media) => {
        switch (media.type) {
            case 'image':
                return <img key={media.id + currentIndex} src={getMediaUrl(media.filepath)} alt={media.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />;
            case 'video':
                return <video key={media.id + currentIndex} src={getMediaUrl(media.filepath)} autoPlay muted style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} onEnded={() => setCurrentIndex(prev => (prev + 1) % mediaItems.length)} />;
            case 'document':
                return <iframe key={media.id + currentIndex} src={`${getMediaUrl(media.filepath)}#toolbar=0&navpanes=0&scrollbar=0`} title={media.name} style={{ width: '100%', height: '100%', border: 'none' }} />;
            case 'webpage':
                return <iframe key={media.id + currentIndex} src={media.url} title={media.name} style={{ width: '100%', height: '100%', border: 'none' }} />;
            default:
                return <div style={{ color: 'white', padding: '40px' }}>Nicht unterstütztes Format</div>;
        }
    };

    const renderTicker = () => {
        if (!activeTicker?.rss_ticker_url) return null;
        const text = rssTexts[activeTicker.id];
        if (!text) return null;

        const speed = activeTicker.rss_ticker_speed || 60;
        const color = activeTicker.rss_ticker_color || '#ffffff';
        const bgColor = activeTicker.rss_ticker_bg_color || '#1a1a2e';
        const opacity = activeTicker.rss_ticker_bg_opacity ?? 90;
        const fontSize = activeTicker.rss_ticker_font_size || 16;
        const estimatedWidth = text.length * (fontSize * 0.6);
        const duration = estimatedWidth / speed;

        return (
            <div className="ticker-container" style={{ background: hexToRgba(bgColor, opacity), height: `${fontSize * 2.5}px`, position: 'absolute', bottom: 0, width: '100%', zIndex: 100 }}>
                <div className="ticker-content" style={{ color, fontSize: `${fontSize}px`, animationDuration: `${duration}s` }}>
                    {text}
                </div>
            </div>
        );
    };

    return (
        <div className="w-full h-full relative" style={{ overflow: 'hidden' }}>
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {renderMedia(currentMedia)}
            </div>
            {renderTicker()}
        </div>
    );
};


// ----------------------------------------------------------------------------
// Main Player Page
// ----------------------------------------------------------------------------
function PlayerPage() {
    const [isPaired, setIsPaired] = useState(false);
    const [pairingCode, setPairingCode] = useState('');
    const [screenToken, setScreenToken] = useState(localStorage.getItem('screen_token') || null);

    const [screenData, setScreenData] = useState(null);
    const [layout, setLayout] = useState(null);
    const [playlistsData, setPlaylistsData] = useState([]);
    const [loading, setLoading] = useState(true);

    const socketRef = useRef(null);

    // Fetch the active configuration for this screen
    const fetchScreenConfig = useCallback(async () => {
        try {
            setLoading(true);
            const myId = localStorage.getItem('screen_id');
            if (!myId) return;

            const [screensRes, playlistsRes] = await Promise.all([
                axios.get(`${API_URL}/screens`),
                axios.get(`${API_URL}/playlists`)
            ]);

            const me = screensRes.data.find(s => s.id === myId);
            setScreenData(me);
            setPlaylistsData(playlistsRes.data);

            if (me?.active_layout_id) {
                const layoutRes = await axios.get(`${API_URL}/layouts/${me.active_layout_id}`);
                setLayout(layoutRes.data);
            } else {
                setLayout(null);
            }
        } catch (err) {
            console.error('Failed to load screen config:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    // --- PAIRING & SOCKETS ---
    useEffect(() => {
        document.body.classList.add('player-mode');
        if (screenToken) {
            setIsPaired(true);
            connectWebSocket();
            fetchScreenConfig();
        } else {
            startPairingProcess();
        }
        return () => {
            document.body.classList.remove('player-mode');
            if (socketRef.current) socketRef.current.disconnect();
        };
        // eslint-disable-next-line
    }, [screenToken]);

    const startPairingProcess = async () => {
        try {
            const browserInfo = navigator.userAgent.substring(0, 20);
            const res = await axios.post(`${API_URL}/screens/pair`, { name: `Screen (${browserInfo})` });
            setPairingCode(res.data.pairingCode);
            const socket = io(SERVER_URL);
            socket.on('paired', (data) => {
                if (data.screenId === res.data.id && data.token) {
                    localStorage.setItem('screen_token', data.token);
                    localStorage.setItem('screen_id', data.screenId);
                    setScreenToken(data.token);
                    socket.disconnect();
                }
            });
        } catch (err) {
            console.error('Pairing Error:', err);
        }
    };

    const connectWebSocket = () => {
        const socket = io(SERVER_URL);
        socketRef.current = socket;
        socket.on('connect', () => socket.emit('authenticate', screenToken));
        
        // Listen for changes
        socket.on('playlist_changed', fetchScreenConfig);
        socket.on('layout_changed', fetchScreenConfig);
        
        socket.on('auth_error', () => {
            localStorage.removeItem('screen_token');
            localStorage.removeItem('screen_id');
            setScreenToken(null);
            setIsPaired(false);
        });
    };

    // --- RENDERING ROUTER ---
    if (!isPaired) {
        return (
            <div className="player-page-root">
                <div className="pairing-card glass-card">
                    <div className="pairing-header">
                        <Monitor size={48} className="pairing-icon" />
                        <h2>Display Setup</h2>
                        <p>Diesen Code im Dashboard unter „Screens" eingeben, um dieses Display zu verbinden.</p>
                    </div>
                    <div className="pairing-code-display">
                        {pairingCode || '---'}
                    </div>
                    <div className="pairing-footer">
                        <span>Server: {SERVER_URL}</span>
                    </div>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="player-page-root">
                <div className="loader">
                    <div className="spinner"></div>
                    <p>Konfiguration wird geladen...</p>
                </div>
            </div>
        );
    }

    // Logic: 
    // If layout is assigned, render layout zones.
    // Else if playlist is assigned, render single full-screen playlist.
    // Else show waiting screen.

    if (screenData?.active_layout_id && layout) {
        return (
            <div className="player-content-root" style={{ backgroundColor: layout.bg_color || '#000' }}>
                {layout.zones?.map(zone => (
                    <div 
                        key={zone.id} 
                        style={{
                            position: 'absolute',
                            left: `${zone.x_percent}%`,
                            top: `${zone.y_percent}%`,
                            width: `${zone.width_percent}%`,
                            height: `${zone.height_percent}%`,
                            zIndex: zone.z_index || 10,
                            overflow: 'hidden'
                        }}
                    >
                        <SingleZoneRenderer playlistId={zone.playlist_id} playlistsData={playlistsData} />
                    </div>
                ))}
            </div>
        );
    } else if (screenData?.active_playlist_id) {
        return (
            <div className="player-content-root" style={{ backgroundColor: '#000' }}>
                <div style={{ position: 'absolute', inset: 0, zIndex: 10 }}>
                    <SingleZoneRenderer playlistId={screenData.active_playlist_id} playlistsData={playlistsData} />
                </div>
            </div>
        );
    }

    // Fallback: No layout and no playlist
    return (
        <div className="player-page-root">
            <div className="status-card glass-card">
                <div className="success-icon">✓</div>
                <h2>Display bereit</h2>
                <p>Warte auf zugewiesene Inhalte (Layout oder Playlist)...</p>
                <div className="screen-info">
                    ID: {localStorage.getItem('screen_id')?.slice(0, 8)}...
                </div>
            </div>
        </div>
    );
}

export default PlayerPage;
