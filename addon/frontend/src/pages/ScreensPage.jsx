import { useEffect, useState } from 'react';
import axios from 'axios';
import {
  Camera,
  Clock3,
  Cpu,
  Download,
  LayoutDashboard,
  ListVideo,
  Monitor,
  PenSquare,
  Power,
  RefreshCw,
  RotateCw,
  Smartphone,
  Volume2,
  Trash2,
  Users,
} from 'lucide-react';
import {
  WEEKDAYS,
  buildScheduleForm,
  formatLastContact,
  normalizeDevicePolicy,
  parseDeviceInfo,
  summarizeSchedule,
  toDateTimeLocalValue,
} from '../ui';

const API_URL = `${window.location.origin}/api`;
const KEEP_GROUP_VALUE = '__keep__';
const NO_GROUP_VALUE = '__none__';
const ROTATION_OPTIONS = ['normal', 'left', 'right', 'inverted'];

function buildGroupForm(group = null) {
  const defaultMode = group?.default_layout_id ? 'layout' : group?.default_playlist_id ? 'playlist' : 'none';

  return {
    id: group?.id || null,
    name: group?.name || '',
    description: group?.description || '',
    defaultMode,
    targetId: group?.default_layout_id || group?.default_playlist_id || '',
  };
}

function buildBulkForm() {
  return {
    assignmentMode: 'skip',
    targetId: '',
    screenGroupId: KEEP_GROUP_VALUE,
  };
}

function buildDeviceCommandForm(screen = null) {
  const health = screen?.device_health_data || {};

  return {
    playerVolume: health.playerVolume ?? 100,
    systemVolume: health.systemVolumePercent ?? 70,
    rotation: 'normal',
    devicePolicy: normalizeDevicePolicy(screen?.device_policy_data),
  };
}

