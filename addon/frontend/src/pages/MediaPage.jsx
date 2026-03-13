import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Upload, Link as LinkIcon, Image as ImageIcon, Video, FileText, Globe } from 'lucide-react';

const API_URL = window.location.origin + '/api';

function MediaPage() {
    const [media, setMedia] = useState([]);
    const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
    const [isWebModalOpen, setIsWebModalOpen] = useState(false);

    // Upload State
    const [file, setFile] = useState(null);
    const [uploadName, setUploadName] = useState('');
    const [uploadDuration, setUploadDuration] = useState(10);

    // Webpage State
    const [webName, setWebName] = useState('');
    const [webUrl, setWebUrl] = useState('');
    const [webDuration, setWebDuration] = useState(30);

    useEffect(() => {
        fetchMedia();
    }, []);

    const fetchMedia = async () => {
        try {
            const res = await axios.get(`${API_URL}/media`);
            setMedia(res.data);
        } catch (err) {
            console.error("Fehler beim Laden der Medien", err);
        }
    };

    const handleFileUpload = async (e) => {
        e.preventDefault();
        if (!file || !uploadName) return;

        let type = 'image';
        if (file.type.startsWith('video/')) type = 'video';
        else if (file.type === 'application/pdf') type = 'document';

        const formData = new FormData();
        formData.append('file', file);
        formData.append('name', uploadName);
        formData.append('type', type);
        formData.append('duration', uploadDuration);

        try {
            await axios.post(`${API_URL}/media/upload`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            setIsUploadModalOpen(false);
            setFile(null);
            setUploadName('');
            fetchMedia();
        } catch (err) {
            console.error("Fehler beim Upload", err);
        }
    };

    const handleWebAdd = async (e) => {
        e.preventDefault();
        if (!webName || !webUrl) return;

        try {
            await axios.post(`${API_URL}/media/web`, {
                name: webName,
                url: webUrl,
                duration: webDuration
            });
            setIsWebModalOpen(false);
            setWebName('');
            setWebUrl('');
            fetchMedia();
        } catch (err) {
            console.error("Fehler beim Hinzufügen der URL", err);
        }
    };

    const getIconForType = (type) => {
        const iconStyle = { marginBottom: '4px' };
        switch (type) {
            case 'image': return <div className="type-icon" style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8' }}><ImageIcon size={18} /></div>;
            case 'video': return <div className="type-icon" style={{ background: 'rgba(74, 222, 128, 0.15)', color: '#4ade80' }}><Video size={18} /></div>;
            case 'document': return <div className="type-icon" style={{ background: 'rgba(251, 146, 60, 0.15)', color: '#fb923c' }}><FileText size={18} /></div>;
            case 'webpage': return <div className="type-icon" style={{ background: 'rgba(167, 139, 250, 0.15)', color: '#a78bfa' }}><Globe size={18} /></div>;
            default: return <div className="type-icon"><ImageIcon size={18} /></div>;
        }
    };

    return (
        <div>
            <div className="page-header">
                <h1>Medien Bibliothek</h1>
                <div style={{ display: 'flex', gap: '12px' }}>
                    <button className="btn btn-primary" onClick={() => setIsUploadModalOpen(true)}>
                        <Upload size={18} /> Datei hochladen
                    </button>
                    <button className="btn btn-secondary" onClick={() => setIsWebModalOpen(true)}>
                        <Globe size={18} /> Webseite hinzufügen
                    </button>
                </div>
            </div>

            {media.length === 0 ? (
                <div className="glass-card empty-state" style={{ padding: '80px 40px' }}>
                    <ImageIcon size={64} style={{ opacity: 0.15, marginBottom: '24px' }} />
                    <h3 style={{ color: 'var(--text-dim)' }}>Keine Medien vorhanden</h3>
                    <p style={{ color: 'var(--text-dim)', maxWidth: '400px', margin: '0 auto', fontSize: '0.95rem' }}>
                        Laden Sie Bilder, Videos oder PDF-Dokumente hoch oder fügen Sie Webseiten-URLs hinzu, um sie in Ihren Playlisten zu verwenden.
                    </p>
                </div>
            ) : (
                <div className="glass-card">
                    <div className="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th style={{ width: '120px' }}>Typ</th>
                                    <th>Name</th>
                                    <th>Pfad / URL</th>
                                    <th style={{ width: '140px' }}>Dauer (Sek)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {media.map(item => (
                                    <tr key={item.id}>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                {getIconForType(item.type)}
                                                <span style={{ textTransform: 'capitalize', fontWeight: 600, fontSize: '0.85rem' }}>{item.type}</span>
                                            </div>
                                        </td>
                                        <td style={{ fontWeight: 600 }}>{item.name}</td>
                                        <td style={{ maxWidth: '300px' }}>
                                            {item.type === 'webpage' ?
                                                <a href={item.url} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', textDecoration: 'none', borderBottom: '1px solid currentColor' }}>{item.url}</a> :
                                                <span style={{ color: 'var(--text-dim)', fontSize: '0.85rem', fontFamily: 'monospace' }}>{item.filepath}</span>
                                            }
                                        </td>
                                        <td style={{ color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>
                                            {item.type === 'video' ? 
                                                <span className="badge badge-primary" style={{ background: 'rgba(74, 222, 128, 0.15)', color: '#4ade80' }}>Auto</span> : 
                                                item.duration
                                            }
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Upload Modal */}
            {isUploadModalOpen && (
                <div className="modal-overlay">
                    <div className="modal-content" style={{ maxWidth: '480px' }}>
                        <h2 style={{ marginBottom: '24px' }}>Medien hochladen</h2>
                        <form onSubmit={handleFileUpload}>
                            <div className="form-group">
                                <label>Datei auswählen</label>
                                <div style={{ 
                                    border: '2px dashed var(--border)', 
                                    padding: '32px', 
                                    borderRadius: '12px', 
                                    textAlign: 'center',
                                    background: 'var(--bg-secondary)',
                                    cursor: 'pointer'
                                }} onClick={() => document.getElementById('fileInput').click()}>
                                    <Upload size={32} style={{ marginBottom: '12px', opacity: 0.5 }} />
                                    <p style={{ margin: 0, fontSize: '0.9rem' }}>{file ? file.name : 'Klicke zum Auswählen oder Drag & Drop'}</p>
                                    <input
                                        id="fileInput"
                                        type="file"
                                        accept="image/*,video/*,application/pdf"
                                        onChange={(e) => {
                                            const f = e.target.files[0];
                                            setFile(f);
                                            if (f && !uploadName) setUploadName(f.name.split('.')[0]);
                                        }}
                                        style={{ display: 'none' }}
                                    />
                                </div>
                            </div>
                            <div className="form-group">
                                <label>Anzeigename</label>
                                <input
                                    type="text"
                                    value={uploadName}
                                    onChange={(e) => setUploadName(e.target.value)}
                                    placeholder="Name für die Bibliothek"
                                    className="form-control"
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>Anzeigedauer (Sekunden)</label>
                                <input
                                    type="number"
                                    value={uploadDuration}
                                    onChange={(e) => setUploadDuration(Number(e.target.value))}
                                    className="form-control"
                                    min="1"
                                />
                                <p style={{ marginTop: '8px', fontSize: '0.75rem', color: 'var(--text-dim)', lineHeight: 1.4 }}>
                                    Bei Videos wird dieser Wert ignoriert – das Video wird immer in voller Länge abgespielt.
                                </p>
                            </div>
                            <div className="modal-actions">
                                <button type="button" className="btn btn-secondary" onClick={() => setIsUploadModalOpen(false)}>Abbrechen</button>
                                <button type="submit" className="btn btn-primary" disabled={!file || !uploadName}>
                                    <Upload size={18} /> Hochladen
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Webpage Modal */}
            {isWebModalOpen && (
                <div className="modal-overlay">
                    <div className="modal-content" style={{ maxWidth: '480px' }}>
                        <h2 style={{ marginBottom: '24px' }}>Webseite hinzufügen</h2>
                        <form onSubmit={handleWebAdd}>
                            <div className="form-group">
                                <label>URL</label>
                                <input
                                    type="url"
                                    value={webUrl}
                                    onChange={(e) => setWebUrl(e.target.value)}
                                    placeholder="https://deine-webseite.de"
                                    className="form-control"
                                    required
                                    autoFocus
                                />
                            </div>
                            <div className="form-group">
                                <label>Anzeigename</label>
                                <input
                                    type="text"
                                    value={webName}
                                    onChange={(e) => setWebName(e.target.value)}
                                    placeholder="Titel für die Bibliothek"
                                    className="form-control"
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>Anzeigedauer (Sekunden)</label>
                                <input
                                    type="number"
                                    value={webDuration}
                                    onChange={(e) => setWebDuration(Number(e.target.value))}
                                    className="form-control"
                                    min="1"
                                />
                            </div>
                            <div className="modal-actions">
                                <button type="button" className="btn btn-secondary" onClick={() => setIsWebModalOpen(false)}>Abbrechen</button>
                                <button type="submit" className="btn btn-primary" disabled={!webUrl || !webName}>
                                    <LinkIcon size={18} /> URL hinzufügen
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

export default MediaPage;
