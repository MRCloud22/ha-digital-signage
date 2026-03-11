import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import axios from 'axios';
import './Player.css';

// Dynamically use the same host for API calls (useful for HA ingress)
const SERVER_URL = window.location.origin + window.location.pathname.replace(/\/player.*/, '');
const API_URL = `${SERVER_URL}/api`;

function PlayerPage() {
    const [isPaired, setIsPaired] = useState(false);
    const [pairingCode, setPairingCode] = useState('');
    const [screenToken, setScreenToken] = useState(localStorage.getItem('screen_token') || null);
    const [screenId, setScreenId] = useState(localStorage.getItem('screen_id') || null);

    const [playlist, setPlaylist] = useState(null);
    const [mediaItems, setMediaItems] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);

    // Ref for the socket instance to clean it up
    const socketRef = useRef(null);
    const timerRef = useRef(null);

    useEffect(() => {
        // Add special body class for fullscreen styling
        document.body.classList.add('player-mode');

        // Initialize Player
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
        };
    }, [screenToken]);

    // Make sure we advance media after the appropriate duration
    useEffect(() => {
        if (!mediaItems || mediaItems.length === 0 || !isPaired) return;

        const currentMedia = mediaItems[currentIndex];

        if (currentMedia.type !== 'video') {
            const duration = (currentMedia.duration || 10) * 1000;

            timerRef.current = setTimeout(() => {
                advanceToNextMedia();
            }, duration);
        }

        // For videos, we rely on the `onEnded` event of the <video> tag

        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [currentIndex, mediaItems, isPaired]);

    const advanceToNextMedia = () => {
        setCurrentIndex((prevIndex) => (prevIndex + 1) % mediaItems.length);
    };

    const startPairingProcess = async () => {
        try {
            // Basic identifier for this browser instance
            const browserInfo = navigator.userAgent.substring(0, 20);
            const res = await axios.post(`${API_URL}/screens/pair`, { name: `Screen (${browserInfo})` });
            setPairingCode(res.data.pairingCode);
            setScreenId(res.data.id);

            // Connect to socket just to wait for the 'paired' event
            const socket = io(SERVER_URL);
            socket.on('paired', (data) => {
                if (data.screenId === res.data.id && data.token) {
                    localStorage.setItem('screen_token', data.token);
                    localStorage.setItem('screen_id', data.screenId);
                    setScreenToken(data.token); // This will trigger the useEffect to setup the player
                    socket.disconnect();
                }
            });
        } catch (err) {
            console.error("Fehler beim Starten des Pairings:", err);
        }
    };

    const connectWebSocket = () => {
        const socket = io(SERVER_URL);
        socketRef.current = socket;

        socket.on('connect', () => {
            socket.emit('authenticate', screenToken);
        });

        socket.on('playlist_changed', () => {
            console.log('Playlist changed remotely! Re-fetching...');
            fetchActivePlaylist();
        });

        socket.on('auth_error', (msg) => {
            console.error(msg);
            // Restart pairing?
            localStorage.removeItem('screen_token');
            localStorage.removeItem('screen_id');
            setScreenToken(null);
            setIsPaired(false);
        });
    };

    const fetchActivePlaylist = async () => {
        try {
            // Get the screen info to find the active playlist
            const screensRes = await axios.get(`${API_URL}/screens`);
            const me = screensRes.data.find(s => s.id === localStorage.getItem('screen_id'));

            if (me && me.active_playlist_id) {
                // Fetch playlist details (to get RSS Ticker)
                const plRes = await axios.get(`${API_URL}/playlists`);
                const pl = plRes.data.find(p => p.id === me.active_playlist_id);
                setPlaylist(pl);

                // Fetch playlist media items
                const itemsRes = await axios.get(`${API_URL}/playlists/${me.active_playlist_id}/items`);
                setMediaItems(itemsRes.data);
                setCurrentIndex(0); // Reset to start
            } else {
                setPlaylist(null);
                setMediaItems([]);
            }
        } catch (err) {
            console.error("Fehler beim Laden der Playlist", err);
        }
    };

    // --- RENDERING ---

    if (!isPaired) {
        return (
            <div className="player-container pairing-screen">
                <div className="pairing-box">
                    <h2>Screen Setup</h2>
                    <p>Öffne das Home Assistant Dashboard um diesen Screen zu verknüpfen.</p>
                    <div className="pairing-code">{pairingCode || 'LÄDT...'}</div>
                    <p style={{ color: '#a0aec0' }}>Dieser Code ändert sich nach einem Neustart.</p>
                </div>
            </div>
        );
    }

    if (mediaItems.length === 0) {
        return (
            <div className="player-container pairing-screen">
                <h2 style={{ color: 'white' }}>Verbunden</h2>
                <p style={{ color: '#a0aec0' }}>Warte auf zugewiesene Playlist...</p>
            </div>
        );
    }

    const currentMedia = mediaItems[currentIndex];

    // We need the full URL for media if it's served by the Express backend
    const getMediaUrl = (filepath) => {
        if (filepath.startsWith('http')) return filepath;
        return `${SERVER_URL}${filepath}`;
    };

    const renderMedia = (media) => {
        switch (media.type) {
            case 'image':
                return <img src={getMediaUrl(media.filepath)} alt={media.name} />;
            case 'video':
                return (
                    <video
                        src={getMediaUrl(media.filepath)}
                        autoPlay
                        muted // Many browsers require muted for autoplay without user interaction
                        onEnded={() => advanceToNextMedia()}
                    />
                );
            case 'document':
                // For PDF rendering in Chromium, an iframe usually works great.
                // It relies on the browser's native PDF viewing capability.
                return (
                    <iframe
                        src={`${getMediaUrl(media.filepath)}#toolbar=0&navpanes=0&scrollbar=0`}
                        title={media.name}
                        className="pdf-container"
                    />
                );
            case 'webpage':
                return <iframe src={media.url} title={media.name} />;
            default:
                return <div>Nicht unterstütztes Format</div>;
        }
    };

    return (
        <div className="player-container">
            <div className="media-layer">
                {renderMedia(currentMedia)}
            </div>

            {/* RSS Ticker */}
            {playlist && playlist.rss_ticker_url && (
                <div className="ticker-container">
                    <div className="ticker-label">NEWS</div>
                    <div className="ticker-content">
                        {/* Real implementation would fetch and parse RSS here. 
                For the PoC we simulate the text. */}
                        Breaking News from {playlist.rss_ticker_url} • Weitere aktuelle Meldungen folgen hier... • Willkommen zur Digital Signage Lösung.
                    </div>
                </div>
            )}
        </div>
    );
}

export default PlayerPage;
