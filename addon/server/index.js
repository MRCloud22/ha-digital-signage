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

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

const PORT = 9999;

// Middleware
app.use(cors());
app.use(express.json());

const frontendPath = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendPath));

// Configure Multer for file uploads
const uploadDir = path.join(__dirname, 'data/uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => { cb(null, uploadDir); },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Serve uploaded files statically
app.use('/uploads', express.static(uploadDir));

// --- HELPER: Circular reference check for playlist nesting ---
// Returns true if adding subPlaylistId into parentPlaylistId would create a cycle
function wouldCreateCycle(parentPlaylistId, subPlaylistId, callback) {
    if (parentPlaylistId === subPlaylistId) return callback(true);

    // Get all sub-playlists of subPlaylistId (recursively)
    function getSubIds(playlistId, visited, done) {
        if (visited.has(playlistId)) return done(visited);
        visited.add(playlistId);
        db.all(
            `SELECT sub_playlist_id FROM playlist_items WHERE playlist_id = ? AND sub_playlist_id IS NOT NULL`,
            [playlistId],
            (err, rows) => {
                if (err || !rows.length) return done(visited);
                let pending = rows.length;
                rows.forEach(row => {
                    getSubIds(row.sub_playlist_id, visited, (v) => {
                        if (--pending === 0) done(v);
                    });
                });
            }
        );
    }

    getSubIds(subPlaylistId, new Set(), (descendants) => {
        callback(descendants.has(parentPlaylistId));
    });
}

// --- RSS PROXY ENDPOINT ---
// Fetches an RSS feed server-side (avoids browser CORS issues)
app.get('/api/rss-proxy', (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'Missing url parameter' });

    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, { headers: { 'User-Agent': 'DigitalSignage/1.0' } }, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
            res.setHeader('Content-Type', 'application/xml');
            res.send(data);
        });
    }).on('error', (err) => {
        res.status(500).json({ error: 'Failed to fetch RSS: ' + err.message });
    });
});

// --- API ENDPOINTS ---

// 1. Screens
app.post('/api/screens/pair', (req, res) => {
    const { name } = req.body;
    const pairingCode = Math.floor(100000 + Math.random() * 900000).toString();
    const screenId = uuidv4();
    db.run(
        `INSERT INTO screens (id, name, pairing_code, token) VALUES (?, ?, ?, ?)`,
        [screenId, name, pairingCode, null],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: screenId, pairingCode });
        }
    );
});

app.post('/api/screens/confirm', (req, res) => {
    const { pairingCode } = req.body;
    const token = uuidv4();
    db.run(
        `UPDATE screens SET pairing_code = NULL, token = ? WHERE pairing_code = ?`,
        [token, pairingCode],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: "Invalid pairing code" });
            db.get(`SELECT id FROM screens WHERE token = ?`, [token], (err, row) => {
                if (row) io.emit('paired', { screenId: row.id, token: token });
            });
            res.json({ success: true, token });
        }
    );
});

