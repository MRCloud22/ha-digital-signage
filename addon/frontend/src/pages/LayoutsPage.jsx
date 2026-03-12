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
        <div className="p-8 max-w-6xl mx-auto">
            <div className="flex justify-between items-center mb-8">
                <h1 className="text-3xl font-bold flex items-center gap-3">
                    <LayoutDashboard className="text-blue-600" size={32} />
                    Layouts
                </h1>
                <button
                    onClick={() => setIsCreating(true)}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
                >
                    <Plus size={20} />
                    Neues Layout
                </button>
            </div>

            {/* Creation Modal */}
            {isCreating && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                        <h2 className="text-xl font-bold mb-4">Neues Layout erstellen</h2>
                        <form onSubmit={handleCreateLayout} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                                <input
                                    type="text"
                                    value={newLayout.name}
                                    onChange={e => setNewLayout({ ...newLayout, name: e.target.value })}
                                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                                    required
                                    autoFocus
                                    placeholder="Mein Layout"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Ausrichtung</label>
                                <div className="flex items-center gap-4">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input 
                                            type="radio" 
                                            name="orientation" 
                                            value="landscape" 
                                            checked={newLayout.orientation === 'landscape'}
                                            onChange={handleOrientationChange}
                                        />
                                        <Monitor size={18} /> Querformat (Landscape)
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input 
                                            type="radio" 
                                            name="orientation" 
                                            value="portrait" 
                                            checked={newLayout.orientation === 'portrait'}
                                            onChange={handleOrientationChange}
                                        />
                                        <MonitorSmartphone size={18} /> Hochformat (Portrait)
                                    </label>
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Zielauflösung</label>
                                <select
                                    value={newLayout.resolution}
                                    onChange={e => setNewLayout({ ...newLayout, resolution: e.target.value })}
                                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                                >
                                    {resolutionOptions.map(res => (
                                        <option key={res} value={res}>{res}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex justify-end gap-3 mt-6">
                                <button
                                    type="button"
                                    onClick={() => setIsCreating(false)}
                                    className="px-4 py-2 text-gray-600 hover:text-gray-800"
                                >
                                    Abbrechen
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                                >
                                    Erstellen
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Layouts List */}
            {layouts.length === 0 ? (
                <div className="bg-gray-50 rounded-xl p-12 text-center border border-gray-100">
                    <LayoutDashboard className="mx-auto text-gray-300 mb-4" size={64} />
                    <h3 className="text-xl font-medium text-gray-600 mb-2">Keine Layouts vorhanden</h3>
                    <p className="text-gray-500 max-w-md mx-auto">
                        Erstellen Sie ein Layout, um Ihren Bildschirm in mehrere Zonen zu unterteilen. Jede Zone kann eine eigene Playlist abspielen.
                    </p>
                </div>
            ) : (
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                    <table className="w-full">
                        <thead className="bg-gray-50 border-b border-gray-100">
                            <tr>
                                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-600">Name</th>
                                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-600">Ausrichtung</th>
                                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-600">Auflösung</th>
                                <th className="px-6 py-4 text-right text-sm font-semibold text-gray-600">Aktionen</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {layouts.map(layout => (
                                <tr key={layout.id} className="hover:bg-gray-50/50 transition-colors">
                                    <td className="px-6 py-4 font-medium text-gray-800">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                                                {layout.orientation === 'landscape' ? <Monitor size={20} /> : <MonitorSmartphone size={20} />}
                                            </div>
                                            {layout.name}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-gray-600">
                                        {layout.orientation === 'landscape' ? 'Querformat' : 'Hochformat'}
                                    </td>
                                    <td className="px-6 py-4 text-gray-600">
                                        {layout.resolution}
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center justify-end gap-2">
                                            <button
                                                onClick={() => navigate(`/layouts/${layout.id}/edit`)}
                                                className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg transition"
                                                title="Layout bearbeiten"
                                            >
                                                <PenSquare size={20} />
                                            </button>
                                            <button
                                                onClick={() => handleDeleteLayout(layout.id)}
                                                className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition"
                                                title="Layout löschen"
                                            >
                                                <Trash2 size={20} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default LayoutsPage;
