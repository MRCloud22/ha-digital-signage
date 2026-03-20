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

    runMigration(`CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist_sort ON playlist_items (playlist_id, sort_order)`);
    runMigration(`CREATE INDEX IF NOT EXISTS idx_layout_zones_layout_z ON layout_zones (layout_id, z_index)`);
    runMigration(`CREATE INDEX IF NOT EXISTS idx_screen_schedules_screen_priority ON screen_schedules (screen_id, priority DESC, created_at ASC)`);
    runMigration(`CREATE INDEX IF NOT EXISTS idx_screens_token ON screens (token)`);
});

module.exports = db;