app.get('/api/screens', (req, res) => {
    db.all(`SELECT id, name, active_playlist_id, last_seen, (token IS NOT NULL) as is_paired FROM screens`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.put('/api/screens/:id', (req, res) => {
    const { name, active_playlist_id } = req.body;
    db.run(
        `UPDATE screens SET name = ?, active_playlist_id = ? WHERE id = ?`,
        [name, active_playlist_id, req.params.id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            io.to(req.params.id).emit('playlist_changed');
            res.json({ success: true });
        }
    );
});

// 2. Playlists
app.get('/api/playlists', (req, res) => {
    db.all(`SELECT * FROM playlists`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/playlists', (req, res) => {
    const { name, rssTickerUrl, rssTickerSpeed, rssTickerColor, rssTickerBgColor, rssTickerFontSize } = req.body;
    const id = uuidv4();
    db.run(
        `INSERT INTO playlists (id, name, rss_ticker_url, rss_ticker_speed, rss_ticker_color, rss_ticker_bg_color, rss_ticker_font_size) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, name, rssTickerUrl || null, rssTickerSpeed || 60, rssTickerColor || '#ffffff', rssTickerBgColor || '#1a1a2e', rssTickerFontSize || 16],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id, name });
        }
    );
});

app.put('/api/playlists/:id', (req, res) => {
    const { name, rssTickerUrl, rssTickerSpeed, rssTickerColor, rssTickerBgColor, rssTickerFontSize } = req.body;
    db.run(
        `UPDATE playlists SET name = ?, rss_ticker_url = ?, rss_ticker_speed = ?, rss_ticker_color = ?, rss_ticker_bg_color = ?, rss_ticker_font_size = ? WHERE id = ?`,
        [name, rssTickerUrl || null, rssTickerSpeed || 60, rssTickerColor || '#ffffff', rssTickerBgColor || '#1a1a2e', rssTickerFontSize || 16, req.params.id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

app.delete('/api/playlists/:id', (req, res) => {
    db.run(`DELETE FROM playlists WHERE id = ?`, [req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Playlist items – flattened (including nested playlists)
app.get('/api/playlists/:id/items', (req, res) => {
    db.all(
        `SELECT 
            pi.id, pi.sort_order, pi.sub_playlist_id, pi.duration_override,
            m.id as media_id, m.name, m.type, m.filepath, m.url, m.duration,
            p.name as sub_playlist_name
         FROM playlist_items pi
         LEFT JOIN media m ON pi.media_id = m.id
         LEFT JOIN playlists p ON pi.sub_playlist_id = p.id
         WHERE pi.playlist_id = ?
         ORDER BY pi.sort_order ASC`,
        [req.params.id],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
});

// Add media item to playlist
app.post('/api/playlists/:id/items', (req, res) => {
    const { mediaId, subPlaylistId, sortOrder, durationOverride } = req.body;
    const playlistId = req.params.id;

    if (!mediaId && !subPlaylistId) {
        return res.status(400).json({ error: 'Either mediaId or subPlaylistId is required' });
    }

    // If adding a sub-playlist, check for circular references
    if (subPlaylistId) {
        wouldCreateCycle(playlistId, subPlaylistId, (isCycle) => {
            if (isCycle) {
                return res.status(400).json({ error: 'Zirkuläre Playlist-Verschachtelung nicht erlaubt!' });
            }
            const id = uuidv4();
            db.run(
                `INSERT INTO playlist_items (id, playlist_id, media_id, sub_playlist_id, sort_order, duration_override) VALUES (?, ?, ?, ?, ?, ?)`,
                [id, playlistId, null, subPlaylistId, sortOrder, durationOverride || null],
                (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ success: true, id });
                }
            );
        });
    } else {
        const id = uuidv4();
        db.run(
            `INSERT INTO playlist_items (id, playlist_id, media_id, sub_playlist_id, sort_order, duration_override) VALUES (?, ?, ?, ?, ?, ?)`,
            [id, playlistId, mediaId, null, sortOrder, durationOverride || null],
            (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, id });
            }
        );
    }
});

// Update duration override for a playlist item
app.put('/api/playlists/:playlistId/items/:itemId', (req, res) => {
    const { durationOverride, sortOrder } = req.body;
    db.run(
        `UPDATE playlist_items SET duration_override = ?, sort_order = ? WHERE id = ? AND playlist_id = ?`,
        [durationOverride || null, sortOrder, req.params.itemId, req.params.playlistId],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

// Delete a playlist item
app.delete('/api/playlists/:playlistId/items/:itemId', (req, res) => {
    db.run(`DELETE FROM playlist_items WHERE id = ? AND playlist_id = ?`, [req.params.itemId, req.params.playlistId], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// 3. Media
app.get('/api/media', (req, res) => {
    db.all(`SELECT * FROM media`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/media/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { name, type, duration } = req.body;
    const id = uuidv4();
    const filepath = `/uploads/${req.file.filename}`;
    db.run(
        `INSERT INTO media (id, name, type, filepath, duration) VALUES (?, ?, ?, ?, ?)`,
        [id, name, type, filepath, duration || 10],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id, name, type, filepath, duration: duration || 10 });
        }
    );
});

app.post('/api/media/web', (req, res) => {
    const { name, url, duration } = req.body;
    const id = uuidv4();
    db.run(
        `INSERT INTO media (id, name, type, url, duration) VALUES (?, ?, ?, ?, ?)`,
        [id, name, 'webpage', url, duration || 30],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id, name, type: 'webpage', url, duration: duration || 30 });
        }
    );
});

app.delete('/api/media/:id', (req, res) => {
    db.get(`SELECT filepath FROM media WHERE id = ?`, [req.params.id], (err, row) => {
        if (row && row.filepath) {
            const fullPath = path.join(uploadDir, path.basename(row.filepath));
            if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
        }
        db.run(`DELETE FROM media WHERE id = ?`, [req.params.id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    });
});

// --- Sockets for Realtime Client Updates ---
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('authenticate', (token) => {
        db.get(`SELECT id FROM screens WHERE token = ?`, [token], (err, row) => {
            if (row) {
                socket.join(row.id);
                console.log(`Screen ${row.id} authenticated`);
                db.run(`UPDATE screens SET last_seen = CURRENT_TIMESTAMP WHERE id = ?`, [row.id]);
            } else {
                socket.emit('auth_error', 'Invalid token');
            }
        });
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// Fallback für React Router (SPA)
app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/') && !req.path.startsWith('/uploads/')) {
        res.sendFile(path.join(frontendPath, 'index.html'));
    } else {
        next();
    }
});

server.listen(PORT, () => {
    console.log(`Digital Signage Server running on port ${PORT}`);
});
