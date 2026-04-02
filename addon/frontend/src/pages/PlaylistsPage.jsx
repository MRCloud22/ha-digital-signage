import { useEffect, useEffectEvent, useState } from 'react';
import axios from 'axios';
import {
  ChevronDown,
  ChevronUp,
  Clock3,
  Eye,
  ListVideo,
  Plus,
  Rss,
  Settings,
  Trash2,
} from 'lucide-react';
import { formatDuration, truncate } from '../ui';

const API_URL = `${window.location.origin}/api`;

function PlaylistsPage() {
  const [playlists, setPlaylists] = useState([]);
  const [media, setMedia] = useState([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);
  const [items, setItems] = useState([]);
  const [preview, setPreview] = useState(null);

  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const [editingPlaylist, setEditingPlaylist] = useState(null);

  const [showAddItem, setShowAddItem] = useState(false);
  const [addType, setAddType] = useState('media');
  const [selectedMediaId, setSelectedMediaId] = useState('');
  const [selectedSubPlaylistId, setSelectedSubPlaylistId] = useState('');
  const [addDuration, setAddDuration] = useState('');

  const fetchBaseData = async () => {
    try {
      const [playlistsRes, mediaRes] = await Promise.all([
        axios.get(`${API_URL}/playlists`),
        axios.get(`${API_URL}/media`),
      ]);

      setPlaylists(playlistsRes.data);
      setMedia(mediaRes.data);

      if (!selectedPlaylist && playlistsRes.data.length > 0) {
        setSelectedPlaylist(playlistsRes.data[0]);
      } else if (selectedPlaylist) {
        const updated = playlistsRes.data.find((entry) => entry.id === selectedPlaylist.id);
        setSelectedPlaylist(updated || null);
      }
    } catch (error) {
      console.error('Failed to fetch playlists', error);
    }
  };

  const refreshPlaylistDetail = async (playlistId) => {
    try {
      const [itemsRes, previewRes, playlistsRes] = await Promise.all([
        axios.get(`${API_URL}/playlists/${playlistId}/items`),
        axios.get(`${API_URL}/playlists/${playlistId}/preview`),
        axios.get(`${API_URL}/playlists`),
      ]);

      setItems(itemsRes.data);
      setPreview(previewRes.data);
      setPlaylists(playlistsRes.data);

      const updated = playlistsRes.data.find((entry) => entry.id === playlistId);
      setSelectedPlaylist(updated || null);
    } catch (error) {
      console.error('Failed to refresh playlist detail', error);
    }
  };

  const fetchBaseDataEffect = useEffectEvent(() => {
    fetchBaseData();
  });

  const refreshPlaylistDetailEffect = useEffectEvent((playlistId) => {
    refreshPlaylistDetail(playlistId);
  });

  const selectedPlaylistId = selectedPlaylist?.id;

  useEffect(() => {
    fetchBaseDataEffect();
  }, []);

  useEffect(() => {
    if (!selectedPlaylistId) return;
    refreshPlaylistDetailEffect(selectedPlaylistId);
  }, [selectedPlaylistId]);

  const createPlaylist = async (event) => {
    event.preventDefault();
    if (!newName.trim()) return;

    try {
      const response = await axios.post(`${API_URL}/playlists`, { name: newName.trim() });
      setNewName('');
      setIsCreating(false);
      await fetchBaseData();
      const created = { id: response.data.id, name: response.data.name, description: response.data.description };
      setSelectedPlaylist(created);
      await refreshPlaylistDetail(response.data.id);
    } catch (error) {
      console.error('Failed to create playlist', error);
    }
  };

  const deletePlaylist = async (playlistId) => {
    if (!window.confirm('Playlist wirklich loeschen?')) return;

    try {
      await axios.delete(`${API_URL}/playlists/${playlistId}`);
      if (selectedPlaylist?.id === playlistId) {
        setSelectedPlaylist(null);
        setItems([]);
        setPreview(null);
      }
      await fetchBaseData();
    } catch (error) {
      console.error('Failed to delete playlist', error);
    }
  };

  const savePlaylistSettings = async (event) => {
    event.preventDefault();
    if (!editingPlaylist) return;

    try {
      await axios.put(`${API_URL}/playlists/${editingPlaylist.id}`, {
        name: editingPlaylist.name,
        description: editingPlaylist.description,
        rssTickerUrl: editingPlaylist.rss_ticker_url,
        rssTickerSpeed: editingPlaylist.rss_ticker_speed,
        rssTickerColor: editingPlaylist.rss_ticker_color,
        rssTickerBgColor: editingPlaylist.rss_ticker_bg_color,
        rssTickerBgOpacity: editingPlaylist.rss_ticker_bg_opacity,
        rssTickerFontSize: editingPlaylist.rss_ticker_font_size,
      });
      setEditingPlaylist(null);
      await fetchBaseData();
      if (selectedPlaylist) {
        await refreshPlaylistDetail(selectedPlaylist.id);
      }
    } catch (error) {
      console.error('Failed to save playlist settings', error);
    }
  };

  const addItem = async (event) => {
    event.preventDefault();
    if (!selectedPlaylist) return;

    try {
      await axios.post(`${API_URL}/playlists/${selectedPlaylist.id}/items`, {
        media_id: addType === 'media' ? selectedMediaId : undefined,
        sub_playlist_id: addType === 'playlist' ? selectedSubPlaylistId : undefined,
        sort_order: items.length,
        duration_override: addDuration ? Number(addDuration) : undefined,
      });

      setShowAddItem(false);
      setSelectedMediaId('');
      setSelectedSubPlaylistId('');
      setAddDuration('');
      await refreshPlaylistDetail(selectedPlaylist.id);
    } catch (error) {
      alert(error.response?.data?.error || 'Inhalt konnte nicht hinzugefuegt werden.');
    }
  };

  const removeItem = async (itemId) => {
    if (!selectedPlaylist) return;

    await axios.delete(`${API_URL}/playlists/${selectedPlaylist.id}/items/${itemId}`);
    await refreshPlaylistDetail(selectedPlaylist.id);
  };

  const updateItemDuration = async (item, newDuration) => {
    if (!selectedPlaylist) return;

    await axios.put(`${API_URL}/playlists/${selectedPlaylist.id}/items/${item.id}`, {
      duration_override: newDuration ? Number(newDuration) : null,
      sort_order: item.sort_order,
    });
    await refreshPlaylistDetail(selectedPlaylist.id);
  };

  const moveItem = async (item, direction) => {
    if (!selectedPlaylist) return;

    const index = items.findIndex((entry) => entry.id === item.id);
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= items.length) return;

    const other = items[swapIndex];

    await axios.put(`${API_URL}/playlists/${selectedPlaylist.id}/items/${item.id}`, {
      duration_override: item.duration_override,
      sort_order: other.sort_order,
    });
    await axios.put(`${API_URL}/playlists/${selectedPlaylist.id}/items/${other.id}`, {
      duration_override: other.duration_override,
      sort_order: item.sort_order,
    });

    await refreshPlaylistDetail(selectedPlaylist.id);
  };

  const nestablePlaylists = playlists.filter((playlist) => playlist.id !== selectedPlaylist?.id);
  const previewDuration = preview
    ? formatDuration(preview.estimatedDurationSeconds, preview.hasDynamicDuration)
    : '0s';

  return (
    <div className="workspace-two-column">
      <div className="sidebar-column">
        <div className="page-header compact">
          <div>
            <h1>Playlisten</h1>
            <p className="page-subtitle">Direkte Inhalte, RSS-Ticker und Playback-Vorschau.</p>
          </div>
          <button className="btn btn-primary" onClick={() => setIsCreating(true)}>
            <Plus size={18} />
            Neu
          </button>
        </div>

        {isCreating && (
          <form onSubmit={createPlaylist} className="glass-card create-panel">
            <div className="form-group">
              <label>Name</label>
              <input
                className="form-control"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                autoFocus
                placeholder="z.B. Empfang, Mittag, Event"
                required
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setIsCreating(false)}>
                Abbrechen
              </button>
              <button type="submit" className="btn btn-primary">
                Playlist erstellen
              </button>
            </div>
          </form>
        )}

        <div className="glass-card list-panel">
          {playlists.length === 0 ? (
            <div className="empty-state compact">
              <ListVideo size={40} style={{ opacity: 0.2 }} />
              <p>Keine Playlisten vorhanden.</p>
            </div>
          ) : (
            playlists.map((playlist) => (
              <div
                key={playlist.id}
                className={`list-row ${selectedPlaylist?.id === playlist.id ? 'active' : ''}`}
                onClick={() => setSelectedPlaylist(playlist)}
              >
                <div>
                  <div className="entity-title-row">
                    <span className="entity-title">{playlist.name}</span>
                    {playlist.rss_ticker_url ? <span className="badge badge-neutral">RSS</span> : null}
                  </div>
                  <div className="entity-meta">{playlist.description || 'Ohne Beschreibung'}</div>
                </div>
                <div className="row-actions" onClick={(event) => event.stopPropagation()}>
                  <button className="btn-icon" onClick={() => setEditingPlaylist({ ...playlist })}>
                    <Settings size={16} />
                  </button>
                  <button className="btn-icon danger" onClick={() => deletePlaylist(playlist.id)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="content-column">
        {!selectedPlaylist ? (
          <div className="glass-card empty-state large">
            <ListVideo size={64} style={{ opacity: 0.15 }} />
            <h3>Playlist auswaehlen</h3>
            <p>Waehle links eine Playlist, um Inhalte, Reihenfolge und Vorschau zu bearbeiten.</p>
          </div>
        ) : (
          <>
            <div className="page-header">
              <div>
                <h2>{selectedPlaylist.name}</h2>
                <p className="page-subtitle">{selectedPlaylist.description || 'Keine Beschreibung hinterlegt.'}</p>
              </div>
              <div className="header-actions">
                <button className="btn btn-secondary" onClick={() => setEditingPlaylist({ ...selectedPlaylist })}>
                  <Settings size={18} />
                  Einstellungen
                </button>
                <button className="btn btn-primary" onClick={() => setShowAddItem(true)}>
                  <Plus size={18} />
                  Inhalt hinzufuegen
                </button>
              </div>
            </div>

            <div className="stats-grid">
              <StatCard label="Direkte Items" value={items.length} icon={<ListVideo size={18} />} />
              <StatCard label="Flattened Preview" value={preview?.totalItems || 0} icon={<Eye size={18} />} />
              <StatCard label="Geschaetzte Dauer" value={previewDuration} icon={<Clock3 size={18} />} />
              <StatCard
                label="RSS-Ticker"
                value={selectedPlaylist.rss_ticker_url ? 'aktiv' : 'aus'}
                icon={<Rss size={18} />}
                accent={selectedPlaylist.rss_ticker_url ? 'success' : 'default'}
              />
            </div>

            {selectedPlaylist.rss_ticker_url ? (
              <div className="glass-card info-strip">
                <Rss size={18} />
                <div>
                  <strong>RSS-Ticker aktiv</strong>
                  <div className="muted-small">{selectedPlaylist.rss_ticker_url}</div>
                </div>
              </div>
            ) : null}

            <div className="glass-card section-card">
              <div className="section-header">
                <h3>Direkte Inhalte</h3>
                <span className="muted-small">Reihenfolge bestimmt die Playback-Logik.</span>
              </div>
              {items.length === 0 ? (
                <div className="empty-state compact">
                  <p>Diese Playlist enthaelt noch keine direkten Inhalte.</p>
                </div>
              ) : (
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Inhalt</th>
                        <th>Typ</th>
                        <th>Dauer</th>
                        <th style={{ width: '120px', textAlign: 'center' }}>Aktionen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, index) => (
                        <ItemRow
                          key={item.id}
                          item={item}
                          index={index}
                          total={items.length}
                          onRemove={removeItem}
                          onUpdate={updateItemDuration}
                          onMove={moveItem}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="glass-card section-card">
              <div className="section-header">
                <h3>Abspielvorschau</h3>
                <span className="muted-small">Serverseitig aufgeloest inklusive Sub-Playlisten.</span>
              </div>
              {!preview || preview.flattenedItems.length === 0 ? (
                <div className="empty-state compact">
                  <p>Keine Playback-Vorschau verfuegbar.</p>
                </div>
              ) : (
                <div className="preview-sequence">
                  {preview.flattenedItems.map((item, index) => (
                    <div key={`${item.id}-${index}`} className="preview-sequence-row">
                      <div className="preview-sequence-index">{index + 1}</div>
                      <div className="preview-sequence-body">
                        <div className="entity-title-row">
                          <span className="entity-title">{item.name}</span>
                          <span className={`badge badge-${item.type}`}>{item.type}</span>
                        </div>
                        <div className="entity-meta">
                          Quelle: {item.source_playlist_name || 'Direkt'} | Dauer {item.type === 'video' ? 'Video-Ende' : `${item.effective_duration}s`}
                        </div>
                        {item.url ? <div className="muted-small">{truncate(item.url, 90)}</div> : null}
                        {item.content ? <div className="muted-small">{truncate(item.content, 90)}</div> : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {showAddItem && selectedPlaylist && (
        <div className="modal-overlay">
          <div className="modal-content modal-narrow">
            <h3>Inhalt hinzufuegen</h3>
            <div className="segment-control">
              <button
                type="button"
                className={`segment-button ${addType === 'media' ? 'active' : ''}`}
                onClick={() => setAddType('media')}
              >
                Medium
              </button>
              <button
                type="button"
                className={`segment-button ${addType === 'playlist' ? 'active' : ''}`}
                onClick={() => setAddType('playlist')}
              >
                Sub-Playlist
              </button>
            </div>

            <form onSubmit={addItem}>
              {addType === 'media' ? (
                <div className="form-group">
                  <label>Medium waehlen</label>
                  <select className="form-control" value={selectedMediaId} onChange={(event) => setSelectedMediaId(event.target.value)} required>
                    <option value="">Bitte waehlen</option>
                    {media.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name} ({entry.type})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="form-group">
                  <label>Sub-Playlist waehlen</label>
                  <select className="form-control" value={selectedSubPlaylistId} onChange={(event) => setSelectedSubPlaylistId(event.target.value)} required>
                    <option value="">Bitte waehlen</option>
                    {nestablePlaylists.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {addType === 'media' ? (
                <div className="form-group">
                  <label>Dauer ueberschreiben (optional)</label>
                  <input
                    className="form-control"
                    type="number"
                    min="1"
                    value={addDuration}
                    onChange={(event) => setAddDuration(event.target.value)}
                    placeholder="leer = Standarddauer"
                  />
                </div>
              ) : null}

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddItem(false)}>
                  Abbrechen
                </button>
                <button type="submit" className="btn btn-primary">
                  Hinzufuegen
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingPlaylist && (
        <div className="modal-overlay">
          <div className="modal-content modal-wide">
            <h3>Playlist bearbeiten</h3>
            <form onSubmit={savePlaylistSettings}>
              <div className="form-group">
                <label>Name</label>
                <input
                  className="form-control"
                  value={editingPlaylist.name}
                  onChange={(event) => setEditingPlaylist((current) => ({ ...current, name: event.target.value }))}
                  required
                />
              </div>

              <div className="form-group">
                <label>Beschreibung</label>
                <textarea
                  className="form-control"
                  rows={3}
                  value={editingPlaylist.description || ''}
                  onChange={(event) => setEditingPlaylist((current) => ({ ...current, description: event.target.value }))}
                  placeholder="Wofuer ist diese Playlist gedacht?"
                />
              </div>

              <div className="divider" />

              <h4 className="modal-subtitle">
                <Rss size={16} />
                RSS-Ticker
              </h4>

              <div className="form-group">
                <label>Feed URL</label>
                <input
                  className="form-control"
                  type="url"
                  value={editingPlaylist.rss_ticker_url || ''}
                  onChange={(event) => setEditingPlaylist((current) => ({ ...current, rss_ticker_url: event.target.value }))}
                  placeholder="https://example.com/feed.xml"
                />
              </div>

              <div className="form-grid two-columns">
                <div className="form-group">
                  <label>Textfarbe</label>
                  <input
                    className="form-control"
                    value={editingPlaylist.rss_ticker_color || '#ffffff'}
                    onChange={(event) => setEditingPlaylist((current) => ({ ...current, rss_ticker_color: event.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label>Hintergrundfarbe</label>
                  <input
                    className="form-control"
                    value={editingPlaylist.rss_ticker_bg_color || '#1a1a2e'}
                    onChange={(event) => setEditingPlaylist((current) => ({ ...current, rss_ticker_bg_color: event.target.value }))}
                  />
                </div>
              </div>

              <div className="form-grid two-columns">
                <div className="form-group">
                  <label>Groesse (px)</label>
                  <input
                    className="form-control"
                    type="number"
                    min="10"
                    max="72"
                    value={editingPlaylist.rss_ticker_font_size || 16}
                    onChange={(event) => setEditingPlaylist((current) => ({ ...current, rss_ticker_font_size: Number(event.target.value) }))}
                  />
                </div>
                <div className="form-group">
                  <label>Speed (px/s)</label>
                  <input
                    className="form-control"
                    type="number"
                    min="10"
                    max="400"
                    value={editingPlaylist.rss_ticker_speed || 60}
                    onChange={(event) => setEditingPlaylist((current) => ({ ...current, rss_ticker_speed: Number(event.target.value) }))}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Deckkraft: {editingPlaylist.rss_ticker_bg_opacity ?? 90}%</label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={editingPlaylist.rss_ticker_bg_opacity ?? 90}
                  onChange={(event) => setEditingPlaylist((current) => ({ ...current, rss_ticker_bg_opacity: Number(event.target.value) }))}
                />
              </div>

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setEditingPlaylist(null)}>
                  Abbrechen
                </button>
                <button type="submit" className="btn btn-primary">
                  Speichern
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function ItemRow({ item, index, total, onRemove, onUpdate, onMove }) {
  const [editing, setEditing] = useState(false);
  const [draftDuration, setDraftDuration] = useState(item.duration_override?.toString() || '');

  const isSubPlaylist = !!item.sub_playlist_id;
  const displayName = isSubPlaylist ? `Sub-Playlist: ${item.sub_playlist_name}` : item.name;
  const displayType = isSubPlaylist ? 'playlist' : item.type;
  const effectiveDuration = item.duration_override || item.duration || 10;

  const commitDuration = () => {
    onUpdate(item, draftDuration);
    setEditing(false);
  };

  return (
    <tr>
      <td>{index + 1}</td>
      <td>
        <div className="entity-cell">
          <span className="entity-title">{displayName}</span>
          {!isSubPlaylist && item.url ? <span className="entity-meta">{truncate(item.url, 64)}</span> : null}
        </div>
      </td>
      <td>
        <span className={`badge badge-${displayType}`}>{displayType}</span>
      </td>
      <td>
        {isSubPlaylist ? (
          <span className="muted-small">uebernimmt Unterplaylist</span>
        ) : editing ? (
          <div className="inline-editor">
            <input
              className="form-control compact-select"
              type="number"
              min="1"
              value={draftDuration}
              onChange={(event) => setDraftDuration(event.target.value)}
              autoFocus
            />
            <button type="button" className="btn btn-secondary btn-small" onClick={commitDuration}>
              OK
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setEditing(true)}>
            <Clock3 size={14} />
            {item.type === 'video' && !item.duration_override ? 'Video-Ende' : `${effectiveDuration}s`}
          </button>
        )}
      </td>
      <td style={{ textAlign: 'center' }}>
        <div className="row-actions centered">
          <button className="btn-icon" onClick={() => onMove(item, 'up')} disabled={index === 0}>
            <ChevronUp size={14} />
          </button>
          <button className="btn-icon" onClick={() => onMove(item, 'down')} disabled={index === total - 1}>
            <ChevronDown size={14} />
          </button>
          <button className="btn-icon danger" onClick={() => onRemove(item.id)}>
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
}

function StatCard({ label, value, icon, accent = 'default' }) {
  return (
    <div className={`stat-card ${accent}`}>
      <div className="stat-card-icon">{icon}</div>
      <div>
        <div className="stat-card-value">{value}</div>
        <div className="stat-card-label">{label}</div>
      </div>
    </div>
  );
}

export default PlaylistsPage;
