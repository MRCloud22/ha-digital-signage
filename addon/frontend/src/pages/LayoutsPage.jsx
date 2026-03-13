import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Plus, Trash2, LayoutDashboard, MonitorSmartphone, Monitor, PenSquare } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const LayoutsPage = () => {
    const [layouts, setLayouts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [newLayout, setNewLayout] = useState({ name: '', orientation: 'landscape', resolution: '1920x1080' });
    const navigate = useNavigate();

    useEffect(() => {
        fetchLayouts();
    }, []);

    const fetchLayouts = async () => {
        try {
            const res = await axios.get('/api/layouts');
            setLayouts(res.data);
            setLoading(false);
        } catch (err) {
            console.error('Failed to fetch layouts', err);
            setLoading(false);
        }
    };

    const handleCreateLayout = async (e) => {
        e.preventDefault();
        try {
            const res = await axios.post('/api/layouts', newLayout);
            setLayouts([res.data, ...layouts]);
            setIsCreating(false);
            setNewLayout({ name: '', orientation: 'landscape', resolution: '1920x1080' });
            // Optionally auto-navigate to the editor:
            navigate(`/layouts/${res.data.id}/edit`);
        } catch (err) {
            console.error('Failed to create layout', err);
            alert('Error creating layout');
        }
    };

    const handleDeleteLayout = async (id) => {
        if (!confirm('Layout wirklich löschen? Dieser Vorgang kann nicht rückgängig gemacht werden.')) return;
        try {
            await axios.delete(`/api/layouts/${id}`);
            setLayouts(layouts.filter(l => l.id !== id));
        } catch (err) {
            console.error('Failed to delete layout', err);
        }
    };

    // Derived resolution options based on orientation
    const resolutionOptions = newLayout.orientation === 'landscape' 
        ? ['1920x1080', '1280x720', '3840x2160']
        : ['1080x1920', '720x1280', '2160x3840'];

    // Auto-update resolution if orientation changes
    const handleOrientationChange = (e) => {
        const val = e.target.value;
        setNewLayout({
            ...newLayout,
            orientation: val,
            resolution: val === 'landscape' ? '1920x1080' : '1080x1920'
        });
    };

    if (loading) return <div className="p-8 text-center text-gray-500">Lade Layouts...</div>;

    return (
        <div>
            <div className="page-header">
                <h1>Layouts</h1>
                <button
                    onClick={() => setIsCreating(true)}
                    className="btn btn-primary"
                >
                    <Plus size={20} /> Neues Layout
                </button>
            </div>

            {layouts.length === 0 ? (
                <div className="glass-card empty-state" style={{ padding: '80px 40px' }}>
                    <LayoutDashboard size={64} style={{ opacity: 0.15, marginBottom: '24px' }} />
                    <h3 style={{ color: 'var(--text-dim)', marginBottom: '12px' }}>Keine Layouts vorhanden</h3>
                    <p style={{ color: 'var(--text-dim)', maxWidth: '400px', margin: '0 auto', fontSize: '0.95rem' }}>
                        Erstellen Sie ein Layout, um Ihren Bildschirm in mehrere Zonen zu unterteilen. Jede Zone kann eine eigene Playlist abspielen.
                    </p>
                </div>
            ) : (
                <div className="glass-card">
                    <div className="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Ausrichtung</th>
                                    <th>Auflösung</th>
                                    <th style={{ width: '120px', textAlign: 'right' }}>Aktionen</th>
                                </tr>
                            </thead>
                            <tbody>
                                {layouts.map(layout => (
                                    <tr key={layout.id}>
                                        <td style={{ fontWeight: 600 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                <div style={{ 
                                                    padding: '8px', 
                                                    background: 'rgba(14, 165, 233, 0.1)', 
                                                    color: 'var(--primary)', 
                                                    borderRadius: '8px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center'
                                                }}>
                                                    {layout.orientation === 'landscape' ? <Monitor size={20} /> : <MonitorSmartphone size={20} />}
                                                </div>
                                                <span style={{ fontSize: '1.05rem' }}>{layout.name}</span>
                                            </div>
                                        </td>
                                        <td style={{ color: 'var(--text-secondary)' }}>
                                            {layout.orientation === 'landscape' ? 'Querformat' : 'Hochformat'}
                                        </td>
                                        <td style={{ color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>
                                            {layout.resolution}
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                                <button
                                                    onClick={() => navigate(`/layouts/${layout.id}/edit`)}
                                                    className="btn-icon"
                                                    title="Layout bearbeiten"
                                                >
                                                    <PenSquare size={18} />
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteLayout(layout.id)}
                                                    className="btn-icon danger"
                                                    title="Layout löschen"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Creation Modal */}
            {isCreating && (
                <div className="modal-overlay">
                    <div className="modal-content" style={{ maxWidth: '440px' }}>
                        <h2 style={{ marginBottom: '24px' }}>Neues Layout</h2>
                        <form onSubmit={handleCreateLayout}>
                            <div className="form-group">
                                <label>Name</label>
                                <input
                                    type="text"
                                    value={newLayout.name}
                                    onChange={e => setNewLayout({ ...newLayout, name: e.target.value })}
                                    className="form-control"
                                    required
                                    autoFocus
                                    placeholder="z.B. Empfangshalle"
                                />
                            </div>
                            <div className="form-group">
                                <label>Ausrichtung</label>
                                <div style={{ display: 'flex', gap: '16px', background: 'var(--bg-secondary)', padding: '12px', borderRadius: '10px' }}>
                                    <label style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', cursor: 'pointer', opacity: newLayout.orientation === 'landscape' ? 1 : 0.5 }}>
                                        <input 
                                            type="radio" 
                                            name="orientation" 
                                            value="landscape" 
                                            checked={newLayout.orientation === 'landscape'}
                                            onChange={handleOrientationChange}
                                            style={{ display: 'none' }}
                                        />
                                        <Monitor size={32} style={{ color: newLayout.orientation === 'landscape' ? 'var(--primary)' : 'inherit' }} />
                                        <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>Querformat</span>
                                    </label>
                                    <label style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', cursor: 'pointer', opacity: newLayout.orientation === 'portrait' ? 1 : 0.5 }}>
                                        <input 
                                            type="radio" 
                                            name="orientation" 
                                            value="portrait" 
                                            checked={newLayout.orientation === 'portrait'}
                                            onChange={handleOrientationChange}
                                            style={{ display: 'none' }}
                                        />
                                        <MonitorSmartphone size={32} style={{ color: newLayout.orientation === 'portrait' ? 'var(--primary)' : 'inherit' }} />
                                        <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>Hochformat</span>
                                    </label>
                                </div>
                            </div>
                            <div className="form-group">
                                <label>Zielauflösung</label>
                                <select
                                    value={newLayout.resolution}
                                    onChange={e => setNewLayout({ ...newLayout, resolution: e.target.value })}
                                    className="form-control"
                                >
                                    {resolutionOptions.map(res => (
                                        <option key={res} value={res}>{res}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="modal-actions">
                                <button
                                    type="button"
                                    onClick={() => setIsCreating(false)}
                                    className="btn btn-secondary"
                                >
                                    Abbrechen
                                </button>
                                <button
                                    type="submit"
                                    className="btn btn-primary"
                                >
                                    Erstellen
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default LayoutsPage;
