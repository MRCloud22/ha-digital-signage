const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const db = require('./db');
const { DEVICE_AGENT_VERSION, buildDeviceAgentScript } = require('./deviceAgentTemplate');
const {
    dbAll,
    dbGet,
    dbRun,
    evaluateScreenRuntime,
    getLayoutWithZones,
    getMostRecentSeenAt,
    getPlaylistPreview,
    getSchedulesForScreen,
    isScheduleActive,
    isScreenOnline,
    safeParseJson,
    sanitizeMedia,
} = require('./runtime');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' },
});

const PORT = 9999;
const PLAYER_VERSION = '2.1.0';
const PLAYER_LAUNCHER_VERSION = '1.2.0';
const DEVICE_REPORT_ONLINE_THRESHOLD_SECONDS = 150;
const ALERT_OFFLINE_WARNING_SECONDS = 3 * 60;
const ALERT_OFFLINE_DANGER_SECONDS = 15 * 60;
const ALERT_AGENT_DANGER_SECONDS = 15 * 60;
const ALERT_COMMAND_STUCK_SECONDS = 10 * 60;
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, 'data/uploads');
const screenshotUploadDir = path.join(uploadDir, 'screenshots');
const frontendPath = path.join(__dirname, '../frontend/dist');

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

if (!fs.existsSync(screenshotUploadDir)) {
    fs.mkdirSync(screenshotUploadDir, { recursive: true });
}

const DEVICE_POLICY_DEFAULTS = Object.freeze({
    watchdogEnabled: true,
    otaChannel: 'stable',
    autoAgentUpdates: false,
    autoLauncherUpdates: false,
    playerRestartGraceSeconds: 45,
    rebootAfterConsecutivePlayerFailures: 3,
    maxCpuTemperatureC: 82,
    maxDiskUsedPercent: 94,
    maxMemoryUsedPercent: 96,
});

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(frontendPath));
app.use('/uploads', express.static(uploadDir));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
    },
});

const upload = multer({ storage });

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalText(value) {
    const trimmed = normalizeText(value);
    return trimmed || null;
}

function normalizeBoolean(value, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;

    const normalized = `${value}`.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function serializeJsonValue(input) {
    if (input === undefined || input === null) return null;
    if (typeof input === 'string') return input;

    try {
        return JSON.stringify(input);
    } catch (error) {
        return null;
    }
}

function serializeDeviceInfo(input) {
    return serializeJsonValue(input);
}

function normalizeDateTime(value) {
    if (!value) return null;
    const normalized = `${value}`.trim();
    if (!normalized) return null;

    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) return null;

    return normalized;
}

function normalizeTimeValue(value) {
    if (!value) return null;
    const normalized = `${value}`.trim();
    return /^\d{2}:\d{2}$/.test(normalized) ? normalized : null;
}

function normalizeWeekdays(days) {
    if (!Array.isArray(days)) return '';

    const uniqueDays = [...new Set(
        days
            .map((value) => Number.parseInt(value, 10))
            .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6)
    )];

    uniqueDays.sort((left, right) => left - right);
    return uniqueDays.join(',');
}

function jsonError(res, status, message) {
    return res.status(status).json({ error: message });
}

async function playlistExists(playlistId) {
    if (!playlistId) return false;
    const row = await dbGet(db, `SELECT id FROM playlists WHERE id = ?`, [playlistId]);
    return !!row;
}

async function layoutExists(layoutId) {
    if (!layoutId) return false;
    const row = await dbGet(db, `SELECT id FROM layouts WHERE id = ?`, [layoutId]);
    return !!row;
}

async function groupExists(groupId) {
    if (!groupId) return false;
    const row = await dbGet(db, `SELECT id FROM screen_groups WHERE id = ?`, [groupId]);
    return !!row;
}

async function mediaExists(mediaId) {
    if (!mediaId) return false;
    const row = await dbGet(db, `SELECT id FROM media WHERE id = ?`, [mediaId]);
    return !!row;
}

async function authenticateScreenApiRequest(req) {
    const token = normalizeText(req.headers['x-screen-token']);
    if (!token) {
        return { error: 'Missing screen token.', status: 401 };
    }

    const screen = await dbGet(
        db,
        `SELECT id, name FROM screens WHERE id = ? AND token = ?`,
        [req.params.id, token]
    );

    if (!screen) {
        return { error: 'Invalid screen token.', status: 403 };
    }

    return { value: screen };
}

function normalizeServerUrl(value) {
    const normalized = normalizeText(value);
    if (!normalized) return null;

    try {
        const parsed = new URL(normalized);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return null;
        }

        parsed.hash = '';
        parsed.search = '';
        const urlText = parsed.toString();
        return urlText.endsWith('/') ? urlText.slice(0, -1) : urlText;
    } catch (error) {
        return null;
    }
}

function toIsoDate(daysFromNow) {
    return new Date(Date.now() + (daysFromNow * 24 * 60 * 60 * 1000)).toISOString();
}

function shellEscape(value) {
    return `'${`${value ?? ''}`.replace(/'/g, `'\\''`)}'`;
}

function buildProvisioningPlayerUrl(serverUrl, secretToken) {
    return `${serverUrl}/#/player?provisioning=${encodeURIComponent(secretToken)}`;
}

function buildProvisioningInstallerUrl(serverUrl, secretToken) {
    return `${serverUrl}/api/provisioning/install/${encodeURIComponent(secretToken)}.sh`;
}

function buildProvisioningFullPageOsUrl(serverUrl, secretToken) {
    return buildProvisioningPlayerUrl(serverUrl, secretToken);
}

function buildProvisionedBootstrapUrl(serverUrl, screenId, screenToken) {
    return `${serverUrl}/#/player?screenId=${encodeURIComponent(screenId)}&screenToken=${encodeURIComponent(screenToken)}`;
}

function getSecondsSinceTimestamp(value, now = new Date()) {
    if (!value) return null;

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;

    return Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / 1000));
}

function isRecentTimestamp(value, thresholdSeconds, now = new Date()) {
    if (!value) return false;

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return false;

    const diffSeconds = Math.floor((now.getTime() - parsed.getTime()) / 1000);
    return diffSeconds >= 0 && diffSeconds <= thresholdSeconds;
}

function normalizeCapabilities(value) {
    const input = Array.isArray(value)
        ? value
        : `${value || ''}`
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean);

    return [...new Set(input)];
}

function serializeCapabilities(value) {
    const capabilities = normalizeCapabilities(value);
    return capabilities.length ? JSON.stringify(capabilities) : null;
}

function normalizeAlertSeverity(value) {
    const normalized = normalizeText(value).toLowerCase();
    return ['danger', 'warning', 'info'].includes(normalized) ? normalized : null;
}

function normalizeScreenshotMimeType(value) {
    const normalized = normalizeText(value).toLowerCase().split(';')[0];
    if (['image/jpeg', 'image/png', 'image/webp'].includes(normalized)) {
        return normalized;
    }

    return 'image/jpeg';
}

function getScreenshotFileExtension(mimeType) {
    if (mimeType === 'image/png') return '.png';
    if (mimeType === 'image/webp') return '.webp';
    return '.jpg';
}

function buildUploadUrl(...parts) {
    const normalizedParts = parts
        .flat()
        .map((part) => `${part || ''}`.replace(/^\/+|\/+$/g, ''))
        .filter(Boolean);

    return `/${normalizedParts.join('/')}`;
}

function getDefaultDevicePolicy() {
    return { ...DEVICE_POLICY_DEFAULTS };
}

function normalizeOtaChannel(value) {
    const normalized = normalizeText(value).toLowerCase();
    return ['stable', 'beta'].includes(normalized) ? normalized : DEVICE_POLICY_DEFAULTS.otaChannel;
}

function normalizeDevicePolicy(input = {}) {
    const safeInput = typeof input === 'object' && input !== null ? input : {};

    return {
        watchdogEnabled: normalizeBoolean(safeInput.watchdogEnabled, DEVICE_POLICY_DEFAULTS.watchdogEnabled),
        otaChannel: normalizeOtaChannel(safeInput.otaChannel),
        autoAgentUpdates: normalizeBoolean(safeInput.autoAgentUpdates, DEVICE_POLICY_DEFAULTS.autoAgentUpdates),
        autoLauncherUpdates: normalizeBoolean(safeInput.autoLauncherUpdates, DEVICE_POLICY_DEFAULTS.autoLauncherUpdates),
        playerRestartGraceSeconds: clampNumber(
            safeInput.playerRestartGraceSeconds,
            15,
            600,
            DEVICE_POLICY_DEFAULTS.playerRestartGraceSeconds
        ),
        rebootAfterConsecutivePlayerFailures: clampNumber(
            safeInput.rebootAfterConsecutivePlayerFailures,
            1,
            10,
            DEVICE_POLICY_DEFAULTS.rebootAfterConsecutivePlayerFailures
        ),
        maxCpuTemperatureC: clampNumber(
            safeInput.maxCpuTemperatureC,
            60,
            100,
            DEVICE_POLICY_DEFAULTS.maxCpuTemperatureC
        ),
        maxDiskUsedPercent: clampNumber(
            safeInput.maxDiskUsedPercent,
            70,
            99,
            DEVICE_POLICY_DEFAULTS.maxDiskUsedPercent
        ),
        maxMemoryUsedPercent: clampNumber(
            safeInput.maxMemoryUsedPercent,
            70,
            99,
            DEVICE_POLICY_DEFAULTS.maxMemoryUsedPercent
        ),
    };
}

function parseDevicePolicy(value) {
    return normalizeDevicePolicy(safeParseJson(value, DEVICE_POLICY_DEFAULTS));
}

function serializeDevicePolicy(value) {
    return JSON.stringify(normalizeDevicePolicy(value));
}

function getScreenCapabilities(screen) {
    return safeParseJson(screen?.device_capabilities, []);
}

function getScreenHealth(screen) {
    return safeParseJson(screen?.device_health, null);
}

function getScreenDevicePolicy(screen) {
    return parseDevicePolicy(screen?.device_policy);
}

async function getScreenDevicePolicyRecord(screenId) {
    return dbGet(
        db,
        `SELECT
            s.id,
            s.name,
            s.device_policy,
            s.provisioning_profile_id,
            p.name AS provisioning_profile_name,
            p.device_policy AS profile_device_policy
         FROM screens s
         LEFT JOIN provisioning_profiles p ON p.id = s.provisioning_profile_id
         WHERE s.id = ?`,
        [screenId]
    );
}

function resolveDevicePolicyRecord(record) {
    const screenPolicy = safeParseJson(record?.device_policy, null);
    if (screenPolicy && typeof screenPolicy === 'object') {
        return normalizeDevicePolicy(screenPolicy);
    }

    const profilePolicy = safeParseJson(record?.profile_device_policy, null);
    if (profilePolicy && typeof profilePolicy === 'object') {
        return normalizeDevicePolicy(profilePolicy);
    }

    return getDefaultDevicePolicy();
}

function parseDeviceScreenshotRow(row) {
    if (!row) return null;

    return {
        ...row,
        url: row.filepath || null,
    };
}

function getDeviceHealthStatus(screen, now = new Date()) {
    return isRecentTimestamp(screen?.last_agent_report, DEVICE_REPORT_ONLINE_THRESHOLD_SECONDS, now) ? 'online' : 'stale';
}

async function getDeviceScreenshotsForScreen(screenId, limit = 10) {
    const rows = await dbAll(
        db,
        `SELECT *
         FROM device_screenshots
         WHERE screen_id = ?
         ORDER BY datetime(created_at) DESC
         LIMIT ?`,
        [screenId, limit]
    );

    return rows.map(parseDeviceScreenshotRow);
}

