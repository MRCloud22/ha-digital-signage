import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Upload, Link as LinkIcon, Image as ImageIcon, Video, FileText, Globe } from 'lucide-react';

const API_URL = 'http://localhost:9999/api';

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
        switch (type) {
            case 'image': return <ImageIcon size={20} color="#4299e1" />;
            case 'video': return <Video size={20} color="#48bb78" />;
            case 'document': return <FileText size={20} color="#ed8936" />;
            case 'webpage': return <Globe size={20} color="#9f7aea" />;
            default: return <ImageIcon size={20} />;
        }
    };

    return (
        <div>
            <div className="page-header">
                <h1>Medien Bibliothek</h1>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button className="btn" onClick={() => setIsUploadModalOpen(true)}>
                        <Upload size={18} /> Datei hochladen
                    </button>
                    <button className="btn btn-secondary" onClick={() => setIsWebModalOpen(true)}>
                        <LinkIcon size={18} /> Webseite hinzufügen
                    </button>
                </div>
            </div>

            <div className="card">
                {media.length === 0 ? (
                    <div className="empty-state">
                        <ImageIcon size={48} style={{ opacity: 0.5, marginBottom: '10px' }} />
                        <p>Es sind noch keine Medien vorhanden.</p>
                    </div>
                ) : (
                    <table>
                        <thead>
                            <tr>
                                <th>Typ</th>
                                <th>Name</th>
                                <th>Pfad / URL</th>
                                <th>Dauer (Sek)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {media.map(item => (
                                <tr key={item.id}>
                                    <td style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        {getIconForType(item.type)}
                                        <span style={{ textTransform: 'capitalize' }}>{item.type}</span>
                                    </td>
                                    <td>{item.name}</td>
                                    <td>
                                        {item.type === 'webpage' ?
                                            <a href={item.url} target="_blank" rel="noreferrer">{item.url}</a> :
                                            item.filepath
                                        }
                                    </td>
                                    <td>{item.type === 'video' ? 'Auto' : item.duration}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Upload Modal */}
            {isUploadModalOpen && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <h3>Medien hochladen</h3>
                        <form onSubmit={handleFileUpload}>
                            <div className="form-group">
                                <label>Datei (Bild, Video, PDF)</label>
                                <input
                                    type="file"
                                    accept="image/*,video/*,application/pdf"
                                    onChange={(e) => setFile(e.target.files[0])}
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>Anzeigename</label>
                                <input
                                    type="text"
                                    value={uploadName}
                                    onChange={(e) => setUploadName(e.target.value)}
                                    placeholder="z.B. Sommer Angebot"
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>Anzeigedauer (Sekunden)</label>
                                <input
                                    type="number"
                                    value={uploadDuration}
                                    onChange={(e) => setUploadDuration(Number(e.target.value))}
                                    min="1"
                                />
                                <small style={{ color: 'var(--text-secondary)' }}>Wird bei Videos ignoriert (spielt bis zum Ende).</small>
                            </div>
                            <div className="modal-actions">
                                <button type="button" className="btn btn-secondary" onClick={() => setIsUploadModalOpen(false)}>Abbrechen</button>
                                <button type="submit" className="btn"><Upload size={16} /> Hochladen</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Webpage Modal */}
            {isWebModalOpen && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <h3>Webseite hinzufügen</h3>
                        <form onSubmit={handleWebAdd}>
                            <div className="form-group">
                                <label>URL</label>
                                <input
                                    type="url"
                                    value={webUrl}
                                    onChange={(e) => setWebUrl(e.target.value)}
                                    placeholder="https://example.com"
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>Anzeigename</label>
                                <input
                                    type="text"
                                    value={webName}
                                    onChange={(e) => setWebName(e.target.value)}
                                    placeholder="z.B. Nachrichten"
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>Anzeigedauer (Sekunden)</label>
                                <input
                                    type="number"
                                    value={webDuration}
                                    onChange={(e) => setWebDuration(Number(e.target.value))}
                                    min="1"
                                />
                            </div>
                            <div className="modal-actions">
                                <button type="button" className="btn btn-secondary" onClick={() => setIsWebModalOpen(false)}>Abbrechen</button>
                                <button type="submit" className="btn"><LinkIcon size={16} /> Hinzufügen</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

export default MediaPage;
