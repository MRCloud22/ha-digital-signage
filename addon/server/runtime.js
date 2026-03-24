const DEFAULT_ITEM_DURATION = 10;
const ONLINE_THRESHOLD_SECONDS = 70;

function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row || null);
        });
    });
}

function dbAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) return reject(err);
            resolve(rows || []);
        });
    });
}

function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(err) {
            if (err) return reject(err);
            resolve({
                lastID: this.lastID,
                changes: this.changes,
            });
        });
    });
}

function safeParseJson(value, fallback = null) {
    if (!value) return fallback;

    try {
        return JSON.parse(value);
    } catch (error) {
        return fallback;
    }
}

function sanitizeMedia(row) {
    if (!row) return null;

    return {
        ...row,
        duration: row.duration ?? DEFAULT_ITEM_DURATION,
        settings: safeParseJson(row.settings, {}),
    };
}

function getMostRecentSeenAt(screen) {
    return screen?.last_heartbeat || screen?.last_seen || null;
}

function isScreenOnline(screen, now = new Date()) {
    const lastSeen = getMostRecentSeenAt(screen);
    if (!lastSeen) return false;

    const diffSeconds = Math.floor((now.getTime() - new Date(lastSeen).getTime()) / 1000);
    return diffSeconds >= 0 && diffSeconds <= ONLINE_THRESHOLD_SECONDS;
}

function normalizeDays(daysOfWeek) {
    if (!daysOfWeek) return [];

    return `${daysOfWeek}`
        .split(',')
        .map((value) => Number.parseInt(value.trim(), 10))
        .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);
}

function toMinutes(timeValue) {
    if (!timeValue || !/^\d{2}:\d{2}$/.test(timeValue)) return null;

    const [hours, minutes] = timeValue.split(':').map((part) => Number.parseInt(part, 10));
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;

    return (hours * 60) + minutes;
}

function isWithinTimeWindow(nowMinutes, startMinutes, endMinutes) {
    if (startMinutes === null && endMinutes === null) return true;
    if (startMinutes !== null && endMinutes !== null) {
        if (startMinutes === endMinutes) return true;
        if (startMinutes < endMinutes) {
            return nowMinutes >= startMinutes && nowMinutes < endMinutes;
        }

        return nowMinutes >= startMinutes || nowMinutes < endMinutes;
    }

    if (startMinutes !== null) return nowMinutes >= startMinutes;
    return nowMinutes < endMinutes;
}

function isScheduleActive(schedule, now = new Date()) {
    if (!schedule || !schedule.is_enabled) return false;

    const startsAt = schedule.starts_at ? new Date(schedule.starts_at) : null;
    const endsAt = schedule.ends_at ? new Date(schedule.ends_at) : null;

    if (startsAt && !Number.isNaN(startsAt.getTime()) && now < startsAt) return false;
    if (endsAt && !Number.isNaN(endsAt.getTime()) && now > endsAt) return false;

    const days = normalizeDays(schedule.days_of_week);
    if (days.length > 0 && !days.includes(now.getDay())) return false;

    const nowMinutes = (now.getHours() * 60) + now.getMinutes();
    const startMinutes = toMinutes(schedule.start_time);
    const endMinutes = toMinutes(schedule.end_time);

    return isWithinTimeWindow(nowMinutes, startMinutes, endMinutes);
}

async function getLayoutWithZones(db, layoutId) {
    if (!layoutId) return null;

    const layout = await dbGet(db, `SELECT * FROM layouts WHERE id = ?`, [layoutId]);
    if (!layout) return null;

    const zones = await dbAll(
        db,
        `SELECT * FROM layout_zones WHERE layout_id = ? ORDER BY z_index ASC`,
        [layoutId]
    );

    return {
        ...layout,
        zones,
    };
}

