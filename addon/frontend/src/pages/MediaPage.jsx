import { useEffect, useEffectEvent, useState } from 'react';
import axios from 'axios';
import {
  FileText,
  Globe,
  Image as ImageIcon,
  Link as LinkIcon,
  PenSquare,
  Search,
  Trash2,
  Type,
  Upload,
  Video,
} from 'lucide-react';
import { truncate } from '../ui';

const API_URL = `${window.location.origin}/api`;

function MediaPage() {
  const [media, setMedia] = useState([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isWebModalOpen, setIsWebModalOpen] = useState(false);
  const [isTextModalOpen, setIsTextModalOpen] = useState(false);
  const [editingWebMedia, setEditingWebMedia] = useState(null);

  const [file, setFile] = useState(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadDuration, setUploadDuration] = useState(10);

  const [webName, setWebName] = useState('');
  const [webUrl, setWebUrl] = useState('');
  const [webDuration, setWebDuration] = useState(30);

  const [textSlide, setTextSlide] = useState({
    name: '',
    content: '',
    duration: 12,
    settings: {
      textColor: '#f8fafc',
      backgroundColor: '#0f172a',
      accentColor: '#0ea5e9',
      fontSize: 42,
      align: 'center',
    },
  });

  const fetchMedia = async () => {
    try {
      const response = await axios.get(`${API_URL}/media`);
      setMedia(response.data);
    } catch (error) {
      console.error('Failed to load media', error);
    }
  };

  const fetchMediaEffect = useEffectEvent(() => {
    fetchMedia();
  });

  const resetWebForm = () => {
    setEditingWebMedia(null);
    setWebName('');
    setWebUrl('');
    setWebDuration(30);
  };

  const closeWebModal = () => {
    setIsWebModalOpen(false);
    resetWebForm();
  };

  const openWebCreateModal = () => {
    resetWebForm();
    setIsWebModalOpen(true);
  };

  const openWebEditModal = (item) => {
    setEditingWebMedia(item);
    setWebName(item.name || '');
    setWebUrl(item.url || '');
    setWebDuration(Number(item.duration) || 30);
    setIsWebModalOpen(true);
  };

  useEffect(() => {
    fetchMediaEffect();
  }, []);

  const handleFileUpload = async (event) => {
    event.preventDefault();
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
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setFile(null);
      setUploadName('');
      setUploadDuration(10);
      setIsUploadModalOpen(false);
      await fetchMedia();
    } catch (error) {
      console.error('Failed to upload file', error);
    }
  };

  const handleWebSave = async (event) => {
    event.preventDefault();
    if (!webName || !webUrl) return;

    try {
      if (editingWebMedia) {
        await axios.put(`${API_URL}/media/${editingWebMedia.id}`, {
          name: webName,
          url: webUrl,
          duration: webDuration,
        });
      } else {
        await axios.post(`${API_URL}/media/web`, {
          name: webName,
          url: webUrl,
          duration: webDuration,
        });
      }
      closeWebModal();
      await fetchMedia();
    } catch (error) {
      console.error('Failed to save webpage', error);
    }
  };

  const handleTextAdd = async (event) => {
    event.preventDefault();
    if (!textSlide.name || !textSlide.content) return;

    try {
      await axios.post(`${API_URL}/media/text`, textSlide);
      setTextSlide({
        name: '',
        content: '',
        duration: 12,
        settings: {
          textColor: '#f8fafc',
          backgroundColor: '#0f172a',
          accentColor: '#0ea5e9',
          fontSize: 42,
          align: 'center',
        },
      });
      setIsTextModalOpen(false);
      await fetchMedia();
    } catch (error) {
      console.error('Failed to add text slide', error);
    }
  };

  const deleteMedia = async (item) => {
    if (!window.confirm(`Medium "${item.name}" wirklich loeschen?`)) return;

    try {
      await axios.delete(`${API_URL}/media/${item.id}`);
      await fetchMedia();
    } catch (error) {
      console.error('Failed to delete media', error);
    }
  };

  const query = search.trim().toLowerCase();
  const filteredMedia = media.filter((item) => {
    if (filter !== 'all' && item.type !== filter) return false;
    if (!query) return true;

    const haystack = [item.name, item.url, item.filepath, item.content]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes(query);
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Medienbibliothek</h1>
          <p className="page-subtitle">Dateien, Webseiten und Text-Slides fuer Playlisten und Layouts.</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-secondary" onClick={() => setIsTextModalOpen(true)}>
            <Type size={18} />
            Text-Slide
          </button>
          <button className="btn btn-secondary" onClick={openWebCreateModal}>
            <Globe size={18} />
            Webseite
          </button>
          <button className="btn btn-primary" onClick={() => setIsUploadModalOpen(true)}>
            <Upload size={18} />
            Datei hochladen
          </button>
        </div>
      </div>

      <div className="toolbar">
        <div className="toolbar-search">
          <Search size={16} />
          <input
            className="form-control"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Suchen nach Name, URL oder Inhalt"
          />
        </div>
        <select className="form-control compact-select" value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">Alle Typen</option>
          <option value="image">Bild</option>
          <option value="video">Video</option>
          <option value="document">Dokument</option>
          <option value="webpage">Webseite</option>
          <option value="text">Text</option>
        </select>
      </div>

      {filteredMedia.length === 0 ? (
        <div className="glass-card empty-state large">
          <ImageIcon size={64} style={{ opacity: 0.15 }} />
          <h3>Keine Medien gefunden</h3>
          <p>Lege Medien an oder passe Suche und Filter an.</p>
        </div>
      ) : (
        <div className="media-grid">
          {filteredMedia.map((item) => (
            <div key={item.id} className="glass-card media-card">
              <div className="media-preview">{renderPreview(item)}</div>
              <div className="media-card-body">
                <div className="entity-title-row">
                  <span className="entity-title">{item.name}</span>
                  <span className={`badge badge-${item.type}`}>{item.type}</span>
                </div>
                <div className="entity-meta">
                  {item.type === 'webpage'
                    ? truncate(item.url, 72)
                    : item.type === 'text'
                      ? truncate(item.content, 72)
                      : truncate(item.filepath, 72)}
                </div>
                <div className="media-card-footer">
                  <span>{item.type === 'video' ? 'Bis Video-Ende' : `${item.duration || 0}s`}</span>
                  <div className="row-actions">
                    {item.type === 'webpage' ? (
                      <button className="btn-icon" onClick={() => openWebEditModal(item)} title="Webseite bearbeiten">
                        <PenSquare size={16} />
                      </button>
                    ) : null}
                    {item.url ? (
                      <a className="btn-icon" href={item.url} target="_blank" rel="noreferrer">
                        <LinkIcon size={16} />
                      </a>
                    ) : null}
                    <button className="btn-icon danger" onClick={() => deleteMedia(item)}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {isUploadModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content modal-narrow">
            <h3>Datei hochladen</h3>
            <form onSubmit={handleFileUpload}>
              <div className="form-group">
                <label>Datei</label>
                <input
                  className="form-control"
                  type="file"
                  accept="image/*,video/*,application/pdf"
                  onChange={(event) => {
                    const nextFile = event.target.files?.[0] || null;
                    setFile(nextFile);
                    if (nextFile && !uploadName) {
                      setUploadName(nextFile.name.replace(/\.[^.]+$/, ''));
                    }
                  }}
                  required
                />
              </div>
              <div className="form-group">
                <label>Name</label>
                <input className="form-control" value={uploadName} onChange={(event) => setUploadName(event.target.value)} required />
              </div>
              <div className="form-group">
                <label>Dauer (Sekunden)</label>
                <input
                  className="form-control"
                  type="number"
                  min="1"
                  value={uploadDuration}
                  onChange={(event) => setUploadDuration(Number(event.target.value))}
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setIsUploadModalOpen(false)}>
                  Abbrechen
                </button>
                <button type="submit" className="btn btn-primary">
                  Hochladen
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isWebModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content modal-narrow">
            <h3>{editingWebMedia ? 'Webseite bearbeiten' : 'Webseite hinzufuegen'}</h3>
            <form onSubmit={handleWebSave}>
              <div className="form-group">
                <label>Name</label>
                <input className="form-control" value={webName} onChange={(event) => setWebName(event.target.value)} required />
              </div>
              <div className="form-group">
                <label>URL</label>
                <input className="form-control" type="url" value={webUrl} onChange={(event) => setWebUrl(event.target.value)} required />
              </div>
              <div className="form-group">
                <label>Dauer (Sekunden)</label>
                <input
                  className="form-control"
                  type="number"
                  min="1"
                  value={webDuration}
                  onChange={(event) => setWebDuration(Number(event.target.value))}
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={closeWebModal}>
                  Abbrechen
                </button>
                <button type="submit" className="btn btn-primary">
                  {editingWebMedia ? 'Aktualisieren' : 'Speichern'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isTextModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content modal-wide">
            <h3>Text-Slide erstellen</h3>
            <div className="split-panel">
              <form className="glass-panel" onSubmit={handleTextAdd}>
                <div className="form-group">
                  <label>Name</label>
                  <input
                    className="form-control"
                    value={textSlide.name}
                    onChange={(event) => setTextSlide((current) => ({ ...current, name: event.target.value }))}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Textinhalt</label>
                  <textarea
                    className="form-control"
                    rows={6}
                    value={textSlide.content}
                    onChange={(event) => setTextSlide((current) => ({ ...current, content: event.target.value }))}
                    required
                  />
                </div>
                <div className="form-grid two-columns">
                  <div className="form-group">
                    <label>Dauer</label>
                    <input
                      className="form-control"
                      type="number"
                      min="1"
                      value={textSlide.duration}
                      onChange={(event) => setTextSlide((current) => ({ ...current, duration: Number(event.target.value) }))}
                    />
                  </div>
                  <div className="form-group">
                    <label>Font Size</label>
                    <input
                      className="form-control"
                      type="number"
                      min="16"
                      max="140"
                      value={textSlide.settings.fontSize}
                      onChange={(event) => setTextSlide((current) => ({
                        ...current,
                        settings: { ...current.settings, fontSize: Number(event.target.value) },
                      }))}
                    />
                  </div>
                </div>
                <div className="form-grid two-columns">
                  <div className="form-group">
                    <label>Textfarbe</label>
                    <input
                      className="form-control"
                      value={textSlide.settings.textColor}
                      onChange={(event) => setTextSlide((current) => ({
                        ...current,
                        settings: { ...current.settings, textColor: event.target.value },
                      }))}
                    />
                  </div>
                  <div className="form-group">
                    <label>Hintergrund</label>
                    <input
                      className="form-control"
                      value={textSlide.settings.backgroundColor}
                      onChange={(event) => setTextSlide((current) => ({
                        ...current,
                        settings: { ...current.settings, backgroundColor: event.target.value },
                      }))}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label>Akzentfarbe</label>
                  <input
                    className="form-control"
                    value={textSlide.settings.accentColor}
                    onChange={(event) => setTextSlide((current) => ({
                      ...current,
                      settings: { ...current.settings, accentColor: event.target.value },
                    }))}
                  />
                </div>
                <div className="form-group">
                  <label>Ausrichtung</label>
                  <select
                    className="form-control"
                    value={textSlide.settings.align}
                    onChange={(event) => setTextSlide((current) => ({
                      ...current,
                      settings: { ...current.settings, align: event.target.value },
                    }))}
                  >
                    <option value="left">Links</option>
                    <option value="center">Zentriert</option>
                    <option value="right">Rechts</option>
                  </select>
                </div>
                <div className="modal-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setIsTextModalOpen(false)}>
                    Abbrechen
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Text-Slide speichern
                  </button>
                </div>
              </form>

              <div className="glass-panel">
                <h4>Vorschau</h4>
                <div
                  className="text-slide-preview"
                  style={{
                    background: textSlide.settings.backgroundColor,
                    color: textSlide.settings.textColor,
                    textAlign: textSlide.settings.align,
                  }}
                >
                  <div className="text-slide-accent" style={{ background: textSlide.settings.accentColor }} />
                  <div style={{ fontSize: `${textSlide.settings.fontSize}px` }}>
                    {textSlide.content || 'Hier erscheint deine Nachricht'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function renderPreview(item) {
  switch (item.type) {
    case 'image':
      return <img src={`${window.location.origin}${item.filepath}`} alt={item.name} className="media-image-preview" />;
    case 'video':
      return (
        <div className="media-placeholder">
          <Video size={28} />
          <span>Video</span>
        </div>
      );
    case 'document':
      return (
        <div className="media-placeholder">
          <FileText size={28} />
          <span>PDF</span>
        </div>
      );
    case 'webpage':
      return (
        <div className="media-placeholder">
          <Globe size={28} />
          <span>{truncate(item.url, 42)}</span>
        </div>
      );
    case 'text':
      return (
        <div
          className="text-card-preview"
          style={{
            background: item.settings?.backgroundColor || '#0f172a',
            color: item.settings?.textColor || '#f8fafc',
            textAlign: item.settings?.align || 'center',
          }}
        >
          <div className="text-card-preview-accent" style={{ background: item.settings?.accentColor || '#0ea5e9' }} />
          <span>{truncate(item.content, 70)}</span>
        </div>
      );
    default:
      return (
        <div className="media-placeholder">
          <ImageIcon size={28} />
        </div>
      );
  }
}

export default MediaPage;