async function getMonitoringAlerts(filters = {}, now = new Date()) {
    const limit = clampNumber(filters.limit ?? 100, 1, 500, 100);
    const screenId = normalizeOptionalText(filters.screenId);
    const severityFilter = normalizeAlertSeverity(filters.severity);
    const last24Hours = new Date(now.getTime() - (24 * 60 * 60 * 1000)).toISOString();
    const last7Days = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000)).toISOString();
    const staleCommandThreshold = new Date(now.getTime() - (ALERT_COMMAND_STUCK_SECONDS * 1000)).toISOString();

    const screens = await getScreensResponse(now);
    const scopedScreens = screenId ? screens.filter((screen) => screen.id === screenId) : screens;
    const alerts = [];

    scopedScreens.forEach((screen) => {
        const health = screen.device_health_data || {};
        const policy = screen.device_policy_data || getDefaultDevicePolicy();

        if (screen.is_paired && !screen.is_online) {
            const secondsSinceLastContact = getSecondsSinceTimestamp(screen.last_contact_at, now);
            const severity = (secondsSinceLastContact || 0) >= ALERT_OFFLINE_DANGER_SECONDS ? 'danger' : 'warning';

            alerts.push({
                id: `screen-offline:${screen.id}`,
                severity,
                category: 'screen_offline',
                screen_id: screen.id,
                screen_name: screen.name,
                title: 'Screen offline',
                message: screen.last_contact_at
                    ? 'Kein Heartbeat vom Player innerhalb des erwarteten Zeitfensters.'
                    : 'Der Screen wurde gepairt, aber hat noch keinen Heartbeat gemeldet.',
                occurred_at: screen.last_contact_at || screen.last_seen || now.toISOString(),
                meta: {
                    secondsSinceLastContact,
                    pendingDeviceCommands: screen.pending_device_command_count || 0,
                },
            });
        }

        if (screen.device_agent_version && screen.device_health_status !== 'online') {
            const secondsSinceAgentReport = getSecondsSinceTimestamp(screen.last_agent_report, now);
            const severity = (secondsSinceAgentReport || 0) >= ALERT_AGENT_DANGER_SECONDS ? 'danger' : 'warning';

            alerts.push({
                id: `agent-stale:${screen.id}`,
                severity,
                category: 'device_agent_stale',
                screen_id: screen.id,
                screen_name: screen.name,
                title: 'Pi-Agent meldet nicht',
                message: 'Der Raspberry-Pi-Agent liefert keine frischen Device-Health-Daten.',
                occurred_at: screen.last_agent_report || screen.last_device_report || now.toISOString(),
                meta: {
                    secondsSinceAgentReport,
                    agentVersion: screen.device_agent_version,
                },
            });
        }

        if (isRecentTimestamp(screen.last_agent_report, DEVICE_REPORT_ONLINE_THRESHOLD_SECONDS, now)) {
            const cpuTemperature = Number(health.cpuTemperatureC);
            if (Number.isFinite(cpuTemperature) && cpuTemperature >= policy.maxCpuTemperatureC) {
                alerts.push({
                    id: `device-cpu-temp:${screen.id}`,
                    severity: cpuTemperature >= policy.maxCpuTemperatureC + 5 ? 'danger' : 'warning',
                    category: 'device_health_threshold',
                    screen_id: screen.id,
                    screen_name: screen.name,
                    title: 'CPU-Temperatur zu hoch',
                    message: `Die CPU-Temperatur liegt bei ${cpuTemperature.toFixed(1)} C und ueberschreitet die Policy.`,
                    occurred_at: screen.last_agent_report,
                    meta: {
                        metric: 'cpuTemperatureC',
                        currentValue: cpuTemperature,
                        threshold: policy.maxCpuTemperatureC,
                    },
                });
            }

            const diskUsedPercent = Number(health?.disk?.usedPercent);
            if (Number.isFinite(diskUsedPercent) && diskUsedPercent >= policy.maxDiskUsedPercent) {
                alerts.push({
                    id: `device-disk-usage:${screen.id}`,
                    severity: diskUsedPercent >= Math.min(policy.maxDiskUsedPercent + 3, 99) ? 'danger' : 'warning',
                    category: 'device_health_threshold',
                    screen_id: screen.id,
                    screen_name: screen.name,
                    title: 'Speicher fast voll',
                    message: `Der Datentraeger ist mit ${Math.round(diskUsedPercent)}% belegt und verletzt die Device-Policy.`,
                    occurred_at: screen.last_agent_report,
                    meta: {
                        metric: 'diskUsedPercent',
                        currentValue: diskUsedPercent,
                        threshold: policy.maxDiskUsedPercent,
                    },
                });
            }

            const memoryUsedPercent = Number(health?.memory?.usedPercent);
            if (Number.isFinite(memoryUsedPercent) && memoryUsedPercent >= policy.maxMemoryUsedPercent) {
                alerts.push({
                    id: `device-memory-usage:${screen.id}`,
                    severity: memoryUsedPercent >= Math.min(policy.maxMemoryUsedPercent + 3, 99) ? 'danger' : 'warning',
                    category: 'device_health_threshold',
                    screen_id: screen.id,
                    screen_name: screen.name,
                    title: 'RAM-Auslastung zu hoch',
                    message: `Der Pi nutzt ${Math.round(memoryUsedPercent)}% RAM und verletzt die Device-Policy.`,
                    occurred_at: screen.last_agent_report,
                    meta: {
                        metric: 'memoryUsedPercent',
                        currentValue: memoryUsedPercent,
                        threshold: policy.maxMemoryUsedPercent,
                    },
                });
            }

            if (policy.watchdogEnabled && health.playerProcessRunning === false) {
                alerts.push({
                    id: `watchdog-player-missing:${screen.id}`,
                    severity: 'warning',
                    category: 'watchdog_recovery',
                    screen_id: screen.id,
                    screen_name: screen.name,
                    title: 'Player-Prozess fehlt',
                    message: 'Der Pi-Agent sieht keinen laufenden Browser-Prozess. Der Watchdog sollte Recovery ausloesen.',
                    occurred_at: screen.last_agent_report,
                    meta: health.watchdog && typeof health.watchdog === 'object' ? health.watchdog : {},
                });
            }
        }
    });

    const queryFilters = [];
    const queryParams = [];

    if (screenId) {
        queryFilters.push(`dc.screen_id = ?`);
        queryParams.push(screenId);
    }

    const failedCommands = await dbAll(
        db,
        `SELECT
            dc.screen_id,
            s.name AS screen_name,
            COUNT(*) AS failure_count,
            MAX(COALESCE(dc.completed_at, dc.updated_at, dc.created_at)) AS last_failed_at
         FROM device_commands dc
         LEFT JOIN screens s ON s.id = dc.screen_id
         WHERE dc.status = 'failed'
           AND datetime(COALESCE(dc.completed_at, dc.updated_at, dc.created_at)) >= datetime(?)
           ${queryFilters.length ? `AND ${queryFilters.join(' AND ')}` : ''}
         GROUP BY dc.screen_id, s.name`,
        [last7Days, ...queryParams]
    );

    failedCommands.forEach((row) => {
        alerts.push({
            id: `device-command-failed:${row.screen_id}`,
            severity: 'danger',
            category: 'device_command_failed',
            screen_id: row.screen_id,
            screen_name: row.screen_name,
            title: 'Remote-Befehle fehlgeschlagen',
            message: `${row.failure_count} Device-Kommandos sind in den letzten 7 Tagen fehlgeschlagen.`,
            occurred_at: row.last_failed_at,
            meta: {
                failureCount: row.failure_count,
            },
        });
    });

    const stuckCommands = await dbAll(
        db,
        `SELECT
            dc.screen_id,
            s.name AS screen_name,
            COUNT(*) AS pending_count,
            MIN(dc.created_at) AS oldest_created_at
         FROM device_commands dc
         LEFT JOIN screens s ON s.id = dc.screen_id
         WHERE dc.status IN ('pending', 'acknowledged')
           AND datetime(dc.created_at) <= datetime(?)
           ${queryFilters.length ? `AND ${queryFilters.join(' AND ')}` : ''}
         GROUP BY dc.screen_id, s.name`,
        [staleCommandThreshold, ...queryParams]
    );

    stuckCommands.forEach((row) => {
        alerts.push({
            id: `device-command-stuck:${row.screen_id}`,
            severity: 'warning',
            category: 'device_command_stuck',
            screen_id: row.screen_id,
            screen_name: row.screen_name,
            title: 'Remote-Befehle warten zu lange',
            message: `${row.pending_count} Device-Kommandos sind laenger als ${Math.round(ALERT_COMMAND_STUCK_SECONDS / 60)} Minuten offen.`,
            occurred_at: row.oldest_created_at,
            meta: {
                pendingCount: row.pending_count,
            },
        });
    });

    const playbackErrors = await dbAll(
        db,
        `SELECT
            pe.screen_id,
            s.name AS screen_name,
            COUNT(*) AS error_count,
            MAX(COALESCE(pe.ended_at, pe.started_at, pe.created_at)) AS last_error_at
         FROM playback_events pe
         LEFT JOIN screens s ON s.id = pe.screen_id
         WHERE pe.status = 'error'
           AND datetime(COALESCE(pe.ended_at, pe.started_at, pe.created_at)) >= datetime(?)
           ${screenId ? 'AND pe.screen_id = ?' : ''}
         GROUP BY pe.screen_id, s.name`,
        screenId ? [last24Hours, screenId] : [last24Hours]
    );

    playbackErrors.forEach((row) => {
        alerts.push({
            id: `playback-error:${row.screen_id}`,
            severity: 'danger',
            category: 'playback_error',
            screen_id: row.screen_id,
            screen_name: row.screen_name,
            title: 'Playback-Fehler',
            message: `${row.error_count} Ausspielungen endeten in den letzten 24 Stunden mit Fehler.`,
            occurred_at: row.last_error_at,
            meta: {
                errorCount: row.error_count,
            },
        });
    });

    const playerErrors = await dbAll(
        db,
        `SELECT
            pe.screen_id,
            s.name AS screen_name,
            COUNT(*) AS error_count,
            MAX(pe.created_at) AS last_error_at
         FROM player_events pe
         LEFT JOIN screens s ON s.id = pe.screen_id
         WHERE pe.level = 'error'
           AND datetime(pe.created_at) >= datetime(?)
           ${screenId ? 'AND pe.screen_id = ?' : ''}
         GROUP BY pe.screen_id, s.name`,
        screenId ? [last24Hours, screenId] : [last24Hours]
    );

    playerErrors.forEach((row) => {
        alerts.push({
            id: `player-error:${row.screen_id}`,
            severity: 'danger',
            category: 'player_error',
            screen_id: row.screen_id,
            screen_name: row.screen_name,
            title: 'Player-Errors',
            message: `${row.error_count} Client-Fehler wurden in den letzten 24 Stunden gemeldet.`,
            occurred_at: row.last_error_at,
            meta: {
                errorCount: row.error_count,
            },
        });
    });

    const severityOrder = { danger: 0, warning: 1, info: 2 };
    const filtered = severityFilter
        ? alerts.filter((alert) => alert.severity === severityFilter)
        : alerts;

    filtered.sort((left, right) => {
        const severityDiff = (severityOrder[left.severity] ?? 99) - (severityOrder[right.severity] ?? 99);
        if (severityDiff !== 0) return severityDiff;

        const leftTime = left.occurred_at ? new Date(left.occurred_at).getTime() : 0;
        const rightTime = right.occurred_at ? new Date(right.occurred_at).getTime() : 0;
        return rightTime - leftTime;
    });

    return filtered.slice(0, limit);
}

function getProvisioningTokenStatus(tokenRow, now = new Date()) {
    if (tokenRow.claimed_at) return 'claimed';

    const expiresAt = tokenRow.expires_at ? new Date(tokenRow.expires_at) : null;
    if (expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt < now) {
        return 'expired';
    }

    return 'pending';
}

function buildPlayerLauncherScript({ playerUrl, chromiumBinary, useShellVariables = false }) {
    const playerUrlText = useShellVariables ? '"${' + playerUrl + '}"' : shellEscape(playerUrl);
    const chromiumBinaryText = useShellVariables ? '"${' + chromiumBinary + '}"' : shellEscape(chromiumBinary);

    return `#!/usr/bin/env bash
set -euo pipefail
xset s off || true
xset -dpms || true
xset s noblank || true
pkill unclutter >/dev/null 2>&1 || true
unclutter -idle 0.1 -root >/dev/null 2>&1 &
exec ${chromiumBinaryText} --kiosk --noerrdialogs --disable-infobars --check-for-update-interval=31536000 --overscroll-history-navigation=0 ${playerUrlText}
`;
}

function buildDeviceOtaManifest() {
    return {
        playerVersion: PLAYER_VERSION,
        playerLauncherVersion: PLAYER_LAUNCHER_VERSION,
        agentVersion: DEVICE_AGENT_VERSION,
    };
}

