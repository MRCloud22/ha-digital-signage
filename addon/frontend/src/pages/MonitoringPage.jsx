import { useEffect, useEffectEvent, useState } from 'react';
import axios from 'axios';
import { Activity, AlertTriangle, BellRing, CheckCircle2, Cpu, RefreshCw, ShieldAlert } from 'lucide-react';

const API_URL = `${window.location.origin}/api`;

function MonitoringPage() {
  const [screens, setScreens] = useState([]);
  const [summary, setSummary] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [playbackEvents, setPlaybackEvents] = useState([]);
  const [playerEvents, setPlayerEvents] = useState([]);
  const [screenFilter, setScreenFilter] = useState('');
  const [alertSeverity, setAlertSeverity] = useState('');
  const [playbackStatus, setPlaybackStatus] = useState('');
  const [playerLevel, setPlayerLevel] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchMonitoring = async () => {
    try {
      setLoading(true);

      const alertParams = { limit: 80 };
      const playbackParams = { limit: 80, hours: 168 };
      const playerParams = { limit: 80, hours: 168 };

      if (screenFilter) {
        alertParams.screenId = screenFilter;
        playbackParams.screenId = screenFilter;
        playerParams.screenId = screenFilter;
      }

      if (alertSeverity) {
        alertParams.severity = alertSeverity;
      }

      if (playbackStatus) {
        playbackParams.status = playbackStatus;
      }

      if (playerLevel) {
        playerParams.level = playerLevel;
      }

      const [screensRes, summaryRes, alertsRes, playbackRes, playerRes] = await Promise.all([
        axios.get(`${API_URL}/screens`),
        axios.get(`${API_URL}/monitoring/summary`),
        axios.get(`${API_URL}/monitoring/alerts`, { params: alertParams }),
        axios.get(`${API_URL}/monitoring/playback-events`, { params: playbackParams }),
        axios.get(`${API_URL}/monitoring/player-events`, { params: playerParams }),
      ]);

      setScreens(screensRes.data);
      setSummary(summaryRes.data);
      setAlerts(alertsRes.data);
      setPlaybackEvents(playbackRes.data);
      setPlayerEvents(playerRes.data);
    } catch (error) {
      console.error('Failed to load monitoring data', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMonitoringEffect = useEffectEvent(() => {
    fetchMonitoring();
  });

  useEffect(() => {
    fetchMonitoringEffect();
  }, [screenFilter, alertSeverity, playbackStatus, playerLevel]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Monitoring</h1>
          <p className="page-subtitle">
            Alerts, Proof-of-Play, Player-Fehler und Device-Zustand zentral ueberwachen.
          </p>
        </div>
        <div className="header-actions">
          <button className="btn btn-secondary" onClick={() => fetchMonitoring()} title="Aktualisieren">
            <RefreshCw size={18} />
            Refresh
          </button>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard
          label="Alerts offen"
          value={summary?.alertsOpen ?? '...'}
          icon={<BellRing size={18} />}
          accent={(summary?.alertsOpen || 0) > 0 ? 'danger' : 'success'}
        />
        <StatCard
          label="Kritisch"
          value={summary?.criticalAlerts ?? '...'}
          icon={<ShieldAlert size={18} />}
          accent={(summary?.criticalAlerts || 0) > 0 ? 'danger' : 'default'}
        />
        <StatCard
          label="Warnings"
          value={summary?.warningAlerts ?? '...'}
          icon={<AlertTriangle size={18} />}
          accent={(summary?.warningAlerts || 0) > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Proofs 24h"
          value={summary?.proofsLast24h ?? '...'}
          icon={<CheckCircle2 size={18} />}
          accent="success"
        />
        <StatCard
          label="Playback-Fehler 24h"
          value={summary?.playbackErrorsLast24h ?? '...'}
          icon={<AlertTriangle size={18} />}
          accent="warning"
        />
        <StatCard
          label="Online"
          value={summary?.onlineScreens ?? '...'}
          icon={<Cpu size={18} />}
          accent="success"
        />
      </div>

      <div className="glass-card monitoring-toolbar-card">
        <div className="toolbar">
          <select className="form-control" value={screenFilter} onChange={(event) => setScreenFilter(event.target.value)}>
            <option value="">Alle Screens</option>
            {screens.map((screen) => (
              <option key={screen.id} value={screen.id}>
                {screen.name}
              </option>
            ))}
          </select>

          <select className="form-control" value={alertSeverity} onChange={(event) => setAlertSeverity(event.target.value)}>
            <option value="">Alle Alert-Severities</option>
            <option value="danger">Nur kritisch</option>
            <option value="warning">Nur Warnings</option>
            <option value="info">Nur Info</option>
          </select>

          <select className="form-control" value={playbackStatus} onChange={(event) => setPlaybackStatus(event.target.value)}>
            <option value="">Alle Playback-Status</option>
            <option value="completed">Nur abgeschlossen</option>
            <option value="started">Nur gestartet</option>
            <option value="error">Nur Fehler</option>
          </select>

          <select className="form-control" value={playerLevel} onChange={(event) => setPlayerLevel(event.target.value)}>
            <option value="">Alle Player-Level</option>
            <option value="error">Nur Errors</option>
            <option value="warning">Nur Warnings</option>
            <option value="info">Nur Info</option>
          </select>
        </div>

        <p className="muted-small">
          Letzter Alert: {formatTimestamp(summary?.lastAlertAt)} | Letzter erfolgreicher Proof: {formatTimestamp(summary?.lastProofAt)}
        </p>
      </div>

      <div className="monitoring-layout">
        <div className="glass-card monitoring-section">
          <div className="section-header">
            <div>
              <h3>Alert Center</h3>
              <p className="muted-copy">Offline-Screens, stale Agents, Fehlwiedergaben und problematische Remote-Kommandos.</p>
            </div>
          </div>

          {loading ? (
            <div className="empty-state compact">
              <RefreshCw className="spin" size={24} />
              <p>Lade Alerts...</p>
            </div>
          ) : alerts.length === 0 ? (
            <div className="empty-state compact">
              <CheckCircle2 size={34} style={{ opacity: 0.2 }} />
              <p>Keine aktiven Alerts fuer den aktuellen Filter.</p>
            </div>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Zeit</th>
                    <th>Severity</th>
                    <th>Screen</th>
                    <th>Kategorie</th>
                    <th>Meldung</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map((alert) => (
                    <tr key={alert.id}>
                      <td>{formatTimestamp(alert.occurred_at)}</td>
                      <td>
                        <span className={`badge ${getAlertBadgeClass(alert.severity)}`}>{alert.severity}</span>
                      </td>
                      <td>{alert.screen_name || shortId(alert.screen_id)}</td>
                      <td>{getAlertCategoryLabel(alert.category)}</td>
                      <td>
                        <div className="entity-cell">
                          <span className="entity-title">{alert.title}</span>
                          <span className="muted-small">
                            {alert.message}
                            {renderAlertMeta(alert.meta)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="glass-card monitoring-section">
          <div className="section-header">
            <div>
              <h3>Proof-of-Play</h3>
              <p className="muted-copy">Jede gestartete, abgeschlossene oder fehlerhafte Ausspielung des Players.</p>
            </div>
          </div>

          {loading ? (
            <div className="empty-state compact">
              <RefreshCw className="spin" size={24} />
              <p>Lade Playback-Events...</p>
            </div>
          ) : playbackEvents.length === 0 ? (
            <div className="empty-state compact">
              <CheckCircle2 size={34} style={{ opacity: 0.2 }} />
              <p>Keine Playback-Events fuer den aktuellen Filter.</p>
            </div>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Zeit</th>
                    <th>Screen</th>
                    <th>Medium</th>
                    <th>Playlist</th>
                    <th>Status</th>
                    <th>Dauer</th>
                  </tr>
                </thead>
                <tbody>
                  {playbackEvents.map((event) => (
                    <tr key={event.id}>
                      <td>{formatTimestamp(event.ended_at || event.started_at || event.created_at)}</td>
                      <td>{event.screen_name || shortId(event.screen_id)}</td>
                      <td>
                        <div className="entity-cell">
                          <span className="entity-title">{event.media_name}</span>
                          <span className="muted-small">{event.media_type || 'unbekannt'}</span>
                        </div>
                      </td>
                      <td>
                        <div className="entity-cell">
                          <span>{event.source_playlist_name || event.root_playlist_name || 'Unbekannt'}</span>
                          <span className="muted-small">{event.runtime_source || 'screen'}</span>
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${getPlaybackBadgeClass(event.status)}`}>{event.status}</span>
                      </td>
                      <td>
                        <div className="entity-cell">
                          <span>{formatSeconds(event.duration_seconds)}</span>
                          <span className="muted-small">Soll: {formatSeconds(event.expected_duration_seconds)}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="glass-card monitoring-section">
          <div className="section-header">
            <div>
              <h3>Player-Logs</h3>
              <p className="muted-copy">Verbindungs-, Runtime- und Medienfehler direkt vom Client.</p>
            </div>
          </div>

          {loading ? (
            <div className="empty-state compact">
              <RefreshCw className="spin" size={24} />
              <p>Lade Player-Logs...</p>
            </div>
          ) : playerEvents.length === 0 ? (
            <div className="empty-state compact">
              <Activity size={34} style={{ opacity: 0.2 }} />
              <p>Keine Player-Logs fuer den aktuellen Filter.</p>
            </div>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Zeit</th>
                    <th>Screen</th>
                    <th>Level</th>
                    <th>Kategorie</th>
                    <th>Meldung</th>
                  </tr>
                </thead>
                <tbody>
                  {playerEvents.map((event) => (
                    <tr key={event.id}>
                      <td>{formatTimestamp(event.created_at)}</td>
                      <td>{event.screen_name || shortId(event.screen_id)}</td>
                      <td>
                        <span className={`badge ${getLevelBadgeClass(event.level)}`}>{event.level}</span>
                      </td>
                      <td>{event.category}</td>
                      <td>
                        <div className="entity-cell">
                          <span>{event.message}</span>
                          <span className="muted-small">{summarizeDetails(event.details)}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatTimestamp(value) {
  if (!value) return 'Nie';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unbekannt' : date.toLocaleString('de-DE');
}

function formatSeconds(value) {
  if (!Number.isFinite(Number(value))) return '-';
  return `${Math.round(Number(value))}s`;
}

function shortId(value) {
  return value ? `${value.slice(0, 8)}...` : '-';
}

function summarizeDetails(value) {
  if (!value) return 'Keine Zusatzdaten';

  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === 'string') return parsed;
    if (parsed?.message) return parsed.message;
    return Object.entries(parsed).slice(0, 2).map(([key, entryValue]) => `${key}: ${entryValue}`).join(' | ');
  } catch {
    return value;
  }
}

function renderAlertMeta(meta) {
  if (!meta || typeof meta !== 'object') return '';

  const parts = [];

  if (Number.isFinite(meta.secondsSinceLastContact)) {
    parts.push(`letzter Kontakt vor ${Math.round(meta.secondsSinceLastContact / 60)} min`);
  }

  if (Number.isFinite(meta.secondsSinceAgentReport)) {
    parts.push(`letzter Agent-Report vor ${Math.round(meta.secondsSinceAgentReport / 60)} min`);
  }

  if (Number.isFinite(meta.failureCount)) {
    parts.push(`${meta.failureCount} Fehler`);
  }

  if (Number.isFinite(meta.pendingCount)) {
    parts.push(`${meta.pendingCount} offen`);
  }

  if (Number.isFinite(meta.errorCount)) {
    parts.push(`${meta.errorCount} Vorkommnisse`);
  }

  if (meta.metric && Number.isFinite(meta.currentValue) && Number.isFinite(meta.threshold)) {
    parts.push(`${meta.metric}: ${Math.round(meta.currentValue * 10) / 10} / ${meta.threshold}`);
  }

  return parts.length ? ` | ${parts.join(' | ')}` : '';
}

function getPlaybackBadgeClass(status) {
  if (status === 'completed') return 'badge-success';
  if (status === 'error') return 'badge-danger';
  return 'badge-warning';
}

function getLevelBadgeClass(level) {
  if (level === 'error') return 'badge-danger';
  if (level === 'warning') return 'badge-warning';
  return 'badge-neutral';
}

function getAlertBadgeClass(severity) {
  if (severity === 'danger') return 'badge-danger';
  if (severity === 'warning') return 'badge-warning';
  return 'badge-neutral';
}

function getAlertCategoryLabel(category) {
  const labels = {
    screen_offline: 'Screen offline',
    device_agent_stale: 'Agent stale',
    device_command_failed: 'Command failed',
    device_command_stuck: 'Command pending',
    playback_error: 'Playback error',
    player_error: 'Player error',
    device_health_threshold: 'Health threshold',
    watchdog_recovery: 'Watchdog',
  };

  return labels[category] || category || 'Unbekannt';
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

export default MonitoringPage;
