const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
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
app.use(express.static(frontendPath)); // Serve admin UI and Player

// Configure Multer for file uploads
const uploadDir = path.join(__dirname, 'data/uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Serve uploaded files statically
app.use('/uploads', express.static(uploadDir));

// --- API ENDPOINTS ---

// 1. Screens
app.post('/api/screens/pair', (req, res) => {
    // Generate pairing code, token and screen entry
    const { name } = req.body;
    const pairingCode = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits
    const screenId = uuidv4();
    const token = null; // Token is generated when code is confirmed from dashboard

    db.run(
        `INSERT INTO screens (id, name, pairing_code, token) VALUES (?, ?, ?, ?)`,
        [screenId, name, pairingCode, token],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: screenId, pairingCode });
        }
    );
});

// Admin endpoint to confirm pairing code and link screen
app.post('/api/screens/confirm', (req, res) => {
    const { pairingCode } = req.body;
    const token = uuidv4(); // Generate real token

    db.run(
        `UPDATE screens SET pairing_code = NULL, token = ? WHERE pairing_code = ?`,
        [token, pairingCode],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: "Invalid pairing code" });

            // Get screen ID to inform connected socket
            db.get(`SELECT id FROM screens WHERE token = ?`, [token], (err, row) => {
                if (row) {
                    io.emit('paired', { screenId: row.id, token: token });
                }
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

            // Notify screen about playlist change using WebSockets
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
    const { name, rssTickerUrl } = req.body;
    const id = uuidv4();
    db.run(
        `INSERT INTO playlists (id, name, rss_ticker_url) VALUES (?, ?, ?)`,
        [id, name, rssTickerUrl || null],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id, name, rss_ticker_url: rssTickerUrl });
        }
    );
});

app.get('/api/playlists/:id/items', (req, res) => {
    db.all(
        `SELECT pi.id, pi.sort_order, m.* 
         FROM playlist_items pi 
         JOIN media m ON pi.media_id = m.id 
         WHERE pi.playlist_id = ? 
         ORDER BY pi.sort_order ASC`,
        [req.params.id],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
});

app.post('/api/playlists/:id/items', (req, res) => {
    const { mediaId, sortOrder } = req.body;
    const id = uuidv4();
    db.run(
        `INSERT INTO playlist_items (id, playlist_id, media_id, sort_order) VALUES (?, ?, ?, ?)`,
        [id, req.params.id, mediaId, sortOrder],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, id });
        }
    );
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

    const { name, type, duration } = req.body; // type: image, video, document
    const id = uuidv4();
    const filepath = `/uploads/${req.file.filename}`;

    db.run(
        `INSERT INTO media (id, name, type, filepath, duration) VALUES (?, ?, ?, ?, ?)`,
        [id, name, type, filepath, duration || 10], // Default duration: 10s for images/pdfs
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


// --- Sockets for Realtime Client Updates ---
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Client authenticates using token
    socket.on('authenticate', (token) => {
        db.get(`SELECT id FROM screens WHERE token = ?`, [token], (err, row) => {
            if (row) {
                socket.join(row.id); // Join room specific to this screen ID
                console.log(`Screen ${row.id} authenticated`);

                // Update last_seen
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

// ... (vorheriger Code bleibt unverändert)

// Basic route for serving the player (if we decide to host the player on the server as well)
// app.get('/player', (req, res) => { ... });

// Fallback für React Router (Gültig für HA Ingress)
app.get('*', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
});

server.listen(PORT, () => {
    console.log(`Digital Signage Server running on port ${PORT}`);
});