function buildProvisioningInstallerScript({ profile, tokenRow }) {
    const deviceAgentScript = buildDeviceAgentScript();
    const defaultScreenName = profile.default_screen_name || '';
    const devicePolicy = serializeJsonValue(normalizeDevicePolicy(profile.device_policy ? safeParseJson(profile.device_policy, {}) : profile.device_policy || {})) || '{}';

    return `#!/usr/bin/env bash
set -euo pipefail

SERVER_URL=${shellEscape(profile.server_url)}
PROVISIONING_TOKEN=${shellEscape(tokenRow.secret_token)}
DEFAULT_SCREEN_NAME=${shellEscape(defaultScreenName)}
PLAYER_VERSION=${shellEscape(PLAYER_VERSION)}
PLAYER_LAUNCHER_VERSION=${shellEscape(PLAYER_LAUNCHER_VERSION)}
AGENT_VERSION=${shellEscape(DEVICE_AGENT_VERSION)}
DEVICE_POLICY_JSON=${shellEscape(devicePolicy)}
RUN_USER="\${SUDO_USER:-$USER}"
if [[ -z "\${RUN_USER}" ]]; then
  RUN_USER="$USER"
fi

RUN_HOME="$(getent passwd "\${RUN_USER}" | cut -d: -f6)"
if [[ -z "\${RUN_HOME}" ]]; then
  echo "Could not determine home directory for user \${RUN_USER}" >&2
  exit 1
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This installer currently supports Debian/Raspberry Pi OS only." >&2
  exit 1
fi

sudo apt-get update
PACKAGES=(python3 unclutter xdotool x11-xserver-utils alsa-utils scrot)
if apt-cache show chromium-browser >/dev/null 2>&1; then
  PACKAGES+=(chromium-browser)
elif apt-cache show chromium >/dev/null 2>&1; then
  PACKAGES+=(chromium)
fi

sudo apt-get install -y --no-install-recommends "\${PACKAGES[@]}"

CHROMIUM_BIN=""
if command -v chromium-browser >/dev/null 2>&1; then
  CHROMIUM_BIN="$(command -v chromium-browser)"
elif command -v chromium >/dev/null 2>&1; then
  CHROMIUM_BIN="$(command -v chromium)"
else
  echo "Chromium could not be found after installation." >&2
  exit 1
fi

install -d -m 755 "\${RUN_HOME}/.config/signage-player"
install -d -m 755 "\${RUN_HOME}/.config/autostart"
install -d -m 755 "\${RUN_HOME}/.config/lxsession/LXDE-pi"

CONFIG_PATH="\${RUN_HOME}/.config/signage-player/config.json"
LAUNCHER_PATH="\${RUN_HOME}/.config/signage-player/launch.sh"

mapfile -t CLAIM_OUTPUT < <(
  SERVER_URL="\${SERVER_URL}" \\
  PROVISIONING_TOKEN="\${PROVISIONING_TOKEN}" \\
  DEFAULT_SCREEN_NAME="\${DEFAULT_SCREEN_NAME}" \\
  HOSTNAME_VALUE="$(hostname)" \\
  CONFIG_PATH="\${CONFIG_PATH}" \\
  LAUNCHER_PATH="\${LAUNCHER_PATH}" \\
  CHROMIUM_BIN="\${CHROMIUM_BIN}" \\
  PLAYER_VERSION="\${PLAYER_VERSION}" \\
  PLAYER_LAUNCHER_VERSION="\${PLAYER_LAUNCHER_VERSION}" \\
  AGENT_VERSION="\${AGENT_VERSION}" \\
  DEVICE_POLICY_JSON="\${DEVICE_POLICY_JSON}" \\
  python3 <<'PY'
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

server_url = os.environ['SERVER_URL'].rstrip('/')
default_name = os.environ.get('DEFAULT_SCREEN_NAME', '').strip()
hostname = os.environ.get('HOSTNAME_VALUE', 'raspberry-pi').strip() or 'raspberry-pi'
screen_name = default_name or hostname

payload = json.dumps({
    'provisioningToken': os.environ['PROVISIONING_TOKEN'],
    'screenName': screen_name,
    'resolution': '1920x1080',
    'deviceInfo': {
        'platform': 'raspberry-pi-os',
        'hostname': hostname,
        'installer': 'provisioning-script',
    },
}).encode('utf-8')

request = urllib.request.Request(
    f"{server_url}/api/provisioning/claim",
    data=payload,
    headers={'Content-Type': 'application/json'},
    method='POST',
)

try:
    with urllib.request.urlopen(request, timeout=20) as response:
        claim = json.loads(response.read().decode('utf-8'))
except urllib.error.HTTPError as error:
    body = error.read().decode('utf-8', 'replace')
    print(body, file=sys.stderr)
    raise

screen_id = claim['screenId']
screen_token = claim['token']
player_url = f"{server_url}/#/player?screenId={urllib.parse.quote(screen_id)}&screenToken={urllib.parse.quote(screen_token)}"
device_policy = claim.get('devicePolicy')
if not isinstance(device_policy, dict):
    device_policy = json.loads(os.environ.get('DEVICE_POLICY_JSON', '{}'))

config = {
    'server_url': server_url,
    'screen_id': screen_id,
    'screen_token': screen_token,
    'player_url': player_url,
    'launcher_path': os.environ['LAUNCHER_PATH'],
    'chromium_bin': os.environ.get('CHROMIUM_BIN'),
    'agent_service_name': 'signage-device-agent.service',
    'device_agent_path': str(pathlib.Path(os.environ['LAUNCHER_PATH']).with_name('device-agent.py')),
    'device_state_path': str(pathlib.Path(os.environ['LAUNCHER_PATH']).with_name('agent-state.json')),
    'player_version': os.environ.get('PLAYER_VERSION'),
    'player_launcher_version': os.environ.get('PLAYER_LAUNCHER_VERSION'),
    'agent_version': os.environ.get('AGENT_VERSION'),
    'device_policy': device_policy,
    'installed_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
}

pathlib.Path(os.environ['CONFIG_PATH']).write_text(json.dumps(config, indent=2), encoding='utf-8')

print(screen_id)
print(screen_token)
print(player_url)
PY
)

SCREEN_ID="\${CLAIM_OUTPUT[0]}"
SCREEN_TOKEN="\${CLAIM_OUTPUT[1]}"
PLAYER_URL="\${CLAIM_OUTPUT[2]}"

cat > "\${RUN_HOME}/.config/signage-player/launch.sh" <<EOF
${buildPlayerLauncherScript({ playerUrl: 'PLAYER_URL', chromiumBinary: 'CHROMIUM_BIN', useShellVariables: true }).trim()}
EOF

chmod +x "\${RUN_HOME}/.config/signage-player/launch.sh"

cat > "\${RUN_HOME}/.config/signage-player/device-agent.py" <<'PYEOF'
${deviceAgentScript}
PYEOF

chmod +x "\${RUN_HOME}/.config/signage-player/device-agent.py"

cat > "\${RUN_HOME}/.config/autostart/signage-player.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Digital Signage Player
Exec=\${RUN_HOME}/.config/signage-player/launch.sh
X-GNOME-Autostart-enabled=true
NoDisplay=false
Terminal=false
EOF

cat > "\${RUN_HOME}/.config/lxsession/LXDE-pi/autostart" <<EOF
@lxpanel --profile LXDE-pi
@pcmanfm --desktop --profile LXDE-pi
@xscreensaver -no-splash
@xset s off
@xset -dpms
@xset s noblank
@\${RUN_HOME}/.config/signage-player/launch.sh
EOF

sudo tee /etc/systemd/system/signage-device-agent.service >/dev/null <<EOF
[Unit]
Description=Digital Signage Device Agent
After=network-online.target graphical.target
Wants=network-online.target

[Service]
Type=simple
User=\${RUN_USER}
WorkingDirectory=\${RUN_HOME}/.config/signage-player
Environment=DISPLAY=:0
Environment=XAUTHORITY=\${RUN_HOME}/.Xauthority
ExecStart=/usr/bin/python3 \${RUN_HOME}/.config/signage-player/device-agent.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/sudoers.d/signage-device-agent >/dev/null <<EOF
\${RUN_USER} ALL=(root) NOPASSWD: /sbin/reboot, /sbin/poweroff, /usr/sbin/reboot, /usr/sbin/poweroff, /usr/bin/systemctl restart signage-device-agent.service
EOF

sudo chmod 440 /etc/sudoers.d/signage-device-agent
chown -R "\${RUN_USER}":"\${RUN_USER}" "\${RUN_HOME}/.config/signage-player" "\${RUN_HOME}/.config/autostart" "\${RUN_HOME}/.config/lxsession"
sudo systemctl daemon-reload
sudo systemctl enable signage-device-agent.service
sudo systemctl restart signage-device-agent.service

echo "Digital Signage provisioning complete."
echo "Screen ID: \${SCREEN_ID}"
echo "Player URL: \${PLAYER_URL}"
echo "Reboot the Raspberry Pi to start the player automatically."
`;
}

async function validateProvisioningProfilePayload(payload) {
    const name = normalizeText(payload?.name);
    const serverUrl = normalizeServerUrl(payload?.server_url);
    const defaultScreenName = normalizeOptionalText(payload?.default_screen_name);
    const description = normalizeOptionalText(payload?.description);
    const notes = normalizeOptionalText(payload?.notes);
    const screenGroupId = normalizeOptionalText(payload?.screen_group_id);
    const devicePolicy = normalizeDevicePolicy(payload?.device_policy);

    if (!name) {
        return { error: 'Profile name is required.' };
    }

    if (!serverUrl) {
        return { error: 'A valid server_url is required.' };
    }

    const assignment = await validateAssignment(
        normalizeOptionalText(payload?.active_playlist_id),
        normalizeOptionalText(payload?.active_layout_id)
    );

    if (assignment.error) {
        return { error: assignment.error };
    }

    if (screenGroupId && !(await groupExists(screenGroupId))) {
        return { error: 'Group does not exist.' };
    }

    return {
        value: {
            name,
            server_url: serverUrl,
            description,
            default_screen_name: defaultScreenName,
            notes,
            screen_group_id: screenGroupId,
            active_playlist_id: assignment.value.active_playlist_id,
            active_layout_id: assignment.value.active_layout_id,
            device_policy: serializeDevicePolicy(devicePolicy),
        },
    };
}

async function getProvisioningProfilesResponse() {
    return dbAll(
        db,
        `SELECT
            p.*,
            g.name AS group_name,
            pl.name AS playlist_name,
            l.name AS layout_name,
            (
                SELECT COUNT(*)
                FROM provisioning_tokens pt
                WHERE pt.profile_id = p.id
            ) AS token_count,
            (
                SELECT COUNT(*)
                FROM provisioning_tokens pt
                WHERE pt.profile_id = p.id
                  AND pt.claimed_at IS NULL
                  AND (pt.expires_at IS NULL OR datetime(pt.expires_at) >= datetime('now'))
            ) AS pending_token_count
         FROM provisioning_profiles p
         LEFT JOIN screen_groups g ON g.id = p.screen_group_id
         LEFT JOIN playlists pl ON pl.id = p.active_playlist_id
         LEFT JOIN layouts l ON l.id = p.active_layout_id
         ORDER BY p.created_at DESC, p.name COLLATE NOCASE ASC`
    );
}

async function getProvisioningTokensResponse(now = new Date()) {
    const rows = await dbAll(
        db,
        `SELECT
            pt.*,
            p.name AS profile_name,
            p.server_url,
            s.name AS claimed_screen_name
         FROM provisioning_tokens pt
         INNER JOIN provisioning_profiles p ON p.id = pt.profile_id
         LEFT JOIN screens s ON s.id = pt.claimed_screen_id
         ORDER BY pt.created_at DESC`
    );

    return rows.map((row) => {
        const status = getProvisioningTokenStatus(row, now);

        return {
            ...row,
            status,
            player_url: buildProvisioningPlayerUrl(row.server_url, row.secret_token),
            installer_url: buildProvisioningInstallerUrl(row.server_url, row.secret_token),
            fullpageos_url: buildProvisioningFullPageOsUrl(row.server_url, row.secret_token),
            install_command: `curl -fsSL ${shellEscape(buildProvisioningInstallerUrl(row.server_url, row.secret_token))} | bash`,
        };
    });
}

async function validateAssignment(activePlaylistId, activeLayoutId) {
    if (activePlaylistId && activeLayoutId) {
        return { error: 'Playlist and layout cannot both be assigned at the same time.' };
    }

    if (activePlaylistId && !(await playlistExists(activePlaylistId))) {
        return { error: 'Playlist does not exist.' };
    }

    if (activeLayoutId && !(await layoutExists(activeLayoutId))) {
        return { error: 'Layout does not exist.' };
    }

    return {
        value: {
            active_playlist_id: activePlaylistId || null,
            active_layout_id: activeLayoutId || null,
        },
    };
}

async function wouldCreateCycle(parentPlaylistId, subPlaylistId) {
    if (parentPlaylistId === subPlaylistId) return true;

    const visited = new Set();

    async function visit(playlistId) {
        if (visited.has(playlistId)) return false;
        visited.add(playlistId);

        const rows = await dbAll(
            db,
            `SELECT sub_playlist_id FROM playlist_items WHERE playlist_id = ? AND sub_playlist_id IS NOT NULL`,
            [playlistId]
        );

        for (const row of rows) {
            if (row.sub_playlist_id === parentPlaylistId) return true;
            if (await visit(row.sub_playlist_id)) return true;
        }

        return false;
    }

    return visit(subPlaylistId);
}

async function normalizePlaylistSortOrder(playlistId) {
    const items = await dbAll(
        db,
        `SELECT id FROM playlist_items WHERE playlist_id = ? ORDER BY sort_order ASC, id ASC`,
        [playlistId]
    );

    for (let index = 0; index < items.length; index += 1) {
        await dbRun(
            db,
            `UPDATE playlist_items SET sort_order = ? WHERE id = ?`,
            [index, items[index].id]
        );
    }
}

async function getScreensResponse(now = new Date()) {
    const screens = await dbAll(
        db,
        `SELECT
            s.id,
            s.name,
            s.pairing_code,
            s.token,
            s.active_playlist_id,
            s.active_layout_id,
            s.last_seen,
            s.last_heartbeat,
            s.notes,
            s.device_info,
            s.resolution,
            s.player_version,
            s.device_agent_version,
            s.last_device_report,
            s.last_player_report,
            s.last_agent_report,
            s.device_health,
            s.device_capabilities,
            s.device_policy,
            s.screen_group_id,
            s.provisioning_profile_id,
            (
                SELECT ds.filepath
                FROM device_screenshots ds
                WHERE ds.screen_id = s.id
                ORDER BY datetime(ds.created_at) DESC
                LIMIT 1
            ) AS latest_screenshot_filepath,
            (
                SELECT ds.created_at
                FROM device_screenshots ds
                WHERE ds.screen_id = s.id
                ORDER BY datetime(ds.created_at) DESC
                LIMIT 1
            ) AS latest_screenshot_created_at,
            g.name as group_name,
            g.description as group_description,
            g.default_playlist_id as group_default_playlist_id,
            g.default_layout_id as group_default_layout_id,
            p.name as provisioning_profile_name,
            (
                SELECT COUNT(*)
                FROM device_commands dc
                WHERE dc.screen_id = s.id
                  AND dc.status IN ('pending', 'acknowledged')
            ) AS pending_device_command_count
         FROM screens s
         LEFT JOIN screen_groups g ON g.id = s.screen_group_id
         LEFT JOIN provisioning_profiles p ON p.id = s.provisioning_profile_id
         ORDER BY COALESCE(s.last_heartbeat, s.last_seen) DESC, s.name COLLATE NOCASE ASC`
    );

    const schedules = await dbAll(
        db,
        `SELECT * FROM screen_schedules ORDER BY priority DESC, created_at ASC`
    );

    const schedulesByScreen = new Map();
    schedules.forEach((schedule) => {
        const current = schedulesByScreen.get(schedule.screen_id) || [];
        current.push(schedule);
        schedulesByScreen.set(schedule.screen_id, current);
    });

    return screens.map((screen) => {
        const screenSchedules = schedulesByScreen.get(screen.id) || [];
        const activeSchedule = screenSchedules.find((schedule) => isScheduleActive(schedule, now)) || null;

        let runtimeMode = 'none';
        let runtimeSource = 'default';

        if (activeSchedule) {
            runtimeMode = activeSchedule.target_type;
            runtimeSource = 'schedule';
        } else if (screen.active_layout_id) {
            runtimeMode = 'layout';
            runtimeSource = 'screen';
        } else if (screen.active_playlist_id) {
            runtimeMode = 'playlist';
            runtimeSource = 'screen';
        } else if (screen.group_default_layout_id) {
            runtimeMode = 'layout';
            runtimeSource = 'group';
        } else if (screen.group_default_playlist_id) {
            runtimeMode = 'playlist';
            runtimeSource = 'group';
        } else {
            runtimeSource = 'none';
        }

        return {
            ...screen,
            is_paired: !!screen.token,
            is_online: isScreenOnline(screen, now),
            last_contact_at: getMostRecentSeenAt(screen),
            device_health_status: getDeviceHealthStatus(screen, now),
            device_health_data: getScreenHealth(screen),
            device_capabilities_data: getScreenCapabilities(screen),
            device_policy_data: getScreenDevicePolicy(screen),
            latest_screenshot_url: screen.latest_screenshot_filepath || null,
            latest_screenshot_created_at: screen.latest_screenshot_created_at || null,
            schedule_count: screenSchedules.length,
            runtime_mode: runtimeMode,
            runtime_source: runtimeSource,
            active_schedule_name: activeSchedule?.name || null,
        };
    });
}

