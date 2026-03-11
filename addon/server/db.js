const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dataDir = process.env.UPLOAD_DIR ? path.dirname(process.env.DB_PATH || '') : path.join(__dirname, 'data');
if (dataDir && !fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.DB_PATH || path.join(dataDir, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

// Initialize database schema
db.serialize(() => {
    db.run(`
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

    db.run(`
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

    // Run schema migrations for existing databases
    db.run(`ALTER TABLE playlists ADD COLUMN rss_ticker_speed INTEGER DEFAULT 60`, () => { });
    db.run(`ALTER TABLE playlists ADD COLUMN rss_ticker_color TEXT DEFAULT '#ffffff'`, () => { });
    db.run(`ALTER TABLE playlists ADD COLUMN rss_ticker_bg_color TEXT DEFAULT '#1a1a2e'`, () => { });
    db.run(`ALTER TABLE playlists ADD COLUMN rss_ticker_bg_opacity INTEGER DEFAULT 90`, () => { });
    db.run(`ALTER TABLE playlists ADD COLUMN rss_ticker_font_size INTEGER DEFAULT 16`, () => { });

    db.run(`
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

    // Migrations for existing playlist_items tables
    db.run(`ALTER TABLE playlist_items ADD COLUMN sub_playlist_id TEXT`, () => { });
    db.run(`ALTER TABLE playlist_items ADD COLUMN duration_override INTEGER`, () => { });

    db.run(`
        CREATE TABLE IF NOT EXISTS screens (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            pairing_code TEXT,
            token TEXT,
            active_playlist_id TEXT,
            last_seen DATETIME,
            FOREIGN KEY (active_playlist_id) REFERENCES playlists(id) ON DELETE SET NULL
        )
    `);
});

module.exports = db;