function ScreensPage() {
  const [screens, setScreens] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [layouts, setLayouts] = useState([]);
  const [screenGroups, setScreenGroups] = useState([]);
  const [loading, setLoading] = useState(true);

  const [pairingCode, setPairingCode] = useState('');
  const [pairingError, setPairingError] = useState('');
  const [isPairing, setIsPairing] = useState(false);

  const [scheduleScreen, setScheduleScreen] = useState(null);
  const [screenSchedules, setScreenSchedules] = useState([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleForm, setScheduleForm] = useState(buildScheduleForm());

  const [isGroupManagerOpen, setIsGroupManagerOpen] = useState(false);
  const [groupForm, setGroupForm] = useState(buildGroupForm());
  const [groupSaving, setGroupSaving] = useState(false);

  const [selectedScreenIds, setSelectedScreenIds] = useState([]);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkForm, setBulkForm] = useState(buildBulkForm());

  const [deviceScreen, setDeviceScreen] = useState(null);
  const [deviceCommands, setDeviceCommands] = useState([]);
  const [deviceCommandsLoading, setDeviceCommandsLoading] = useState(false);
  const [deviceScreenshots, setDeviceScreenshots] = useState([]);
  const [deviceScreenshotsLoading, setDeviceScreenshotsLoading] = useState(false);
  const [selectedScreenshotId, setSelectedScreenshotId] = useState(null);
  const [deviceCommandSaving, setDeviceCommandSaving] = useState(false);
  const [devicePolicySaving, setDevicePolicySaving] = useState(false);
  const [deviceForm, setDeviceForm] = useState(buildDeviceCommandForm());

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchScreens, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setSelectedScreenIds((current) => current.filter((screenId) => screens.some((screen) => screen.id === screenId)));
  }, [screens]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [screensRes, playlistsRes, layoutsRes, groupsRes] = await Promise.all([
        axios.get(`${API_URL}/screens`),
        axios.get(`${API_URL}/playlists`),
        axios.get(`${API_URL}/layouts`),
        axios.get(`${API_URL}/screen-groups`),
      ]);

      setScreens(screensRes.data);
      setPlaylists(playlistsRes.data);
      setLayouts(layoutsRes.data);
      setScreenGroups(groupsRes.data);
      setDeviceScreen((current) => (current ? screensRes.data.find((screen) => screen.id === current.id) || null : null));
    } catch (error) {
      console.error('Failed to fetch screen data', error);
    } finally {
      setLoading(false);
    }
  };

  const refreshScreensAndGroups = async () => {
    const [screensRes, groupsRes] = await Promise.all([
      axios.get(`${API_URL}/screens`),
      axios.get(`${API_URL}/screen-groups`),
    ]);

    setScreens(screensRes.data);
    setScreenGroups(groupsRes.data);
    setDeviceScreen((current) => (current ? screensRes.data.find((screen) => screen.id === current.id) || null : null));
  };

  const fetchScreens = async () => {
    try {
      const response = await axios.get(`${API_URL}/screens`);
      setScreens(response.data);
      setDeviceScreen((current) => (current ? response.data.find((screen) => screen.id === current.id) || null : null));
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
        screen_group_id: has('screen_group_id') ? updates.screen_group_id : screen.screen_group_id ?? null,
      });

      await refreshScreensAndGroups();
    } catch (error) {
      console.error('Failed to update screen', error);
      alert(error.response?.data?.error || 'Screen konnte nicht aktualisiert werden.');
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
      await refreshScreensAndGroups();
    } catch (error) {
      console.error('Failed to delete screen', error);
    }
  };

  const openDeviceManager = async (screen) => {
    setDeviceScreen(screen);
    setDeviceForm(buildDeviceCommandForm(screen));
    setDeviceScreenshots([]);
    setSelectedScreenshotId(null);
    setDeviceCommandsLoading(true);
    setDeviceScreenshotsLoading(true);

    try {
      const [commandsRes, screenshotsRes] = await Promise.all([
        axios.get(`${API_URL}/screens/${screen.id}/device-commands`, {
          params: { limit: 25 },
        }),
        axios.get(`${API_URL}/screens/${screen.id}/device-screenshots`, {
          params: { limit: 6 },
        }),
      ]);

      setDeviceCommands(commandsRes.data);
      setDeviceScreenshots(screenshotsRes.data);
      setSelectedScreenshotId(screenshotsRes.data[0]?.id || null);
    } catch (error) {
      console.error('Failed to load device commands', error);
      setDeviceCommands([]);
      setDeviceScreenshots([]);
      setSelectedScreenshotId(null);
    } finally {
      setDeviceCommandsLoading(false);
      setDeviceScreenshotsLoading(false);
    }
  };

  const refreshDeviceManager = async () => {
    if (!deviceScreen) return;

    setDeviceCommandsLoading(true);
    setDeviceScreenshotsLoading(true);
    try {
      const [screensRes, commandsRes, screenshotsRes] = await Promise.all([
        axios.get(`${API_URL}/screens`),
        axios.get(`${API_URL}/screens/${deviceScreen.id}/device-commands`, {
          params: { limit: 25 },
        }),
        axios.get(`${API_URL}/screens/${deviceScreen.id}/device-screenshots`, {
          params: { limit: 6 },
        }),
      ]);

      setScreens(screensRes.data);
      setDeviceCommands(commandsRes.data);
      setDeviceScreenshots(screenshotsRes.data);
      setSelectedScreenshotId((current) => (
        screenshotsRes.data.some((item) => item.id === current)
          ? current
          : screenshotsRes.data[0]?.id || null
      ));
      const updatedScreen = screensRes.data.find((screen) => screen.id === deviceScreen.id) || null;
      setDeviceScreen(updatedScreen);
      if (updatedScreen) {
        setDeviceForm(buildDeviceCommandForm(updatedScreen));
      }
    } catch (error) {
      console.error('Failed to refresh device manager', error);
    } finally {
      setDeviceCommandsLoading(false);
      setDeviceScreenshotsLoading(false);
    }
  };

  const sendDeviceCommand = async (screen, commandType, payload = {}) => {
    if (!screen) return;

    try {
      setDeviceCommandSaving(true);
      await axios.post(`${API_URL}/screens/${screen.id}/device-commands`, {
        commandType,
        payload,
      });
      await refreshDeviceManager();
    } catch (error) {
      console.error('Failed to send device command', error);
      alert(error.response?.data?.error || 'Befehl konnte nicht gesendet werden.');
    } finally {
      setDeviceCommandSaving(false);
    }
  };

  const saveDevicePolicy = async (screen) => {
    if (!screen) return;

    try {
      setDevicePolicySaving(true);
      await axios.put(`${API_URL}/screens/${screen.id}/device-policy`, {
        policy: normalizeDevicePolicy(deviceForm.devicePolicy),
      });
      await refreshDeviceManager();
    } catch (error) {
      console.error('Failed to save device policy', error);
      alert(error.response?.data?.error || 'Device-Policy konnte nicht gespeichert werden.');
    } finally {
      setDevicePolicySaving(false);
    }
  };

  const applyProvisioningPolicy = async (screen) => {
    if (!screen?.provisioning_profile_id) return;

    try {
      setDevicePolicySaving(true);
      await axios.post(`${API_URL}/screens/${screen.id}/device-policy/apply-profile`);
      await refreshDeviceManager();
    } catch (error) {
      console.error('Failed to apply provisioning policy', error);
      alert(error.response?.data?.error || 'Provisioning-Policy konnte nicht uebernommen werden.');
    } finally {
      setDevicePolicySaving(false);
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

  const saveGroup = async (event) => {
    event.preventDefault();

    const payload = {
      name: groupForm.name,
      description: groupForm.description || null,
      default_playlist_id: null,
      default_layout_id: null,
    };

    if (groupForm.defaultMode === 'playlist') {
      if (!groupForm.targetId) {
        alert('Bitte eine Playlist fuer die Gruppen-Standardzuordnung waehlen.');
        return;
      }
      payload.default_playlist_id = groupForm.targetId;
    }

    if (groupForm.defaultMode === 'layout') {
      if (!groupForm.targetId) {
        alert('Bitte ein Layout fuer die Gruppen-Standardzuordnung waehlen.');
        return;
      }
      payload.default_layout_id = groupForm.targetId;
    }

    try {
      setGroupSaving(true);
      if (groupForm.id) {
        await axios.put(`${API_URL}/screen-groups/${groupForm.id}`, payload);
      } else {
        await axios.post(`${API_URL}/screen-groups`, payload);
      }

      setGroupForm(buildGroupForm());
      await refreshScreensAndGroups();
    } catch (error) {
      console.error('Failed to save screen group', error);
      alert(error.response?.data?.error || 'Gruppe konnte nicht gespeichert werden.');
    } finally {
      setGroupSaving(false);
    }
  };

  const deleteGroup = async (group) => {
    if (!window.confirm(`Gruppe "${group.name}" wirklich loeschen? Zugewiesene Screens verlieren nur die Gruppe.`)) {
      return;
    }

    try {
      await axios.delete(`${API_URL}/screen-groups/${group.id}`);
      if (groupForm.id === group.id) {
        setGroupForm(buildGroupForm());
      }
      await refreshScreensAndGroups();
    } catch (error) {
      console.error('Failed to delete group', error);
      alert(error.response?.data?.error || 'Gruppe konnte nicht geloescht werden.');
    }
  };

  const toggleScreenSelection = (screenId) => {
    setSelectedScreenIds((current) => (
      current.includes(screenId)
        ? current.filter((entry) => entry !== screenId)
        : [...current, screenId]
    ));
  };

  const toggleSelectAll = () => {
    if (selectedScreenIds.length === screens.length) {
      setSelectedScreenIds([]);
      return;
    }

    setSelectedScreenIds(screens.map((screen) => screen.id));
  };

  const applyBulkUpdate = async () => {
    if (selectedScreenIds.length === 0) return;

    const payload = {
      screenIds: selectedScreenIds,
    };

    if (bulkForm.assignmentMode === 'playlist') {
      if (!bulkForm.targetId) {
        alert('Bitte eine Playlist fuer das Bulk-Update waehlen.');
        return;
      }
      payload.active_playlist_id = bulkForm.targetId;
      payload.active_layout_id = null;
    } else if (bulkForm.assignmentMode === 'layout') {
      if (!bulkForm.targetId) {
        alert('Bitte ein Layout fuer das Bulk-Update waehlen.');
        return;
      }
      payload.active_playlist_id = null;
      payload.active_layout_id = bulkForm.targetId;
    } else if (bulkForm.assignmentMode === 'clear') {
      payload.active_playlist_id = null;
      payload.active_layout_id = null;
    }

    if (bulkForm.screenGroupId !== KEEP_GROUP_VALUE) {
      payload.screen_group_id = bulkForm.screenGroupId === NO_GROUP_VALUE ? null : bulkForm.screenGroupId;
    }

    try {
      setBulkSaving(true);
      await axios.post(`${API_URL}/screens/bulk-update`, payload);
      setBulkForm(buildBulkForm());
      setSelectedScreenIds([]);
      await refreshScreensAndGroups();
    } catch (error) {
      console.error('Failed to apply bulk update', error);
      alert(error.response?.data?.error || 'Bulk-Update fehlgeschlagen.');
    } finally {
      setBulkSaving(false);
    }
  };

  const onlineScreens = screens.filter((screen) => screen.is_online).length;
  const scheduledScreens = screens.filter((screen) => screen.schedule_count > 0).length;
  const groupedScreens = screens.filter((screen) => !!screen.screen_group_id).length;
  const allSelected = screens.length > 0 && selectedScreenIds.length === screens.length;
  const bulkNeedsTarget = bulkForm.assignmentMode === 'playlist' || bulkForm.assignmentMode === 'layout';
  const bulkHasChanges = bulkForm.assignmentMode !== 'skip' || bulkForm.screenGroupId !== KEEP_GROUP_VALUE;
  const selectedScreenshot = deviceScreenshots.find((item) => item.id === selectedScreenshotId) || deviceScreenshots[0] || null;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Screens</h1>
          <p className="page-subtitle">
            Pairing, Gruppen-Fallbacks, Live-Status und zeitgesteuerte Ausspielung pro Display.
          </p>
        </div>
        <div className="header-actions">
          <button className="btn btn-secondary" onClick={() => setIsGroupManagerOpen(true)}>
            <Users size={18} />
            Gruppen
          </button>
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
        <StatCard label="Mit Gruppe" value={groupedScreens} icon={<Users size={18} />} />
      </div>

      {selectedScreenIds.length > 0 && (
        <div className="glass-card bulk-bar">
          <div className="bulk-bar-copy">
            <span className="badge badge-neutral">{selectedScreenIds.length} ausgewaehlt</span>
            <span>Bulk-Zuweisung fuer mehrere Screens.</span>
          </div>

          <div className="bulk-bar-controls">
            <select
              className="form-control compact-select"
              value={bulkForm.assignmentMode}
              onChange={(event) => setBulkForm((current) => ({
                ...current,
                assignmentMode: event.target.value,
                targetId: event.target.value === 'playlist' || event.target.value === 'layout' ? current.targetId : '',
              }))}
            >
              <option value="skip">Direkte Zuordnung unveraendert</option>
              <option value="playlist">Playlist setzen</option>
              <option value="layout">Layout setzen</option>
              <option value="clear">Direkte Zuordnung leeren</option>
            </select>

            {bulkNeedsTarget && (
              <select
                className="form-control compact-select"
                value={bulkForm.targetId}
                onChange={(event) => setBulkForm((current) => ({ ...current, targetId: event.target.value }))}
              >
                <option value="">{bulkForm.assignmentMode === 'layout' ? 'Layout waehlen' : 'Playlist waehlen'}</option>
                {(bulkForm.assignmentMode === 'layout' ? layouts : playlists).map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            )}

            <select
              className="form-control compact-select"
              value={bulkForm.screenGroupId}
              onChange={(event) => setBulkForm((current) => ({ ...current, screenGroupId: event.target.value }))}
            >
              <option value={KEEP_GROUP_VALUE}>Gruppe unveraendert</option>
              <option value={NO_GROUP_VALUE}>Gruppe entfernen</option>
              {screenGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  Gruppe: {group.name}
                </option>
              ))}
            </select>

            <button
              className="btn btn-primary"
              onClick={applyBulkUpdate}
              disabled={bulkSaving || !bulkHasChanges || (bulkNeedsTarget && !bulkForm.targetId)}
            >
              {bulkSaving ? 'Speichert...' : 'Auf Auswahl anwenden'}
            </button>
            <button className="btn btn-secondary" onClick={() => setSelectedScreenIds([])}>
              Auswahl aufheben
            </button>
          </div>
        </div>
      )}

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
                  <th className="selection-cell">
                    <input
                      className="table-checkbox"
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      aria-label="Alle Screens auswaehlen"
                    />
                  </th>
                  <th>Status</th>
                  <th>Screen</th>
                  <th>Gruppe</th>
                  <th>Zuordnung</th>
                  <th>Zeitplaene</th>
                  <th>Zuletzt aktiv</th>
                  <th style={{ width: '70px' }} />
                </tr>
              </thead>
              <tbody>
                {screens.map((screen) => {
                  const deviceInfo = parseDeviceInfo(screen.device_info);
                  const assignmentMode = getDirectAssignmentMode(screen);
                  const directTarget = assignmentMode === 'layout'
                    ? getTargetName('layout', screen.active_layout_id, playlists, layouts)
                    : getTargetName('playlist', screen.active_playlist_id, playlists, layouts);

                  return (
                    <tr key={screen.id}>
                      <td className="selection-cell">
                        <input
                          className="table-checkbox"
                          type="checkbox"
                          checked={selectedScreenIds.includes(screen.id)}
                          onChange={() => toggleScreenSelection(screen.id)}
                          aria-label={`Screen ${screen.name} auswaehlen`}
                        />
                      </td>
                      <td>
                        <div className="status-stack">
                          <span className={`status-pill ${screen.is_online ? 'online' : screen.is_paired ? 'idle' : 'pending'}`}>
                            <span className="status-dot" />
                            {screen.is_online ? 'Online' : screen.is_paired ? 'Gekoppelt' : 'Pending'}
                          </span>
                          <span className="muted-small">{describeScreenRuntime(screen)}</span>
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
                          <div className="muted-small">{describeDeviceSummary(screen)}</div>
                          {screen.notes ? <div className="muted-small">{screen.notes}</div> : null}
                        </div>
                      </td>
                      <td>
                        <div className="status-stack">
                          <div className="assignment-select">
                            <Users size={16} />
                            <select
                              className="form-control compact-select"
                              value={screen.screen_group_id || NO_GROUP_VALUE}
                              onChange={(event) => updateScreen(screen, {
                                screen_group_id: event.target.value === NO_GROUP_VALUE ? null : event.target.value,
                              })}
                            >
                              <option value={NO_GROUP_VALUE}>Keine Gruppe</option>
                              {screenGroups.map((group) => (
                                <option key={group.id} value={group.id}>
                                  {group.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <span className="muted-small">
                            {screen.group_name
                              ? describeGroupTarget(screen, playlists, layouts)
                              : 'Keine Gruppen-Fallbacks'}
                          </span>
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
                                  active_layout_id: screen.active_layout_id || screen.group_default_layout_id || layouts[0]?.id || null,
                                });
                              } else if (event.target.value === 'playlist') {
                                updateScreen(screen, {
                                  active_playlist_id: screen.active_playlist_id || screen.group_default_playlist_id || playlists[0]?.id || null,
                                  active_layout_id: null,
                                });
                              } else {
                                updateScreen(screen, {
                                  active_playlist_id: null,
                                  active_layout_id: null,
                                });
                              }
                            }}
                          >
                            <option value="none">Kein Override</option>
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
                          ) : null}

                          {assignmentMode === 'playlist' ? (
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
                          ) : null}

                          <span className="muted-small">
                            {assignmentMode === 'none'
                              ? screen.group_name
                                ? 'Kein direkter Override, Gruppe uebernimmt den Fallback.'
                                : 'Kein direkter Override konfiguriert.'
                              : `${assignmentMode === 'layout' ? 'Layout' : 'Playlist'}: ${directTarget || 'Ziel fehlt'}`}
                          </span>
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
                        <div className="row-actions centered">
                          <button className="btn-icon" title="Device Management" onClick={() => openDeviceManager(screen)}>
                            <Cpu size={18} />
                          </button>
                          <button className="btn-icon danger" title="Screen loeschen" onClick={() => deleteScreen(screen)}>
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {deviceScreen && (
        <div className="modal-overlay">
          <div className="modal-content modal-wide">
            <div className="modal-header">
              <div>
                <h3>Device Management fuer {deviceScreen.name}</h3>
                <p className="muted-copy">
                  Browser-Kommandos laufen direkt im Player. Pi-Kommandos benoetigen den Device-Agent aus dem Provisioning-Installer.
                </p>
              </div>
              <div className="row-actions">
                <button className="btn btn-secondary" onClick={refreshDeviceManager}>
                  <RefreshCw size={16} />
                  Aktualisieren
                </button>
                <button className="btn btn-secondary" onClick={() => setDeviceScreen(null)}>
                  Schliessen
                </button>
              </div>
            </div>

            <div className="stats-grid">
              <StatCard
                label="Player"
                value={deviceScreen.is_online ? 'Online' : deviceScreen.is_paired ? 'Offline' : 'Pending'}
                icon={<Monitor size={18} />}
                accent={deviceScreen.is_online ? 'success' : 'warning'}
              />
              <StatCard
                label="Agent"
                value={describeAgentState(deviceScreen)}
                icon={<Cpu size={18} />}
                accent={deviceScreen.device_health_status === 'online' ? 'success' : deviceScreen.device_agent_version ? 'warning' : 'default'}
              />
              <StatCard
                label="Kommandos offen"
                value={deviceScreen.pending_device_command_count || 0}
                icon={<RefreshCw size={18} />}
                accent={(deviceScreen.pending_device_command_count || 0) > 0 ? 'warning' : 'default'}
              />
              <StatCard
                label="Letzter Device Report"
                value={formatLastContact(deviceScreen.last_device_report)}
                icon={<Clock3 size={18} />}
              />
              <StatCard
                label="Letzter Screenshot"
                value={formatLastContact(deviceScreen.latest_screenshot_created_at)}
                icon={<Camera size={18} />}
              />
            </div>

            <div className="split-panel">
              <div className="glass-panel">
                <h4>Health</h4>
                <div className="device-health-grid">
                  <div className="device-health-item">
                    <span className="muted-small">Hostname</span>
                    <strong>{deviceScreen.device_health_data?.hostname || 'Unbekannt'}</strong>
                  </div>
                  <div className="device-health-item">
                    <span className="muted-small">IP</span>
                    <strong>{formatIpAddresses(deviceScreen.device_health_data?.ipAddresses)}</strong>
                  </div>
                  <div className="device-health-item">
                    <span className="muted-small">CPU Temperatur</span>
                    <strong>{formatTemperature(deviceScreen.device_health_data?.cpuTemperatureC)}</strong>
                  </div>
                  <div className="device-health-item">
                    <span className="muted-small">RAM</span>
                    <strong>{formatUsage(deviceScreen.device_health_data?.memory)}</strong>
                  </div>
                  <div className="device-health-item">
                    <span className="muted-small">Disk</span>
                    <strong>{formatUsage(deviceScreen.device_health_data?.disk)}</strong>
                  </div>
                  <div className="device-health-item">
                    <span className="muted-small">Uptime</span>
                    <strong>{formatUptime(deviceScreen.device_health_data?.uptimeSeconds)}</strong>
                  </div>
                  <div className="device-health-item">
                    <span className="muted-small">Player Version</span>
                    <strong>{deviceScreen.player_version || '-'}</strong>
                  </div>
                  <div className="device-health-item">
                    <span className="muted-small">Agent Version</span>
                    <strong>{deviceScreen.device_agent_version || '-'}</strong>
                  </div>
                  <div className="device-health-item">
                    <span className="muted-small">Provisioning Profil</span>
                    <strong>{deviceScreen.provisioning_profile_name || '-'}</strong>
                  </div>
                  <div className="device-health-item">
                    <span className="muted-small">OTA Channel</span>
                    <strong>{deviceScreen.device_policy_data?.otaChannel || 'stable'}</strong>
                  </div>
                  <div className="device-health-item">
                    <span className="muted-small">Letzte Recovery</span>
                    <strong>{formatLastContact(deviceScreen.device_health_data?.watchdog?.lastRecoveryAt)}</strong>
                  </div>
                  <div className="device-health-item">
                    <span className="muted-small">Player Volume</span>
                    <strong>{formatPercent(deviceScreen.device_health_data?.playerVolume)}</strong>
                  </div>
                  <div className="device-health-item">
                    <span className="muted-small">System Volume</span>
                    <strong>{formatPercent(deviceScreen.device_health_data?.systemVolumePercent)}</strong>
                  </div>
                </div>
                <div className="info-strip" style={{ flexWrap: 'wrap' }}>
                  <span className={`badge ${deviceScreen.is_online ? 'badge-success' : 'badge-warning'}`}>
                    {deviceScreen.is_online ? 'Player online' : 'Player nicht online'}
                  </span>
                  <span className={`badge ${deviceScreen.device_health_status === 'online' ? 'badge-success' : 'badge-neutral'}`}>
                    {describeAgentState(deviceScreen)}
                  </span>
                  <span className={`badge ${deviceScreen.device_policy_data?.watchdogEnabled ? 'badge-success' : 'badge-neutral'}`}>
                    {deviceScreen.device_policy_data?.watchdogEnabled ? 'Watchdog aktiv' : 'Watchdog aus'}
                  </span>
                  {(deviceScreen.device_capabilities_data || []).map((capability) => (
                    <span key={capability} className="badge badge-neutral">{capability}</span>
                  ))}
                </div>
              </div>

              <div className="glass-panel">
                <h4>Remote Actions</h4>
                <div className="device-action-section">
                  <div className="entity-title-row">
                    <span className="entity-title">Player</span>
                  </div>
                  <div className="device-action-grid">
                    <button className="btn btn-secondary" disabled={deviceCommandSaving} onClick={() => sendDeviceCommand(deviceScreen, 'refresh_runtime')}>
                      <RefreshCw size={16} />
                      Runtime laden
                    </button>
                    <button className="btn btn-secondary" disabled={deviceCommandSaving} onClick={() => sendDeviceCommand(deviceScreen, 'reload_player')}>
                      <RefreshCw size={16} />
                      Player neu laden
                    </button>
                    <button className="btn btn-secondary" disabled={deviceCommandSaving} onClick={() => sendDeviceCommand(deviceScreen, 'clear_offline_cache')}>
                      <RefreshCw size={16} />
                      Cache leeren
                    </button>
                    <button
                      className="btn btn-secondary"
                      disabled={deviceCommandSaving}
                      onClick={() => {
                        if (!window.confirm('Player-Session wirklich zuruecksetzen?')) return;
                        sendDeviceCommand(deviceScreen, 'restart_pairing');
                      }}
                    >
                      <Monitor size={16} />
                      Neu koppeln
                    </button>
                  </div>

                  <div className="form-grid two-columns">
                    <div className="form-group">
                      <label>Player Lautstaerke</label>
                      <input
                        className="form-control"
                        type="number"
                        min="0"
                        max="100"
                        value={deviceForm.playerVolume}
                        onChange={(event) => setDeviceForm((current) => ({ ...current, playerVolume: event.target.value }))}
                      />
                    </div>
                    <div className="form-group" style={{ alignSelf: 'end' }}>
                      <button
                        className="btn btn-primary"
                        disabled={deviceCommandSaving}
                        onClick={() => sendDeviceCommand(deviceScreen, 'set_player_volume', {
                          level: Number(deviceForm.playerVolume || 0),
                        })}
                      >
                        <Volume2 size={16} />
                        Player Volume senden
                      </button>
                    </div>
                  </div>
                </div>

                <div className="divider" />

                <div className="device-action-section">
                  <div className="entity-title-row">
                    <span className="entity-title">Pi Agent</span>
                    <span className="badge badge-neutral">{describeAgentState(deviceScreen)}</span>
                  </div>
                  {!deviceScreen.device_agent_version ? (
                    <p className="muted-small">
                      Noch kein Agent-Report vorhanden. Diese Befehle funktionieren erst auf Raspberry Pi OS mit dem neuen Provisioning-Installer.
                    </p>
                  ) : null}
                  <div className="device-action-grid">
                    <button
                      className="btn btn-secondary"
                      disabled={deviceCommandSaving || !deviceScreen.device_agent_version}
                      onClick={() => sendDeviceCommand(deviceScreen, 'restart_player_process')}
                    >
                      <Monitor size={16} />
                      Browser neu starten
                    </button>
                    <button
                      className="btn btn-secondary"
                      disabled={deviceCommandSaving || !deviceScreen.device_agent_version}
                      onClick={() => {
                        if (!window.confirm('Geraet wirklich neu starten?')) return;
                        sendDeviceCommand(deviceScreen, 'reboot_device');
                      }}
                    >
                      <Power size={16} />
                      Reboot
                    </button>
                    <button
                      className="btn btn-danger"
                      disabled={deviceCommandSaving || !deviceScreen.device_agent_version}
                      onClick={() => {
                        if (!window.confirm('Geraet wirklich herunterfahren?')) return;
                        sendDeviceCommand(deviceScreen, 'shutdown_device');
                      }}
                    >
                      <Power size={16} />
                      Shutdown
                    </button>
                    <button
                      className="btn btn-secondary"
                      disabled={deviceCommandSaving || !deviceScreen.device_agent_version}
                      onClick={() => sendDeviceCommand(deviceScreen, 'capture_screenshot')}
                    >
                      <Camera size={16} />
                      Screenshot
                    </button>
                    <button
                      className="btn btn-secondary"
                      disabled={deviceCommandSaving || !deviceScreen.device_agent_version}
                      onClick={() => sendDeviceCommand(deviceScreen, 'restart_device_agent')}
                    >
                      <RefreshCw size={16} />
                      Agent neu starten
                    </button>
                    <button
                      className="btn btn-secondary"
                      disabled={deviceCommandSaving || !deviceScreen.device_agent_version}
                      onClick={() => sendDeviceCommand(deviceScreen, 'update_device_agent')}
                    >
                      <Download size={16} />
                      Agent OTA
                    </button>
                    <button
                      className="btn btn-secondary"
                      disabled={deviceCommandSaving || !deviceScreen.device_agent_version}
                      onClick={() => sendDeviceCommand(deviceScreen, 'update_player_launcher')}
                    >
                      <Download size={16} />
                      Launcher OTA
                    </button>
                    <button
                      className="btn btn-primary"
                      disabled={deviceCommandSaving || !deviceScreen.device_agent_version}
                      onClick={() => sendDeviceCommand(deviceScreen, 'repair_installation')}
                    >
                      <RefreshCw size={16} />
                      Runtime reparieren
                    </button>
                  </div>

                  <div className="form-grid two-columns">
                    <div className="form-group">
                      <label>System Lautstaerke</label>
                      <input
                        className="form-control"
                        type="number"
                        min="0"
                        max="100"
                        value={deviceForm.systemVolume}
                        onChange={(event) => setDeviceForm((current) => ({ ...current, systemVolume: event.target.value }))}
                      />
                    </div>
                    <div className="form-group">
                      <label>Rotation</label>
                      <select
                        className="form-control"
                        value={deviceForm.rotation}
                        onChange={(event) => setDeviceForm((current) => ({ ...current, rotation: event.target.value }))}
                      >
                        {ROTATION_OPTIONS.map((rotation) => (
                          <option key={rotation} value={rotation}>
                            {rotation}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="device-action-grid">
                    <button
                      className="btn btn-primary"
                      disabled={deviceCommandSaving || !deviceScreen.device_agent_version}
                      onClick={() => sendDeviceCommand(deviceScreen, 'set_system_volume', {
                        level: Number(deviceForm.systemVolume || 0),
                      })}
                    >
                      <Volume2 size={16} />
                      System Volume senden
                    </button>
                    <button
                      className="btn btn-primary"
                      disabled={deviceCommandSaving || !deviceScreen.device_agent_version}
                      onClick={() => sendDeviceCommand(deviceScreen, 'rotate_display', {
                        rotation: deviceForm.rotation,
                      })}
                    >
                      <RotateCw size={16} />
                      Rotation senden
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="glass-panel" style={{ marginTop: 18 }}>
              <div className="section-header">
                <div>
                  <h4>Policy, OTA und Recovery</h4>
                  <p className="muted-copy">
                    Watchdog- und Health-Schwellen fuer diesen Screen sowie OTA-Verhalten des Pi-Agenten.
                  </p>
                </div>
                <div className="row-actions">
                  {deviceScreen.provisioning_profile_id ? (
                    <button
                      className="btn btn-secondary"
                      disabled={devicePolicySaving}
                      onClick={() => applyProvisioningPolicy(deviceScreen)}
                    >
                      Profil-Policy uebernehmen
                    </button>
                  ) : null}
                  <button
                    className="btn btn-primary"
                    disabled={devicePolicySaving}
                    onClick={() => saveDevicePolicy(deviceScreen)}
                  >
                    {devicePolicySaving ? 'Speichert...' : 'Policy speichern'}
                  </button>
                </div>
              </div>

              <div className="checkbox-row">
                <input
                  className="table-checkbox"
                  type="checkbox"
                  checked={deviceForm.devicePolicy.watchdogEnabled}
                  onChange={(event) => setDeviceForm((current) => ({
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
                    value={deviceForm.devicePolicy.otaChannel}
                    onChange={(event) => setDeviceForm((current) => ({
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
                    value={deviceForm.devicePolicy.playerRestartGraceSeconds}
                    onChange={(event) => setDeviceForm((current) => ({
                      ...current,
                      devicePolicy: {
                        ...current.devicePolicy,
                        playerRestartGraceSeconds: event.target.value,
                      },
                    }))}
                  />
                </div>

                <div className="form-group">
                  <label>Reboot nach Fehler-Serie</label>
                  <input
                    className="form-control"
                    type="number"
                    min="1"
                    max="10"
                    value={deviceForm.devicePolicy.rebootAfterConsecutivePlayerFailures}
                    onChange={(event) => setDeviceForm((current) => ({
                      ...current,
                      devicePolicy: {
                        ...current.devicePolicy,
                        rebootAfterConsecutivePlayerFailures: event.target.value,
                      },
                    }))}
                  />
                </div>

                <div className="form-group">
                  <label>CPU Temp Limit (C)</label>
                  <input
                    className="form-control"
                    type="number"
                    min="60"
                    max="100"
                    value={deviceForm.devicePolicy.maxCpuTemperatureC}
                    onChange={(event) => setDeviceForm((current) => ({
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
                    value={deviceForm.devicePolicy.maxDiskUsedPercent}
                    onChange={(event) => setDeviceForm((current) => ({
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
                    value={deviceForm.devicePolicy.maxMemoryUsedPercent}
                    onChange={(event) => setDeviceForm((current) => ({
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
                  checked={deviceForm.devicePolicy.autoAgentUpdates}
                  onChange={(event) => setDeviceForm((current) => ({
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
                  checked={deviceForm.devicePolicy.autoLauncherUpdates}
                  onChange={(event) => setDeviceForm((current) => ({
                    ...current,
                    devicePolicy: {
                      ...current.devicePolicy,
                      autoLauncherUpdates: event.target.checked,
                    },
                  }))}
                />
                <span>Launcher-Updates automatisch anwenden</span>
              </div>

              <div className="info-strip" style={{ marginTop: 18, marginBottom: 0, flexWrap: 'wrap' }}>
                <span className="badge badge-neutral">
                  Recovery 24h: {deviceScreen.device_health_data?.watchdog?.recoveryActionsLast24h ?? 0}
                </span>
                <span className="badge badge-neutral">
                  Fehlerfolge: {deviceScreen.device_health_data?.watchdog?.consecutivePlayerFailures ?? 0}
                </span>
                <span className="badge badge-neutral">
                  Letzte Aktion: {deviceScreen.device_health_data?.watchdog?.lastRecoveryAction || 'keine'}
                </span>
              </div>
            </div>

            <div className="glass-panel device-screenshot-panel" style={{ marginTop: 18 }}>
              <div className="section-header">
                <div>
                  <h4>Screenshots</h4>
                  <p className="muted-copy">Aktuelle Bildschirmaufnahmen vom Raspberry Pi fuer Diagnose und Support.</p>
                </div>
              </div>

              {deviceScreenshotsLoading ? (
                <div className="empty-state compact">
                  <RefreshCw className="spin" size={24} />
                  <p>Lade Screenshots...</p>
                </div>
              ) : !selectedScreenshot ? (
                <div className="empty-state compact">
                  <Camera size={34} style={{ opacity: 0.2 }} />
                  <p>Noch keine Screenshots vorhanden.</p>
                </div>
              ) : (
                <div className="device-screenshot-layout">
                  <div className="device-screenshot-frame">
                    <img
                      src={toAbsoluteUploadUrl(selectedScreenshot.url)}
                      alt={`Screenshot ${deviceScreen.name}`}
                      className="device-screenshot-image"
                    />
                  </div>
                  <div className="device-screenshot-meta">
                    <div className="entity-cell">
                      <span className="entity-title">Zuletzt erfasst</span>
                      <span className="muted-small">{formatLastContact(selectedScreenshot.created_at)}</span>
                    </div>
                    <div className="entity-cell">
                      <span className="entity-title">Datei</span>
                      <span className="muted-small">
                        {formatBytes(selectedScreenshot.file_size)} | {selectedScreenshot.mime_type || 'unbekannt'}
                      </span>
                    </div>
                    <a
                      className="btn btn-secondary"
                      href={toAbsoluteUploadUrl(selectedScreenshot.url)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Screenshot oeffnen
                    </a>
                    {deviceScreenshots.length > 1 ? (
                      <div className="device-screenshot-strip">
                        {deviceScreenshots.map((screenshot) => (
                          <button
                            key={screenshot.id}
                            className={`device-screenshot-thumb ${selectedScreenshot.id === screenshot.id ? 'active' : ''}`}
                            onClick={() => setSelectedScreenshotId(screenshot.id)}
                            type="button"
                          >
                            <img src={toAbsoluteUploadUrl(screenshot.url)} alt="" />
                            <span>{formatLastContact(screenshot.created_at)}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>

            <div className="glass-panel" style={{ marginTop: 18 }}>
              <div className="section-header">
                <div>
                  <h4>Command History</h4>
                  <p className="muted-copy">Zuletzt ausgefuehrte und wartende Device-Kommandos.</p>
                </div>
              </div>

              {deviceCommandsLoading ? (
                <div className="empty-state compact">
                  <RefreshCw className="spin" size={24} />
                  <p>Lade Device-Kommandos...</p>
                </div>
              ) : deviceCommands.length === 0 ? (
                <div className="empty-state compact">
                  <Cpu size={34} style={{ opacity: 0.2 }} />
                  <p>Noch keine Device-Kommandos vorhanden.</p>
                </div>
              ) : (
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>Zeit</th>
                        <th>Ziel</th>
                        <th>Befehl</th>
                        <th>Status</th>
                        <th>Ergebnis</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deviceCommands.map((command) => (
                        <tr key={command.id}>
                          <td>{formatLastContact(command.created_at)}</td>
                          <td>{command.target}</td>
                          <td>{command.command_type}</td>
                          <td>
                            <span className={`badge ${getCommandStatusBadge(command.status)}`}>{command.status}</span>
                          </td>
                          <td>
                            <div className="entity-cell">
                              <span>{command.result_message || '-'}</span>
                              {command.result_payload?.screenshot?.url ? (
                                <a href={toAbsoluteUploadUrl(command.result_payload.screenshot.url)} target="_blank" rel="noreferrer" className="muted-small">
                                  Screenshot ansehen
                                </a>
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
      )}

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
      {isGroupManagerOpen && (
        <div className="modal-overlay">
          <div className="modal-content modal-wide">
            <div className="modal-header">
              <div>
                <h3>Screen-Gruppen</h3>
                <p className="muted-copy">
                  Gruppen ordnen Screens logisch, liefern Standardzuordnungen und beschleunigen Bulk-Operationen.
                </p>
              </div>
              <button className="btn btn-secondary" onClick={() => setIsGroupManagerOpen(false)}>
                Schliessen
              </button>
            </div>

            <div className="split-panel">
              <div className="glass-panel">
                <h4>{groupForm.id ? 'Gruppe bearbeiten' : 'Neue Gruppe anlegen'}</h4>
                <form onSubmit={saveGroup}>
                  <div className="form-group">
                    <label>Name</label>
                    <input
                      className="form-control"
                      value={groupForm.name}
                      onChange={(event) => setGroupForm((current) => ({ ...current, name: event.target.value }))}
                      placeholder="z.B. Lobby, Empfang, Filiale Nord"
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label>Beschreibung</label>
                    <textarea
                      className="form-control"
                      rows={4}
                      value={groupForm.description}
                      onChange={(event) => setGroupForm((current) => ({ ...current, description: event.target.value }))}
                      placeholder="Optional: Einsatzort, Standort oder Besonderheiten"
                    />
                  </div>

                  <div className="form-grid two-columns">
                    <div className="form-group">
                      <label>Standardmodus</label>
                      <select
                        className="form-control"
                        value={groupForm.defaultMode}
                        onChange={(event) => setGroupForm((current) => ({
                          ...current,
                          defaultMode: event.target.value,
                          targetId: event.target.value === 'none' ? '' : current.targetId,
                        }))}
                      >
                        <option value="none">Kein Gruppen-Fallback</option>
                        <option value="playlist">Playlist</option>
                        <option value="layout">Layout</option>
                      </select>
                    </div>

                    <div className="form-group">
                      <label>Standardziel</label>
                      <select
                        className="form-control"
                        value={groupForm.targetId}
                        onChange={(event) => setGroupForm((current) => ({ ...current, targetId: event.target.value }))}
                        disabled={groupForm.defaultMode === 'none'}
                      >
                        <option value="">
                          {groupForm.defaultMode === 'layout'
                            ? 'Layout waehlen'
                            : groupForm.defaultMode === 'playlist'
                              ? 'Playlist waehlen'
                              : 'Nicht erforderlich'}
                        </option>
                        {(groupForm.defaultMode === 'layout' ? layouts : playlists).map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <p className="muted-small">
                    Ohne Standardzuordnung dient die Gruppe nur fuer Struktur und Bulk-Zuweisungen.
                  </p>

                  <div className="modal-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => setGroupForm(buildGroupForm())}>
                      {groupForm.id ? 'Neue Gruppe' : 'Reset'}
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={groupSaving}>
                      {groupSaving ? 'Speichert...' : groupForm.id ? 'Gruppe aktualisieren' : 'Gruppe speichern'}
                    </button>
                  </div>
                </form>
              </div>

              <div className="glass-panel">
                <h4>Vorhandene Gruppen</h4>
                {screenGroups.length === 0 ? (
                  <div className="empty-state compact">
                    <Users size={34} style={{ opacity: 0.2 }} />
                    <p>Noch keine Gruppen angelegt.</p>
                  </div>
                ) : (
                  <div className="group-list">
                    {screenGroups.map((group) => (
                      <div key={group.id} className={`group-card ${groupForm.id === group.id ? 'active' : ''}`}>
                        <div className="group-card-header">
                          <div className="group-summary">
                            <div className="entity-title-row">
                              <span className="entity-title">{group.name}</span>
                              <span className="badge badge-neutral">{group.screen_count} Screens</span>
                            </div>
                            {group.description ? <div className="muted-small">{group.description}</div> : null}
                            <div className="entity-meta">{describeGroupTarget(group, playlists, layouts)}</div>
                          </div>

                          <div className="row-actions">
                            <button className="btn-icon" type="button" onClick={() => setGroupForm(buildGroupForm(group))}>
                              <PenSquare size={16} />
                            </button>
                            <button className="btn-icon danger" type="button" onClick={() => deleteGroup(group)}>
                              <Trash2 size={16} />
                            </button>
                          </div>
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
                            <button className="btn-icon" type="button" onClick={() => setScheduleForm(buildScheduleForm(schedule))}>
                              <PenSquare size={16} />
                            </button>
                            <button className="btn-icon danger" type="button" onClick={() => deleteSchedule(schedule.id)}>
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

function getDirectAssignmentMode(screen) {
  if (screen.active_layout_id) return 'layout';
  if (screen.active_playlist_id) return 'playlist';
  return 'none';
}

function getTargetName(type, id, playlists, layouts) {
  if (!id) return '';

  const list = type === 'layout' ? layouts : playlists;
  const match = list.find((entry) => entry.id === id);
  return match?.name || 'Ziel fehlt';
}

function describeGroupTarget(groupLike, playlists, layouts) {
  if (groupLike.group_default_layout_id || groupLike.default_layout_id) {
    const layoutId = groupLike.group_default_layout_id || groupLike.default_layout_id;
    return `Fallback Layout: ${getTargetName('layout', layoutId, playlists, layouts)}`;
  }

  if (groupLike.group_default_playlist_id || groupLike.default_playlist_id) {
    const playlistId = groupLike.group_default_playlist_id || groupLike.default_playlist_id;
    return `Fallback Playlist: ${getTargetName('playlist', playlistId, playlists, layouts)}`;
  }

  return 'Ohne Gruppen-Standardzuordnung';
}

function describeScreenRuntime(screen) {
  if (screen.runtime_source === 'schedule') {
    return `Aktiv: ${screen.active_schedule_name || 'Zeitplan'}`;
  }

  if (screen.runtime_source === 'group') {
    return screen.group_name ? `Fallback ueber Gruppe ${screen.group_name}` : 'Fallback ueber Gruppe';
  }

  if (screen.runtime_source === 'screen') {
    return 'Direkte Zuordnung aktiv';
  }

  return 'Noch kein Inhalt zugewiesen';
}

function describeAgentState(screen) {
  if (screen.device_health_status === 'online') return 'Agent online';
  if (screen.device_agent_version) return 'Agent stale';
  return 'Kein Agent';
}

function describeDeviceSummary(screen) {
  const parts = [];

  if (screen.player_version) {
    parts.push(`Player ${screen.player_version}`);
  }

  if (screen.device_agent_version) {
    parts.push(`Agent ${screen.device_agent_version}`);
  }

  if (screen.pending_device_command_count) {
    parts.push(`${screen.pending_device_command_count} offen`);
  }

  return parts.join(' | ') || 'Noch keine Device-Telemetrie';
}

function toAbsoluteUploadUrl(value) {
  return value ? `${window.location.origin}${value}` : '';
}

function formatTemperature(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)} C` : '-';
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${Math.round(value)}%` : '-';
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return '-';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatUsage(metric) {
  if (!metric?.totalBytes) return '-';

  return `${formatBytes(metric.usedBytes)} / ${formatBytes(metric.totalBytes)} (${formatPercent(metric.usedPercent)})`;
}

function formatUptime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '-';

  const totalMinutes = Math.floor(seconds / 60);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatIpAddresses(value) {
  if (!Array.isArray(value) || value.length === 0) return '-';
  return value.join(', ');
}

function getCommandStatusBadge(status) {
  if (status === 'completed') return 'badge-success';
  if (status === 'failed' || status === 'cancelled') return 'badge-danger';
  if (status === 'acknowledged' || status === 'pending') return 'badge-warning';
  return 'badge-neutral';
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