async function validateSchedulePayload(payload) {
    const name = normalizeText(payload.name);
    const targetType = payload.targetType || payload.target_type;
    const targetId = normalizeText(payload.targetId || payload.target_id);
    const priority = clampNumber(payload.priority ?? 0, -100, 100, 0);
    const startsAt = normalizeDateTime(payload.startsAt || payload.starts_at);
    const endsAt = normalizeDateTime(payload.endsAt || payload.ends_at);
    const startTime = normalizeTimeValue(payload.startTime || payload.start_time);
    const endTime = normalizeTimeValue(payload.endTime || payload.end_time);
    const daysOfWeek = normalizeWeekdays(payload.daysOfWeek || payload.days_of_week || []);
    const isEnabled = payload.isEnabled === undefined && payload.is_enabled === undefined
        ? 1
        : (payload.isEnabled ?? payload.is_enabled ? 1 : 0);

    if (!name) {
        return { error: 'Schedule name is required.' };
    }

    if (!['playlist', 'layout'].includes(targetType)) {
        return { error: 'Schedule target_type must be playlist or layout.' };
    }

    if (!targetId) {
        return { error: 'Schedule target_id is required.' };
    }

    if (startsAt && endsAt && new Date(startsAt) > new Date(endsAt)) {
        return { error: 'starts_at must be before ends_at.' };
    }

    const targetIsValid = targetType === 'playlist'
        ? await playlistExists(targetId)
        : await layoutExists(targetId);

    if (!targetIsValid) {
        return { error: `Target ${targetType} does not exist.` };
    }

    return {
        value: {
            name,
            target_type: targetType,
            target_id: targetId,
            priority,
            starts_at: startsAt,
            ends_at: endsAt,
            start_time: startTime,
            end_time: endTime,
            days_of_week: daysOfWeek,
            is_enabled: isEnabled,
        },
    };
}

function normalizePlaybackStatus(value) {
    const normalized = normalizeText(value).toLowerCase();
    return ['started', 'completed', 'error'].includes(normalized) ? normalized : null;
}

function normalizeEventLevel(value) {
    const normalized = normalizeText(value).toLowerCase();
    return ['info', 'warning', 'error'].includes(normalized) ? normalized : 'info';
}

function normalizeEventCategory(value) {
    const normalized = normalizeText(value).toLowerCase();
    return normalized || 'system';
}

const PLAYER_COMMAND_TYPES = ['refresh_runtime', 'reload_player', 'clear_offline_cache', 'restart_pairing', 'set_player_volume'];
const AGENT_COMMAND_TYPES = [
    'restart_player_process',
    'set_system_volume',
    'rotate_display',
    'reboot_device',
    'shutdown_device',
    'capture_screenshot',
    'restart_device_agent',
    'update_device_agent',
    'update_player_launcher',
    'repair_installation',
];

function normalizeCommandTarget(value) {
    const normalized = normalizeText(value).toLowerCase();
    return ['player', 'agent'].includes(normalized) ? normalized : null;
}

function inferCommandTarget(commandType) {
    if (PLAYER_COMMAND_TYPES.includes(commandType)) return 'player';
    if (AGENT_COMMAND_TYPES.includes(commandType)) return 'agent';
    return null;
}

function normalizeDeviceCommandType(value) {
    const normalized = normalizeText(value).toLowerCase();
    return inferCommandTarget(normalized) ? normalized : null;
}

function normalizeCommandStatusUpdate(value) {
    const normalized = normalizeText(value).toLowerCase();
    return ['acknowledged', 'completed', 'failed', 'cancelled'].includes(normalized) ? normalized : null;
}

function sanitizeDeviceCommandPayload(commandType, payload = {}) {
    const safePayload = typeof payload === 'object' && payload !== null ? payload : {};

    if (commandType === 'set_player_volume' || commandType === 'set_system_volume') {
        return {
            level: clampNumber(safePayload.level ?? 100, 0, 100, 100),
        };
    }

    if (commandType === 'rotate_display') {
        const rotation = normalizeText(safePayload.rotation).toLowerCase();
        return {
            rotation: ['normal', 'left', 'right', 'inverted'].includes(rotation) ? rotation : 'normal',
            output: normalizeOptionalText(safePayload.output),
        };
    }

    if (commandType === 'capture_screenshot') {
        return {
            quality: clampNumber(safePayload.quality ?? 65, 20, 100, 65),
            format: normalizeText(safePayload.format).toLowerCase() === 'png' ? 'png' : 'jpeg',
        };
    }

    return {};
}

function parseDeviceCommandRow(row) {
    return {
        ...row,
        payload: safeParseJson(row.payload, {}),
        result_payload: safeParseJson(row.result_payload, null),
    };
}

async function getDeviceCommandsForScreen(screenId, limit = 50) {
    const rows = await dbAll(
        db,
        `SELECT *
         FROM device_commands
         WHERE screen_id = ?
         ORDER BY datetime(created_at) DESC
         LIMIT ?`,
        [screenId, limit]
    );

    return rows.map(parseDeviceCommandRow);
}

app.get('/api/health', async (req, res) => {
    const overview = {
        screens: await dbGet(db, `SELECT COUNT(*) AS count FROM screens`),
        screenGroups: await dbGet(db, `SELECT COUNT(*) AS count FROM screen_groups`),
        provisioningProfiles: await dbGet(db, `SELECT COUNT(*) AS count FROM provisioning_profiles`),
        provisioningTokens: await dbGet(db, `SELECT COUNT(*) AS count FROM provisioning_tokens`),
        playlists: await dbGet(db, `SELECT COUNT(*) AS count FROM playlists`),
        layouts: await dbGet(db, `SELECT COUNT(*) AS count FROM layouts`),
        media: await dbGet(db, `SELECT COUNT(*) AS count FROM media`),
        playbackEvents: await dbGet(db, `SELECT COUNT(*) AS count FROM playback_events`),
        playerEvents: await dbGet(db, `SELECT COUNT(*) AS count FROM player_events`),
        deviceCommands: await dbGet(db, `SELECT COUNT(*) AS count FROM device_commands`),
        deviceScreenshots: await dbGet(db, `SELECT COUNT(*) AS count FROM device_screenshots`),
    };

    res.json({
        ok: true,
        counts: {
            screens: overview.screens?.count || 0,
            screenGroups: overview.screenGroups?.count || 0,
            provisioningProfiles: overview.provisioningProfiles?.count || 0,
            provisioningTokens: overview.provisioningTokens?.count || 0,
            playlists: overview.playlists?.count || 0,
            layouts: overview.layouts?.count || 0,
            media: overview.media?.count || 0,
            playbackEvents: overview.playbackEvents?.count || 0,
            playerEvents: overview.playerEvents?.count || 0,
            deviceCommands: overview.deviceCommands?.count || 0,
            deviceScreenshots: overview.deviceScreenshots?.count || 0,
        },
    });
});

app.get('/api/monitoring/summary', async (req, res) => {
    const now = new Date();
    const last24Hours = new Date(now.getTime() - (24 * 60 * 60 * 1000)).toISOString();
    const screens = await getScreensResponse(now);
    const alerts = await getMonitoringAlerts({ limit: 500 }, now);

    const [
        proofsLast24h,
        playbackErrorsLast24h,
        playerErrorsLast24h,
        screensWithPlaybackLast24h,
        lastProofRow,
    ] = await Promise.all([
        dbGet(
            db,
            `SELECT COUNT(*) AS count
             FROM playback_events
             WHERE status = 'completed'
               AND datetime(COALESCE(ended_at, started_at, created_at)) >= datetime(?)`,
            [last24Hours]
        ),
        dbGet(
            db,
            `SELECT COUNT(*) AS count
             FROM playback_events
             WHERE status = 'error'
               AND datetime(COALESCE(ended_at, started_at, created_at)) >= datetime(?)`,
            [last24Hours]
        ),
        dbGet(
            db,
            `SELECT COUNT(*) AS count
             FROM player_events
             WHERE level = 'error'
               AND datetime(created_at) >= datetime(?)`,
            [last24Hours]
        ),
        dbGet(
            db,
            `SELECT COUNT(DISTINCT screen_id) AS count
             FROM playback_events
             WHERE datetime(COALESCE(ended_at, started_at, created_at)) >= datetime(?)`,
            [last24Hours]
        ),
        dbGet(
            db,
            `SELECT COALESCE(ended_at, started_at, created_at) AS last_proof_at
             FROM playback_events
             WHERE status = 'completed'
             ORDER BY datetime(COALESCE(ended_at, started_at, created_at)) DESC
             LIMIT 1`
        ),
    ]);

    res.json({
        proofsLast24h: proofsLast24h?.count || 0,
        playbackErrorsLast24h: playbackErrorsLast24h?.count || 0,
        playerErrorsLast24h: playerErrorsLast24h?.count || 0,
        screensWithPlaybackLast24h: screensWithPlaybackLast24h?.count || 0,
        onlineScreens: screens.filter((screen) => screen.is_online).length,
        alertsOpen: alerts.length,
        criticalAlerts: alerts.filter((alert) => alert.severity === 'danger').length,
        warningAlerts: alerts.filter((alert) => alert.severity === 'warning').length,
        offlineScreens: alerts.filter((alert) => alert.category === 'screen_offline').length,
        staleAgents: alerts.filter((alert) => alert.category === 'device_agent_stale').length,
        lastAlertAt: alerts[0]?.occurred_at || null,
        lastProofAt: lastProofRow?.last_proof_at || null,
    });
});

app.get('/api/monitoring/alerts', async (req, res) => {
    const alerts = await getMonitoringAlerts({
        limit: req.query.limit,
        screenId: req.query.screenId,
        severity: req.query.severity,
    });

    res.json(alerts);
});

app.get('/api/monitoring/playback-events', async (req, res) => {
    const limit = clampNumber(req.query.limit ?? 100, 1, 500, 100);
    const hours = clampNumber(req.query.hours ?? 168, 1, 24 * 30, 168);
    const status = normalizePlaybackStatus(req.query.status);
    const screenId = normalizeOptionalText(req.query.screenId);
    const since = new Date(Date.now() - (hours * 60 * 60 * 1000)).toISOString();

    const whereClauses = [`datetime(COALESCE(pe.ended_at, pe.started_at, pe.created_at)) >= datetime(?)`];
    const params = [since];

    if (status) {
        whereClauses.push(`pe.status = ?`);
        params.push(status);
    }

    if (screenId) {
        whereClauses.push(`pe.screen_id = ?`);
        params.push(screenId);
    }

    params.push(limit);

    const rows = await dbAll(
        db,
        `SELECT
            pe.*,
            s.name AS screen_name,
            p.name AS root_playlist_name
         FROM playback_events pe
         LEFT JOIN screens s ON s.id = pe.screen_id
         LEFT JOIN playlists p ON p.id = pe.root_playlist_id
         WHERE ${whereClauses.join(' AND ')}
         ORDER BY datetime(COALESCE(pe.ended_at, pe.started_at, pe.created_at)) DESC
         LIMIT ?`,
        params
    );

    res.json(rows);
});

app.get('/api/monitoring/player-events', async (req, res) => {
    const limit = clampNumber(req.query.limit ?? 100, 1, 500, 100);
    const hours = clampNumber(req.query.hours ?? 168, 1, 24 * 30, 168);
    const level = normalizeText(req.query.level).toLowerCase();
    const screenId = normalizeOptionalText(req.query.screenId);
    const since = new Date(Date.now() - (hours * 60 * 60 * 1000)).toISOString();

    const whereClauses = [`datetime(pe.created_at) >= datetime(?)`];
    const params = [since];

    if (['info', 'warning', 'error'].includes(level)) {
        whereClauses.push(`pe.level = ?`);
        params.push(level);
    }

    if (screenId) {
        whereClauses.push(`pe.screen_id = ?`);
        params.push(screenId);
    }

    params.push(limit);

    const rows = await dbAll(
        db,
        `SELECT
            pe.*,
            s.name AS screen_name
         FROM player_events pe
         LEFT JOIN screens s ON s.id = pe.screen_id
         WHERE ${whereClauses.join(' AND ')}
         ORDER BY datetime(pe.created_at) DESC
         LIMIT ?`,
        params
    );

    res.json(rows);
});

app.get('/api/provisioning/profiles', async (req, res) => {
    const profiles = await getProvisioningProfilesResponse();
    res.json(profiles);
});

app.post('/api/provisioning/profiles', async (req, res) => {
    const validation = await validateProvisioningProfilePayload(req.body || {});
    if (validation.error) {
        return jsonError(res, 400, validation.error);
    }

    const profileId = uuidv4();
    const profile = validation.value;

    await dbRun(
        db,
        `INSERT INTO provisioning_profiles (
            id, name, description, server_url, default_screen_name, notes,
            screen_group_id, active_playlist_id, active_layout_id, device_policy
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            profileId,
            profile.name,
            profile.description,
            profile.server_url,
            profile.default_screen_name,
            profile.notes,
            profile.screen_group_id,
            profile.active_playlist_id,
            profile.active_layout_id,
            profile.device_policy,
        ]
    );

    res.json({ success: true, id: profileId });
});

app.put('/api/provisioning/profiles/:id', async (req, res) => {
    const validation = await validateProvisioningProfilePayload(req.body || {});
    if (validation.error) {
        return jsonError(res, 400, validation.error);
    }

    const profile = validation.value;
    const result = await dbRun(
        db,
        `UPDATE provisioning_profiles
         SET
            name = ?,
            description = ?,
            server_url = ?,
            default_screen_name = ?,
            notes = ?,
            screen_group_id = ?,
            active_playlist_id = ?,
            active_layout_id = ?,
            device_policy = ?,
            updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
            profile.name,
            profile.description,
            profile.server_url,
            profile.default_screen_name,
            profile.notes,
            profile.screen_group_id,
            profile.active_playlist_id,
            profile.active_layout_id,
            profile.device_policy,
            req.params.id,
        ]
    );

    if (result.changes === 0) {
        return jsonError(res, 404, 'Provisioning profile not found.');
    }

    res.json({ success: true });
});

