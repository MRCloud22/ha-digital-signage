import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Monitor, KeyRound, MonitorPlay, Trash2 } from 'lucide-react';

const API_URL = window.location.origin + window.location.pathname.replace(/\/$/, '') + '/api';

function ScreensPage() {
    const [screens, setScreens] = useState([]);
    const [playlists, setPlaylists] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [pairingCode, setPairingCode] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        fetchScreens();
        fetchPlaylists();
    }, []);

    const fetchScreens = async () => {
        try {
            const res = await axios.get(`${API_URL}/screens`);
            setScreens(res.data);
        } catch (err) {
            console.error("Fehler beim Laden der Screens", err);
        }
    };

    const fetchPlaylists = async () => {
        try {
            const res = await axios.get(`${API_URL}/playlists`);
            setPlaylists(res.data);
        } catch (err) {
            console.error("Fehler beim Laden der Playlisten", err);
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
                active_playlist_id: playlistId
            });
            fetchScreens();
        } catch (err) {
            console.error("Fehler beim Zuweisen der Playlist", err);
        }
    };

    return (
        <div>
            <div className="page-header">
                <h1>Screens (Raspberry Pis)</h1>
                <button className="btn" onClick={() => setIsModalOpen(true)}>
                    <Plus size={18} /> Neuen Screen koppeln
                </button>
            </div>

            <div className="card">
                {screens.length === 0 ? (
                    <div className="empty-state">
                        <Monitor size={48} style={{ opacity: 0.5, marginBottom: '10px' }} />
                        <p>Es sind noch keine Screens verbunden.</p>
                    </div>
                ) : (
                    <table>
                        <thead>
                            <tr>
                                <th>Status</th>
                                <th>Name</th>
                                <th>Verknüpfte Playlist</th>
                                <th>Zuletzt gesehen</th>
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
                                    <td>{screen.name}</td>
                                    <td>
                                        <select
                                            value={screen.active_playlist_id || ''}
                                            onChange={(e) => assignPlaylist(screen.id, e.target.value, screen.name)}
                                        >
                                            <option value="">-- Keine Playlist --</option>
                                            {playlists.map(pl => (
                                                <option key={pl.id} value={pl.id}>{pl.name}</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td>{screen.last_seen ? new Date(screen.last_seen).toLocaleString() : 'Nie'}</td>
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
                            Starte den Raspberry Pi. Erscheint ein Code auf dem Bildschirm, gib ihn hier ein.
                        </p>
                        {error && <div style={{ color: 'red', marginBottom: '10px', fontSize: '0.9rem' }}>{error}</div>}
                        <form onSubmit={handlePairing}>
                            <div className="form-group">
                                <label>Pairing Code (6 Ziffern)</label>
                                <input
                                    type="text"
                                    value={pairingCode}
                                    onChange={(e) => setPairingCode(e.target.value)}
                                    placeholder="z.B. 123456"
                                    required
                                />
                            </div>
                            <div className="modal-actions">
                                <button type="button" className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>Abbrechen</button>
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