async function getPlaylistPreview(db, playlistId, visited = new Set()) {
    if (!playlistId) {
        return {
            playlist: null,
            flattenedItems: [],
            totalItems: 0,
            estimatedDurationSeconds: 0,
            hasDynamicDuration: false,
        };
    }

    if (visited.has(playlistId)) {
        return {
            playlist: null,
            flattenedItems: [],
            totalItems: 0,
            estimatedDurationSeconds: 0,
            hasDynamicDuration: false,
            warning: 'cycle_detected',
        };
    }

    const nextVisited = new Set(visited);
    nextVisited.add(playlistId);

    const playlist = await dbGet(db, `SELECT * FROM playlists WHERE id = ?`, [playlistId]);
    if (!playlist) {
        return {
            playlist: null,
            flattenedItems: [],
            totalItems: 0,
            estimatedDurationSeconds: 0,
            hasDynamicDuration: false,
            warning: 'playlist_missing',
        };
    }

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
            p.name as sub_playlist_name,
            p.rss_ticker_url as sub_playlist_rss_ticker_url,
            p.rss_ticker_speed as sub_playlist_rss_ticker_speed,
            p.rss_ticker_color as sub_playlist_rss_ticker_color,
            p.rss_ticker_bg_color as sub_playlist_rss_ticker_bg_color,
            p.rss_ticker_bg_opacity as sub_playlist_rss_ticker_bg_opacity,
            p.rss_ticker_font_size as sub_playlist_rss_ticker_font_size
         FROM playlist_items pi
         LEFT JOIN media m ON pi.media_id = m.id
         LEFT JOIN playlists p ON pi.sub_playlist_id = p.id
         WHERE pi.playlist_id = ?
         ORDER BY pi.sort_order ASC`,
        [playlistId]
    );

    const flattenedItems = [];
    let estimatedDurationSeconds = 0;
    let hasDynamicDuration = false;

    for (const row of rows) {
        if (row.sub_playlist_id) {
            const childPreview = await getPlaylistPreview(db, row.sub_playlist_id, nextVisited);
            childPreview.flattenedItems.forEach((item) => {
                flattenedItems.push({
                    ...item,
                    source_playlist_id: row.sub_playlist_id,
                    source_playlist_name: row.sub_playlist_name,
                    source_playlist_rss_ticker_url: row.sub_playlist_rss_ticker_url,
                    source_playlist_rss_ticker_speed: row.sub_playlist_rss_ticker_speed,
                    source_playlist_rss_ticker_color: row.sub_playlist_rss_ticker_color,
                    source_playlist_rss_ticker_bg_color: row.sub_playlist_rss_ticker_bg_color,
                    source_playlist_rss_ticker_bg_opacity: row.sub_playlist_rss_ticker_bg_opacity,
                    source_playlist_rss_ticker_font_size: row.sub_playlist_rss_ticker_font_size,
                });
            });
            estimatedDurationSeconds += childPreview.estimatedDurationSeconds || 0;
            hasDynamicDuration = hasDynamicDuration || childPreview.hasDynamicDuration;
            continue;
        }

        if (!row.media_id) {
            continue;
        }

        const media = sanitizeMedia(row);
        const effectiveDuration = row.duration_override || media.duration || DEFAULT_ITEM_DURATION;
        const isDynamic = media.type === 'video' && !row.duration_override;

        if (isDynamic) {
            hasDynamicDuration = true;
        } else {
            estimatedDurationSeconds += effectiveDuration;
        }

        flattenedItems.push({
            id: row.id,
            media_id: media.media_id,
            name: media.name,
            type: media.type,
            filepath: media.filepath,
            url: media.url,
            content: media.content,
            settings: media.settings,
            duration: media.duration,
            effective_duration: effectiveDuration,
            source_playlist_id: playlist.id,
            source_playlist_name: playlist.name,
            source_playlist_rss_ticker_url: playlist.rss_ticker_url,
            source_playlist_rss_ticker_speed: playlist.rss_ticker_speed,
            source_playlist_rss_ticker_color: playlist.rss_ticker_color,
            source_playlist_rss_ticker_bg_color: playlist.rss_ticker_bg_color,
            source_playlist_rss_ticker_bg_opacity: playlist.rss_ticker_bg_opacity,
            source_playlist_rss_ticker_font_size: playlist.rss_ticker_font_size,
        });
    }

    return {
        playlist,
        flattenedItems,
        totalItems: flattenedItems.length,
        estimatedDurationSeconds,
        hasDynamicDuration,
    };
}

async function getSchedulesForScreen(db, screenId) {
    return dbAll(
        db,
        `SELECT * FROM screen_schedules WHERE screen_id = ? ORDER BY priority DESC, created_at ASC`,
        [screenId]
    );
}

async function evaluateScreenRuntime(db, screenId, now = new Date()) {
    const screen = await dbGet(
        db,
        `SELECT
            s.*,
            g.name as group_name,
            g.description as group_description,
            g.default_playlist_id as group_default_playlist_id,
            g.default_layout_id as group_default_layout_id
         FROM screens s
         LEFT JOIN screen_groups g ON g.id = s.screen_group_id
         WHERE s.id = ?`,
        [screenId]
    );

    if (!screen) return null;

    const schedules = await getSchedulesForScreen(db, screenId);
    const activeSchedule = schedules.find((schedule) => isScheduleActive(schedule, now)) || null;

    let mode = 'none';
    let playlistId = screen.active_playlist_id || null;
    let layoutId = screen.active_layout_id || null;
    let source = 'screen';

    if (activeSchedule) {
        source = 'schedule';
        if (activeSchedule.target_type === 'layout') {
            layoutId = activeSchedule.target_id;
            playlistId = null;
        } else if (activeSchedule.target_type === 'playlist') {
            playlistId = activeSchedule.target_id;
            layoutId = null;
        }
    } else if (!layoutId && !playlistId) {
        playlistId = screen.group_default_playlist_id || null;
        layoutId = screen.group_default_layout_id || null;
        source = playlistId || layoutId ? 'group' : 'none';
    }

    let layout = null;

    if (layoutId) {
        layout = await getLayoutWithZones(db, layoutId);
        if (layout) {
            mode = 'layout';
        } else {
            layoutId = null;
        }
    }

    if (mode === 'none' && playlistId) {
        mode = 'playlist';
    }

    if (mode === 'none' && !playlistId && !layoutId && !activeSchedule) {
        source = 'none';
    }

    return {
        screen: {
            ...screen,
            is_online: isScreenOnline(screen, now),
            last_contact_at: getMostRecentSeenAt(screen),
        },
        schedules,
        activeSchedule,
        effective: {
            mode,
            source,
            playlist_id: playlistId,
            layout_id: layoutId,
        },
        layout,
    };
}

module.exports = {
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
    normalizeDays,
    safeParseJson,
    sanitizeMedia,
};