app.delete('/api/provisioning/profiles/:id', async (req, res) => {
    const result = await dbRun(db, `DELETE FROM provisioning_profiles WHERE id = ?`, [req.params.id]);
    if (result.changes === 0) {
        return jsonError(res, 404, 'Provisioning profile not found.');
    }

    res.json({ success: true });
});

app.get('/api/provisioning/tokens', async (req, res) => {
    const tokens = await getProvisioningTokensResponse();
    res.json(tokens);
});

app.post('/api/provisioning/profiles/:id/tokens', async (req, res) => {
    const profile = await dbGet(db, `SELECT * FROM provisioning_profiles WHERE id = ?`, [req.params.id]);
    if (!profile) {
        return jsonError(res, 404, 'Provisioning profile not found.');
    }

    const expiresInDays = clampNumber(req.body?.expires_in_days ?? 14, 0, 365, 14);
    const tokenId = uuidv4();
    const secretToken = uuidv4();
    const label = normalizeOptionalText(req.body?.label);
    const expiresAt = expiresInDays > 0 ? toIsoDate(expiresInDays) : null;

    await dbRun(
        db,
        `INSERT INTO provisioning_tokens (id, profile_id, secret_token, label, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
        [tokenId, req.params.id, secretToken, label, expiresAt]
    );

    const tokenRow = {
        id: tokenId,
        profile_id: req.params.id,
        secret_token: secretToken,
        label,
        expires_at: expiresAt,
        claimed_at: null,
        claimed_screen_id: null,
        created_at: new Date().toISOString(),
    };

    res.json({
        success: true,
        id: tokenId,
        profile_id: req.params.id,
        profile_name: profile.name,
        label,
        expires_at: expiresAt,
        status: 'pending',
        secret_token: secretToken,
        player_url: buildProvisioningPlayerUrl(profile.server_url, secretToken),
        installer_url: buildProvisioningInstallerUrl(profile.server_url, secretToken),
        fullpageos_url: buildProvisioningFullPageOsUrl(profile.server_url, secretToken),
        install_command: `curl -fsSL ${shellEscape(buildProvisioningInstallerUrl(profile.server_url, secretToken))} | bash`,
        installer_script: buildProvisioningInstallerScript({ profile, tokenRow }),
    });
});

app.delete('/api/provisioning/tokens/:id', async (req, res) => {
    const result = await dbRun(
        db,
        `DELETE FROM provisioning_tokens WHERE id = ? AND claimed_at IS NULL`,
        [req.params.id]
    );

    if (result.changes === 0) {
        return jsonError(res, 404, 'Pending provisioning token not found.');
    }

    res.json({ success: true });
});

app.get('/api/provisioning/install/:secretToken.sh', async (req, res) => {
    const tokenRow = await dbGet(
        db,
        `SELECT
            pt.*,
            p.name AS profile_name,
            p.description,
            p.server_url,
            p.default_screen_name,
            p.notes,
            p.screen_group_id,
            p.active_playlist_id,
            p.active_layout_id,
            p.device_policy
         FROM provisioning_tokens pt
         INNER JOIN provisioning_profiles p ON p.id = pt.profile_id
         WHERE pt.secret_token = ?`,
        [req.params.secretToken]
    );

    if (!tokenRow) {
        return jsonError(res, 404, 'Provisioning token not found.');
    }

    const status = getProvisioningTokenStatus(tokenRow);
    if (status === 'claimed') {
        return jsonError(res, 410, 'Provisioning token already claimed.');
    }

    if (status === 'expired') {
        return jsonError(res, 410, 'Provisioning token expired.');
    }

    res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="signage-provision-${tokenRow.profile_name || 'raspberry-pi'}.sh"`);
    res.send(buildProvisioningInstallerScript({ profile: tokenRow, tokenRow }));
});

app.post('/api/provisioning/claim', async (req, res) => {
    const secretToken = normalizeText(req.body?.provisioningToken || req.body?.token);
    if (!secretToken) {
        return jsonError(res, 400, 'provisioningToken is required.');
    }

    const tokenRow = await dbGet(
        db,
        `SELECT
            pt.*,
            p.name AS profile_name,
            p.server_url,
            p.default_screen_name,
            p.notes,
            p.screen_group_id,
            p.active_playlist_id,
            p.active_layout_id,
            p.device_policy
         FROM provisioning_tokens pt
         INNER JOIN provisioning_profiles p ON p.id = pt.profile_id
         WHERE pt.secret_token = ?`,
        [secretToken]
    );

    if (!tokenRow) {
        return jsonError(res, 404, 'Provisioning token not found.');
    }

    const status = getProvisioningTokenStatus(tokenRow);
    if (status === 'claimed') {
        return jsonError(res, 410, 'Provisioning token already claimed.');
    }

    if (status === 'expired') {
        return jsonError(res, 410, 'Provisioning token expired.');
    }

    const screenId = uuidv4();
    const screenToken = uuidv4();
    const screenName = normalizeText(req.body?.screenName) || tokenRow.default_screen_name || 'Provisioned Screen';
    const resolution = normalizeOptionalText(req.body?.resolution);
    const deviceInfo = serializeDeviceInfo(req.body?.deviceInfo || req.body?.userAgent);

    await dbRun(
        db,
        `INSERT INTO screens (
            id, name, pairing_code, token, active_playlist_id, active_layout_id,
            last_seen, last_heartbeat, notes, device_info, resolution, screen_group_id,
            provisioning_profile_id, device_policy
         ) VALUES (?, ?, NULL, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?)`,
        [
            screenId,
            screenName,
            screenToken,
            tokenRow.active_playlist_id,
            tokenRow.active_layout_id,
            tokenRow.notes,
            deviceInfo,
            resolution,
            tokenRow.screen_group_id,
            tokenRow.profile_id,
            serializeDevicePolicy(tokenRow.device_policy ? safeParseJson(tokenRow.device_policy, {}) : {}),
        ]
    );

    await dbRun(
        db,
        `UPDATE provisioning_tokens
         SET claimed_at = CURRENT_TIMESTAMP, claimed_screen_id = ?
         WHERE id = ?`,
        [screenId, tokenRow.id]
    );

    io.emit('screen_updated', { screenId });
    io.emit('runtime_changed');

    res.json({
        success: true,
        screenId,
        token: screenToken,
        name: screenName,
        provisioningProfileId: tokenRow.profile_id,
        devicePolicy: normalizeDevicePolicy(tokenRow.device_policy ? safeParseJson(tokenRow.device_policy, {}) : {}),
    });
});

app.post('/api/screens/:id/device-health', async (req, res) => {
    const auth = await authenticateScreenApiRequest(req);
    if (auth.error) {
        return jsonError(res, auth.status, auth.error);
    }

    const currentScreen = await dbGet(
        db,
        `SELECT device_health, device_capabilities FROM screens WHERE id = ?`,
        [req.params.id]
    );
    const reportedAt = normalizeDateTime(req.body?.reportedAt) || new Date().toISOString();
    const playerVersion = normalizeOptionalText(req.body?.playerVersion);
    const agentVersion = normalizeOptionalText(req.body?.agentVersion);
    const mergedCapabilities = [
        ...getScreenCapabilities(currentScreen || {}),
        ...normalizeCapabilities(req.body?.capabilities),
    ];
    const mergedHealth = {
        ...(getScreenHealth(currentScreen || {}) || {}),
        ...(typeof req.body?.health === 'object' && req.body.health !== null ? req.body.health : {}),
    };

    await dbRun(
        db,
        `UPDATE screens
         SET
            last_device_report = ?,
            last_player_report = CASE WHEN ? IS NOT NULL THEN ? ELSE last_player_report END,
            last_agent_report = CASE WHEN ? IS NOT NULL THEN ? ELSE last_agent_report END,
            player_version = COALESCE(?, player_version),
            device_agent_version = COALESCE(?, device_agent_version),
            device_capabilities = ?,
            device_health = ?
         WHERE id = ?`,
        [
            reportedAt,
            playerVersion,
            reportedAt,
            agentVersion,
            reportedAt,
            playerVersion,
            agentVersion,
            serializeCapabilities(mergedCapabilities),
            serializeJsonValue(mergedHealth),
            req.params.id,
        ]
    );

    const devicePolicyRecord = await getScreenDevicePolicyRecord(req.params.id);
    io.emit('screen_updated', { screenId: req.params.id });
    res.json({
        success: true,
        reportedAt,
        policy: resolveDevicePolicyRecord(devicePolicyRecord),
        ota: buildDeviceOtaManifest(),
    });
});

app.get('/api/screens/:id/device-agent-script', async (req, res) => {
    const auth = await authenticateScreenApiRequest(req);
    if (auth.error) {
        return jsonError(res, auth.status, auth.error);
    }

    res.setHeader('Content-Type', 'text/x-python; charset=utf-8');
    res.send(buildDeviceAgentScript());
});

app.get('/api/screens/:id/device-policy', async (req, res) => {
    const record = await getScreenDevicePolicyRecord(req.params.id);
    if (!record) {
        return jsonError(res, 404, 'Screen not found');
    }

    res.json({
        policy: resolveDevicePolicyRecord(record),
        provisioning_profile_id: record.provisioning_profile_id || null,
        provisioning_profile_name: record.provisioning_profile_name || null,
    });
});

app.put('/api/screens/:id/device-policy', async (req, res) => {
    const screen = await dbGet(db, `SELECT id FROM screens WHERE id = ?`, [req.params.id]);
    if (!screen) {
        return jsonError(res, 404, 'Screen not found');
    }

    const policy = normalizeDevicePolicy(req.body?.policy || req.body?.device_policy || req.body || {});

    await dbRun(
        db,
        `UPDATE screens
         SET device_policy = ?
         WHERE id = ?`,
        [serializeDevicePolicy(policy), req.params.id]
    );

    io.emit('screen_updated', { screenId: req.params.id });
    res.json({ success: true, policy });
});

app.post('/api/screens/:id/device-policy/apply-profile', async (req, res) => {
    const record = await getScreenDevicePolicyRecord(req.params.id);
    if (!record) {
        return jsonError(res, 404, 'Screen not found');
    }

    if (!record.provisioning_profile_id) {
        return jsonError(res, 400, 'Screen is not linked to a provisioning profile.');
    }

    const policy = normalizeDevicePolicy(safeParseJson(record.profile_device_policy, {}));
    await dbRun(
        db,
        `UPDATE screens
         SET device_policy = ?
         WHERE id = ?`,
        [serializeDevicePolicy(policy), req.params.id]
    );

    io.emit('screen_updated', { screenId: req.params.id });
    res.json({
        success: true,
        policy,
        provisioning_profile_id: record.provisioning_profile_id,
        provisioning_profile_name: record.provisioning_profile_name || null,
    });
});

app.get('/api/screens/:id/device-screenshots', async (req, res) => {
    const screen = await dbGet(db, `SELECT id FROM screens WHERE id = ?`, [req.params.id]);
    if (!screen) {
        return jsonError(res, 404, 'Screen not found');
    }

    const limit = clampNumber(req.query.limit ?? 8, 1, 50, 8);
    const screenshots = await getDeviceScreenshotsForScreen(req.params.id, limit);
    res.json(screenshots);
});

app.post(
    '/api/screens/:id/device-screenshots',
    express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'], limit: '12mb' }),
    async (req, res) => {
        const auth = await authenticateScreenApiRequest(req);
        if (auth.error) {
            return jsonError(res, auth.status, auth.error);
        }

        const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (body.length === 0) {
            return jsonError(res, 400, 'Screenshot upload body is empty.');
        }

        const commandId = normalizeOptionalText(req.query.commandId);
        if (commandId) {
            const command = await dbGet(
                db,
                `SELECT id FROM device_commands WHERE id = ? AND screen_id = ?`,
                [commandId, req.params.id]
            );

            if (!command) {
                return jsonError(res, 404, 'Referenced device command not found.');
            }
        }

        const mimeType = normalizeScreenshotMimeType(req.headers['content-type']);
        const screenshotId = uuidv4();
        const filename = `${Date.now()}-${screenshotId}${getScreenshotFileExtension(mimeType)}`;
        const absolutePath = path.join(screenshotUploadDir, filename);
        const filepath = buildUploadUrl('uploads', 'screenshots', filename);

        fs.writeFileSync(absolutePath, body);

        await dbRun(
            db,
            `INSERT INTO device_screenshots (id, screen_id, command_id, filepath, mime_type, file_size, source)
             VALUES (?, ?, ?, ?, ?, ?, 'agent')`,
            [screenshotId, req.params.id, commandId, filepath, mimeType, body.length]
        );

        const created = await dbGet(db, `SELECT * FROM device_screenshots WHERE id = ?`, [screenshotId]);
        io.emit('screen_updated', { screenId: req.params.id });
        res.json(parseDeviceScreenshotRow(created));
    }
);

app.get('/api/screens/:id/device-commands', async (req, res) => {
    const screen = await dbGet(db, `SELECT id FROM screens WHERE id = ?`, [req.params.id]);
    if (!screen) {
        return jsonError(res, 404, 'Screen not found');
    }

    const limit = clampNumber(req.query.limit ?? 50, 1, 200, 50);
    const rows = await dbAll(
        db,
        `SELECT *
         FROM device_commands
         WHERE screen_id = ?
         ORDER BY datetime(created_at) DESC
         LIMIT ?`,
        [req.params.id, limit]
    );

    res.json(rows.map(parseDeviceCommandRow));
});

