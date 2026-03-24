import { useEffect, useEffectEvent, useState } from 'react';
import axios from 'axios';
import {
  Copy,
  PackagePlus,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { normalizeDevicePolicy } from '../ui';

const API_URL = `${window.location.origin}/api`;

function parseDevicePolicy(value) {
  if (!value) return normalizeDevicePolicy();

  if (typeof value === 'string') {
    try {
      return normalizeDevicePolicy(JSON.parse(value));
    } catch {
      return normalizeDevicePolicy();
    }
  }

  return normalizeDevicePolicy(value);
}

function buildProfileForm(profile = null) {
  const assignmentMode = profile?.active_layout_id ? 'layout' : profile?.active_playlist_id ? 'playlist' : 'none';
  const devicePolicy = parseDevicePolicy(profile?.device_policy);

  return {
    id: profile?.id || null,
    name: profile?.name || '',
    description: profile?.description || '',
    serverUrl: profile?.server_url || window.location.origin,
    defaultScreenName: profile?.default_screen_name || '',
    notes: profile?.notes || '',
    screenGroupId: profile?.screen_group_id || '',
    assignmentMode,
    targetId: profile?.active_layout_id || profile?.active_playlist_id || '',
    devicePolicy,
  };
}

function ProvisioningPage() {
  const [profiles, setProfiles] = useState([]);
  const [tokens, setTokens] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [layouts, setLayouts] = useState([]);
  const [screenGroups, setScreenGroups] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState(null);
  const [profileForm, setProfileForm] = useState(buildProfileForm());
  const [issueForm, setIssueForm] = useState({ label: '', expiresInDays: 14 });
  const [issuedToken, setIssuedToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [issuing, setIssuing] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [profilesRes, tokensRes, playlistsRes, layoutsRes, groupsRes] = await Promise.all([
        axios.get(`${API_URL}/provisioning/profiles`),
        axios.get(`${API_URL}/provisioning/tokens`),
        axios.get(`${API_URL}/playlists`),
        axios.get(`${API_URL}/layouts`),
        axios.get(`${API_URL}/screen-groups`),
      ]);

      setProfiles(profilesRes.data);
      setTokens(tokensRes.data);
      setPlaylists(playlistsRes.data);
      setLayouts(layoutsRes.data);
      setScreenGroups(groupsRes.data);

      if (!selectedProfileId && profilesRes.data.length > 0) {
        const nextProfile = profilesRes.data[0];
        setSelectedProfileId(nextProfile.id);
        setProfileForm(buildProfileForm(nextProfile));
      } else if (selectedProfileId) {
        const updated = profilesRes.data.find((entry) => entry.id === selectedProfileId);
        if (updated) {
          setProfileForm(buildProfileForm(updated));
        } else {
          setSelectedProfileId(profilesRes.data[0]?.id || null);
          setProfileForm(profilesRes.data[0] ? buildProfileForm(profilesRes.data[0]) : buildProfileForm());
        }
      }
    } catch (error) {
      console.error('Failed to load provisioning data', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchDataEffect = useEffectEvent(() => {
    fetchData();
  });

  useEffect(() => {
    fetchDataEffect();
  }, []);

  const selectedProfile = profiles.find((entry) => entry.id === selectedProfileId) || null;
  const visibleTokens = selectedProfileId
    ? tokens.filter((token) => token.profile_id === selectedProfileId)
    : tokens;

  const pendingCount = tokens.filter((token) => token.status === 'pending').length;
  const claimedCount = tokens.filter((token) => token.status === 'claimed').length;
  const expiredCount = tokens.filter((token) => token.status === 'expired').length;

  const saveProfile = async (event) => {
    event.preventDefault();

    const payload = {
      name: profileForm.name,
      description: profileForm.description || null,
      server_url: profileForm.serverUrl,
      default_screen_name: profileForm.defaultScreenName || null,
      notes: profileForm.notes || null,
      screen_group_id: profileForm.screenGroupId || null,
      active_playlist_id: null,
      active_layout_id: null,
      device_policy: normalizeDevicePolicy(profileForm.devicePolicy),
    };

    if (profileForm.assignmentMode === 'playlist') {
      payload.active_playlist_id = profileForm.targetId || null;
    } else if (profileForm.assignmentMode === 'layout') {
      payload.active_layout_id = profileForm.targetId || null;
    }

    try {
      setSaving(true);
      if (profileForm.id) {
        await axios.put(`${API_URL}/provisioning/profiles/${profileForm.id}`, payload);
        setSelectedProfileId(profileForm.id);
      } else {
        const response = await axios.post(`${API_URL}/provisioning/profiles`, payload);
        setSelectedProfileId(response.data.id);
      }

      await fetchData();
    } catch (error) {
      alert(error.response?.data?.error || 'Provisioning-Profil konnte nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  };

  const deleteProfile = async (profile) => {
    if (!window.confirm(`Provisioning-Profil "${profile.name}" wirklich loeschen?`)) return;

    try {
      await axios.delete(`${API_URL}/provisioning/profiles/${profile.id}`);
      if (selectedProfileId === profile.id) {
        setSelectedProfileId(null);
        setProfileForm(buildProfileForm());
        setIssuedToken(null);
      }
      await fetchData();
    } catch (error) {
      alert(error.response?.data?.error || 'Provisioning-Profil konnte nicht geloescht werden.');
    }
  };

  const issueToken = async () => {
    if (!selectedProfile) return;

    try {
      setIssuing(true);
      const response = await axios.post(`${API_URL}/provisioning/profiles/${selectedProfile.id}/tokens`, {
        label: issueForm.label || null,
        expires_in_days: Number(issueForm.expiresInDays || 0),
      });

      setIssuedToken(response.data);
      setIssueForm({ label: '', expiresInDays: 14 });
      await fetchData();
    } catch (error) {
      alert(error.response?.data?.error || 'Installer konnte nicht erzeugt werden.');
    } finally {
      setIssuing(false);
    }
  };

  const deleteToken = async (token) => {
    if (!window.confirm('Pending Installer wirklich widerrufen?')) return;

    try {
      await axios.delete(`${API_URL}/provisioning/tokens/${token.id}`);
      if (issuedToken?.id === token.id) {
        setIssuedToken(null);
      }
      await fetchData();
    } catch (error) {
      alert(error.response?.data?.error || 'Installer konnte nicht geloescht werden.');
    }
  };

  const selectProfile = (profile) => {
    setSelectedProfileId(profile.id);
    setProfileForm(buildProfileForm(profile));
    setIssuedToken(null);
  };

  const createNewProfile = () => {
    setSelectedProfileId(null);
    setProfileForm(buildProfileForm());
    setIssuedToken(null);
  };

  const copyValue = async (value) => {
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
    } catch (error) {
      console.error('Clipboard write failed', error);
      window.prompt('Bitte manuell kopieren:', value);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Provisioning</h1>
          <p className="page-subtitle">
            Wiederverwendbare Pi-Profile, einmalige Enrollment-Installer und FullPageOS-Links fuer neue Geraete.
          </p>
        </div>
        <div className="header-actions">
          <button className="btn btn-secondary" onClick={fetchData} title="Aktualisieren">
            <RefreshCw size={18} />
            Refresh
          </button>
          <button className="btn btn-primary" onClick={createNewProfile}>
            <PackagePlus size={18} />
            Neues Profil
          </button>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard label="Profile" value={profiles.length} icon={<ServerCog size={18} />} />
        <StatCard label="Pending Installer" value={pendingCount} icon={<PackagePlus size={18} />} accent="warning" />
        <StatCard label="Claimed" value={claimedCount} icon={<ShieldCheck size={18} />} accent="success" />
        <StatCard label="Expired" value={expiredCount} icon={<Trash2 size={18} />} accent="danger" />
      </div>

      <div className="workspace-two-column">
        <div className="sidebar-column">
          <div className="glass-card create-panel">
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={createNewProfile}>
              <PackagePlus size={18} />
              Profil anlegen
            </button>
          </div>

          <div className="glass-card list-panel">
            {loading ? (
              <div className="empty-state compact">
                <RefreshCw className="spin" size={24} />
                <p>Lade Provisioning-Profile...</p>
              </div>
            ) : profiles.length === 0 ? (
              <div className="empty-state compact">
                <PackagePlus size={34} style={{ opacity: 0.2 }} />
                <p>Noch keine Provisioning-Profile vorhanden.</p>
              </div>
            ) : (
              profiles.map((profile) => (
                <button
                  key={profile.id}
                  className={`list-row ${selectedProfileId === profile.id ? 'active' : ''}`}
                  onClick={() => selectProfile(profile)}
                >
                  <div>
                    <div className="entity-title-row">
                      <span className="entity-title">{profile.name}</span>
                    </div>
                    <div className="muted-small">{describeProfileAssignment(profile)}</div>
                  </div>
                  <span className="badge badge-neutral">{profile.pending_token_count} pending</span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="content-column">
          <div className="glass-card section-card">
            <div className="section-header">
              <div>
                <h3>{profileForm.id ? 'Provisioning-Profil bearbeiten' : 'Neues Provisioning-Profil'}</h3>
                <p className="muted-copy">
                  Die `server_url` muss vom Raspberry Pi direkt erreichbar sein, also typischerweise die Home-Assistant-IP mit Add-on-Port.
                </p>
              </div>
              {profileForm.id ? (
                <button className="btn btn-danger" onClick={() => deleteProfile({ id: profileForm.id, name: profileForm.name })}>
                  <Trash2 size={16} />
                  Loeschen
                </button>
              ) : null}
            </div>

            <form onSubmit={saveProfile}>
              <div className="form-grid two-columns">
                <div className="form-group">
                  <label>Name</label>
                  <input
                    className="form-control"
                    value={profileForm.name}
                    onChange={(event) => setProfileForm((current) => ({ ...current, name: event.target.value }))}
                    placeholder="z.B. Filiale Nord, Lobby Pi, FullPageOS"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Default Screen Name</label>
                  <input
                    className="form-control"
                    value={profileForm.defaultScreenName}
                    onChange={(event) => setProfileForm((current) => ({ ...current, defaultScreenName: event.target.value }))}
                    placeholder="z.B. Empfangsdisplay"
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Server URL</label>
                <input
                  className="form-control"
                  value={profileForm.serverUrl}
                  onChange={(event) => setProfileForm((current) => ({ ...current, serverUrl: event.target.value }))}
                  placeholder="http://192.168.1.65:9999"
                  required
                />
              </div>

              <div className="form-group">
                <label>Beschreibung</label>
                <textarea
                  className="form-control"
                  rows={3}
                  value={profileForm.description}
                  onChange={(event) => setProfileForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder="Optional: Zielgeraete, Standort oder Installationshinweise"
                />
              </div>

              <div className="form-group">
                <label>Screen Gruppe</label>
                <select
                  className="form-control"
                  value={profileForm.screenGroupId}
                  onChange={(event) => setProfileForm((current) => ({ ...current, screenGroupId: event.target.value }))}
                >
                  <option value="">Keine Gruppe</option>
                  {screenGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-grid two-columns">
                <div className="form-group">
                  <label>Initiale Zuordnung</label>
                  <select
                    className="form-control"
                    value={profileForm.assignmentMode}
                    onChange={(event) => setProfileForm((current) => ({
                      ...current,
                      assignmentMode: event.target.value,
                      targetId: event.target.value === 'none' ? '' : current.targetId,
                    }))}
                  >
                    <option value="none">Keine direkte Zuordnung</option>
                    <option value="playlist">Playlist</option>
                    <option value="layout">Layout</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Ziel</label>
                  <select
                    className="form-control"
                    value={profileForm.targetId}
                    onChange={(event) => setProfileForm((current) => ({ ...current, targetId: event.target.value }))}
                    disabled={profileForm.assignmentMode === 'none'}
                  >
                    <option value="">
                      {profileForm.assignmentMode === 'layout'
                        ? 'Layout waehlen'
                        : profileForm.assignmentMode === 'playlist'
                          ? 'Playlist waehlen'
                          : 'Nicht erforderlich'}
                    </option>
                    {(profileForm.assignmentMode === 'layout' ? layouts : playlists).map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>Screen Notes</label>
                <textarea
                  className="form-control"
                  rows={4}
                  value={profileForm.notes}
                  onChange={(event) => setProfileForm((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Wird bei jedem provisionierten Screen als Notiz hinterlegt"
                />
              </div>

              <div className="glass-panel" style={{ marginTop: 12, marginBottom: 18 }}>
                <div className="section-header">
                  <div>
                    <h4>Pi Policy Defaults</h4>
                    <p className="muted-copy">
                      Diese Policy wird bei neuen Provisioning-Screens hinterlegt und steuert Watchdog, Recovery und OTA-Verhalten.
                    </p>
                  </div>
                </div>

                <div className="checkbox-row">
                  <input
                    className="table-checkbox"
                    type="checkbox"
                    checked={profileForm.devicePolicy.watchdogEnabled}
                    onChange={(event) => setProfileForm((current) => ({
                      ...current,
                      devicePolicy: {
                        ...current.devicePolicy,
                        watchdogEnabled: event.target.checked,
                      },
                    }))}
                  />
                  <span>Watchdog fuer Player-Prozess aktivieren</span>
                </div>

                <div className="form-grid two-columns">
                  <div className="form-group">
                    <label>OTA Channel</label>
                    <select
                      className="form-control"
                      value={profileForm.devicePolicy.otaChannel}
                      onChange={(event) => setProfileForm((current) => ({
                        ...current,
                        devicePolicy: {
                          ...current.devicePolicy,
                          otaChannel: event.target.value,
                        },
                      }))}
                    >
                      <option value="stable">stable</option>
                      <option value="beta">beta</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Player Restart nach Ausfall (Sek.)</label>
                    <input
                      className="form-control"
                      type="number"
                      min="15"
                      max="600"
                      value={profileForm.devicePolicy.playerRestartGraceSeconds}
                      onChange={(event) => setProfileForm((current) => ({
                        ...current,
                        devicePolicy: {
                          ...current.devicePolicy,
                          playerRestartGraceSeconds: event.target.value,
                        },
                      }))}
                    />
                  </div>

                  <div className="form-group">
                    <label>Reboot nach aufeinanderfolgenden Fehlern</label>
                    <input
                      className="form-control"
                      type="number"
                      min="1"
                      max="10"
                      value={profileForm.devicePolicy.rebootAfterConsecutivePlayerFailures}
                      onChange={(event) => setProfileForm((current) => ({
                        ...current,
                        devicePolicy: {
                          ...current.devicePolicy,
                          rebootAfterConsecutivePlayerFailures: event.target.value,
                        },
                      }))}
                    />
                  </div>

                  <div className="form-group">
                    <label>CPU Temp Warnschwelle (C)</label>
                    <input
                      className="form-control"
                      type="number"
                      min="60"
                      max="100"
                      value={profileForm.devicePolicy.maxCpuTemperatureC}
                      onChange={(event) => setProfileForm((current) => ({
                        ...current,
                        devicePolicy: {
                          ...current.devicePolicy,
                          maxCpuTemperatureC: event.target.value,
                        },
                      }))}
                    />
                  </div>

                  <div className="form-group">
                    <label>Max. Disk Usage (%)</label>
                    <input
                      className="form-control"
                      type="number"
                      min="70"
                      max="99"
                      value={profileForm.devicePolicy.maxDiskUsedPercent}
                      onChange={(event) => setProfileForm((current) => ({
                        ...current,
                        devicePolicy: {
                          ...current.devicePolicy,
                          maxDiskUsedPercent: event.target.value,
                        },
                      }))}
                    />
                  </div>

                  <div className="form-group">
                    <label>Max. RAM Usage (%)</label>
                    <input
                      className="form-control"
                      type="number"
                      min="70"
                      max="99"
                      value={profileForm.devicePolicy.maxMemoryUsedPercent}
                      onChange={(event) => setProfileForm((current) => ({
                        ...current,
                        devicePolicy: {
                          ...current.devicePolicy,
                          maxMemoryUsedPercent: event.target.value,
                        },
                      }))}
                    />
                  </div>
                </div>

                <div className="checkbox-row" style={{ marginBottom: 0 }}>
                  <input
                    className="table-checkbox"
                    type="checkbox"
                    checked={profileForm.devicePolicy.autoAgentUpdates}
                    onChange={(event) => setProfileForm((current) => ({
                      ...current,
                      devicePolicy: {
                        ...current.devicePolicy,
                        autoAgentUpdates: event.target.checked,
                      },
                    }))}
                  />
                  <span>Device-Agent OTA automatisch anwenden</span>
                </div>

                <div className="checkbox-row" style={{ marginBottom: 0 }}>
                  <input
                    className="table-checkbox"
                    type="checkbox"
                    checked={profileForm.devicePolicy.autoLauncherUpdates}
                    onChange={(event) => setProfileForm((current) => ({
                      ...current,
                      devicePolicy: {
                        ...current.devicePolicy,
                        autoLauncherUpdates: event.target.checked,
                      },
                    }))}
                  />
                  <span>Launcher-/Kiosk-Update automatisch anwenden</span>
                </div>
              </div>

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={createNewProfile}>
                  Reset
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Speichert...' : profileForm.id ? 'Profil aktualisieren' : 'Profil speichern'}
                </button>
              </div>
            </form>
          </div>

          <div className="glass-card section-card">
            <div className="section-header">
              <div>
                <h3>Installer ausgeben</h3>
                <p className="muted-copy">
                  Ein Installer ist ein einmaliger Enrollment-Link. Das Pi-Script richtet Chromium ein und claimed den Screen ohne PIN.
                </p>
              </div>
            </div>

            {!selectedProfile ? (
              <div className="empty-state compact">
                <ShieldCheck size={34} style={{ opacity: 0.2 }} />
                <p>Zuerst ein Profil auswaehlen oder speichern.</p>
              </div>
            ) : (
              <>
                <div className="form-grid two-columns">
                  <div className="form-group">
                    <label>Label</label>
                    <input
                      className="form-control"
                      value={issueForm.label}
                      onChange={(event) => setIssueForm((current) => ({ ...current, label: event.target.value }))}
                      placeholder="Optional: z.B. Messe April, Pi 04"
                    />
                  </div>
                  <div className="form-group">
                    <label>Ablauf in Tagen</label>
                    <input
                      className="form-control"
                      type="number"
                      min="0"
                      max="365"
                      value={issueForm.expiresInDays}
                      onChange={(event) => setIssueForm((current) => ({ ...current, expiresInDays: event.target.value }))}
                    />
                  </div>
                </div>

                <div className="info-strip">
                  <span className="badge badge-neutral">{selectedProfile.name}</span>
                  <span className="muted-small">{describeProfileAssignment(selectedProfile)}</span>
                </div>

                <div className="modal-actions" style={{ marginTop: 0 }}>
                  <button className="btn btn-primary" onClick={issueToken} disabled={issuing}>
                    <PackagePlus size={18} />
                    {issuing ? 'Erzeugt...' : 'Installer erzeugen'}
                  </button>
                </div>

                {issuedToken ? (
                  <div className="provisioning-output">
                    <CopyField
                      label="Install Command"
                      value={issuedToken.install_command}
                      onCopy={copyValue}
                    />
                    <CopyField
                      label="Installer URL"
                      value={issuedToken.installer_url}
                      onCopy={copyValue}
                    />
                    <CopyField
                      label="FullPageOS URL"
                      value={issuedToken.fullpageos_url}
                      onCopy={copyValue}
                    />
                    <CopyField
                      label="Direkter Player Link"
                      value={issuedToken.player_url}
                      onCopy={copyValue}
                    />
                  </div>
                ) : null}
              </>
            )}
          </div>

          <div className="glass-card section-card">
            <div className="section-header">
              <div>
                <h3>Ausgegebene Installer</h3>
                <p className="muted-copy">
                  Pending Installer koennen geloescht werden. Claimed Installer zeigen direkt den provisionierten Screen.
                </p>
              </div>
            </div>

            {visibleTokens.length === 0 ? (
              <div className="empty-state compact">
                <PackagePlus size={34} style={{ opacity: 0.2 }} />
                <p>Keine Installer fuer die aktuelle Auswahl.</p>
              </div>
            ) : (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Profil</th>
                      <th>Label</th>
                      <th>Status</th>
                      <th>Ablauf</th>
                      <th>Screen</th>
                      <th style={{ width: '180px' }}>Aktionen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleTokens.map((token) => (
                      <tr key={token.id}>
                        <td>{token.profile_name}</td>
                        <td>{token.label || '-'}</td>
                        <td>
                          <span className={`badge ${getTokenBadgeClass(token.status)}`}>{token.status}</span>
                        </td>
                        <td>{formatDate(token.expires_at)}</td>
                        <td>{token.claimed_screen_name || '-'}</td>
                        <td>
                          <div className="row-actions">
                            <button className="btn btn-secondary btn-small" onClick={() => setIssuedToken(token)}>
                              Details
                            </button>
                            {token.status === 'pending' ? (
                              <button className="btn btn-danger btn-small" onClick={() => deleteToken(token)}>
                                Widerrufen
                              </button>
                            ) : null}
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
    </div>
  );
}

function CopyField({ label, value, onCopy }) {
  return (
    <div className="copy-field">
      <div className="copy-field-header">
        <span className="entity-title">{label}</span>
        <button className="btn btn-secondary btn-small" onClick={() => onCopy(value)}>
          <Copy size={14} />
          Kopieren
        </button>
      </div>
      <textarea className="form-control provisioning-code-block" rows={3} value={value || ''} readOnly />
    </div>
  );
}

function describeProfileAssignment(profile) {
  if (profile.layout_name) {
    return `Layout: ${profile.layout_name}${profile.group_name ? ` | Gruppe: ${profile.group_name}` : ''}`;
  }

  if (profile.playlist_name) {
    return `Playlist: ${profile.playlist_name}${profile.group_name ? ` | Gruppe: ${profile.group_name}` : ''}`;
  }

  if (profile.group_name) {
    return `Gruppe: ${profile.group_name}`;
  }

  return 'Nur Enrollment, keine direkte Standardzuordnung';
}

function getTokenBadgeClass(status) {
  if (status === 'claimed') return 'badge-success';
  if (status === 'expired') return 'badge-danger';
  return 'badge-warning';
}

function formatDate(value) {
  if (!value) return 'Kein Ablauf';

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unbekannt' : date.toLocaleString('de-DE');
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

export default ProvisioningPage;
