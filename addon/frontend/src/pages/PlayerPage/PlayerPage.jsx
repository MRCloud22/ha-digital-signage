import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import axios from 'axios';
import './Player.css';

const SERVER_URL = window.location.origin;
const API_URL = `${SERVER_URL}/api`;

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
        console.error('RSS parse error:', e);
        return [];
    }
}

function PlayerPage() {
    const [isPaired, setIsPaired] = useState(false);
    const [pairingCode, setPairingCode] = useState('');
    const [screenToken, setScreenToken] = useState(localStorage.getItem('screen_token') || null);

    const [playlist, setPlaylist] = useState(null);
    const [mediaItems, setMediaItems] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);

    // RSS Ticker
    const [rssText, setRssText] = useState('');
    const [rssLoaded, setRssLoaded] = useState(false);
    const rssRefreshRef = useRef(null);

    const socketRef = useRef(null);
    const timerRef = useRef(null);

    // --- PLAYLIST LOADING ---

    // Recursively flatten nested playlists into a single list of playable items
    const flattenPlaylist = useCallback(async (playlistId, visited = new Set()) => {
        if (visited.has(playlistId)) return []; // Cycle guard (safety)
        visited.add(playlistId);

        const itemsRes = await axios.get(`${API_URL}/playlists/${playlistId}/items`);
        const items = itemsRes.data;
        const flatItems = [];

        for (const item of items) {
            if (item.sub_playlist_id) {
                // Recursively expand sub-playlists
                const subItems = await flattenPlaylist(item.sub_playlist_id, visited);
                flatItems.push(...subItems);
            } else {
                // Regular media item with optional duration override
                flatItems.push({
                    ...item,
                    duration: item.duration_override || item.duration || 10,
                });
            }
        }
        return flatItems;
    }, []);

    const fetchActivePlaylist = useCallback(async () => {
        try {
            const screensRes = await axios.get(`${API_URL}/screens`);
            const me = screensRes.data.find(s => s.id === localStorage.getItem('screen_id'));

            if (me && me.active_playlist_id) {
                const plRes = await axios.get(`${API_URL}/playlists`);
                const pl = plRes.data.find(p => p.id === me.active_playlist_id);
                setPlaylist(pl);

                const flat = await flattenPlaylist(me.active_playlist_id);
                setMediaItems(flat);
                setCurrentIndex(0);

                // Load RSS ticker if configured
                if (pl?.rss_ticker_url) {
                    loadRss(pl.rss_ticker_url);
                    scheduleRssRefresh(pl.rss_ticker_url);
                } else {
                    setRssText('');
                    setRssLoaded(false);
                    if (rssRefreshRef.current) clearInterval(rssRefreshRef.current);
                }
            } else {
                setPlaylist(null);
                setMediaItems([]);
                setRssText('');
            }
        } catch (err) {
            console.error('Fehler beim Laden der Playlist', err);
        }
    }, [flattenPlaylist]);

    // --- RSS ---

    const loadRss = async (url) => {
        try {
            const res = await axios.get(`${API_URL}/rss-proxy?url=${encodeURIComponent(url)}`);
            const items = parseRssItems(res.data);
            if (items.length > 0) {
                setRssText(items.join('  ·  '));
                setRssLoaded(true);
            }
        } catch (err) {
            console.error('RSS Ladefehler:', err);
        }
    };

    const scheduleRssRefresh = (url) => {
        if (rssRefreshRef.current) clearInterval(rssRefreshRef.current);
        // Refresh every 5 minutes
        rssRefreshRef.current = setInterval(() => loadRss(url), 5 * 60 * 1000);
    };

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
            if (rssRefreshRef.current) clearInterval(rssRefreshRef.current);
        };
    }, [screenToken]);

    // Timer to advance to next media
    useEffect(() => {
        if (!mediaItems || mediaItems.length === 0 || !isPaired) return;
        const currentMedia = mediaItems[currentIndex];
        if (currentMedia.type !== 'video') {
            const duration = (currentMedia.duration || 10) * 1000;
            timerRef.current = setTimeout(() => {
                setCurrentIndex(prev => (prev + 1) % mediaItems.length);
            }, duration);
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
        socket.on('connect', () => { socket.emit('authenticate', screenToken); });
        socket.on('playlist_changed', () => { fetchActivePlaylist(); });
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
                    <p>Öffne das Home Assistant Dashboard um diesen Screen zu verknüpfen.</p>
                    <div className="pairing-code">{pairingCode || 'LÄDT...'}</div>
                    <p style={{ color: '#a0aec0' }}>Gib diesen Code im Dashboard unter „Screens" ein.</p>
                </div>
            </div>
        );
    }

    if (mediaItems.length === 0) {
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
                return <img src={getMediaUrl(media.filepath)} alt={media.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />;
            case 'video':
                return (
                    <video
                        key={media.id}
                        src={getMediaUrl(media.filepath)}
                        autoPlay muted
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                        onEnded={() => setCurrentIndex(prev => (prev + 1) % mediaItems.length)}
                    />
                );
            case 'document':
                return (
                    <iframe
                        key={media.id}
                        src={`${getMediaUrl(media.filepath)}#toolbar=0&navpanes=0&scrollbar=0`}
                        title={media.name}
                        className="pdf-container"
                    />
                );
            case 'webpage':
                return <iframe key={media.id} src={media.url} title={media.name} style={{ width: '100%', height: '100%', border: 'none' }} />;
            default:
                return <div style={{ color: 'white', padding: '40px' }}>Nicht unterstütztes Format</div>;
        }
    };

    // Ticker animation: speed in px/s from playlist config
    const tickerSpeed = playlist?.rss_ticker_speed || 60;
    const tickerColor = playlist?.rss_ticker_color || '#ffffff';
    const tickerBgColor = playlist?.rss_ticker_bg_color || '#1a1a2e';
    const tickerFontSize = playlist?.rss_ticker_font_size || 16;
    const estimatedWidth = rssText.length * (tickerFontSize * 0.6);
    const tickerDuration = estimatedWidth / tickerSpeed;

    return (
        <div className="player-container">
            <div className="media-layer">
                {renderMedia(currentMedia)}
            </div>

            {/* RSS Ticker */}
            {playlist && playlist.rss_ticker_url && rssLoaded && rssText && (
                <div className="ticker-container" style={{ background: tickerBgColor, height: `${tickerFontSize * 2.5}px` }}>
                    <div className="ticker-content" style={{
                        color: tickerColor,
                        fontSize: `${tickerFontSize}px`,
                        animationDuration: `${tickerDuration}s`,
                        whiteSpace: 'nowrap',
                    }}>
                        {rssText}
                    </div>
                </div>
            )}
        </div>
    );
}

export default PlayerPage;