app.post('/api/screens/:id/device-commands', async (req, res) => {
    const screen = await dbGet(db, `SELECT id, name FROM screens WHERE id = ?`, [req.params.id]);
    if (!screen) {
        return jsonError(res, 404, 'Screen not found');
    }

    const commandType = normalizeDeviceCommandType(req.body?.commandType || req.body?.command_type);
    if (!commandType) {
        return jsonError(res, 400, 'Unsupported command type.');
    }

    const expectedTarget = inferCommandTarget(commandType);
    const target = normalizeCommandTarget(req.body?.target) || expectedTarget;
    if (target !== expectedTarget) {
        return jsonError(res, 400, `Command ${commandType} must target ${expectedTarget}.`);
    }

    const payload = sanitizeDeviceCommandPayload(commandType, req.body?.payload || req.body);
    const commandId = uuidv4();
    const requestedBy = normalizeOptionalText(req.body?.requestedBy || req.body?.requested_by) || 'dashboard';

    await dbRun(
        db,
        `INSERT INTO device_commands (id, screen_id, target, command_type, payload, status, requested_by)
         VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
        [commandId, req.params.id, target, commandType, serializeJsonValue(payload), requestedBy]
    );

    const created = await dbGet(db, `SELECT * FROM device_commands WHERE id = ?`, [commandId]);
    io.to(req.params.id).emit('device_command_available', { screenId: req.params.id, commandId, target });
    io.emit('screen_updated', { screenId: req.params.id });

    res.json(parseDeviceCommandRow(created));
});

app.get('/api/screens/:id/device-commands/pending', async (req, res) => {
    const auth = await authenticateScreenApiRequest(req);
    if (auth.error) {
        return jsonError(res, auth.status, auth.error);
    }

    const target = normalizeCommandTarget(req.query.target) || 'player';
    const limit = clampNumber(req.query.limit ?? 10, 1, 50, 10);

    const rows = await dbAll(
        db,
        `SELECT *
         FROM device_commands
         WHERE screen_id = ?
           AND target = ?
           AND status = 'pending'
         ORDER BY datetime(created_at) ASC
         LIMIT ?`,
        [req.params.id, target, limit]
    );

    res.json(rows.map(parseDeviceCommandRow));
});

app.post('/api/screens/:id/device-commands/:commandId/status', async (req, res) => {
    const auth = await authenticateScreenApiRequest(req);
    if (auth.error) {
        return jsonError(res, auth.status, auth.error);
    }

    const status = normalizeCommandStatusUpdate(req.body?.status);
    if (!status) {
        return jsonError(res, 400, 'Unsupported command status.');
    }

    const existing = await dbGet(
        db,
        `SELECT * FROM device_commands WHERE id = ? AND screen_id = ?`,
        [req.params.commandId, req.params.id]
    );
    if (!existing) {
        return jsonError(res, 404, 'Device command not found.');
    }

    const reportedAt = normalizeDateTime(req.body?.reportedAt) || new Date().toISOString();
    const message = normalizeOptionalText(req.body?.message);
    const resultPayload = serializeJsonValue(req.body?.result);

    await dbRun(
        db,
        `UPDATE device_commands
         SET
            status = ?,
            result_message = COALESCE(?, result_message),
            result_payload = COALESCE(?, result_payload),
            started_at = CASE
                WHEN ? = 'acknowledged' AND started_at IS NULL THEN ?
                ELSE started_at
            END,
            completed_at = CASE
                WHEN ? IN ('completed', 'failed', 'cancelled') THEN ?
                ELSE completed_at
            END,
            updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND screen_id = ?`,
        [
            status,
            message,
            resultPayload,
            status,
            reportedAt,
            status,
            reportedAt,
            req.params.commandId,
            req.params.id,
        ]
    );

    const updated = await dbGet(db, `SELECT * FROM device_commands WHERE id = ?`, [req.params.commandId]);
    io.emit('screen_updated', { screenId: req.params.id });
    res.json(parseDeviceCommandRow(updated));
});

app.post('/api/screens/:id/playback-events', async (req, res) => {
    const auth = await authenticateScreenApiRequest(req);
    if (auth.error) {
        return jsonError(res, auth.status, auth.error);
    }

    const playbackId = normalizeText(req.body?.playbackId);
    const action = normalizePlaybackStatus(req.body?.action);
    const mediaName = normalizeText(req.body?.mediaName);

    if (!playbackId) {
        return jsonError(res, 400, 'playbackId is required.');
    }

    if (!action) {
        return jsonError(res, 400, 'action must be started, completed or error.');
    }

    if (action === 'started' && !mediaName) {
        return jsonError(res, 400, 'mediaName is required for started events.');
    }

    const rootPlaylistId = normalizeOptionalText(req.body?.rootPlaylistId);
    const sourcePlaylistId = normalizeOptionalText(req.body?.sourcePlaylistId);
    const mediaId = normalizeOptionalText(req.body?.mediaId);

    const payload = {
        rootPlaylistId: rootPlaylistId && await playlistExists(rootPlaylistId) ? rootPlaylistId : null,
        sourcePlaylistId: sourcePlaylistId && await playlistExists(sourcePlaylistId) ? sourcePlaylistId : null,
        sourcePlaylistName: normalizeOptionalText(req.body?.sourcePlaylistName),
        mediaId: mediaId && await mediaExists(mediaId) ? mediaId : null,
        mediaName: mediaName || 'Unbekanntes Medium',
        mediaType: normalizeOptionalText(req.body?.mediaType),
        runtimeMode: normalizeOptionalText(req.body?.runtimeMode),
        runtimeSource: normalizeOptionalText(req.body?.runtimeSource),
        startedAt: normalizeDateTime(req.body?.startedAt) || new Date().toISOString(),
        endedAt: normalizeDateTime(req.body?.endedAt),
        durationSeconds: req.body?.durationSeconds === undefined
            ? null
            : clampNumber(req.body?.durationSeconds, 0, 86400, 0),
        expectedDurationSeconds: req.body?.expectedDurationSeconds === undefined
            ? null
            : clampNumber(req.body?.expectedDurationSeconds, 0, 86400, 0),
        details: serializeJsonValue(req.body?.details),
    };

    if (action === 'started') {
        await dbRun(
            db,
            `INSERT OR IGNORE INTO playback_events (
                id, screen_id, root_playlist_id, source_playlist_id, source_playlist_name,
                media_id, media_name, media_type, status, proof_source, runtime_mode,
                runtime_source, started_at, ended_at, duration_seconds, expected_duration_seconds, details
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'player', ?, ?, ?, ?, ?, ?, ?)`,
            [
                playbackId,
                req.params.id,
                payload.rootPlaylistId,
                payload.sourcePlaylistId,
                payload.sourcePlaylistName,
                payload.mediaId,
                payload.mediaName,
                payload.mediaType,
                action,
                payload.runtimeMode,
                payload.runtimeSource,
                payload.startedAt,
                payload.endedAt,
                payload.durationSeconds,
                payload.expectedDurationSeconds,
                payload.details,
            ]
        );

        await dbRun(
            db,
            `UPDATE playback_events
             SET
                root_playlist_id = COALESCE(?, root_playlist_id),
                source_playlist_id = COALESCE(?, source_playlist_id),
                source_playlist_name = COALESCE(?, source_playlist_name),
                media_id = COALESCE(?, media_id),
                media_name = ?,
                media_type = COALESCE(?, media_type),
                status = ?,
                runtime_mode = COALESCE(?, runtime_mode),
                runtime_source = COALESCE(?, runtime_source),
                started_at = COALESCE(?, started_at),
                expected_duration_seconds = COALESCE(?, expected_duration_seconds),
                details = COALESCE(?, details),
                updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND screen_id = ?`,
            [
                payload.rootPlaylistId,
                payload.sourcePlaylistId,
                payload.sourcePlaylistName,
                payload.mediaId,
                payload.mediaName,
                payload.mediaType,
                action,
                payload.runtimeMode,
                payload.runtimeSource,
                payload.startedAt,
                payload.expectedDurationSeconds,
                payload.details,
                playbackId,
                req.params.id,
            ]
        );

        return res.json({ success: true });
    }

    const updateResult = await dbRun(
        db,
        `UPDATE playback_events
         SET
            root_playlist_id = COALESCE(?, root_playlist_id),
            source_playlist_id = COALESCE(?, source_playlist_id),
            source_playlist_name = COALESCE(?, source_playlist_name),
            media_id = COALESCE(?, media_id),
            media_name = COALESCE(?, media_name),
            media_type = COALESCE(?, media_type),
            status = ?,
            runtime_mode = COALESCE(?, runtime_mode),
            runtime_source = COALESCE(?, runtime_source),
            started_at = COALESCE(?, started_at),
            ended_at = COALESCE(?, ended_at),
            duration_seconds = COALESCE(?, duration_seconds),
            expected_duration_seconds = COALESCE(?, expected_duration_seconds),
            details = COALESCE(?, details),
            updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND screen_id = ?`,
        [
            payload.rootPlaylistId,
            payload.sourcePlaylistId,
            payload.sourcePlaylistName,
            payload.mediaId,
            mediaName || null,
            payload.mediaType,
            action,
            payload.runtimeMode,
            payload.runtimeSource,
            payload.startedAt,
            payload.endedAt || new Date().toISOString(),
            payload.durationSeconds,
            payload.expectedDurationSeconds,
            payload.details,
            playbackId,
            req.params.id,
        ]
    );

    if (updateResult.changes === 0) {
        await dbRun(
            db,
            `INSERT INTO playback_events (
                id, screen_id, root_playlist_id, source_playlist_id, source_playlist_name,
                media_id, media_name, media_type, status, proof_source, runtime_mode,
                runtime_source, started_at, ended_at, duration_seconds, expected_duration_seconds, details
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'player', ?, ?, ?, ?, ?, ?, ?)`,
            [
                playbackId,
                req.params.id,
                payload.rootPlaylistId,
                payload.sourcePlaylistId,
                payload.sourcePlaylistName,
                payload.mediaId,
                payload.mediaName,
                payload.mediaType,
                action,
                payload.runtimeMode,
                payload.runtimeSource,
                payload.startedAt,
                payload.endedAt || new Date().toISOString(),
                payload.durationSeconds,
                payload.expectedDurationSeconds,
                payload.details,
            ]
        );
    }

    res.json({ success: true });
});

app.post('/api/screens/:id/player-events', async (req, res) => {
    const auth = await authenticateScreenApiRequest(req);
    if (auth.error) {
        return jsonError(res, auth.status, auth.error);
    }

    const message = normalizeText(req.body?.message);
    if (!message) {
        return jsonError(res, 400, 'message is required.');
    }

    const eventId = normalizeText(req.body?.eventId) || uuidv4();

    await dbRun(
        db,
        `INSERT OR REPLACE INTO player_events (id, screen_id, level, category, message, details, created_at)
         VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`,
        [
            eventId,
            req.params.id,
            normalizeEventLevel(req.body?.level),
            normalizeEventCategory(req.body?.category),
            message,
            serializeJsonValue(req.body?.details),
            normalizeDateTime(req.body?.createdAt),
        ]
    );

    res.json({ success: true, id: eventId });
});

app.get('/api/rss-proxy', async (req, res) => {
    const rawUrl = req.query.url;
    const urlText = typeof rawUrl === 'string' ? rawUrl.trim() : '';

    if (!urlText) {
        return jsonError(res, 400, 'Missing url parameter');
    }

    let targetUrl;

    try {
        targetUrl = new URL(urlText);
    } catch (error) {
        return jsonError(res, 400, 'Invalid RSS URL');
    }

    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
        return jsonError(res, 400, 'Only http and https RSS URLs are supported');
    }

    const client = targetUrl.protocol === 'https:' ? https : http;

    client.get(targetUrl, { headers: { 'User-Agent': 'DigitalSignage/2.0' } }, (response) => {
        let data = '';
        response.on('data', (chunk) => {
            data += chunk;
        });
        response.on('end', () => {
            res.setHeader('Content-Type', 'application/xml');
            res.send(data);
        });
    }).on('error', (error) => {
        jsonError(res, 500, `Failed to fetch RSS: ${error.message}`);
    });
});

app.get('/api/screen-groups', async (req, res) => {
    const groups = await dbAll(
        db,
        `SELECT
            g.*,
            COUNT(s.id) as screen_count
         FROM screen_groups g
         LEFT JOIN screens s ON s.screen_group_id = g.id
         GROUP BY g.id
         ORDER BY g.name COLLATE NOCASE ASC`
    );

    res.json(groups);
});

app.post('/api/screen-groups', async (req, res) => {
    const name = normalizeText(req.body?.name);
    if (!name) {
        return jsonError(res, 400, 'Group name is required.');
    }

    const assignment = await validateAssignment(
        normalizeOptionalText(req.body?.default_playlist_id),
        normalizeOptionalText(req.body?.default_layout_id)
    );

    if (assignment.error) {
        return jsonError(res, 400, assignment.error);
    }

    const groupId = uuidv4();

    await dbRun(
        db,
        `INSERT INTO screen_groups (id, name, description, default_playlist_id, default_layout_id)
         VALUES (?, ?, ?, ?, ?)`,
        [
            groupId,
            name,
            normalizeOptionalText(req.body?.description),
            assignment.value.active_playlist_id,
            assignment.value.active_layout_id,
        ]
    );

    io.emit('screen_updated');
    io.emit('runtime_changed');

    res.json({ success: true, id: groupId });
});

app.put('/api/screen-groups/:id', async (req, res) => {
    const name = normalizeText(req.body?.name);
    if (!name) {
        return jsonError(res, 400, 'Group name is required.');
    }

    const assignment = await validateAssignment(
        normalizeOptionalText(req.body?.default_playlist_id),
        normalizeOptionalText(req.body?.default_layout_id)
    );

    if (assignment.error) {
        return jsonError(res, 400, assignment.error);
    }

    const result = await dbRun(
        db,
        `UPDATE screen_groups
         SET
            name = ?,
            description = ?,
            default_playlist_id = ?,
            default_layout_id = ?,
            updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
            name,
            normalizeOptionalText(req.body?.description),
            assignment.value.active_playlist_id,
            assignment.value.active_layout_id,
            req.params.id,
        ]
    );

    if (result.changes === 0) {
        return jsonError(res, 404, 'Group not found');
    }

    io.emit('screen_updated');
    io.emit('runtime_changed');

    res.json({ success: true });
});

app.delete('/api/screen-groups/:id', async (req, res) => {
    const result = await dbRun(db, `DELETE FROM screen_groups WHERE id = ?`, [req.params.id]);
    if (result.changes === 0) {
        return jsonError(res, 404, 'Group not found');
    }

    io.emit('screen_updated');
    io.emit('runtime_changed');

    res.json({ success: true });
});

