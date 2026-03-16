import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { ListVideo, Plus, Trash2, ChevronDown, ChevronUp, Settings, Clock, Rss } from 'lucide-react';

const API_URL = window.location.origin + '/api';

function PlaylistsPage() {
    const [playlists, setPlaylists] = useState([]);
    const [media, setMedia] = useState([]);
    const [selectedPlaylist, setSelectedPlaylist] = useState(null);
    const [items, setItems] = useState([]);

    // New playlist form
    const [newName, setNewName] = useState('');
    const [isCreating, setIsCreating] = useState(false);

    // Edit playlist settings modal
    const [editingPlaylist, setEditingPlaylist] = useState(null);

    // Add item modal
    const [showAddItem, setShowAddItem] = useState(false);
    const [addType, setAddType] = useState('media'); // 'media' | 'playlist'
    const [selectedMediaId, setSelectedMediaId] = useState('');
    const [selectedSubPlaylistId, setSelectedSubPlaylistId] = useState('');
    const [addDuration, setAddDuration] = useState('');

    useEffect(() => {
        fetchPlaylists();
        fetchMedia();
    }, []);

    useEffect(() => {
        if (selectedPlaylist) fetchItems(selectedPlaylist.id);
    }, [selectedPlaylist]);

    const fetchPlaylists = async () => {
        const res = await axios.get(`${API_URL}/playlists`);
        setPlaylists(res.data);
    };

    const fetchMedia = async () => {
        const res = await axios.get(`${API_URL}/media`);
        setMedia(res.data);
    };

    const fetchItems = async (playlistId) => {
        const res = await axios.get(`${API_URL}/playlists/${playlistId}/items`);
        setItems(res.data);
    };

    const createPlaylist = async (e) => {
        e.preventDefault();
        if (!newName.trim()) return;
        await axios.post(`${API_URL}/playlists`, { name: newName });
        setNewName('');
        setIsCreating(false);
        fetchPlaylists();
    };

    const deletePlaylist = async (id) => {
        if (!window.confirm('Playlist wirklich löschen?')) return;
        await axios.delete(`${API_URL}/playlists/${id}`);
        if (selectedPlaylist?.id === id) setSelectedPlaylist(null);
        fetchPlaylists();
    };

    const savePlaylistSettings = async (e) => {
        e.preventDefault();
        await axios.put(`${API_URL}/playlists/${editingPlaylist.id}`, {
            name: editingPlaylist.name,
            rssTickerUrl: editingPlaylist.rss_ticker_url,
            rssTickerSpeed: editingPlaylist.rss_ticker_speed,
            rssTickerColor: editingPlaylist.rss_ticker_color,
            rssTickerBgColor: editingPlaylist.rss_ticker_bg_color,
            rssTickerBgOpacity: editingPlaylist.rss_ticker_bg_opacity ?? 90,
            rssTickerFontSize: editingPlaylist.rss_ticker_font_size,
        });
        setEditingPlaylist(null);
        fetchPlaylists();
        if (selectedPlaylist?.id === editingPlaylist.id) {
            setSelectedPlaylist({ ...editingPlaylist });
        }
    };

    const addItem = async (e) => {
        e.preventDefault();
        try {
            await axios.post(`${API_URL}/playlists/${selectedPlaylist.id}/items`, {
                media_id: addType === 'media' ? selectedMediaId : undefined,
                sub_playlist_id: addType === 'playlist' ? selectedSubPlaylistId : undefined,
                sort_order: items.length,
                duration_override: addDuration ? parseInt(addDuration) : undefined,
            });
            setShowAddItem(false);
            setSelectedMediaId('');
            setSelectedSubPlaylistId('');
            setAddDuration('');
            fetchItems(selectedPlaylist.id);
        } catch (err) {
            alert(err.response?.data?.error || 'Fehler beim Hinzufügen');
        }
    };

    const removeItem = async (itemId) => {
        await axios.delete(`${API_URL}/playlists/${selectedPlaylist.id}/items/${itemId}`);
        fetchItems(selectedPlaylist.id);
    };

    const updateItemDuration = async (item, newDuration) => {
        await axios.put(`${API_URL}/playlists/${selectedPlaylist.id}/items/${item.id}`, {
            duration_override: newDuration ? parseInt(newDuration) : null,
            sort_order: item.sort_order,
        });
        fetchItems(selectedPlaylist.id);
    };

    const moveItem = async (item, direction) => {
        const index = items.findIndex(i => i.id === item.id);
        const swapIndex = direction === 'up' ? index - 1 : index + 1;
        if (swapIndex < 0 || swapIndex >= items.length) return;

        const other = items[swapIndex];
        await axios.put(`${API_URL}/playlists/${selectedPlaylist.id}/items/${item.id}`, { duration_override: item.duration_override, sort_order: other.sort_order });
        await axios.put(`${API_URL}/playlists/${selectedPlaylist.id}/items/${other.id}`, { duration_override: other.duration_override, sort_order: item.sort_order });
        fetchItems(selectedPlaylist.id);
    };

    // Sub-playlists available to nest (exclude current and its descendants to avoid issues)
    const nestablePlaylist = playlists.filter(p => p.id !== selectedPlaylist?.id);

    return (
        <div style={{ display: 'flex', gap: '24px', height: '100%', alignItems: 'flex-start' }}>
            {/* Left panel: playlist list */}
            <div style={{ width: '320px', flexShrink: 0 }}>
                <div className="page-header" style={{ marginBottom: '24px' }}>
                    <h1 style={{ fontSize: '1.5rem' }}>Playlisten</h1>
                    <button className="btn btn-primary" onClick={() => setIsCreating(true)}>
                        <Plus size={18} />
                    </button>
                </div>

                {isCreating && (
                    <form onSubmit={createPlaylist} className="glass-card" style={{ marginBottom: '16px', padding: '16px' }}>
                        <input
                            autoFocus className="form-control" type="text"
                            placeholder="Name..." value={newName}
                            onChange={e => setNewName(e.target.value)}
                            style={{ marginBottom: '12px' }}
                        />
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Speichern</button>
                            <button type="button" className="btn btn-secondary" onClick={() => setIsCreating(false)}>×</button>
                        </div>
                    </form>
                )}

                <div className="glass-card" style={{ padding: '8px', overflow: 'hidden' }}>
                    {playlists.length === 0 && (
                        <div className="empty-state" style={{ padding: '32px' }}>
                            <ListVideo size={40} style={{ opacity: 0.2, marginBottom: '12px' }} />
                            <p style={{ color: 'var(--text-dim)' }}>Keine Playlisten</p>
                        </div>
                    )}
                    {playlists.map(pl => (
                        <div
                            key={pl.id}
                            onClick={() => setSelectedPlaylist(pl)}
                            style={{
                                padding: '12px 16px', cursor: 'pointer', display: 'flex',
                                justifyContent: 'space-between', alignItems: 'center',
                                borderRadius: '8px',
                                marginBottom: '4px',
                                background: selectedPlaylist?.id === pl.id ? 'rgba(14, 165, 233, 0.15)' : 'transparent',
                                color: selectedPlaylist?.id === pl.id ? 'var(--primary)' : 'var(--text-secondary)',
                                transition: 'all var(--transition-fast)',
                            }}
                            className="nav-item-hover"
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <ListVideo size={18} style={{ opacity: selectedPlaylist?.id === pl.id ? 1 : 0.6 }} />
                                <span style={{ fontWeight: selectedPlaylist?.id === pl.id ? 700 : 500 }}>{pl.name}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '4px' }} onClick={e => e.stopPropagation()}>
                                <button className="btn-icon" title="Settings" onClick={() => setEditingPlaylist({ ...pl })}>
                                    <Settings size={16} />
                                </button>
                                <button className="btn-icon danger" title="Delete" onClick={() => deletePlaylist(pl.id)}>
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Right panel: playlist items */}
            <div style={{ flex: 1 }}>
                {!selectedPlaylist ? (
                    <div className="glass-card empty-state" style={{ height: '400px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                        <ListVideo size={64} style={{ opacity: 0.15, marginBottom: '24px' }} />
                        <h3 style={{ color: 'var(--text-dim)' }}>Playlist auswählen</h3>
                        <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>Wähle links eine Playlist aus, um den Inhalt zu verwalten.</p>
                    </div>
                ) : (
                    <>
                        <div className="page-header" style={{ marginBottom: '24px' }}>
                            <h2 style={{ fontSize: '1.75rem', fontWeight: 800 }}>{selectedPlaylist.name}</h2>
                            <button className="btn btn-primary" onClick={() => setShowAddItem(true)}>
                                <Plus size={18} /> Inhalt hinzufügen
                            </button>
                        </div>

                        {selectedPlaylist.rss_ticker_url && (
                            <div className="glass-card" style={{ marginBottom: '20px', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(14, 165, 233, 0.1)' }}>
                                <Rss size={18} style={{ color: 'var(--primary)' }} />
                                <div style={{ flex: 1 }}>
                                    <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600 }}>RSS Ticker Aktiv</p>
                                    <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-dim)' }}>{selectedPlaylist.rss_ticker_url}</p>
                                </div>
                                <div style={{ textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 600 }}>
                                    {selectedPlaylist.rss_ticker_speed}px/s · {selectedPlaylist.rss_ticker_font_size}px
                                </div>
                            </div>
                        )}

                        <div className="table-container">
                            {items.length === 0 ? (
                                <div className="empty-state" style={{ padding: '60px' }}>
                                    <p style={{ color: 'var(--text-dim)' }}>Noch keine Inhalte hinzugefügt.</p>
                                </div>
                            ) : (
                                <table>
                                    <thead>
                                        <tr>
                                            <th style={{ width: '40px' }}>#</th>
                                            <th>Inhalt</th>
                                            <th style={{ width: '100px' }}>Typ</th>
                                            <th style={{ width: '160px' }}>Dauer</th>
                                            <th style={{ width: '120px', textAlign: 'center' }}>Aktionen</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {items.map((item, idx) => (
                                            <ItemRow key={item.id} item={item} idx={idx} total={items.length}
                                                onRemove={removeItem}
                                                onUpdate={updateItemDuration}
                                                onMove={moveItem}
                                            />
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* Modal: Add item */}
            {showAddItem && (
                <div className="modal-overlay">
                    <div className="modal-content" style={{ width: '440px' }}>
                        <h3>Inhalt hinzufügen</h3>
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                            <button className={`btn ${addType === 'media' ? '' : 'btn-secondary'}`} onClick={() => setAddType('media')}>Mediendatei</button>
                            <button className={`btn ${addType === 'playlist' ? '' : 'btn-secondary'}`} onClick={() => setAddType('playlist')}>Sub-Playlist</button>
                        </div>
                        <form onSubmit={addItem}>
                            {addType === 'media' ? (
                                <div className="form-group">
                                    <label>Medium wählen</label>
                                    <select className="form-control" value={selectedMediaId} onChange={e => setSelectedMediaId(e.target.value)} required>
                                        <option value="">-- Medium auswählen --</option>
                                        {media.map(m => (
                                            <option key={m.id} value={m.id}>{m.name} ({m.type})</option>
                                        ))}
                                    </select>
                                </div>
                            ) : (
                                <div className="form-group">
                                    <label>Sub-Playlist wählen</label>
                                    <select className="form-control" value={selectedSubPlaylistId} onChange={e => setSelectedSubPlaylistId(e.target.value)} required>
                                        <option value="">-- Playlist auswählen --</option>
                                        {nestablePlaylist.map(p => (
                                            <option key={p.id} value={p.id}>{p.name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            {addType === 'media' && (
                                <div className="form-group">
                                    <label><Clock size={13} /> Dauer überschreiben (Sekunden, leer = Standard)</label>
                                    <input className="form-control" type="number" min="1" value={addDuration} onChange={e => setAddDuration(e.target.value)} placeholder="z.B. 15" />
                                </div>
                            )}
                            <div className="modal-actions">
                                <button type="button" className="btn btn-secondary" onClick={() => setShowAddItem(false)}>Abbrechen</button>
                                <button type="submit" className="btn"><Plus size={15} /> Hinzufügen</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal: Playlist settings */}
            {editingPlaylist && (
                <div className="modal-overlay">
                    <div className="modal-content" style={{ width: '520px' }}>
                        <h3>Playlist bearbeiten</h3>
                        <form onSubmit={savePlaylistSettings}>
                            <div className="form-group">
                                <label>Name</label>
                                <input className="form-control" type="text" value={editingPlaylist.name} onChange={e => setEditingPlaylist({ ...editingPlaylist, name: e.target.value })} required />
                            </div>

                            <hr style={{ margin: '16px 0', borderColor: 'var(--border)' }} />
                            <h4 style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}><Rss size={16} /> RSS Ticker</h4>

                            <div className="form-group">
                                <label>RSS Feed URL (leer = Ticker deaktiviert)</label>
                                <input className="form-control" type="url" value={editingPlaylist.rss_ticker_url || ''} onChange={e => setEditingPlaylist({ ...editingPlaylist, rss_ticker_url: e.target.value })} placeholder="https://feeds.example.com/rss.xml" />
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                <div className="form-group">
                                    <label>Textfarbe</label>
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                        <input type="color" value={editingPlaylist.rss_ticker_color || '#ffffff'} onChange={e => setEditingPlaylist({ ...editingPlaylist, rss_ticker_color: e.target.value })} style={{ width: '40px', height: '36px', border: 'none', background: 'none', cursor: 'pointer' }} />
                                        <input className="form-control" type="text" value={editingPlaylist.rss_ticker_color || '#ffffff'} onChange={e => setEditingPlaylist({ ...editingPlaylist, rss_ticker_color: e.target.value })} />
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label>Hintergrundfarbe</label>
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                        <input type="color" value={editingPlaylist.rss_ticker_bg_color || '#1a1a2e'} onChange={e => setEditingPlaylist({ ...editingPlaylist, rss_ticker_bg_color: e.target.value })} style={{ width: '40px', height: '36px', border: 'none', background: 'none', cursor: 'pointer' }} />
                                        <input className="form-control" type="text" value={editingPlaylist.rss_ticker_bg_color || '#1a1a2e'} onChange={e => setEditingPlaylist({ ...editingPlaylist, rss_ticker_bg_color: e.target.value })} />
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label>Schriftgröße (px)</label>
                                    <input className="form-control" type="number" min="10" max="72" value={editingPlaylist.rss_ticker_font_size || 16} onChange={e => setEditingPlaylist({ ...editingPlaylist, rss_ticker_font_size: parseInt(e.target.value) })} />
                                </div>
                                <div className="form-group">
                                    <label>Scrollgeschwindigkeit (px/s)</label>
                                    <input className="form-control" type="number" min="10" max="300" value={editingPlaylist.rss_ticker_speed || 60} onChange={e => setEditingPlaylist({ ...editingPlaylist, rss_ticker_speed: parseInt(e.target.value) })} />
                                </div>
                                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                                    <label>Hintergrund-Transparenz: <strong>{editingPlaylist.rss_ticker_bg_opacity ?? 90}%</strong></label>
                                    <input type="range" min="0" max="100" value={editingPlaylist.rss_ticker_bg_opacity ?? 90}
                                        onChange={e => setEditingPlaylist({ ...editingPlaylist, rss_ticker_bg_opacity: parseInt(e.target.value) })}
                                        style={{ width: '100%', cursor: 'pointer' }}
                                    />
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                        <span>0% (durchsichtig)</span><span>100% (voll)</span>
                                    </div>
                                </div>
                            </div>

                            {editingPlaylist.rss_ticker_url && (() => {
                                const op = (editingPlaylist.rss_ticker_bg_opacity ?? 90) / 100;
                                const bg = editingPlaylist.rss_ticker_bg_color || '#1a1a2e';
                                // Convert hex + opacity to rgba
                                const r = parseInt(bg.slice(1, 3), 16), g = parseInt(bg.slice(3, 5), 16), b = parseInt(bg.slice(5, 7), 16);
                                const previewBg = `rgba(${r},${g},${b},${op})`;
                                return (
                                    <div style={{ padding: '10px 14px', borderRadius: '8px', background: previewBg, marginBottom: '12px', overflow: 'hidden' }}>
                                        <span style={{ color: editingPlaylist.rss_ticker_color || '#ffffff', fontSize: `${editingPlaylist.rss_ticker_font_size || 16}px`, whiteSpace: 'nowrap' }}>
                                            ▶ RSS Ticker Vorschau – Hier scrollt der Nachrichtentext durch...
                                        </span>
                                    </div>
                                );
                            })()}

                            <div className="modal-actions">
                                <button type="button" className="btn btn-secondary" onClick={() => setEditingPlaylist(null)}>Abbrechen</button>
                                <button type="submit" className="btn">Speichern</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

function ItemRow({ item, idx, total, onRemove, onUpdate, onMove }) {
    const [editDur, setEditDur] = useState(item.duration_override?.toString() || '');
    const [editing, setEditing] = useState(false);

    const isSubPlaylist = !!item.sub_playlist_id;
    const name = isSubPlaylist ? `📂 ${item.sub_playlist_name}` : item.name;
    const type = isSubPlaylist ? 'playlist' : item.type;
    const defaultDur = isSubPlaylist ? '–' : `${item.duration}s`;
    const effectiveDur = item.duration_override ? `${item.duration_override}s ✏️` : defaultDur;

    const commitDuration = () => {
        onUpdate(item, editDur);
        setEditing(false);
    };

    return (
        <tr style={{ borderBottom: '1px solid var(--border)', fontSize: '0.9rem' }}>
            <td style={{ padding: '10px 16px', color: 'var(--text-secondary)' }}>{idx + 1}</td>
            <td style={{ padding: '10px 16px' }}>{name}</td>
            <td style={{ padding: '10px 16px' }}>
                <span className={`badge badge-${type}`}>{type}</span>
            </td>
            <td style={{ padding: '10px 16px' }}>
                {isSubPlaylist ? (
                    <span style={{ color: 'var(--text-secondary)' }}>–</span>
                ) : editing ? (
                    <div style={{ display: 'flex', gap: '6px' }}>
                        <input type="number" min="1" value={editDur} onChange={e => setEditDur(e.target.value)}
                            style={{ width: '70px', padding: '4px 8px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '0.85rem' }}
                            onKeyDown={e => e.key === 'Enter' && commitDuration()}
                            autoFocus
                        />
                        <button className="btn" style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={commitDuration}>OK</button>
                        <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={() => setEditing(false)}>×</button>
                    </div>
                ) : (
                    <span onClick={() => setEditing(true)} title="Klicken zum Ändern"
                        style={{ cursor: 'pointer', padding: '3px 8px', borderRadius: '4px', background: 'var(--primary-dim)', display: 'inline-block' }}>
                        <Clock size={11} style={{ marginRight: '4px', verticalAlign: 'middle' }} />{effectiveDur}
                    </span>
                )}
            </td>
            <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                    <button className="btn-icon" title="Hoch" disabled={idx === 0} onClick={() => onMove(item, 'up')}><ChevronUp size={14} /></button>
                    <button className="btn-icon" title="Runter" disabled={idx === total - 1} onClick={() => onMove(item, 'down')}><ChevronDown size={14} /></button>
                    <button className="btn-icon danger" title="Entfernen" onClick={() => onRemove(item.id)}><Trash2 size={14} /></button>
                </div>
            </td>
        </tr>
    );
}

export default PlaylistsPage;
