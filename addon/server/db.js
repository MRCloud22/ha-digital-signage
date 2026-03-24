const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dataDir = process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : path.join(__dirname, 'data');

if (dataDir && !fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.DB_PATH || path.join(dataDir, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

function runMigration(sql) {
    db.run(sql, (err) => {
        if (!err) return;

        const ignorePatterns = [
            /duplicate column name/i,
            /already exists/i,
        ];

        if (ignorePatterns.some((pattern) => pattern.test(err.message))) {
            return;
        }

        console.error('Database migration failed:', err.message);
        console.error(sql);
    });
}

db.serialize(() => {
    db.run('PRAGMA foreign_keys = ON');
    db.run('PRAGMA journal_mode = WAL');

    runMigration(`
        CREATE TABLE IF NOT EXISTS media (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            filepath TEXT,
            url TEXT,
            duration INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    runMigration(`ALTER TABLE media ADD COLUMN content TEXT`);
    runMigration(`ALTER TABLE media ADD COLUMN settings TEXT`);

    runMigration(`
        CREATE TABLE IF NOT EXISTS playlists (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            rss_ticker_url TEXT,
            rss_ticker_speed INTEGER DEFAULT 60,
            rss_ticker_color TEXT DEFAULT '#ffffff',
            rss_ticker_bg_color TEXT DEFAULT '#1a1a2e',
            rss_ticker_bg_opacity INTEGER DEFAULT 90,
            rss_ticker_font_size INTEGER DEFAULT 16,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    runMigration(`ALTER TABLE playlists ADD COLUMN description TEXT`);
    runMigration(`ALTER TABLE playlists ADD COLUMN rss_ticker_speed INTEGER DEFAULT 60`);
    runMigration(`ALTER TABLE playlists ADD COLUMN rss_ticker_color TEXT DEFAULT '#ffffff'`);
    runMigration(`ALTER TABLE playlists ADD COLUMN rss_ticker_bg_color TEXT DEFAULT '#1a1a2e'`);
    runMigration(`ALTER TABLE playlists ADD COLUMN rss_ticker_bg_opacity INTEGER DEFAULT 90`);
    runMigration(`ALTER TABLE playlists ADD COLUMN rss_ticker_font_size INTEGER DEFAULT 16`);

    runMigration(`
        CREATE TABLE IF NOT EXISTS playlist_items (
            id TEXT PRIMARY KEY,
            playlist_id TEXT NOT NULL,
            media_id TEXT,
            sub_playlist_id TEXT,
            sort_order INTEGER NOT NULL,
            duration_override INTEGER,
            FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
            FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE,
            FOREIGN KEY (sub_playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
        )
    `);

    runMigration(`ALTER TABLE playlist_items ADD COLUMN sub_playlist_id TEXT`);
    runMigration(`ALTER TABLE playlist_items ADD COLUMN duration_override INTEGER`);

    runMigration(`
        CREATE TABLE IF NOT EXISTS layouts (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            orientation TEXT NOT NULL DEFAULT 'landscape',
            resolution TEXT NOT NULL DEFAULT '1920x1080',
            bg_color TEXT DEFAULT '#000000',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    runMigration(`
        CREATE TABLE IF NOT EXISTS layout_zones (
            id TEXT PRIMARY KEY,
            layout_id TEXT NOT NULL,
            name TEXT DEFAULT 'Zone',
            x_percent REAL NOT NULL DEFAULT 0,
            y_percent REAL NOT NULL DEFAULT 0,
            width_percent REAL NOT NULL DEFAULT 100,
            height_percent REAL NOT NULL DEFAULT 100,
            playlist_id TEXT,
            z_index INTEGER DEFAULT 0,
            FOREIGN KEY (layout_id) REFERENCES layouts(id) ON DELETE CASCADE,
            FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE SET NULL
        )
    `);

    runMigration(`
        CREATE TABLE IF NOT EXISTS screen_groups (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            default_playlist_id TEXT,
            default_layout_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (default_playlist_id) REFERENCES playlists(id) ON DELETE SET NULL,
            FOREIGN KEY (default_layout_id) REFERENCES layouts(id) ON DELETE SET NULL
        )
    `);

    runMigration(`
        CREATE TABLE IF NOT EXISTS screens (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            pairing_code TEXT,
            token TEXT,
            active_playlist_id TEXT,
            active_layout_id TEXT,
            last_seen DATETIME,
            FOREIGN KEY (active_playlist_id) REFERENCES playlists(id) ON DELETE SET NULL,
            FOREIGN KEY (active_layout_id) REFERENCES layouts(id) ON DELETE SET NULL
        )
    `);

    runMigration(`ALTER TABLE screens ADD COLUMN active_layout_id TEXT`);
    runMigration(`ALTER TABLE screens ADD COLUMN notes TEXT`);
    runMigration(`ALTER TABLE screens ADD COLUMN device_info TEXT`);
    runMigration(`ALTER TABLE screens ADD COLUMN resolution TEXT`);
    runMigration(`ALTER TABLE screens ADD COLUMN last_heartbeat DATETIME`);
    runMigration(`ALTER TABLE screens ADD COLUMN screen_group_id TEXT REFERENCES screen_groups(id) ON DELETE SET NULL`);
    runMigration(`ALTER TABLE screens ADD COLUMN player_version TEXT`);
    runMigration(`ALTER TABLE screens ADD COLUMN device_agent_version TEXT`);
    runMigration(`ALTER TABLE screens ADD COLUMN last_device_report DATETIME`);
    runMigration(`ALTER TABLE screens ADD COLUMN last_player_report DATETIME`);
    runMigration(`ALTER TABLE screens ADD COLUMN last_agent_report DATETIME`);
    runMigration(`ALTER TABLE screens ADD COLUMN device_health TEXT`);
    runMigration(`ALTER TABLE screens ADD COLUMN device_capabilities TEXT`);
    runMigration(`ALTER TABLE screens ADD COLUMN provisioning_profile_id TEXT REFERENCES provisioning_profiles(id) ON DELETE SET NULL`);
    runMigration(`ALTER TABLE screens ADD COLUMN device_policy TEXT`);

    runMigration(`
        CREATE TABLE IF NOT EXISTS screen_schedules (
            id TEXT PRIMARY KEY,
            screen_id TEXT NOT NULL,
            name TEXT NOT NULL,
            target_type TEXT NOT NULL,
            target_id TEXT NOT NULL,
            priority INTEGER NOT NULL DEFAULT 0,
            starts_at DATETIME,
            ends_at DATETIME,
            days_of_week TEXT,
            start_time TEXT,
            end_time TEXT,
            is_enabled INTEGER NOT NULL DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (screen_id) REFERENCES screens(id) ON DELETE CASCADE
        )
    `);

    runMigration(`
        CREATE TABLE IF NOT EXISTS playback_events (
            id TEXT PRIMARY KEY,
            screen_id TEXT NOT NULL,
            root_playlist_id TEXT,
            source_playlist_id TEXT,
            source_playlist_name TEXT,
            media_id TEXT,
            media_name TEXT NOT NULL,
            media_type TEXT,
            status TEXT NOT NULL DEFAULT 'started',
            proof_source TEXT NOT NULL DEFAULT 'player',
            runtime_mode TEXT,
            runtime_source TEXT,
            started_at DATETIME,
            ended_at DATETIME,
            duration_seconds REAL,
            expected_duration_seconds REAL,
            details TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (screen_id) REFERENCES screens(id) ON DELETE CASCADE,
            FOREIGN KEY (root_playlist_id) REFERENCES playlists(id) ON DELETE SET NULL,
            FOREIGN KEY (source_playlist_id) REFERENCES playlists(id) ON DELETE SET NULL,
            FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE SET NULL
        )
    `);

    runMigration(`
        CREATE TABLE IF NOT EXISTS player_events (
            id TEXT PRIMARY KEY,
            screen_id TEXT NOT NULL,
            level TEXT NOT NULL DEFAULT 'info',
            category TEXT NOT NULL DEFAULT 'system',
            message TEXT NOT NULL,
            details TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (screen_id) REFERENCES screens(id) ON DELETE CASCADE
        )
    `);

    runMigration(`
        CREATE TABLE IF NOT EXISTS provisioning_profiles (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            server_url TEXT NOT NULL,
            default_screen_name TEXT,
            notes TEXT,
            screen_group_id TEXT,
            active_playlist_id TEXT,
            active_layout_id TEXT,
            device_policy TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (screen_group_id) REFERENCES screen_groups(id) ON DELETE SET NULL,
            FOREIGN KEY (active_playlist_id) REFERENCES playlists(id) ON DELETE SET NULL,
            FOREIGN KEY (active_layout_id) REFERENCES layouts(id) ON DELETE SET NULL
        )
    `);

    runMigration(`
        CREATE TABLE IF NOT EXISTS provisioning_tokens (
            id TEXT PRIMARY KEY,
            profile_id TEXT NOT NULL,
            secret_token TEXT NOT NULL UNIQUE,
            label TEXT,
            expires_at DATETIME,
            claimed_at DATETIME,
            claimed_screen_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (profile_id) REFERENCES provisioning_profiles(id) ON DELETE CASCADE,
            FOREIGN KEY (claimed_screen_id) REFERENCES screens(id) ON DELETE SET NULL
        )
    `);

    runMigration(`
        CREATE TABLE IF NOT EXISTS device_commands (
            id TEXT PRIMARY KEY,
            screen_id TEXT NOT NULL,
            target TEXT NOT NULL DEFAULT 'player',
            command_type TEXT NOT NULL,
            payload TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            requested_by TEXT,
            result_message TEXT,
            result_payload TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            started_at DATETIME,
            completed_at DATETIME,
            FOREIGN KEY (screen_id) REFERENCES screens(id) ON DELETE CASCADE
        )
    `);

    runMigration(`
        CREATE TABLE IF NOT EXISTS device_screenshots (
            id TEXT PRIMARY KEY,
            screen_id TEXT NOT NULL,
            command_id TEXT,
            filepath TEXT NOT NULL,
            mime_type TEXT,
            file_size INTEGER,
            width INTEGER,
            height INTEGER,
            source TEXT NOT NULL DEFAULT 'agent',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (screen_id) REFERENCES screens(id) ON DELETE CASCADE,
            FOREIGN KEY (command_id) REFERENCES device_commands(id) ON DELETE SET NULL
        )
    `);

    runMigration(`CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist_sort ON playlist_items (playlist_id, sort_order)`);
    runMigration(`CREATE INDEX IF NOT EXISTS idx_layout_zones_layout_z ON layout_zones (layout_id, z_index)`);
    runMigration(`CREATE INDEX IF NOT EXISTS idx_screen_schedules_screen_priority ON screen_schedules (screen_id, priority DESC, created_at ASC)`);
    runMigration(`CREATE INDEX IF NOT EXISTS idx_screens_token ON screens (token)`);
    runMigration(`CREATE INDEX IF NOT EXISTS idx_screens_group ON screens (screen_group_id)`);
    runMigration(`CREATE INDEX IF NOT EXISTS idx_screens_provisioning_profile ON screens (provisioning_profile_id)`);
    runMigration(`CREATE INDEX IF NOT EXISTS idx_screens_device_report ON screens (last_device_report DESC)`);
    runMigration(`CREATE INDEX IF NOT EXISTS idx_playback_events_screen_time ON playback_events (screen_id, started_at DESC, created_at DESC)`);
    runMigration(`CREATE INDEX IF NOT EXISTS idx_playback_events_status_time ON playback_events (status, started_at DESC, created_at DESC)`);
    runMigration(`CREATE INDEX IF NOT EXISTS idx_player_events_screen_time ON player_events (screen_id, created_at DESC)`);
    runMigration(`CREATE INDEX IF NOT EXISTS idx_player_events_level_time ON player_events (level, created_at DESC)`);
    runMigration(`CREATE INDEX IF NOT EXISTS idx_provisioning_tokens_profile_time ON provisioning_tokens (profile_id, created_at DESC)`);
    runMigration(`CREATE INDEX IF NOT EXISTS idx_provisioning_tokens_secret ON provisioning_tokens (secret_token)`);
    runMigration(`CREATE INDEX IF NOT EXISTS idx_provisioning_tokens_claimed ON provisioning_tokens (claimed_screen_id, claimed_at DESC)`);
    runMigration(`CREATE INDEX IF NOT EXISTS idx_device_commands_screen_time ON device_commands (screen_id, created_at DESC)`);
    runMigration(`CREATE INDEX IF NOT EXISTS idx_device_commands_status_target ON device_commands (status, target, created_at DESC)`);
    runMigration(`CREATE INDEX IF NOT EXISTS idx_device_screenshots_screen_time ON device_screenshots (screen_id, created_at DESC)`);
    runMigration(`CREATE INDEX IF NOT EXISTS idx_device_screenshots_command ON device_screenshots (command_id, created_at DESC)`);
});

module.exports = db;