app.post('/api/screens/bulk-update', async (req, res) => {
    const screenIds = Array.isArray(req.body?.screenIds)
        ? req.body.screenIds.map((value) => `${value}`.trim()).filter(Boolean)
        : [];

    if (screenIds.length === 0) {
        return jsonError(res, 400, 'screenIds is required.');
    }

    const hasPlaylist = Object.prototype.hasOwnProperty.call(req.body || {}, 'active_playlist_id');
    const hasLayout = Object.prototype.hasOwnProperty.call(req.body || {}, 'active_layout_id');
    const hasGroup = Object.prototype.hasOwnProperty.call(req.body || {}, 'screen_group_id');

    if (!hasPlaylist && !hasLayout && !hasGroup) {
        return jsonError(res, 400, 'At least one update field is required.');
    }

    let assignment = null;
    if (hasPlaylist || hasLayout) {
        assignment = await validateAssignment(
            normalizeOptionalText(req.body?.active_playlist_id),
            normalizeOptionalText(req.body?.active_layout_id)
        );

        if (assignment.error) {
            return jsonError(res, 400, assignment.error);
        }
    }

    const groupId = hasGroup ? normalizeOptionalText(req.body?.screen_group_id) : null;
    if (hasGroup && groupId && !(await groupExists(groupId))) {
        return jsonError(res, 400, 'Group does not exist.');
    }

    for (const screenId of screenIds) {
        const current = await dbGet(
            db,
            `SELECT active_playlist_id, active_layout_id, screen_group_id FROM screens WHERE id = ?`,
            [screenId]
        );

        if (!current) {
            continue;
        }

        await dbRun(
            db,
            `UPDATE screens
             SET
                active_playlist_id = ?,
                active_layout_id = ?,
                screen_group_id = ?
             WHERE id = ?`,
            [
                assignment ? assignment.value.active_playlist_id : current.active_playlist_id,
                assignment ? assignment.value.active_layout_id : current.active_layout_id,
                hasGroup ? groupId : current.screen_group_id,
                screenId,
            ]
        );
    }

    screenIds.forEach((screenId) => {
        io.to(screenId).emit('runtime_changed');
    });
    io.emit('screen_updated');
    io.emit('runtime_changed');

    res.json({ success: true, updated: screenIds.length });
});

app.post('/api/screens/pair', async (req, res) => {
    const name = normalizeText(req.body?.name) || 'Unassigned Screen';
    const pairingCode = `${Math.floor(100000 + (Math.random() * 900000))}`;
    const screenId = uuidv4();

    await dbRun(
        db,
        `INSERT INTO screens (id, name, pairing_code, token) VALUES (?, ?, ?, ?)`,
        [screenId, name, pairingCode, null]
    );

    res.json({ id: screenId, pairingCode });
});

app.post('/api/screens/confirm', async (req, res) => {
    const pairingCode = normalizeText(req.body?.pairingCode);
    if (!pairingCode) {
        return jsonError(res, 400, 'Pairing code is required.');
    }

    const screen = await dbGet(
        db,
        `SELECT id FROM screens WHERE pairing_code = ?`,
        [pairingCode]
    );

    if (!screen) {
        return jsonError(res, 404, 'Invalid pairing code');
    }

    const token = uuidv4();

    await dbRun(
        db,
        `UPDATE screens SET pairing_code = NULL, token = ? WHERE id = ?`,
        [token, screen.id]
    );

    io.emit('paired', { screenId: screen.id, token });
    io.emit('screen_updated', { screenId: screen.id });

    res.json({ success: true, token });
});

app.get('/api/screens', async (req, res) => {
    const screens = await getScreensResponse();
    res.json(screens);
});

app.get('/api/screens/:id/runtime', async (req, res) => {
    const runtime = await evaluateScreenRuntime(db, req.params.id);
    if (!runtime) {
        return jsonError(res, 404, 'Screen not found');
    }

    res.json(runtime);
});

app.get('/api/screens/:id/schedules', async (req, res) => {
    const screen = await dbGet(db, `SELECT id FROM screens WHERE id = ?`, [req.params.id]);
    if (!screen) {
        return jsonError(res, 404, 'Screen not found');
    }

    const now = new Date();
    const schedules = await getSchedulesForScreen(db, req.params.id);

    res.json(schedules.map((schedule) => ({
        ...schedule,
        is_active_now: isScheduleActive(schedule, now),
    })));
});

app.post('/api/screens/:id/schedules', async (req, res) => {
    const screen = await dbGet(db, `SELECT id FROM screens WHERE id = ?`, [req.params.id]);
    if (!screen) {
        return jsonError(res, 404, 'Screen not found');
    }

    const validation = await validateSchedulePayload(req.body || {});
    if (validation.error) {
        return jsonError(res, 400, validation.error);
    }

    const scheduleId = uuidv4();
    const schedule = validation.value;

    await dbRun(
        db,
        `INSERT INTO screen_schedules (
            id, screen_id, name, target_type, target_id, priority, starts_at, ends_at,
            days_of_week, start_time, end_time, is_enabled
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            scheduleId,
            req.params.id,
            schedule.name,
            schedule.target_type,
            schedule.target_id,
            schedule.priority,
            schedule.starts_at,
            schedule.ends_at,
            schedule.days_of_week,
            schedule.start_time,
            schedule.end_time,
            schedule.is_enabled,
        ]
    );

    io.to(req.params.id).emit('runtime_changed');
    io.emit('screen_updated', { screenId: req.params.id });

    res.json({ success: true, id: scheduleId });
});

app.put('/api/screens/:id/schedules/:scheduleId', async (req, res) => {
    const validation = await validateSchedulePayload(req.body || {});
    if (validation.error) {
        return jsonError(res, 400, validation.error);
    }

    const schedule = validation.value;
    const result = await dbRun(
        db,
        `UPDATE screen_schedules
         SET
            name = ?,
            target_type = ?,
            target_id = ?,
            priority = ?,
            starts_at = ?,
            ends_at = ?,
            days_of_week = ?,
            start_time = ?,
            end_time = ?,
            is_enabled = ?,
            updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND screen_id = ?`,
        [
            schedule.name,
            schedule.target_type,
            schedule.target_id,
            schedule.priority,
            schedule.starts_at,
            schedule.ends_at,
            schedule.days_of_week,
            schedule.start_time,
            schedule.end_time,
            schedule.is_enabled,
            req.params.scheduleId,
            req.params.id,
        ]
    );

    if (result.changes === 0) {
        return jsonError(res, 404, 'Schedule not found');
    }

    io.to(req.params.id).emit('runtime_changed');
    io.emit('screen_updated', { screenId: req.params.id });

    res.json({ success: true });
});

app.delete('/api/screens/:id/schedules/:scheduleId', async (req, res) => {
    const result = await dbRun(
        db,
        `DELETE FROM screen_schedules WHERE id = ? AND screen_id = ?`,
        [req.params.scheduleId, req.params.id]
    );

    if (result.changes === 0) {
        return jsonError(res, 404, 'Schedule not found');
    }

    io.to(req.params.id).emit('runtime_changed');
    io.emit('screen_updated', { screenId: req.params.id });

    res.json({ success: true });
});

app.put('/api/screens/:id', async (req, res) => {
    const name = normalizeText(req.body?.name);
    if (!name) {
        return jsonError(res, 400, 'Screen name is required.');
    }

    const activePlaylistId = normalizeOptionalText(req.body?.active_playlist_id);
    const activeLayoutId = normalizeOptionalText(req.body?.active_layout_id);
    const notes = normalizeOptionalText(req.body?.notes);
    const screenGroupId = normalizeOptionalText(req.body?.screen_group_id);

    const assignment = await validateAssignment(activePlaylistId, activeLayoutId);
    if (assignment.error) {
        return jsonError(res, 400, assignment.error);
    }

    if (screenGroupId && !(await groupExists(screenGroupId))) {
        return jsonError(res, 400, 'Group does not exist.');
    }

    const result = await dbRun(
        db,
        `UPDATE screens
         SET name = ?, active_playlist_id = ?, active_layout_id = ?, notes = ?, screen_group_id = ?
         WHERE id = ?`,
        [
            name,
            assignment.value.active_playlist_id,
            assignment.value.active_layout_id,
            notes,
            screenGroupId,
            req.params.id,
        ]
    );

    if (result.changes === 0) {
        return jsonError(res, 404, 'Screen not found');
    }

    io.to(req.params.id).emit('playlist_changed');
    io.to(req.params.id).emit('layout_changed');
    io.to(req.params.id).emit('runtime_changed');
    io.emit('screen_updated', { screenId: req.params.id });

    res.json({ success: true });
});

app.delete('/api/screens/:id', async (req, res) => {
    const result = await dbRun(db, `DELETE FROM screens WHERE id = ?`, [req.params.id]);
    if (result.changes === 0) {
        return jsonError(res, 404, 'Screen not found');
    }

    res.json({ success: true });
});

app.get('/api/playlists', async (req, res) => {
    const playlists = await dbAll(
        db,
        `SELECT * FROM playlists ORDER BY created_at DESC, name COLLATE NOCASE ASC`
    );

    res.json(playlists);
});

app.post('/api/playlists', async (req, res) => {
    const name = normalizeText(req.body?.name);
    if (!name) {
        return jsonError(res, 400, 'Playlist name is required.');
    }

    const description = normalizeOptionalText(req.body?.description);
    const id = uuidv4();
    const rssTickerUrl = normalizeOptionalText(req.body?.rssTickerUrl);
    const rssTickerSpeed = clampNumber(req.body?.rssTickerSpeed ?? 60, 10, 500, 60);
    const rssTickerColor = normalizeText(req.body?.rssTickerColor) || '#ffffff';
    const rssTickerBgColor = normalizeText(req.body?.rssTickerBgColor) || '#1a1a2e';
    const rssTickerBgOpacity = clampNumber(req.body?.rssTickerBgOpacity ?? 90, 0, 100, 90);
    const rssTickerFontSize = clampNumber(req.body?.rssTickerFontSize ?? 16, 10, 72, 16);

    await dbRun(
        db,
        `INSERT INTO playlists (
            id, name, description, rss_ticker_url, rss_ticker_speed, rss_ticker_color,
            rss_ticker_bg_color, rss_ticker_bg_opacity, rss_ticker_font_size
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            id,
            name,
            description,
            rssTickerUrl,
            rssTickerSpeed,
            rssTickerColor,
            rssTickerBgColor,
            rssTickerBgOpacity,
            rssTickerFontSize,
        ]
    );

    res.json({ id, name, description });
});

app.put('/api/playlists/:id', async (req, res) => {
    const name = normalizeText(req.body?.name);
    if (!name) {
        return jsonError(res, 400, 'Playlist name is required.');
    }

    const result = await dbRun(
        db,
        `UPDATE playlists
         SET
            name = ?,
            description = ?,
            rss_ticker_url = ?,
            rss_ticker_speed = ?,
            rss_ticker_color = ?,
            rss_ticker_bg_color = ?,
            rss_ticker_bg_opacity = ?,
            rss_ticker_font_size = ?
         WHERE id = ?`,
        [
            name,
            normalizeOptionalText(req.body?.description),
            normalizeOptionalText(req.body?.rssTickerUrl),
            clampNumber(req.body?.rssTickerSpeed ?? 60, 10, 500, 60),
            normalizeText(req.body?.rssTickerColor) || '#ffffff',
            normalizeText(req.body?.rssTickerBgColor) || '#1a1a2e',
            clampNumber(req.body?.rssTickerBgOpacity ?? 90, 0, 100, 90),
            clampNumber(req.body?.rssTickerFontSize ?? 16, 10, 72, 16),
            req.params.id,
        ]
    );

    if (result.changes === 0) {
        return jsonError(res, 404, 'Playlist not found');
    }

    io.emit('playlist_changed');
    io.emit('runtime_changed');

    res.json({ success: true });
});

app.delete('/api/playlists/:id', async (req, res) => {
    await dbRun(
        db,
        `DELETE FROM screen_schedules WHERE target_type = 'playlist' AND target_id = ?`,
        [req.params.id]
    );

    const result = await dbRun(db, `DELETE FROM playlists WHERE id = ?`, [req.params.id]);
    if (result.changes === 0) {
        return jsonError(res, 404, 'Playlist not found');
    }

    io.emit('playlist_changed');
    io.emit('runtime_changed');

    res.json({ success: true });
});

app.get('/api/playlists/:id/items', async (req, res) => {
    const rows = await dbAll(
        db,
        `SELECT
            pi.id,
            pi.sort_order,
            pi.sub_playlist_id,
            pi.duration_override,
            m.id as media_id,
            m.name,
            m.type,
            m.filepath,
            m.url,
            m.duration,
            m.content,
            m.settings,
            p.name as sub_playlist_name
         FROM playlist_items pi
         LEFT JOIN media m ON pi.media_id = m.id
         LEFT JOIN playlists p ON pi.sub_playlist_id = p.id
         WHERE pi.playlist_id = ?
         ORDER BY pi.sort_order ASC, pi.id ASC`,
        [req.params.id]
    );

    res.json(rows.map((row) => ({
        ...row,
        settings: safeParseJson(row.settings, {}),
    })));
});

app.get('/api/playlists/:id/preview', async (req, res) => {
    const preview = await getPlaylistPreview(db, req.params.id);
    if (!preview.playlist) {
        return jsonError(res, 404, 'Playlist not found');
    }

    res.json(preview);
});

