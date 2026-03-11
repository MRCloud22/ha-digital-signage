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
            const title = item.querySelector('title')?.textContent?.trim();
            if (title) titles.push(title);
        });
        return titles;
    } catch (e) {
        return [];
    }
}

function PlayerPage() {
    const [isPaired, setIsPaired] = useState(false);
    const [pairingCode, setPairingCode] = useState('');
    const [screenToken, setScreenToken] = useState(localStorage.getItem('screen_token') || null);

    const [mediaItems, setMediaItems] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);

    // Ticker state – tracks the CURRENT item's source playlist config
    const [activeTicker, setActiveTicker] = useState(null); // playlist config object or null
    const [rssTexts, setRssTexts] = useState({}); // map: playlistId -> rssText string
    const rssTimers = useRef({});

    const socketRef = useRef(null);
    const timerRef = useRef(null);

    // --- PLAYLIST FLATTENING ---
    // Each flat item carries the ticker config of its direct source playlist
    const flattenPlaylist = useCallback(async (playlistId, visited = new Set()) => {
        if (visited.has(playlistId)) return [];
        visited.add(playlistId);

        const [itemsRes, playlistsRes] = await Promise.all([
            axios.get(`${API_URL}/playlists/${playlistId}/items`),
            axios.get(`${API_URL}/playlists`),
        ]);

        const items = itemsRes.data;
        const allPlaylists = playlistsRes.data;
        const flatItems = [];

        for (const item of items) {
            if (item.sub_playlist_id) {
                const subPl = allPlaylists.find(p => p.id === item.sub_playlist_id);
                const subItems = await flattenPlaylist(item.sub_playlist_id, visited);
                // Tag each subItem with the sub-playlist's ticker config
                subItems.forEach(si => flatItems.push({ ...si, _sourcePlaylist: subPl }));
            } else {
                flatItems.push({
                    ...item,
                    duration: item.duration_override || item.duration || 10,
                    _sourcePlaylist: allPlaylists.find(p => p.id === playlistId),
                });
            }
        }
        return flatItems;
    }, []);

    // --- RSS LOADING ---
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
        if (rssTimers.current[pl.id]) return; // already scheduled
        loadRss(pl);
        rssTimers.current[pl.id] = setInterval(() => loadRss(pl), 5 * 60 * 1000);
    }, [loadRss]);

    // --- ACTIVE TICKER: update when current media item changes ---
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

    // --- FETCH PLAYLIST FROM SERVER, BUILD FLAT LIST ---
    const fetchActivePlaylist = useCallback(async () => {
        try {
            const screensRes = await axios.get(`${API_URL}/screens`);
            const me = screensRes.data.find(s => s.id === localStorage.getItem('screen_id'));

            if (me?.active_playlist_id) {
                // Get the top-level playlist (for reference)
                const plRes = await axios.get(`${API_URL}/playlists`);
                const topPl = plRes.data.find(p => p.id === me.active_playlist_id);

                const flat = await flattenPlaylist(me.active_playlist_id);

                // Pre-load RSS for all unique source playlists with ticker URLs
                const seen = new Set();
                flat.forEach(item => {
                    const pl = item._sourcePlaylist;
                    if (pl?.rss_ticker_url && !seen.has(pl.id)) {
                        seen.add(pl.id);
                        scheduleRssForPlaylist(pl);
                    }
                });
                // Also pre-load top-level playlist ticker
                if (topPl?.rss_ticker_url && !seen.has(topPl.id)) {
                    scheduleRssForPlaylist(topPl);
                }

                // Tag items from the top-level playlist that aren't sub-playlist items
                const taggedFlat = flat.map(item => ({
                    ...item,
                    _sourcePlaylist: item._sourcePlaylist || topPl,
                }));

                setMediaItems(taggedFlat);
                setCurrentIndex(0);
            } else {
                setMediaItems([]);
                setActiveTicker(null);
            }
        } catch (err) {
            console.error('Fehler beim Laden der Playlist', err);
        }
    }, [flattenPlaylist, scheduleRssForPlaylist]);

    // --- PAIRING & SOCKETS ---
    useEffect(() => {
        document.body.classList.add('player-mode');
        if (screenToken) {
            setIsPaired(true);
            connectWebSocket();
            fetchActivePlaylist();
        } else {
            startPairingProcess();
        }
        return () => {
            document.body.classList.remove('player-mode');
            if (socketRef.current) socketRef.current.disconnect();
            if (timerRef.current) clearTimeout(timerRef.current);
            Object.values(rssTimers.current).forEach(clearInterval);
        };
    }, [screenToken]);

    // Advance media timer
    useEffect(() => {
        if (!mediaItems.length || !isPaired) return;
        const item = mediaItems[currentIndex];
        if (item.type !== 'video') {
            const duration = (item.duration || 10) * 1000;
            timerRef.current = setTimeout(() => setCurrentIndex(prev => (prev + 1) % mediaItems.length), duration);
        }
        return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    }, [currentIndex, mediaItems, isPaired]);

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
            console.error('Pairing-Fehler:', err);
        }
    };

    const connectWebSocket = () => {
        const socket = io(SERVER_URL);
        socketRef.current = socket;
        socket.on('connect', () => socket.emit('authenticate', screenToken));
        socket.on('playlist_changed', fetchActivePlaylist);
        socket.on('auth_error', () => {
            localStorage.removeItem('screen_token');
            localStorage.removeItem('screen_id');
            setScreenToken(null);
            setIsPaired(false);
        });
    };

    // --- RENDERING ---
    if (!isPaired) {
        return (
            <div className="player-container pairing-screen">
                <div className="pairing-box">
                    <h2>Screen Setup</h2>
                    <p>Öffne das Dashboard und gib diesen Code unter „Screens" ein.</p>
                    <div className="pairing-code">{pairingCode || 'LÄDT...'}</div>
                    <p style={{ color: '#a0aec0' }}>Dashboard: {SERVER_URL}</p>
                </div>
            </div>
        );
    }

    if (!mediaItems.length) {
        return (
            <div className="player-container pairing-screen">
                <h2 style={{ color: 'white' }}>Verbunden ✓</h2>
                <p style={{ color: '#a0aec0' }}>Warte auf zugewiesene Playlist...</p>
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
                return <video key={media.id + currentIndex} src={getMediaUrl(media.filepath)} autoPlay muted style={{ width: '100%', height: '100%', objectFit: 'contain' }} onEnded={() => setCurrentIndex(prev => (prev + 1) % mediaItems.length)} />;
            case 'document':
                return <iframe key={media.id + currentIndex} src={`${getMediaUrl(media.filepath)}#toolbar=0&navpanes=0&scrollbar=0`} title={media.name} className="pdf-container" />;
            case 'webpage':
                return <iframe key={media.id + currentIndex} src={media.url} title={media.name} style={{ width: '100%', height: '100%', border: 'none' }} />;
            default:
                return <div style={{ color: 'white', padding: '40px' }}>Nicht unterstütztes Format</div>;
        }
    };

    // Ticker rendering from activeTicker (the source playlist of the current item)
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
            <div className="ticker-container" style={{ background: hexToRgba(bgColor, opacity), height: `${fontSize * 2.5}px` }}>
                <div className="ticker-content" style={{ color, fontSize: `${fontSize}px`, animationDuration: `${duration}s` }}>
                    {text}
                </div>
            </div>
        );
    };

    return (
        <div className="player-container">
            <div className="media-layer">
                {renderMedia(currentMedia)}
            </div>
            {renderTicker()}
        </div>
    );
}

export default PlayerPage;
