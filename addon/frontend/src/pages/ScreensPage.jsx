import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Monitor, Plus, Link2, Trash2, RefreshCw } from 'lucide-react';

const API_URL = window.location.origin + '/api';

function ScreensPage() {
    const [screens, setScreens] = useState([]);
    const [playlists, setPlaylists] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [pairingCode, setPairingCode] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        fetchScreens();
        fetchPlaylists();
        // Auto-refresh screen list every 30s to update "last seen"
        const interval = setInterval(fetchScreens, 30000);
        return () => clearInterval(interval);
    }, []);

    const fetchScreens = async () => {
        try {
            const res = await axios.get(`${API_URL}/screens`);
            setScreens(res.data);
        } catch (err) {
            console.error('Fehler beim Laden der Screens', err);
        }
    };

    const fetchPlaylists = async () => {
        try {
            const res = await axios.get(`${API_URL}/playlists`);
            setPlaylists(res.data);
        } catch (err) {
            console.error('Fehler beim Laden der Playlisten', err);
        }
    };

    const handlePairing = async (e) => {
        e.preventDefault();
        setError('');
        try {
            await axios.post(`${API_URL}/screens/confirm`, { pairingCode });
            setIsModalOpen(false);
            setPairingCode('');
            fetchScreens();
        } catch (err) {
            setError(err.response?.data?.error || 'Koppelung fehlgeschlagen. Ist der Code korrekt?');
        }
    };

    const assignPlaylist = async (screenId, playlistId, currentName) => {
        try {
            await axios.put(`${API_URL}/screens/${screenId}`, {
                name: currentName,
                active_playlist_id: playlistId || null,
            });
            fetchScreens();
        } catch (err) {
            console.error('Fehler beim Zuweisen der Playlist', err);
        }
    };

    const deleteScreen = async (screenId, name) => {
        if (!window.confirm(`Screen "${name}" wirklich löschen?`)) return;
        try {
            await axios.delete(`${API_URL}/screens/${screenId}`);
            fetchScreens();
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
                    <button className="btn btn-secondary" onClick={fetchScreens} title="Aktualisieren">
                        <RefreshCw size={16} />
                    </button>
                    <button className="btn" onClick={() => setIsModalOpen(true)}>
                        <Plus size={18} /> Neuen Screen koppeln
                    </button>
                </div>
            </div>

            <div className="card">
                {screens.length === 0 ? (
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
                                <th>Zugewiesene Playlist</th>
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
                                    <td>
                                        <select
                                            className="form-control"
                                            style={{ maxWidth: '220px' }}
                                            value={screen.active_playlist_id || ''}
                                            onChange={(e) => assignPlaylist(screen.id, e.target.value, screen.name)}
                                        >
                                            <option value="">-- Keine Playlist --</option>
                                            {playlists.map(pl => (
                                                <option key={pl.id} value={pl.id}>{pl.name}</option>
                                            ))}
                                        </select>
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

            {isModalOpen && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <h3>Screen per Code koppeln</h3>
                        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '15px' }}>
                            Öffne <strong>{window.location.origin}/#/player</strong> auf dem Gerät. Der angezeigte 6-stellige Code wird hier eingetragen.
                        </p>
                        {error && <div style={{ color: '#e53e3e', marginBottom: '10px', fontSize: '0.9rem', padding: '8px', background: '#fff5f5', borderRadius: '4px' }}>{error}</div>}
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
                                <button type="button" className="btn btn-secondary" onClick={() => { setIsModalOpen(false); setError(''); }}>Abbrechen</button>
                                <button type="submit" className="btn"><Link2 size={16} /> Koppeln</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

export default ScreensPage;
