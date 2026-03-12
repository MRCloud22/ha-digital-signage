import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Monitor, RefreshCw, Smartphone, Trash2, LayoutDashboard, ListVideo } from 'lucide-react';

const ScreensPage = () => {
    const [screens, setScreens] = useState([]);
    const [playlists, setPlaylists] = useState([]);
    const [layouts, setLayouts] = useState([]);
    const [loading, setLoading] = useState(true);

    const [pairingCode, setPairingCode] = useState('');
    const [isPairing, setIsPairing] = useState(false);
    const [pairingError, setPairingError] = useState('');

    useEffect(() => {
        fetchData();
        // Auto-refresh screen list every 30s to update "last seen"
        const interval = setInterval(fetchScreens, 30000);
        return () => clearInterval(interval);
    }, []);

    const fetchData = async () => {
        try {
            const [screensRes, playlistsRes, layoutsRes] = await Promise.all([
                axios.get('/api/screens'),
                axios.get('/api/playlists'),
                axios.get('/api/layouts')
            ]);
            setScreens(screensRes.data);
            setPlaylists(playlistsRes.data);
            setLayouts(layoutsRes.data);
            setLoading(false);
        } catch (err) {
            console.error('Failed to fetch data', err);
            setLoading(false);
        }
    };

    const fetchScreens = async () => {
        try {
            const res = await axios.get('/api/screens');
            setScreens(res.data);
        } catch (err) {
            console.error('Fehler beim Laden der Screens', err);
        }
    };

    const updateScreen = async (id, name, active_playlist_id, active_layout_id) => {
        try {
            await axios.put(`/api/screens/${id}`, { name, active_playlist_id, active_layout_id });
            // Optimistic update
            setScreens(screens.map(s => s.id === id ? { ...s, name, active_playlist_id, active_layout_id } : s));
        } catch (err) {
            console.error('Failed to update screen', err);
        }
    };

    const handlePairing = async (e) => {
        e.preventDefault();
        setPairingError('');
        try {
            await axios.post('/api/screens/confirm', { pairingCode });
            setIsPairing(false);
            setPairingCode('');
            fetchData(); // Refresh all data after pairing
        } catch (err) {
            setPairingError(err.response?.data?.error || 'Koppelung fehlgeschlagen. Ist der Code korrekt?');
        }
    };

    const deleteScreen = async (screenId, name) => {
        if (!window.confirm(`Screen "${name}" wirklich löschen?`)) return;
        try {
            await axios.delete(`/api/screens/${screenId}`);
            fetchData(); // Refresh all data after deletion
        } catch (err) {
            console.error('Fehler beim Löschen des Screens', err);
        }
    };

    const getLastSeen = (lastSeen) => {
        if (!lastSeen) return 'Nie';
        const diff = Math.floor((Date.now() - new Date(lastSeen).getTime()) / 1000);
        if (diff < 60) return `vor ${diff}s`;
        if (diff < 3600) return `vor ${Math.floor(diff / 60)}min`;
        return new Date(lastSeen).toLocaleString('de-DE');
    };

    return (
        <div>
            <div className="page-header">
                <h1>Screens (Raspberry Pis)</h1>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn btn-secondary" onClick={fetchData} title="Aktualisieren">
                        <RefreshCw size={16} />
                    </button>
                    <button className="btn" onClick={() => setIsPairing(true)}>
                        <Smartphone size={18} /> Neuen Screen koppeln
                    </button>
                </div>
            </div>

            <div className="card">
                {loading ? (
                    <div className="empty-state">
                        <p>Lade Screens...</p>
                    </div>
                ) : screens.length === 0 ? (
                    <div className="empty-state">
                        <Monitor size={48} style={{ opacity: 0.5, marginBottom: '10px' }} />
                        <p>Es sind noch keine Screens verbunden.</p>
                        <p style={{ fontSize: '0.875rem' }}>Öffne <strong>{window.location.origin}/#/player</strong> auf einem Gerät oder Raspberry Pi, um es zu koppeln.</p>
                    </div>
                ) : (
                    <table>
                        <thead>
                            <tr>
                                <th>Status</th>
                                <th>Name</th>
                                <th>Zugewiesene Playlist/Layout</th>
                                <th>Zuletzt gesehen</th>
                                <th style={{ width: '60px' }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {screens.map(screen => (
                                <tr key={screen.id}>
                                    <td>
                                        <span className="status">
                                            <span className={`dot ${screen.is_paired ? 'green' : 'gray'}`}></span>
                                            {screen.is_paired ? 'Verbunden' : 'Wartet...'}
                                        </span>
                                    </td>
                                    <td style={{ fontWeight: 500 }}>{screen.name}</td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-2">
                                            {/* Modus Toggle: Playlist vs Layout */}
                                            <select
                                                className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 bg-gray-50 text-sm font-medium"
                                                value={screen.active_layout_id ? 'layout' : 'playlist'}
                                                onChange={(e) => {
                                                    if (e.target.value === 'playlist') {
                                                        updateScreen(screen.id, screen.name, screen.active_playlist_id || '', null);
                                                    } else {
                                                        updateScreen(screen.id, screen.name, null, screen.active_layout_id || '');
                                                    }
                                                }}
                                            >
                                                <option value="playlist">Playlist</option>
                                                <option value="layout">Layout</option>
                                            </select>

                                            {screen.active_layout_id || (screen.active_layout_id === null && !screen.active_playlist_id) ? (
                                                <div className="flex-1 flex items-center gap-2">
                                                    <LayoutDashboard size={18} className="text-gray-400" />
                                                    <select
                                                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                                                        value={screen.active_layout_id || ''}
                                                        onChange={(e) => updateScreen(screen.id, screen.name, null, e.target.value)}
                                                    >
                                                        <option value="">-- Kein Layout --</option>
                                                        {layouts.map(l => (
                                                            <option key={l.id} value={l.id}>{l.name} ({l.resolution})</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            ) : (
                                                <div className="flex-1 flex items-center gap-2">
                                                    <ListVideo size={18} className="text-gray-400" />
                                                    <select
                                                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                                                        value={screen.active_playlist_id || ''}
                                                        onChange={(e) => updateScreen(screen.id, screen.name, e.target.value, null)}
                                                    >
                                                        <option value="">-- Keine Playlist --</option>
                                                        {playlists.map(p => (
                                                            <option key={p.id} value={p.id}>{p.name}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            )}
                                        </div>
                                    </td>
                                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                                        {getLastSeen(screen.last_seen)}
                                    </td>
                                    <td>
                                        <button
                                            className="btn-icon danger"
                                            title="Screen löschen"
                                            onClick={() => deleteScreen(screen.id, screen.name)}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {isPairing && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <h3>Screen per Code koppeln</h3>
                        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '15px' }}>
                            Öffne <strong>{window.location.origin}/#/player</strong> auf dem Gerät. Der angezeigte 6-stellige Code wird hier eingetragen.
                        </p>
                        {pairingError && <div style={{ color: '#e53e3e', marginBottom: '10px', fontSize: '0.9rem', padding: '8px', background: '#fff5f5', borderRadius: '4px' }}>{pairingError}</div>}
                        <form onSubmit={handlePairing}>
                            <div className="form-group">
                                <label>Pairing Code (6 Ziffern)</label>
                                <input
                                    className="form-control"
                                    type="text"
                                    value={pairingCode}
                                    onChange={(e) => setPairingCode(e.target.value)}
                                    placeholder="z.B. 123456"
                                    maxLength={6}
                                    autoFocus
                                    required
                                />
                            </div>
                            <div className="modal-actions">
                                <button type="button" className="btn btn-secondary" onClick={() => { setIsPairing(false); setPairingError(''); }}>Abbrechen</button>
                                <button type="submit" className="btn">Koppeln</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ScreensPage;
