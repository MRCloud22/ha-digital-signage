import { useEffect, useState } from 'react';
import axios from 'axios';
import {
  Clock3,
  Cpu,
  LayoutDashboard,
  ListVideo,
  Monitor,
  PenSquare,
  RefreshCw,
  Smartphone,
  Trash2,
} from 'lucide-react';
import {
  WEEKDAYS,
  buildScheduleForm,
  formatLastContact,
  parseDeviceInfo,
  summarizeSchedule,
  toDateTimeLocalValue,
} from '../ui';

const API_URL = `${window.location.origin}/api`;

function ScreensPage() {
  const [screens, setScreens] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [layouts, setLayouts] = useState([]);
  const [loading, setLoading] = useState(true);

  const [pairingCode, setPairingCode] = useState('');
  const [pairingError, setPairingError] = useState('');
  const [isPairing, setIsPairing] = useState(false);

  const [scheduleScreen, setScheduleScreen] = useState(null);
  const [screenSchedules, setScreenSchedules] = useState([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleForm, setScheduleForm] = useState(buildScheduleForm());

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchScreens, 15000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [screensRes, playlistsRes, layoutsRes] = await Promise.all([
        axios.get(`${API_URL}/screens`),
        axios.get(`${API_URL}/playlists`),
        axios.get(`${API_URL}/layouts`),
      ]);

      setScreens(screensRes.data);
      setPlaylists(playlistsRes.data);
      setLayouts(layoutsRes.data);
    } catch (error) {
      console.error('Failed to fetch screen data', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchScreens = async () => {
    try {
      const response = await axios.get(`${API_URL}/screens`);
      setScreens(response.data);
    } catch (error) {
      console.error('Failed to refresh screens', error);
    }
  };

  const updateScreen = async (screen, updates) => {
    try {
      const has = (key) => Object.prototype.hasOwnProperty.call(updates, key);

      await axios.put(`${API_URL}/screens/${screen.id}`, {
        name: has('name') ? updates.name : screen.name,
        active_playlist_id: has('active_playlist_id') ? updates.active_playlist_id : screen.active_playlist_id ?? null,
        active_layout_id: has('active_layout_id') ? updates.active_layout_id : screen.active_layout_id ?? null,
        notes: has('notes') ? updates.notes : screen.notes ?? null,
      });

      await fetchScreens();
    } catch (error) {
      console.error('Failed to update screen', error);
    }
  };

  const handlePairing = async (event) => {
    event.preventDefault();
    setPairingError('');

    try {
      await axios.post(`${API_URL}/screens/confirm`, { pairingCode });
      setPairingCode('');
      setIsPairing(false);
      await fetchData();
    } catch (error) {
      setPairingError(error.response?.data?.error || 'Kopplung fehlgeschlagen.');
    }
  };

  const deleteScreen = async (screen) => {
    if (!window.confirm(`Screen "${screen.name}" wirklich loeschen?`)) return;

    try {
      await axios.delete(`${API_URL}/screens/${screen.id}`);
      await fetchData();
    } catch (error) {
      console.error('Failed to delete screen', error);
    }
  };

  const openScheduleManager = async (screen) => {
    setScheduleScreen(screen);
    setScheduleForm(buildScheduleForm());
    setScheduleLoading(true);

    try {
      const response = await axios.get(`${API_URL}/screens/${screen.id}/schedules`);
      setScreenSchedules(response.data);
    } catch (error) {
      console.error('Failed to load schedules', error);
      setScreenSchedules([]);
    } finally {
      setScheduleLoading(false);
    }
  };

  const refreshScheduleModal = async () => {
    if (!scheduleScreen) return;

    const [schedulesRes, screensRes] = await Promise.all([
      axios.get(`${API_URL}/screens/${scheduleScreen.id}/schedules`),
      axios.get(`${API_URL}/screens`),
    ]);

    setScreenSchedules(schedulesRes.data);
    setScreens(screensRes.data);
    const updatedScreen = screensRes.data.find((entry) => entry.id === scheduleScreen.id);
    setScheduleScreen(updatedScreen || scheduleScreen);
  };

  const saveSchedule = async (event) => {
    event.preventDefault();
    if (!scheduleScreen) return;

    setScheduleSaving(true);

    const payload = {
      name: scheduleForm.name,
      targetType: scheduleForm.targetType,
      targetId: scheduleForm.targetId,
      priority: Number(scheduleForm.priority || 0),
      startsAt: scheduleForm.startsAt || null,
      endsAt: scheduleForm.endsAt || null,
      startTime: scheduleForm.startTime || null,
      endTime: scheduleForm.endTime || null,
      daysOfWeek: scheduleForm.daysOfWeek,
      isEnabled: scheduleForm.isEnabled,
    };

    try {
      if (scheduleForm.id) {
        await axios.put(`${API_URL}/screens/${scheduleScreen.id}/schedules/${scheduleForm.id}`, payload);
      } else {
        await axios.post(`${API_URL}/screens/${scheduleScreen.id}/schedules`, payload);
      }

      setScheduleForm(buildScheduleForm());
      await refreshScheduleModal();
    } catch (error) {
      alert(error.response?.data?.error || 'Zeitplan konnte nicht gespeichert werden.');
    } finally {
      setScheduleSaving(false);
    }
  };

  const deleteSchedule = async (scheduleId) => {
    if (!scheduleScreen) return;
    if (!window.confirm('Zeitplan wirklich loeschen?')) return;

    try {
      await axios.delete(`${API_URL}/screens/${scheduleScreen.id}/schedules/${scheduleId}`);
      if (scheduleForm.id === scheduleId) {
        setScheduleForm(buildScheduleForm());
      }
      await refreshScheduleModal();
    } catch (error) {
      console.error('Failed to delete schedule', error);
    }
  };

  const toggleScheduleDay = (dayValue) => {
    setScheduleForm((current) => {
      const nextDays = current.daysOfWeek.includes(dayValue)
        ? current.daysOfWeek.filter((value) => value !== dayValue)
        : [...current.daysOfWeek, dayValue];

      return {
        ...current,
        daysOfWeek: nextDays,
      };
    });
  };

  const onlineScreens = screens.filter((screen) => screen.is_online).length;
  const scheduledScreens = screens.filter((screen) => screen.schedule_count > 0).length;
  const layoutDrivenScreens = screens.filter((screen) => screen.runtime_mode === 'layout').length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Screens</h1>
          <p className="page-subtitle">Pairing, Live-Status und zeitgesteuerte Ausspielung pro Display.</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-secondary" onClick={fetchData} title="Aktualisieren">
            <RefreshCw size={18} />
            Refresh
          </button>
          <button className="btn btn-primary" onClick={() => setIsPairing(true)}>
            <Smartphone size={18} />
            Screen koppeln
          </button>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard label="Screens gesamt" value={screens.length} icon={<Monitor size={18} />} />
        <StatCard label="Online" value={onlineScreens} icon={<Cpu size={18} />} accent="success" />
        <StatCard label="Mit Zeitplan" value={scheduledScreens} icon={<Clock3 size={18} />} />
        <StatCard label="Layout-Modus" value={layoutDrivenScreens} icon={<LayoutDashboard size={18} />} />
      </div>

      <div className="glass-card">
        {loading ? (
          <div className="empty-state">
            <RefreshCw className="spin" size={32} />
            <p>Lade Screens...</p>
          </div>
        ) : screens.length === 0 ? (
          <div className="empty-state">
            <Monitor size={56} style={{ opacity: 0.25 }} />
            <h3>Keine Screens verbunden</h3>
            <p>
              Oeffne <strong>{window.location.origin}/#/player</strong> auf einem Raspberry Pi oder Browser
              und verwende den 6-stelligen Code im Dashboard.
            </p>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Screen</th>
                  <th>Zuordnung</th>
                  <th>Zeitplaene</th>
                  <th>Zuletzt aktiv</th>
                  <th style={{ width: '70px' }} />
                </tr>
              </thead>
              <tbody>
                {screens.map((screen) => {
                  const deviceInfo = parseDeviceInfo(screen.device_info);
                  const assignmentMode = screen.active_layout_id ? 'layout' : 'playlist';

                  return (
                    <tr key={screen.id}>
                      <td>
                        <div className="status-stack">
                          <span className={`status-pill ${screen.is_online ? 'online' : screen.is_paired ? 'idle' : 'pending'}`}>
                            <span className="status-dot" />
                            {screen.is_online ? 'Online' : screen.is_paired ? 'Gekoppelt' : 'Pending'}
                          </span>
                          <span className="muted-small">
                            {screen.runtime_source === 'schedule'
                              ? `Aktiv: ${screen.active_schedule_name || 'Zeitplan'}`
                              : 'Basis-Zuordnung'}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="entity-cell">
                          <div className="entity-title-row">
                            <span className="entity-title">{screen.name}</span>
                            <span className="badge badge-neutral">{screen.runtime_mode}</span>
                          </div>
                          <div className="entity-meta">
                            {screen.resolution ? `${screen.resolution}` : 'Aufloesung unbekannt'}
                            {deviceInfo ? ` · ${deviceInfo}` : ''}
                          </div>
                          {screen.notes ? <div className="muted-small">{screen.notes}</div> : null}
                        </div>
                      </td>
                      <td>
                        <div className="assignment-editor">
                          <select
                            className="form-control compact-select"
                            value={assignmentMode}
                            onChange={(event) => {
                              if (event.target.value === 'layout') {
                                updateScreen(screen, {
                                  active_playlist_id: null,
                                  active_layout_id: screen.active_layout_id || layouts[0]?.id || null,
                                });
                              } else {
                                updateScreen(screen, {
                                  active_playlist_id: screen.active_playlist_id || playlists[0]?.id || null,
                                  active_layout_id: null,
                                });
                              }
                            }}
                          >
                            <option value="playlist">Playlist</option>
                            <option value="layout">Layout</option>
                          </select>

                          {assignmentMode === 'layout' ? (
                            <div className="assignment-select">
                              <LayoutDashboard size={16} />
                              <select
                                className="form-control compact-select"
                                value={screen.active_layout_id || ''}
                                onChange={(event) => updateScreen(screen, {
                                  active_layout_id: event.target.value || null,
                                  active_playlist_id: null,
                                })}
                              >
                                <option value="">Kein Layout</option>
                                {layouts.map((layout) => (
                                  <option key={layout.id} value={layout.id}>
                                    {layout.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : (
                            <div className="assignment-select">
                              <ListVideo size={16} />
                              <select
                                className="form-control compact-select"
                                value={screen.active_playlist_id || ''}
                                onChange={(event) => updateScreen(screen, {
                                  active_playlist_id: event.target.value || null,
                                  active_layout_id: null,
                                })}
                              >
                                <option value="">Keine Playlist</option>
                                {playlists.map((playlist) => (
                                  <option key={playlist.id} value={playlist.id}>
                                    {playlist.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="status-stack">
                          <span className="badge badge-neutral">{screen.schedule_count} Zeitplaene</span>
                          <button className="btn btn-secondary btn-small" onClick={() => openScheduleManager(screen)}>
                            <PenSquare size={14} />
                            Verwalten
                          </button>
                        </div>
                      </td>
                      <td>
                        <div className="status-stack">
                          <span>{formatLastContact(screen.last_contact_at)}</span>
                          <span className="muted-small">
                            {screen.is_online ? 'Heartbeat aktiv' : 'Wartet auf Heartbeat'}
                          </span>
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn-icon danger" title="Screen loeschen" onClick={() => deleteScreen(screen)}>
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isPairing && (
        <div className="modal-overlay">
          <div className="modal-content modal-narrow">
            <h3>Screen per Code koppeln</h3>
            <p className="muted-copy">
              Oeffne <strong>{window.location.origin}/#/player</strong> auf dem Geraet und trage den Code hier ein.
            </p>
            {pairingError ? <div className="alert error">{pairingError}</div> : null}
            <form onSubmit={handlePairing}>
              <div className="form-group">
                <label>Pairing Code</label>
                <input
                  className="form-control"
                  type="text"
                  value={pairingCode}
                  onChange={(event) => setPairingCode(event.target.value)}
                  maxLength={6}
                  placeholder="123456"
                  autoFocus
                  required
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setIsPairing(false)}>
                  Abbrechen
                </button>
                <button type="submit" className="btn btn-primary">
                  Koppeln
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {scheduleScreen && (
        <div className="modal-overlay">
          <div className="modal-content modal-wide">
            <div className="modal-header">
              <div>
                <h3>Zeitplaene fuer {scheduleScreen.name}</h3>
                <p className="muted-copy">
                  Prioritaet entscheidet bei Ueberschneidungen. Hoeher gewinnt.
                </p>
              </div>
              <button className="btn btn-secondary" onClick={() => setScheduleScreen(null)}>
                Schliessen
              </button>
            </div>

            <div className="split-panel">
              <div className="glass-panel">
                <h4>{scheduleForm.id ? 'Zeitplan bearbeiten' : 'Neuen Zeitplan anlegen'}</h4>
                <form onSubmit={saveSchedule}>
                  <div className="form-group">
                    <label>Name</label>
                    <input
                      className="form-control"
                      value={scheduleForm.name}
                      onChange={(event) => setScheduleForm((current) => ({ ...current, name: event.target.value }))}
                      placeholder="z.B. Fruehstueck, Abendrotation"
                      required
                    />
                  </div>

                  <div className="form-grid two-columns">
                    <div className="form-group">
                      <label>Zieltyp</label>
                      <select
                        className="form-control"
                        value={scheduleForm.targetType}
                        onChange={(event) => setScheduleForm((current) => ({
                          ...current,
                          targetType: event.target.value,
                          targetId: '',
                        }))}
                      >
                        <option value="playlist">Playlist</option>
                        <option value="layout">Layout</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Prioritaet</label>
                      <input
                        className="form-control"
                        type="number"
                        value={scheduleForm.priority}
                        onChange={(event) => setScheduleForm((current) => ({ ...current, priority: event.target.value }))}
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Ziel</label>
                    <select
                      className="form-control"
                      value={scheduleForm.targetId}
                      onChange={(event) => setScheduleForm((current) => ({ ...current, targetId: event.target.value }))}
                      required
                    >
                      <option value="">Bitte waehlen</option>
                      {(scheduleForm.targetType === 'layout' ? layouts : playlists).map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-grid two-columns">
                    <div className="form-group">
                      <label>Startdatum</label>
                      <input
                        className="form-control"
                        type="datetime-local"
                        value={toDateTimeLocalValue(scheduleForm.startsAt)}
                        onChange={(event) => setScheduleForm((current) => ({ ...current, startsAt: event.target.value }))}
                      />
                    </div>
                    <div className="form-group">
                      <label>Enddatum</label>
                      <input
                        className="form-control"
                        type="datetime-local"
                        value={toDateTimeLocalValue(scheduleForm.endsAt)}
                        onChange={(event) => setScheduleForm((current) => ({ ...current, endsAt: event.target.value }))}
                      />
                    </div>
                  </div>

                  <div className="form-grid two-columns">
                    <div className="form-group">
                      <label>Ab Uhrzeit</label>
                      <input
                        className="form-control"
                        type="time"
                        value={scheduleForm.startTime}
                        onChange={(event) => setScheduleForm((current) => ({ ...current, startTime: event.target.value }))}
                      />
                    </div>
                    <div className="form-group">
                      <label>Bis Uhrzeit</label>
                      <input
                        className="form-control"
                        type="time"
                        value={scheduleForm.endTime}
                        onChange={(event) => setScheduleForm((current) => ({ ...current, endTime: event.target.value }))}
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Tage</label>
                    <div className="weekday-picker">
                      {WEEKDAYS.map((day) => (
                        <button
                          key={day.value}
                          type="button"
                          className={`weekday-chip ${scheduleForm.daysOfWeek.includes(day.value) ? 'active' : ''}`}
                          onClick={() => toggleScheduleDay(day.value)}
                        >
                          {day.label}
                        </button>
                      ))}
                    </div>
                    <p className="muted-small">Leer bedeutet: jeden Tag aktiv.</p>
                  </div>

                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={scheduleForm.isEnabled}
                      onChange={(event) => setScheduleForm((current) => ({ ...current, isEnabled: event.target.checked }))}
                    />
                    <span>Zeitplan ist aktiv</span>
                  </label>

                  <div className="modal-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => setScheduleForm(buildScheduleForm())}>
                      Reset
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={scheduleSaving}>
                      {scheduleSaving ? 'Speichert...' : scheduleForm.id ? 'Zeitplan aktualisieren' : 'Zeitplan speichern'}
                    </button>
                  </div>
                </form>
              </div>

              <div className="glass-panel">
                <h4>Vorhandene Zeitplaene</h4>
                {scheduleLoading ? (
                  <div className="empty-state compact">
                    <RefreshCw className="spin" size={24} />
                    <p>Lade Zeitplaene...</p>
                  </div>
                ) : screenSchedules.length === 0 ? (
                  <div className="empty-state compact">
                    <Clock3 size={34} style={{ opacity: 0.2 }} />
                    <p>Noch keine Zeitplaene fuer diesen Screen.</p>
                  </div>
                ) : (
                  <div className="schedule-list">
                    {screenSchedules.map((schedule) => (
                      <div key={schedule.id} className={`schedule-card ${schedule.is_active_now ? 'active' : ''}`}>
                        <div className="schedule-card-header">
                          <div>
                            <div className="entity-title-row">
                              <span className="entity-title">{schedule.name}</span>
                              <span className={`badge ${schedule.is_active_now ? 'badge-success' : 'badge-neutral'}`}>
                                {schedule.is_active_now ? 'live' : 'wartend'}
                              </span>
                            </div>
                            <div className="entity-meta">
                              {summarizeSchedule(schedule, playlists, layouts)}
                            </div>
                          </div>
                          <div className="row-actions">
                            <button className="btn-icon" onClick={() => setScheduleForm(buildScheduleForm(schedule))}>
                              <PenSquare size={16} />
                            </button>
                            <button className="btn-icon danger" onClick={() => deleteSchedule(schedule.id)}>
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                        <div className="schedule-card-footer">
                          <span>Prioritaet {schedule.priority}</span>
                          <span>{schedule.is_enabled ? 'Aktiviert' : 'Deaktiviert'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
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

export default ScreensPage;