app.post('/api/playlists/:id/items', async (req, res) => {
    const playlistId = req.params.id;
    const mediaId = normalizeOptionalText(req.body?.mediaId || req.body?.media_id);
    const subPlaylistId = normalizeOptionalText(req.body?.subPlaylistId || req.body?.sub_playlist_id);
    const requestedSortOrder = req.body?.sortOrder ?? req.body?.sort_order;
    const durationOverride = req.body?.durationOverride ?? req.body?.duration_override;

    if (!mediaId && !subPlaylistId) {
        return jsonError(res, 400, 'Either media_id or sub_playlist_id is required.');
    }

    if (mediaId && !(await mediaExists(mediaId))) {
        return jsonError(res, 400, 'Media does not exist.');
    }

    if (subPlaylistId) {
        if (!(await playlistExists(subPlaylistId))) {
            return jsonError(res, 400, 'Sub-playlist does not exist.');
        }

        if (await wouldCreateCycle(playlistId, subPlaylistId)) {
            return jsonError(res, 400, 'Cannot add playlist because it would create a loop.');
        }
    }

    const existingItems = await dbAll(
        db,
        `SELECT id FROM playlist_items WHERE playlist_id = ? ORDER BY sort_order ASC`,
        [playlistId]
    );

    const sortOrder = clampNumber(
        requestedSortOrder ?? existingItems.length,
        0,
        Math.max(existingItems.length, 0),
        existingItems.length
    );

    await dbRun(
        db,
        `UPDATE playlist_items SET sort_order = sort_order + 1 WHERE playlist_id = ? AND sort_order >= ?`,
        [playlistId, sortOrder]
    );

    const itemId = uuidv4();

    await dbRun(
        db,
        `INSERT INTO playlist_items (
            id, playlist_id, media_id, sub_playlist_id, sort_order, duration_override
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
            itemId,
            playlistId,
            mediaId,
            subPlaylistId,
            sortOrder,
            durationOverride === '' || durationOverride === undefined || durationOverride === null
                ? null
                : clampNumber(durationOverride, 1, 86400, null),
        ]
    );

    await normalizePlaylistSortOrder(playlistId);

    io.emit('playlist_changed');
    io.emit('runtime_changed');

    res.json({ success: true, id: itemId });
});

app.put('/api/playlists/:playlistId/items/:itemId', async (req, res) => {
    const durationOverride = req.body?.durationOverride ?? req.body?.duration_override;
    const sortOrder = clampNumber(req.body?.sortOrder ?? req.body?.sort_order, 0, 9999, 0);

    const result = await dbRun(
        db,
        `UPDATE playlist_items
         SET duration_override = ?, sort_order = ?
         WHERE id = ? AND playlist_id = ?`,
        [
            durationOverride === '' || durationOverride === undefined || durationOverride === null
                ? null
                : clampNumber(durationOverride, 1, 86400, null),
            sortOrder,
            req.params.itemId,
            req.params.playlistId,
        ]
    );

    if (result.changes === 0) {
        return jsonError(res, 404, 'Playlist item not found');
    }

    await normalizePlaylistSortOrder(req.params.playlistId);

    io.emit('playlist_changed');
    io.emit('runtime_changed');

    res.json({ success: true });
});

app.delete('/api/playlists/:playlistId/items/:itemId', async (req, res) => {
    const result = await dbRun(
        db,
        `DELETE FROM playlist_items WHERE id = ? AND playlist_id = ?`,
        [req.params.itemId, req.params.playlistId]
    );

    if (result.changes === 0) {
        return jsonError(res, 404, 'Playlist item not found');
    }

    await normalizePlaylistSortOrder(req.params.playlistId);

    io.emit('playlist_changed');
    io.emit('runtime_changed');

    res.json({ success: true });
});

app.get('/api/layouts', async (req, res) => {
    const layouts = await dbAll(
        db,
        `SELECT * FROM layouts ORDER BY created_at DESC, name COLLATE NOCASE ASC`
    );

    res.json(layouts);
});

app.post('/api/layouts', async (req, res) => {
    const name = normalizeText(req.body?.name);
    if (!name) {
        return jsonError(res, 400, 'Layout name is required.');
    }

    const id = uuidv4();
    const orientation = req.body?.orientation === 'portrait' ? 'portrait' : 'landscape';
    const resolution = normalizeText(req.body?.resolution) || (orientation === 'portrait' ? '1080x1920' : '1920x1080');
    const bgColor = normalizeText(req.body?.bg_color) || '#000000';

    await dbRun(
        db,
        `INSERT INTO layouts (id, name, orientation, resolution, bg_color) VALUES (?, ?, ?, ?, ?)`,
        [id, name, orientation, resolution, bgColor]
    );

    res.json({ id, name, orientation, resolution, bg_color: bgColor });
});

app.get('/api/layouts/:id', async (req, res) => {
    const layout = await getLayoutWithZones(db, req.params.id);
    if (!layout) {
        return jsonError(res, 404, 'Layout not found');
    }

    res.json(layout);
});

app.put('/api/layouts/:id', async (req, res) => {
    const name = normalizeText(req.body?.name);
    if (!name) {
        return jsonError(res, 400, 'Layout name is required.');
    }

    const result = await dbRun(
        db,
        `UPDATE layouts
         SET
            name = ?,
            orientation = ?,
            resolution = ?,
            bg_color = ?,
            updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
            name,
            req.body?.orientation === 'portrait' ? 'portrait' : 'landscape',
            normalizeText(req.body?.resolution) || '1920x1080',
            normalizeText(req.body?.bg_color) || '#000000',
            req.params.id,
        ]
    );

    if (result.changes === 0) {
        return jsonError(res, 404, 'Layout not found');
    }

    io.emit('layout_changed');
    io.emit('runtime_changed');

    res.json({ success: true });
});

app.delete('/api/layouts/:id', async (req, res) => {
    await dbRun(
        db,
        `DELETE FROM screen_schedules WHERE target_type = 'layout' AND target_id = ?`,
        [req.params.id]
    );

    const result = await dbRun(db, `DELETE FROM layouts WHERE id = ?`, [req.params.id]);
    if (result.changes === 0) {
        return jsonError(res, 404, 'Layout not found');
    }

    io.emit('layout_changed');
    io.emit('runtime_changed');

    res.json({ success: true });
});

app.put('/api/layouts/:id/zones', async (req, res) => {
    const zones = Array.isArray(req.body?.zones) ? req.body.zones : [];

    for (const zone of zones) {
        if (zone.playlist_id && !(await playlistExists(zone.playlist_id))) {
            return jsonError(res, 400, `Zone playlist ${zone.playlist_id} does not exist.`);
        }
    }

    await dbRun(db, `DELETE FROM layout_zones WHERE layout_id = ?`, [req.params.id]);

    for (let index = 0; index < zones.length; index += 1) {
        const zone = zones[index];
        await dbRun(
            db,
            `INSERT INTO layout_zones (
                id, layout_id, name, x_percent, y_percent, width_percent, height_percent, playlist_id, z_index
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                zone.id && !`${zone.id}`.startsWith('temp-') ? zone.id : uuidv4(),
                req.params.id,
                normalizeText(zone.name) || `Zone ${index + 1}`,
                clampNumber(zone.x_percent, 0, 100, 0),
                clampNumber(zone.y_percent, 0, 100, 0),
                clampNumber(zone.width_percent, 5, 100, 100),
                clampNumber(zone.height_percent, 5, 100, 100),
                normalizeOptionalText(zone.playlist_id),
                clampNumber(zone.z_index ?? index, 0, 999, index),
            ]
        );
    }

    io.emit('layout_changed');
    io.emit('runtime_changed');

    res.json({ success: true });
});

app.get('/api/media', async (req, res) => {
    const rows = await dbAll(
        db,
        `SELECT * FROM media ORDER BY created_at DESC, name COLLATE NOCASE ASC`
    );

    res.json(rows.map((row) => sanitizeMedia(row)));
});

app.post('/api/media/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return jsonError(res, 400, 'No file uploaded');
    }

    const id = uuidv4();
    const name = normalizeText(req.body?.name) || req.file.originalname;
    const type = normalizeText(req.body?.type) || 'image';
    const duration = clampNumber(req.body?.duration ?? 10, 1, 86400, 10);
    const filepath = `/uploads/${req.file.filename}`;

    await dbRun(
        db,
        `INSERT INTO media (id, name, type, filepath, duration) VALUES (?, ?, ?, ?, ?)`,
        [id, name, type, filepath, duration]
    );

    res.json({ id, name, type, filepath, duration });
});

app.post('/api/media/web', async (req, res) => {
    const name = normalizeText(req.body?.name);
    const url = normalizeText(req.body?.url);

    if (!name || !url) {
        return jsonError(res, 400, 'Name and URL are required.');
    }

    let parsed;
    try {
        parsed = new URL(url);
    } catch (error) {
        return jsonError(res, 400, 'URL is invalid.');
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
        return jsonError(res, 400, 'Only http and https URLs are supported.');
    }

    const id = uuidv4();
    const duration = clampNumber(req.body?.duration ?? 30, 1, 86400, 30);

    await dbRun(
        db,
        `INSERT INTO media (id, name, type, url, duration) VALUES (?, ?, ?, ?, ?)`,
        [id, name, 'webpage', parsed.toString(), duration]
    );

    res.json({ id, name, type: 'webpage', url: parsed.toString(), duration });
});

app.post('/api/media/text', async (req, res) => {
    const name = normalizeText(req.body?.name);
    const content = normalizeText(req.body?.content);

    if (!name || !content) {
        return jsonError(res, 400, 'Name and content are required.');
    }

    const id = uuidv4();
    const duration = clampNumber(req.body?.duration ?? 12, 1, 86400, 12);
    const settings = {
        textColor: normalizeText(req.body?.settings?.textColor) || '#f8fafc',
        backgroundColor: normalizeText(req.body?.settings?.backgroundColor) || '#0f172a',
        accentColor: normalizeText(req.body?.settings?.accentColor) || '#0ea5e9',
        fontSize: clampNumber(req.body?.settings?.fontSize ?? 42, 16, 140, 42),
        align: ['left', 'center', 'right'].includes(req.body?.settings?.align) ? req.body.settings.align : 'center',
    };

    await dbRun(
        db,
        `INSERT INTO media (id, name, type, content, duration, settings) VALUES (?, ?, ?, ?, ?, ?)`,
        [id, name, 'text', content, duration, JSON.stringify(settings)]
    );

    res.json({
        id,
        name,
        type: 'text',
        content,
        duration,
        settings,
    });
});

app.put('/api/media/:id', async (req, res) => {
    const existing = await dbGet(db, `SELECT * FROM media WHERE id = ?`, [req.params.id]);
    if (!existing) {
        return jsonError(res, 404, 'Media not found');
    }

    if (existing.type !== 'webpage') {
        return jsonError(res, 400, 'Only webpage media can currently be edited.');
    }

    const name = normalizeText(req.body?.name);
    const url = normalizeText(req.body?.url);

    if (!name || !url) {
        return jsonError(res, 400, 'Name and URL are required.');
    }

    let parsed;
    try {
        parsed = new URL(url);
    } catch (error) {
        return jsonError(res, 400, 'URL is invalid.');
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
        return jsonError(res, 400, 'Only http and https URLs are supported.');
    }

    const duration = clampNumber(req.body?.duration ?? existing.duration ?? 30, 1, 86400, existing.duration ?? 30);

    await dbRun(
        db,
        `UPDATE media
         SET name = ?, url = ?, duration = ?
         WHERE id = ?`,
        [name, parsed.toString(), duration, req.params.id]
    );

    const updated = await dbGet(db, `SELECT * FROM media WHERE id = ?`, [req.params.id]);

    io.emit('playlist_changed');
    io.emit('runtime_changed');

    res.json(sanitizeMedia(updated));
});

app.delete('/api/media/:id', async (req, res) => {
    const media = await dbGet(db, `SELECT filepath FROM media WHERE id = ?`, [req.params.id]);
    if (!media) {
        return jsonError(res, 404, 'Media not found');
    }

    if (media.filepath) {
        const fullPath = path.join(uploadDir, path.basename(media.filepath));
        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
        }
    }

    await dbRun(db, `DELETE FROM media WHERE id = ?`, [req.params.id]);

    io.emit('playlist_changed');
    io.emit('runtime_changed');

    res.json({ success: true });
});

io.on('connection', (socket) => {
    socket.on('authenticate', async (payload) => {
        try {
            const token = typeof payload === 'string' ? payload : normalizeText(payload?.token);
            if (!token) {
                socket.emit('auth_error', 'Missing token');
                return;
            }

            const screen = await dbGet(db, `SELECT id FROM screens WHERE token = ?`, [token]);
            if (!screen) {
                socket.emit('auth_error', 'Invalid token');
                return;
            }

            socket.data.screenId = screen.id;
            socket.join(screen.id);

            const resolution = normalizeOptionalText(payload?.resolution);
            const deviceInfo = serializeDeviceInfo(payload?.deviceInfo || payload?.userAgent);

            await dbRun(
                db,
                `UPDATE screens
                 SET
                    last_seen = CURRENT_TIMESTAMP,
                    last_heartbeat = CURRENT_TIMESTAMP,
                    resolution = COALESCE(?, resolution),
                    device_info = COALESCE(?, device_info)
                 WHERE id = ?`,
                [resolution, deviceInfo, screen.id]
            );

            socket.emit('auth_success', { screenId: screen.id });
            io.emit('screen_updated', { screenId: screen.id });
        } catch (error) {
            socket.emit('auth_error', error.message);
        }
    });

    socket.on('heartbeat', async (payload = {}) => {
        if (!socket.data.screenId) return;

        const resolution = normalizeOptionalText(payload.resolution);
        const deviceInfo = serializeDeviceInfo(payload.deviceInfo || payload.userAgent);

        await dbRun(
            db,
            `UPDATE screens
             SET
                last_seen = CURRENT_TIMESTAMP,
                last_heartbeat = CURRENT_TIMESTAMP,
                resolution = COALESCE(?, resolution),
                device_info = COALESCE(?, device_info)
             WHERE id = ?`,
            [resolution, deviceInfo, socket.data.screenId]
        );

        io.emit('screen_updated', { screenId: socket.data.screenId });
    });

    socket.on('disconnect', () => {
        if (socket.data.screenId) {
            io.emit('screen_updated', { screenId: socket.data.screenId });
        }
    });
});

app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/') && !req.path.startsWith('/uploads/')) {
        res.sendFile(path.join(frontendPath, 'index.html'));
        return;
    }

    next();
});

server.listen(PORT, () => {
    console.log(`Digital Signage Server running on port ${PORT}`);
});
