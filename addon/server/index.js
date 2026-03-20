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
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, 'data/uploads');
const frontendPath = path.join(__dirname, '../frontend/dist');

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

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

function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function serializeDeviceInfo(input) {
    if (!input) return null;
    if (typeof input === 'string') return input;

    try {
        return JSON.stringify(input);
    } catch (error) {
        return null;
    }
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

async function mediaExists(mediaId) {
    if (!mediaId) return false;
    const row = await dbGet(db, `SELECT id FROM media WHERE id = ?`, [mediaId]);
    return !!row;
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
            id,
            name,
            pairing_code,
            token,
            active_playlist_id,
            active_layout_id,
            last_seen,
            last_heartbeat,
            notes,
            device_info,
            resolution
         FROM screens
         ORDER BY COALESCE(last_heartbeat, last_seen) DESC, name COLLATE NOCASE ASC`
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
        } else if (screen.active_playlist_id) {
            runtimeMode = 'playlist';
        } else {
            runtimeSource = 'none';
        }

        return {
            ...screen,
            is_paired: !!screen.token,
            is_online: isScreenOnline(screen, now),
            last_contact_at: getMostRecentSeenAt(screen),
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

app.get('/api/health', async (req, res) => {
    const overview = {
        screens: await dbGet(db, `SELECT COUNT(*) AS count FROM screens`),
        playlists: await dbGet(db, `SELECT COUNT(*) AS count FROM playlists`),
        layouts: await dbGet(db, `SELECT COUNT(*) AS count FROM layouts`),
        media: await dbGet(db, `SELECT COUNT(*) AS count FROM media`),
    };

    res.json({
        ok: true,
        counts: {
            screens: overview.screens?.count || 0,
            playlists: overview.playlists?.count || 0,
            layouts: overview.layouts?.count || 0,
            media: overview.media?.count || 0,
        },
    });
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

    if (activePlaylistId && !(await playlistExists(activePlaylistId))) {
        return jsonError(res, 400, 'Playlist does not exist.');
    }

    if (activeLayoutId && !(await layoutExists(activeLayoutId))) {
        return jsonError(res, 400, 'Layout does not exist.');
    }

    const result = await dbRun(
        db,
        `UPDATE screens
         SET name = ?, active_playlist_id = ?, active_layout_id = ?, notes = ?
         WHERE id = ?`,
        [name, activePlaylistId, activeLayoutId, notes, req.params.id]
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
