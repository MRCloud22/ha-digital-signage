import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { ArrowLeft, Save, Plus, Trash2, LayoutDashboard, Settings, ListVideo } from 'lucide-react';

const LayoutEditorPage = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const canvasRef = useRef(null);

    const [layout, setLayout] = useState(null);
    const [zones, setZones] = useState([]);
    const [playlists, setPlaylists] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showSavedFeedback, setShowSavedFeedback] = useState(false);

    // activeZone is the zone currently selected for editing properties
    const [activeZoneId, setActiveZoneId] = useState(null);

    // Drag & Drop State
    const [draggingId, setDraggingId] = useState(null);
    const [resizingId, setResizingId] = useState(null);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0, initialX: 0, initialY: 0, initialW: 0, initialH: 0 });

    useEffect(() => {
        fetchData();
        // eslint-disable-next-line
    }, [id]);

    const fetchData = async () => {
        try {
            const [layoutRes, playlistsRes] = await Promise.all([
                axios.get(`/api/layouts/${id}`),
                axios.get('/api/playlists')
            ]);
            setLayout(layoutRes.data);
            setZones(layoutRes.data.zones || []);
            setPlaylists(playlistsRes.data);
            setLoading(false);
        } catch (err) {
            console.error('Failed to fetch data', err);
            alert('Fehler beim Laden des Layouts');
            navigate('/layouts');
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            // Save layout metadata
            await axios.put(`/api/layouts/${id}`, layout);
            // Save zones
            await axios.put(`/api/layouts/${id}/zones`, { zones });
            
            setShowSavedFeedback(true);
            setTimeout(() => {
                setShowSavedFeedback(false);
            }, 2000);
        } catch (err) {
            console.error('Failed to save layout', err);
            alert('Fehler beim Speichern');
        } finally {
            setSaving(false);
        }
    };

    const handleAddZone = () => {
        const newZIndex = zones.length > 0 ? Math.max(...zones.map(z => z.z_index || 0)) + 1 : 0;
        const newZone = {
            id: `temp-${Date.now()}`,
            name: `Zone ${zones.length + 1}`,
            x_percent: 10,
            y_percent: 10,
            width_percent: 40,
            height_percent: 40,
            playlist_id: '',
            z_index: newZIndex
        };
        setZones([...zones, newZone]);
        setActiveZoneId(newZone.id);
    };

    const handleDeleteZone = (zoneId, e) => {
        if(e) e.stopPropagation();
        setZones(zones.filter(z => z.id !== zoneId));
        if (activeZoneId === zoneId) setActiveZoneId(null);
    };

    const updateZone = (zoneId, updates) => {
        setZones(zones.map(z => z.id === zoneId ? { ...z, ...updates } : z));
    };

    // --- Interaction Handlers (Mouse) ---
    const handlePointerDown = (e, zoneId, action) => {
        e.stopPropagation();
        setActiveZoneId(zoneId);
        
        const zone = zones.find(z => z.id === zoneId);
        if (!zone || !canvasRef.current) return;

        setDragStart({
            x: e.clientX,
            y: e.clientY,
            initialX: zone.x_percent,
            initialY: zone.y_percent,
            initialW: zone.width_percent,
            initialH: zone.height_percent
        });

        if (action === 'drag') setDraggingId(zoneId);
        if (action === 'resize') setResizingId(zoneId);
    };

    const handlePointerMove = (e) => {
        if (!draggingId && !resizingId) return;
        if (!canvasRef.current) return;

        const canvasRect = canvasRef.current.getBoundingClientRect();
        
        // Calculate movement in percentage of the canvas
        const deltaXPercent = ((e.clientX - dragStart.x) / canvasRect.width) * 100;
        const deltaYPercent = ((e.clientY - dragStart.y) / canvasRect.height) * 100;

        if (draggingId) {
            let newX = dragStart.initialX + deltaXPercent;
            let newY = dragStart.initialY + deltaYPercent;
            
            // Constrain to canvas bounds roughly
            newX = Math.max(0, Math.min(newX, 100 - dragStart.initialW));
            newY = Math.max(0, Math.min(newY, 100 - dragStart.initialH));

            updateZone(draggingId, { x_percent: newX, y_percent: newY });
        }

        if (resizingId) {
            let newW = dragStart.initialW + deltaXPercent;
            let newH = dragStart.initialH + deltaYPercent;

            // Minimum size constraint (e.g. 5%) and max bounded by canvas
            newW = Math.max(5, Math.min(newW, 100 - dragStart.initialX));
            newH = Math.max(5, Math.min(newH, 100 - dragStart.initialY));

            updateZone(resizingId, { width_percent: newW, height_percent: newH });
        }
    };

    const handlePointerUp = () => {
        setDraggingId(null);
        setResizingId(null);
    };

    useEffect(() => {
        if (draggingId || resizingId) {
            window.addEventListener('mousemove', handlePointerMove);
            window.addEventListener('mouseup', handlePointerUp);
        } else {
            window.removeEventListener('mousemove', handlePointerMove);
            window.removeEventListener('mouseup', handlePointerUp);
        }
        return () => {
            window.removeEventListener('mousemove', handlePointerMove);
            window.removeEventListener('mouseup', handlePointerUp);
        };
        // eslint-disable-next-line
    }, [draggingId, resizingId, dragStart]);


    if (loading || !layout) return <div className="p-8 text-center text-gray-500">Lade Layout Editor...</div>;

    const activeZone = zones.find(z => z.id === activeZoneId);
    
    // Parsing resolution for Aspect Ratio
    const [resW, resH] = layout.resolution.split('x').map(Number);
    const isLandscape = layout.orientation === 'landscape';
    const aspectRatio = resW / resH;
    
    // Container classes based on orientation to make it fit nice on screen
    const canvasContainerClasses = isLandscape 
        ? "w-full aspect-video max-w-4xl max-h-[70vh] mx-auto"
        : "h-[80vh] aspect-[9/16] mx-auto";

    return (
        <div className="layout-editor">
            {/* Header */}
            <div className="page-header editor-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <button 
                        onClick={() => navigate('/layouts')}
                        className="btn-icon"
                        title="Zurück zu Layouts"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <h1>Layout Editor</h1>
                    <span className="badge" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                        {layout.resolution} • {layout.orientation === 'landscape' ? 'Quer' : 'Hoch'}
                    </span>
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                    <button
                        onClick={handleAddZone}
                        className="btn btn-secondary"
                    >
                        <Plus size={18} /> Zone hinzufügen
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className={`btn btn-primary ${showSavedFeedback ? 'btn-success' : ''}`}
                    >
                        {saving ? <><Settings className="spin" size={18} /> Speichert...</> : showSavedFeedback ? 'Gespeichert!' : <><Save size={18} /> Speichern</>}
                    </button>
                </div>
            </div>

            {/* Main Editor Area */}
            <div className="editor-main">
                
                {/* Left Sidebar: Settings */}
                <div className="editor-sidebar glass-card">
                    <div className="sidebar-section">
                        <h3><Settings size={18} /> Layout</h3>
                        <div className="form-group">
                            <label>Name</label>
                            <input
                                type="text"
                                value={layout.name}
                                onChange={e => setLayout({...layout, name: e.target.value})}
                                className="form-control"
                            />
                        </div>
                        <div className="form-group">
                            <label>Hintergrundfarbe</label>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <input
                                    type="color"
                                    value={layout.bg_color || '#000000'}
                                    onChange={e => setLayout({...layout, bg_color: e.target.value})}
                                    style={{ width: '40px', height: '40px', padding: '0', border: 'none', background: 'none', cursor: 'pointer' }}
                                />
                                <input
                                    type="text"
                                    value={layout.bg_color || '#000000'}
                                    onChange={e => setLayout({...layout, bg_color: e.target.value})}
                                    className="form-control"
                                    style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="sidebar-section">
                        <h3><LayoutDashboard size={18} /> Aktive Zone</h3>
                        {!activeZone ? (
                            <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
                                <p>Klicken Sie auf eine Zone im Canvas, um sie zu bearbeiten.</p>
                            </div>
                        ) : (
                            <div className="zone-props">
                                <div className="form-group">
                                    <label>Zonen-Name</label>
                                    <input
                                        type="text"
                                        value={activeZone.name}
                                        onChange={e => updateZone(activeZone.id, { name: e.target.value })}
                                        className="form-control highlight"
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Playlist</label>
                                    <select
                                        value={activeZone.playlist_id || ''}
                                        onChange={e => updateZone(activeZone.id, { playlist_id: e.target.value })}
                                        className="form-control"
                                    >
                                        <option value="">-- Keine Playlist --</option>
                                        {playlists.map(p => (
                                            <option key={p.id} value={p.id}>{p.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="grid-compact">
                                    <div className="form-group">
                                        <label>X (%)</label>
                                        <input
                                            type="number"
                                            value={Math.round(activeZone.x_percent)}
                                            onChange={e => updateZone(activeZone.id, { x_percent: Number(e.target.value) })}
                                            className="form-control compact"
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Y (%)</label>
                                        <input
                                            type="number"
                                            value={Math.round(activeZone.y_percent)}
                                            onChange={e => updateZone(activeZone.id, { y_percent: Number(e.target.value) })}
                                            className="form-control compact"
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>B (%)</label>
                                        <input
                                            type="number"
                                            value={Math.round(activeZone.width_percent)}
                                            onChange={e => updateZone(activeZone.id, { width_percent: Number(e.target.value) })}
                                            className="form-control compact"
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>H (%)</label>
                                        <input
                                            type="number"
                                            value={Math.round(activeZone.height_percent)}
                                            onChange={e => updateZone(activeZone.id, { height_percent: Number(e.target.value) })}
                                            className="form-control compact"
                                        />
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleDeleteZone(activeZone.id)}
                                    className="btn btn-danger"
                                    style={{ width: '100%', marginTop: '16px' }}
                                >
                                    <Trash2 size={16} /> Zone löschen
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Area: Workspace / Canvas */}
                <div className="editor-canvas-container">
                    <div 
                        className={`editor-canvas ${layout.orientation}`}
                        style={{ 
                            backgroundColor: layout.bg_color || '#000000',
                            aspectRatio: `${resW} / ${resH}`
                        }}
                        ref={canvasRef}
                        onClick={() => setActiveZoneId(null)}
                    >
                        {/* Canvas Grid */}
                        <div className="canvas-grid"></div>

                        {/* Render Zones */}
                        {zones.map(zone => {
                            const isActive = activeZoneId === zone.id;
                            const playlist = playlists.find(p => p.id === zone.playlist_id);
                            
                            return (
                                <div
                                    key={zone.id}
                                    onClick={(e) => { e.stopPropagation(); setActiveZoneId(zone.id); }}
                                    className={`canvas-zone ${isActive ? 'active' : ''}`}
                                    style={{
                                        left: `${zone.x_percent}%`,
                                        top: `${zone.y_percent}%`,
                                        width: `${zone.width_percent}%`,
                                        height: `${zone.height_percent}%`,
                                        zIndex: zone.z_index || 10
                                    }}
                                >
                                    {/* Zone Drag Handle (Header) */}
                                    <div 
                                        className="zone-header"
                                        onMouseDown={(e) => handlePointerDown(e, zone.id, 'drag')}
                                    >
                                        <span className="zone-name">{zone.name}</span>
                                    </div>

                                    {/* Zone Content Area */}
                                    <div className="zone-content">
                                        {playlist ? (
                                            <>
                                                <ListVideo size={24} className="icon" />
                                                <span className="playlist-name">{playlist.name}</span>
                                            </>
                                        ) : (
                                            <span className="no-playlist">Keine Playlist</span>
                                        )}
                                    </div>

                                    {/* Resize Info */}
                                    {isActive && (
                                        <div className="zone-info">
                                            {Math.round(zone.width_percent)}% × {Math.round(zone.height_percent)}%
                                        </div>
                                    )}

                                    {/* Resize Handle (Bottom Right) */}
                                    <div 
                                        className="zone-resize-handle"
                                        onMouseDown={(e) => handlePointerDown(e, zone.id, 'resize')}
                                    >
                                        <div className="resize-icon" />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

            </div>
            
            <style dangerouslySetInnerHTML={{ __html: `
                .layout-editor {
                    display: flex;
                    flex-direction: column;
                    height: 100vh;
                    background: var(--bg-main);
                    overflow: hidden;
                }
                .editor-header {
                    background: var(--bg-glass);
                    border-bottom: 1px solid var(--border);
                    padding: 12px 24px;
                    margin-bottom: 0;
                    backdrop-filter: blur(20px);
                }
                .editor-main {
                    display: flex;
                    flex: 1;
                    overflow: hidden;
                }
                .editor-sidebar {
                    width: 320px;
                    background: var(--bg-glass);
                    border-right: 1px solid var(--border);
                    display: flex;
                    flex-direction: column;
                    border-radius: 0;
                    padding: 0;
                    overflow-y: auto;
                }
                .sidebar-section {
                    padding: 24px;
                    border-bottom: 1px solid var(--border);
                }
                .sidebar-section h3 {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    font-size: 0.95rem;
                    color: var(--text-secondary);
                    margin-bottom: 20px;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                }
                .grid-compact {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 12px;
                }
                .form-control.compact {
                    padding: 8px 12px;
                    font-size: 0.85rem;
                    text-align: center;
                }
                .form-control.highlight {
                    border-color: var(--primary-dim);
                    background: rgba(14, 165, 233, 0.05);
                }
                .editor-canvas-container {
                    flex: 1;
                    padding: 60px;
                    background: #000;
                    background-image: 
                        radial-gradient(var(--border) 1px, transparent 1px);
                    background-size: 30px 30px;
                    overflow: auto;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .editor-canvas {
                    position: relative;
                    box-shadow: 0 0 0 12px #1e293b, 0 40px 100px -20px rgba(0,0,0,0.8);
                    border-radius: 4px;
                }
                .editor-canvas.landscape {
                    width: 100%;
                    max-width: 1000px;
                }
                .editor-canvas.portrait {
                    height: 100%;
                    max-height: 800px;
                }
                .canvas-grid {
                    position: absolute;
                    inset: 0;
                    pointer-events: none;
                    opacity: 0.1;
                    background-image: linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px);
                    background-size: 10% 10%;
                }
                .canvas-zone {
                    position: absolute;
                    display: flex;
                    flex-direction: column;
                    border: 1px solid rgba(255,255,255,0.2);
                    background: rgba(255,255,255,0.05);
                    backdrop-filter: blur(4px);
                    transition: border-color 0.2s, background 0.2s;
                    overflow: hidden;
                }
                .canvas-zone:hover {
                    border-color: var(--primary);
                    background: rgba(255,255,255,0.1);
                }
                .canvas-zone.active {
                    border-color: var(--primary);
                    background: rgba(14, 165, 233, 0.1);
                    box-shadow: 0 0 30px rgba(14, 165, 233, 0.3);
                    z-index: 100 !important;
                }
                .zone-header {
                    padding: 6px 12px;
                    background: rgba(0,0,0,0.4);
                    font-size: 0.75rem;
                    font-weight: 700;
                    cursor: move;
                    display: flex;
                    justify-content: space-between;
                    border-bottom: 1px solid rgba(255,255,255,0.1);
                }
                .canvas-zone.active .zone-header {
                    background: var(--primary);
                }
                .zone-content {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 12px;
                    text-align: center;
                    pointer-events: none;
                }
                .playlist-name {
                    font-size: 0.85rem;
                    font-weight: 600;
                    margin-top: 8px;
                    color: #fff;
                    text-shadow: 0 2px 4px rgba(0,0,0,0.5);
                }
                .no-playlist {
                    font-size: 0.75rem;
                    color: rgba(255,255,255,0.3);
                }
                .zone-info {
                    position: absolute;
                    top: 40px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: #000;
                    color: #fff;
                    font-size: 0.7rem;
                    padding: 2px 8px;
                    border-radius: 4px;
                    pointer-events: none;
                }
                .zone-resize-handle {
                    position: absolute;
                    bottom: 0;
                    right: 0;
                    width: 20px;
                    height: 20px;
                    cursor: se-resize;
                    display: flex;
                    align-items: flex-end;
                    justify-content: flex-end;
                    padding: 4px;
                }
                .resize-icon {
                    width: 6px;
                    height: 6px;
                    border-right: 2px solid rgba(255,255,255,0.5);
                    border-bottom: 2px solid rgba(255,255,255,0.5);
                }
                .active .resize-icon {
                    border-color: #fff;
                }
                .spin {
                    animation: spin 1s linear infinite;
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}} />
        </div>
    );
};

export default LayoutEditorPage;
