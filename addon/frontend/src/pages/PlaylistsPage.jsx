import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { ListVideo, Plus, Link as LinkIcon } from 'lucide-react';

const API_URL = 'http://localhost:9999/api';

function PlaylistsPage() {
    const [playlists, setPlaylists] = useState([]);
    const [media, setMedia] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedPlaylistId, setSelectedPlaylistId] = useState(null);

    // New Playlist State
    const [newPlaylistName, setNewPlaylistName] = useState('');
    const [newRssUrl, setNewRssUrl] = useState('');

    // Add Item to Playlist State
    const [isAddItemModalOpen, setIsAddItemModalOpen] = useState(false);
    const [selectedMediaId, setSelectedMediaId] = useState('');
    const [playlistItems, setPlaylistItems] = useState({});

    useEffect(() => {
        fetchPlaylists();
        fetchMedia();
    }, []);

    const fetchPlaylists = async () => {
        try {
            const res = await axios.get(`${API_URL}/playlists`);
            setPlaylists(res.data);
            // Fetch items for each playlist
            res.data.forEach(pl => fetchPlaylistItems(pl.id));
        } catch (err) {
            console.error("Fehler beim Laden der Playlisten", err);
        }
    };

    const fetchPlaylistItems = async (playlistId) => {
        try {
            const res = await axios.get(`${API_URL}/playlists/${playlistId}/items`);
            setPlaylistItems(prev => ({ ...prev, [playlistId]: res.data }));
        } catch (err) {
            console.error(`Fehler beim Laden der Items für Playlist ${playlistId}`, err);
        }
    };

    const fetchMedia = async () => {
        try {
            const res = await axios.get(`${API_URL}/media`);
            setMedia(res.data);
        } catch (err) {
            console.error("Fehler beim Laden der Medien", err);
        }
    };

    const handleCreatePlaylist = async (e) => {
        e.preventDefault();
        if (!newPlaylistName) return;

        try {
            await axios.post(`${API_URL}/playlists`, {
                name: newPlaylistName,
                rssTickerUrl: newRssUrl
            });
            setIsModalOpen(false);
            setNewPlaylistName('');
            setNewRssUrl('');
            fetchPlaylists();
        } catch (err) {
            console.error("Fehler beim Erstellen der Playlist", err);
        }
    };

    const handleAddItem = async (e) => {
        e.preventDefault();
        if (!selectedPlaylistId || !selectedMediaId) return;

        // Calculate next order
        const currentItems = playlistItems[selectedPlaylistId] || [];
        const nextOrder = currentItems.length > 0 ? Math.max(...currentItems.map(i => i.sort_order)) + 1 : 1;

        try {
            await axios.post(`${API_URL}/playlists/${selectedPlaylistId}/items`, {
                mediaId: selectedMediaId,
                sortOrder: nextOrder
            });
            setIsAddItemModalOpen(false);
            setSelectedMediaId('');
            fetchPlaylistItems(selectedPlaylistId);
        } catch (err) {
            console.error("Fehler beim Hinzufügen des Items", err);
        }
    };

    const openAddItemModal = (playlistId) => {
        setSelectedPlaylistId(playlistId);
        setIsAddItemModalOpen(true);
    };

    return (
        <div>
            <div className="page-header">
                <h1>Playlisten</h1>
                <button className="btn" onClick={() => setIsModalOpen(true)}>
                    <Plus size={18} /> Neue Playlist erstellen
                </button>
            </div>

            <div className="playlists-container">
                {playlists.length === 0 ? (
                    <div className="card empty-state">
                        <ListVideo size={48} style={{ opacity: 0.5, marginBottom: '10px' }} />
                        <p>Es sind noch keine Playlisten vorhanden.</p>
                    </div>
                ) : (
                    playlists.map(playlist => (
                        <div key={playlist.id} className="card">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border-color)', paddingBottom: '15px', marginBottom: '15px' }}>
                                <div>
                                    <h3 style={{ margin: '0 0 5px 0' }}>{playlist.name}</h3>
                                    {playlist.rss_ticker_url && (
                                        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <LinkIcon size={12} /> RSS Ticker: {playlist.rss_ticker_url}
                                        </span>
                                    )}
                                </div>
                                <button className="btn btn-secondary" onClick={() => openAddItemModal(playlist.id)} style={{ fontSize: '0.8rem', padding: '6px 12px' }}>
                                    <Plus size={14} /> Medium hinzufügen
                                </button>
                            </div>

                            <div className="playlist-items">
                                {(!playlistItems[playlist.id] || playlistItems[playlist.id].length === 0) ? (
                                    <div style={{ padding: '15px', textAlign: 'center', color: 'var(--text-secondary)', background: '#f8fafc', borderRadius: '4px' }}>
                                        Keine Medien in dieser Playlist.
                                    </div>
                                ) : (
                                    <table style={{ background: '#f8fafc', borderRadius: '4px', overflow: 'hidden' }}>
                                        <thead>
                                            <tr>
                                                <th style={{ width: '40px' }}>#</th>
                                                <th>Name</th>
                                                <th>Typ</th>
                                                <th>Dauer</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {playlistItems[playlist.id].map((item, index) => (
                                                <tr key={item.id}>
                                                    <td>{index + 1}</td>
                                                    <td style={{ fontWeight: '500' }}>{item.name}</td>
                                                    <td style={{ textTransform: 'capitalize' }}>{item.type}</td>
                                                    <td>{item.type === 'video' ? 'Auto' : `${item.duration}s`}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Create Playlist Modal */}
            {isModalOpen && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <h3>Neue Playlist</h3>
                        <form onSubmit={handleCreatePlaylist}>
                            <div className="form-group">
                                <label>Name</label>
                                <input
                                    type="text"
                                    value={newPlaylistName}
                                    onChange={(e) => setNewPlaylistName(e.target.value)}
                                    placeholder="z.B. Eingangs-Monitor"
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>RSS Ticker URL (Optional)</label>
                                <input
                                    type="url"
                                    value={newRssUrl}
                                    onChange={(e) => setNewRssUrl(e.target.value)}
                                    placeholder="z.B. https://rss.tagesschau.de"
                                />
                                <small style={{ color: 'var(--text-secondary)' }}>Wird am unteren Bildschirmrand als Newsticker eingeblendet.</small>
                            </div>
                            <div className="modal-actions">
                                <button type="button" className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>Abbrechen</button>
                                <button type="submit" className="btn"><Plus size={16} /> Erstellen</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Add Item to Playlist Modal */}
            {isAddItemModalOpen && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <h3>Medium zuweisen</h3>
                        <form onSubmit={handleAddItem}>
                            <div className="form-group">
                                <label>Medium auswählen</label>
                                <select
                                    value={selectedMediaId}
                                    onChange={(e) => setSelectedMediaId(e.target.value)}
                                    required
                                >
                                    <option value="">-- Bitte wählen --</option>
                                    {media.map(m => (
                                        <option key={m.id} value={m.id}>[{m.type}] {m.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="modal-actions">
                                <button type="button" className="btn btn-secondary" onClick={() => setIsAddItemModalOpen(false)}>Abbrechen</button>
                                <button type="submit" className="btn"><Plus size={16} /> Hinzufügen</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

export default PlaylistsPage;
