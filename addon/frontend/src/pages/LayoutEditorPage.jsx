import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { ArrowLeft, Save, Plus, Trash2, LayoutDashboard, Settings } from 'lucide-react';

const LayoutEditorPage = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const canvasRef = useRef(null);

    const [layout, setLayout] = useState(null);
    const [zones, setZones] = useState([]);
    const [playlists, setPlaylists] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

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
        <div className="flex flex-col h-full bg-gray-50">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shadow-sm shrink-0">
                <div className="flex items-center gap-4">
                    <button 
                        onClick={() => navigate('/layouts')}
                        className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                            <LayoutDashboard size={24} className="text-blue-600"/>
                            Layout Editor
                        </h1>
                        <p className="text-sm text-gray-500">{layout.name} ({layout.resolution})</p>
                    </div>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={handleAddZone}
                        className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition shadow-sm"
                    >
                        <Plus size={18} /> Zone hinzufügen
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className={`flex items-center gap-2 px-6 py-2 rounded-lg transition shadow-sm disabled:opacity-50 ${
                            showSavedFeedback ? 'bg-green-600' : 'bg-blue-600 hover:bg-blue-700'
                        } text-white`}
                    >
                        <Save size={18} /> {saving ? 'Speichert...' : showSavedFeedback ? 'Gespeichert!' : 'Speichern'}
                    </button>
                </div>
            </div>

            {/* Main Editor Area */}
            <div className="flex flex-1 overflow-hidden">
                
                {/* Left Sidebar: Settings */}
                <div className="w-80 bg-white border-r border-gray-200 flex flex-col shrink-0 overflow-y-auto">
                    <div className="p-5 border-b border-gray-100">
                        <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
                            <Settings size={18} className="text-gray-500"/> Layout Einstellungen
                        </h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm text-gray-600 mb-1">Name</label>
                                <input
                                    type="text"
                                    value={layout.name}
                                    onChange={e => setLayout({...layout, name: e.target.value})}
                                    className="w-full px-3 py-2 border rounded-md"
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-gray-600 mb-1">Hintergrundfarbe (CSS)</label>
                                <div className="flex gap-2">
                                    <input
                                        type="color"
                                        value={layout.bg_color || '#000000'}
                                        onChange={e => setLayout({...layout, bg_color: e.target.value})}
                                        className="h-10 w-10 p-1 border rounded-md cursor-pointer"
                                    />
                                    <input
                                        type="text"
                                        value={layout.bg_color || '#000000'}
                                        onChange={e => setLayout({...layout, bg_color: e.target.value})}
                                        className="flex-1 px-3 py-2 border rounded-md font-mono text-sm"
                                        placeholder="#000000"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Zone Properties (Contextual) */}
                    <div className="p-5 flex-1 bg-gray-50/50">
                        <h2 className="text-lg font-semibold mb-4 text-gray-800 border-b pb-2">Ausgewählte Zone</h2>
                        
                        {!activeZone ? (
                            <div className="text-center py-8 text-gray-400">
                                <p className="mb-2">Keine Zone ausgewählt.</p>
                                <p className="text-sm">Klicken Sie auf eine Zone im Canvas, um sie zu bearbeiten.</p>
                            </div>
                        ) : (
                            <div className="space-y-5 animate-fade-in">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Zonen-Name</label>
                                    <input
                                        type="text"
                                        value={activeZone.name}
                                        onChange={e => updateZone(activeZone.id, { name: e.target.value })}
                                        className="w-full px-3 py-2 border border-blue-300 rounded-md focus:ring-2 focus:ring-blue-500 bg-white"
                                    />
                                </div>
                                
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Playlist zuweisen</label>
                                    <select
                                        value={activeZone.playlist_id || ''}
                                        onChange={e => updateZone(activeZone.id, { playlist_id: e.target.value })}
                                        className="w-full px-3 py-2 border border-blue-300 rounded-md focus:ring-2 focus:ring-blue-500 bg-white"
                                    >
                                        <option value="">-- Keine Playlist --</option>
                                        {playlists.map(p => (
                                            <option key={p.id} value={p.id}>{p.name}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs text-gray-500 mb-1">Position X (%)</label>
                                        <input
                                            type="number"
                                            value={Math.round(activeZone.x_percent)}
                                            onChange={e => updateZone(activeZone.id, { x_percent: Number(e.target.value) })}
                                            className="w-full px-2 py-1.5 border rounded-md text-sm bg-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-500 mb-1">Position Y (%)</label>
                                        <input
                                            type="number"
                                            value={Math.round(activeZone.y_percent)}
                                            onChange={e => updateZone(activeZone.id, { y_percent: Number(e.target.value) })}
                                            className="w-full px-2 py-1.5 border rounded-md text-sm bg-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-500 mb-1">Breite (%)</label>
                                        <input
                                            type="number"
                                            value={Math.round(activeZone.width_percent)}
                                            onChange={e => updateZone(activeZone.id, { width_percent: Number(e.target.value) })}
                                            className="w-full px-2 py-1.5 border rounded-md text-sm bg-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-500 mb-1">Höhe (%)</label>
                                        <input
                                            type="number"
                                            value={Math.round(activeZone.height_percent)}
                                            onChange={e => updateZone(activeZone.id, { height_percent: Number(e.target.value) })}
                                            className="w-full px-2 py-1.5 border rounded-md text-sm bg-white"
                                        />
                                    </div>
                                </div>

                                <button
                                    onClick={() => handleDeleteZone(activeZone.id)}
                                    className="w-full mt-4 flex items-center justify-center gap-2 py-2 text-red-600 hover:bg-red-50 border border-red-200 rounded-lg transition"
                                >
                                    <Trash2 size={16} /> Zone entfernen
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Area: Workspace / Canvas */}
                <div className="flex-1 p-8 bg-gray-200/50 overflow-auto flex py-12">
                    <div 
                        className={`relative shadow-2xl ring-1 ring-gray-900/5 ${canvasContainerClasses}`}
                        style={{ 
                            backgroundColor: layout.bg_color || '#000000',
                            aspectRatio: `${resW} / ${resH}`
                        }}
                        ref={canvasRef}
                        onClick={() => setActiveZoneId(null)}
                    >
                        {/* Canvas Grid Background pattern (optional visual aid) */}
                        <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle, #000 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>

                        {/* Render Zones */}
                        {zones.map(zone => {
                            const isActive = activeZoneId === zone.id;
                            const playlist = playlists.find(p => p.id === zone.playlist_id);
                            
                            return (
                                <div
                                    key={zone.id}
                                    onClick={(e) => { e.stopPropagation(); setActiveZoneId(zone.id); }}
                                    className={`absolute flex flex-col overflow-hidden transition-shadow duration-75
                                        ${isActive ? 'ring-4 ring-blue-500 shadow-xl z-50' : 'ring-2 ring-white/50 shadow-md hover:ring-blue-300'}
                                    `}
                                    style={{
                                        left: `${zone.x_percent}%`,
                                        top: `${zone.y_percent}%`,
                                        width: `${zone.width_percent}%`,
                                        height: `${zone.height_percent}%`,
                                        backgroundColor: isActive ? 'rgba(59, 130, 246, 0.1)' : 'rgba(255, 255, 255, 0.1)',
                                        backdropFilter: 'blur(4px)',
                                        zIndex: zone.z_index || 10
                                    }}
                                >
                                    {/* Zone Drag Handle (Header) */}
                                    <div 
                                        className={`px-3 py-2 text-sm font-medium flex justify-between items-center cursor-move select-none shrink-0
                                            ${isActive ? 'bg-blue-600 text-white' : 'bg-gray-800/80 text-gray-200'}
                                        `}
                                        onMouseDown={(e) => handlePointerDown(e, zone.id, 'drag')}
                                    >
                                        <span className="truncate pr-2">{zone.name}</span>
                                        <div className="flex gap-1">
                                            {/* Z-Index Controls could go here */}
                                        </div>
                                    </div>

                                    {/* Zone Content Area */}
                                    <div className="flex-1 flex flex-col items-center justify-center p-4 text-center select-none pointer-events-none">
                                        {playlist ? (
                                            <>
                                                <ListVideo size={32} className={isActive ? 'text-blue-500 mb-2' : 'text-gray-400 mb-2'} />
                                                <span className={`font-medium ${isActive ? 'text-blue-700' : 'text-gray-300 outline-none'}`}>{playlist.name}</span>
                                            </>
                                        ) : (
                                            <span className="text-gray-400/80 text-sm">Keine Playlist</span>
                                        )}
                                    </div>

                                    {/* Resize Info */}
                                    {isActive && (
                                        <div className="absolute top-10 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded shadow pointer-events-none">
                                            {Math.round(zone.width_percent)}% × {Math.round(zone.height_percent)}%
                                        </div>
                                    )}

                                    {/* Resize Handle (Bottom Right) */}
                                    <div 
                                        className={`absolute bottom-0 right-0 w-6 h-6 cursor-se-resize flex items-end justify-end p-1
                                            ${isActive ? 'opacity-100' : 'opacity-0'}
                                        `}
                                        onMouseDown={(e) => handlePointerDown(e, zone.id, 'resize')}
                                    >
                                        <div className="w-3 h-3 border-r-2 border-b-2 border-blue-500 rounded-br-sm" />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

            </div>
        </div>
    );
};

export default LayoutEditorPage;
