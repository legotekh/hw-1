import express from 'express';
import sqlite3 from 'sqlite3';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Database setup
const dbFilePath = process.env.DATABASE_PATH || path.join(__dirname, 'api_data.db');
const db = new sqlite3.Database(dbFilePath);

// Create table for storing API responses
db.serialize(() => {
  // Enforce foreign keys
  db.run('PRAGMA foreign_keys = ON');
  db.run(`
    CREATE TABLE IF NOT EXISTS api_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_endpoint TEXT NOT NULL,
      parameters TEXT,
      response_data TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Normalized storage for parsed items from various endpoints
  db.run(`
    CREATE TABLE IF NOT EXISTS api_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT NOT NULL,
      item_id INTEGER,
      user_id INTEGER,
      post_id INTEGER,
      album_id INTEGER,
      title TEXT,
      name TEXT,
      email TEXT,
      completed INTEGER,
      url TEXT,
      thumbnailUrl TEXT,
      body TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Indexes to speed up common lookups and ordering
  db.run(`CREATE INDEX IF NOT EXISTS idx_api_items_endpoint ON api_items(endpoint)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_api_items_user ON api_items(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_api_items_post ON api_items(post_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_api_items_album ON api_items(album_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_api_items_completed ON api_items(completed)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_api_items_created_at ON api_items(created_at)`);

  // Domain tables (fully normalized)
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT,
      username TEXT,
      email TEXT,
      phone TEXT,
      website TEXT,
      address_json TEXT,
      company_json TEXT
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_name ON users(name)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      title TEXT,
      body TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY,
      post_id INTEGER NOT NULL,
      name TEXT,
      email TEXT,
      body TEXT,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_comments_email ON comments(email)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS albums (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      title TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_albums_user ON albums(user_id)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY,
      album_id INTEGER NOT NULL,
      title TEXT,
      url TEXT,
      thumbnailUrl TEXT,
      FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_photos_album ON photos(album_id)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      title TEXT,
      completed INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_todos_user ON todos(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_todos_completed ON todos(completed)`);
});

// Middleware
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Helper function to fetch from JSONPlaceholder API
async function fetchFromAPI(endpoint, params = {}) {
  const url = new URL(`https://jsonplaceholder.typicode.com${endpoint}`);
  Object.keys(params).forEach(key => {
    if (params[key] !== '' && params[key] !== null && params[key] !== undefined) {
      url.searchParams.append(key, params[key]);
    }
  });
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return await response.json();
}

// Helper function to sort API data arrays per endpoint
function sortApiData(endpoint, data) {
  if (!Array.isArray(data)) return data;
  const copy = [...data];
  if (endpoint === '/users') {
    // Sort by name, then id
    copy.sort((a, b) => {
      const an = (a.name || '').localeCompare?.(b.name || '') ?? 0;
      return an !== 0 ? an : (a.id ?? 0) - (b.id ?? 0);
    });
  } else if (endpoint === '/posts') {
    // Sort by userId, then id
    copy.sort((a, b) => (a.userId ?? 0) - (b.userId ?? 0) || (a.id ?? 0) - (b.id ?? 0));
  } else if (endpoint === '/albums') {
    // Sort by userId, then id
    copy.sort((a, b) => (a.userId ?? 0) - (b.userId ?? 0) || (a.id ?? 0) - (b.id ?? 0));
  } else if (endpoint === '/photos') {
    // Sort by albumId, then id
    copy.sort((a, b) => (a.albumId ?? 0) - (b.albumId ?? 0) || (a.id ?? 0) - (b.id ?? 0));
  } else if (endpoint === '/todos') {
    // Sort by completed (false first), then userId, then id
    copy.sort((a, b) => (Number(Boolean(a.completed)) - Number(Boolean(b.completed))) || (a.userId ?? 0) - (b.userId ?? 0) || (a.id ?? 0) - (b.id ?? 0));
  } else if (endpoint === '/comments') {
    // Sort by postId, then id
    copy.sort((a, b) => (a.postId ?? 0) - (b.postId ?? 0) || (a.id ?? 0) - (b.id ?? 0));
  }
  return copy;
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get all stored data from database
app.get('/api/stored-data', (req, res) => {
  db.all('SELECT * FROM api_responses ORDER BY created_at DESC', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Get pretty/auditable stored data with parsed JSON fields
app.get('/api/stored-data-pretty', (req, res) => {
  db.all('SELECT * FROM api_responses ORDER BY created_at DESC', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    const pretty = rows.map(r => {
      let parsedParams = null;
      let parsedData = null;
      try { parsedParams = r.parameters ? JSON.parse(r.parameters) : null; } catch {}
      try { parsedData = r.response_data ? JSON.parse(r.response_data) : null; } catch {}
      return {
        id: r.id,
        endpoint: r.api_endpoint,
        parameters: parsedParams,
        dataSample: Array.isArray(parsedData) ? parsedData.slice(0, 3) : parsedData,
        itemsCount: Array.isArray(parsedData) ? parsedData.length : (parsedData ? 1 : 0),
        createdAt: r.created_at
      };
    });
    res.json(pretty);
  });
});

// Fetch data from external API and save to database
app.post('/api/fetch-data', async (req, res) => {
  try {
    const { endpoint, userId, postId, albumId } = req.body;
    const validEndpoints = ['/posts', '/users', '/albums', '/photos', '/todos', '/comments'];
    if (!validEndpoints.includes(endpoint)) {
      return res.status(400).json({ error: 'Invalid endpoint' });
    }
    const params = {};
    if (userId) params.userId = userId;
    if (postId) params.postId = postId;
    if (albumId) params.albumId = albumId;

    const apiDataFetched = await fetchFromAPI(endpoint, params);
    const apiData = sortApiData(endpoint, apiDataFetched);

    // Helper to map a single item into flat columns
    function normalizeItem(ep, item) {
      const base = {
        endpoint: ep,
        item_id: item.id ?? null,
        user_id: item.userId ?? null,
        post_id: item.postId ?? null,
        album_id: item.albumId ?? null,
        title: null,
        name: null,
        email: null,
        completed: null,
        url: null,
        thumbnailUrl: null,
        body: null
      };
      if (ep === '/posts') {
        base.title = item.title ?? null;
        base.body = item.body ?? null;
      } else if (ep === '/users') {
        base.name = item.name ?? null;
        base.email = item.email ?? null;
      } else if (ep === '/albums') {
        base.title = item.title ?? null;
      } else if (ep === '/photos') {
        base.title = item.title ?? null;
        base.url = item.url ?? null;
        base.thumbnailUrl = item.thumbnailUrl ?? null;
        base.album_id = item.albumId ?? base.album_id;
      } else if (ep === '/todos') {
        base.title = item.title ?? null;
        base.completed = typeof item.completed === 'boolean' ? (item.completed ? 1 : 0) : null;
      } else if (ep === '/comments') {
        base.name = item.name ?? null;
        base.email = item.email ?? null;
        base.body = item.body ?? null;
        base.post_id = item.postId ?? base.post_id;
      }
      return base;
    }

    // Ensure we have an array of items to insert (sorted if array)
    const itemsArray = Array.isArray(apiData) ? apiData : [apiData];

    // Insert normalized rows in a transaction
    const insertItems = () => new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        const insertStmt = db.prepare(`
          INSERT INTO api_items (
            endpoint, item_id, user_id, post_id, album_id, title, name, email, completed, url, thumbnailUrl, body
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const item of itemsArray) {
          const row = normalizeItem(endpoint, item);
          insertStmt.run([
            row.endpoint,
            row.item_id,
            row.user_id,
            row.post_id,
            row.album_id,
            row.title,
            row.name,
            row.email,
            row.completed,
            row.url,
            row.thumbnailUrl,
            row.body
          ]);
        }
        insertStmt.finalize(err => {
          if (err) {
            db.run('ROLLBACK');
            return reject(err);
          }
          db.run('COMMIT', commitErr => {
            if (commitErr) return reject(commitErr);
            resolve(itemsArray.length);
          });
        });
      });
    });

    const insertedCount = await insertItems();

    // Upsert into domain tables inside a single transaction
    const upsertDomain = () => new Promise((resolve, reject) => {
      const items = Array.isArray(apiData) ? apiData : [apiData];
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        // Prepared statements per endpoint
        const upsertUser = db.prepare(`
          INSERT INTO users (id, name, username, email, phone, website, address_json, company_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name=excluded.name,
            username=excluded.username,
            email=excluded.email,
            phone=excluded.phone,
            website=excluded.website,
            address_json=excluded.address_json,
            company_json=excluded.company_json
        `);

        const upsertPost = db.prepare(`
          INSERT INTO posts (id, user_id, title, body)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            user_id=excluded.user_id,
            title=excluded.title,
            body=excluded.body
        `);

        const upsertComment = db.prepare(`
          INSERT INTO comments (id, post_id, name, email, body)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            post_id=excluded.post_id,
            name=excluded.name,
            email=excluded.email,
            body=excluded.body
        `);

        const upsertAlbum = db.prepare(`
          INSERT INTO albums (id, user_id, title)
          VALUES (?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            user_id=excluded.user_id,
            title=excluded.title
        `);

        const upsertPhoto = db.prepare(`
          INSERT INTO photos (id, album_id, title, url, thumbnailUrl)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            album_id=excluded.album_id,
            title=excluded.title,
            url=excluded.url,
            thumbnailUrl=excluded.thumbnailUrl
        `);

        const upsertTodo = db.prepare(`
          INSERT INTO todos (id, user_id, title, completed)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            user_id=excluded.user_id,
            title=excluded.title,
            completed=excluded.completed
        `);

        try {
          for (const it of items) {
            if (endpoint === '/users') {
              upsertUser.run([
                it.id, it.name ?? null, it.username ?? null, it.email ?? null, it.phone ?? null, it.website ?? null,
                it.address ? JSON.stringify(it.address) : null,
                it.company ? JSON.stringify(it.company) : null
              ]);
            } else if (endpoint === '/posts') {
              upsertPost.run([it.id, it.userId, it.title ?? null, it.body ?? null]);
            } else if (endpoint === '/comments') {
              upsertComment.run([it.id, it.postId, it.name ?? null, it.email ?? null, it.body ?? null]);
            } else if (endpoint === '/albums') {
              upsertAlbum.run([it.id, it.userId, it.title ?? null]);
            } else if (endpoint === '/photos') {
              upsertPhoto.run([it.id, it.albumId, it.title ?? null, it.url ?? null, it.thumbnailUrl ?? null]);
            } else if (endpoint === '/todos') {
              const completed = typeof it.completed === 'boolean' ? (it.completed ? 1 : 0) : null;
              upsertTodo.run([it.id, it.userId, it.title ?? null, completed]);
            }
          }
        } catch (e) {
          db.run('ROLLBACK');
          return reject(e);
        }

        upsertUser.finalize();
        upsertPost.finalize();
        upsertComment.finalize();
        upsertAlbum.finalize();
        upsertPhoto.finalize();
        upsertTodo.finalize(() => {
          db.run('COMMIT', commitErr => {
            if (commitErr) return reject(commitErr);
            resolve();
          });
        });
      });
    });

    await upsertDomain();

    // Keep original audit insert into api_responses
    const auditId = await new Promise((resolve, reject) => {
      const stmt = db.prepare(`
        INSERT INTO api_responses (api_endpoint, parameters, response_data)
        VALUES (?, ?, ?)
      `);
      stmt.run(
        endpoint,
        JSON.stringify(params),
        JSON.stringify(apiData),
        function(err) {
          if (err) return reject(err);
          resolve(this.lastID);
        }
      );
      stmt.finalize();
    });

    res.json({
      success: true,
      data: apiData,
      savedId: auditId,
      itemsInserted: insertedCount,
      message: 'Data fetched, normalized, and saved successfully'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// List normalized items with optional filters and pretty formatting
app.get('/api/items', (req, res) => {
  const { endpoint, userId, postId, albumId, completed, limit = 100, offset = 0 } = req.query;
  const where = [];
  const params = [];
  if (endpoint) { where.push('endpoint = ?'); params.push(String(endpoint)); }
  if (userId) { where.push('user_id = ?'); params.push(Number(userId)); }
  if (postId) { where.push('post_id = ?'); params.push(Number(postId)); }
  if (albumId) { where.push('album_id = ?'); params.push(Number(albumId)); }
  if (completed === '0' || completed === '1') { where.push('completed = ?'); params.push(Number(completed)); }
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `
    SELECT id, endpoint, item_id, user_id, post_id, album_id, title, name, email, completed, url, thumbnailUrl, body, created_at
    FROM api_items
    ${whereClause}
    ORDER BY endpoint ASC, user_id ASC, post_id ASC, album_id ASC, item_id ASC
    LIMIT ? OFFSET ?
  `;
  params.push(Number(limit));
  params.push(Number(offset));
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const pretty = rows.map(r => ({
      id: r.id,
      endpoint: r.endpoint,
      item: {
        id: r.item_id,
        title: r.title ?? undefined,
        name: r.name ?? undefined,
        email: r.email ?? undefined,
        url: r.url ?? undefined,
        thumbnailUrl: r.thumbnailUrl ?? undefined,
        body: r.body ?? undefined,
        completed: typeof r.completed === 'number' ? Boolean(r.completed) : undefined
      },
      relations: {
        userId: r.user_id ?? undefined,
        postId: r.post_id ?? undefined,
        albumId: r.album_id ?? undefined
      },
      createdAt: r.created_at
    }));
    res.json(pretty);
  });
});

// Grouped structured view combining related entities per endpoint
app.get('/api/structured', (req, res) => {
  const sql = `
    SELECT endpoint, item_id, user_id, post_id, album_id, title, name, email, completed, url, thumbnailUrl, body
    FROM api_items
    ORDER BY endpoint, user_id, post_id, album_id, item_id
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const grouped = rows.reduce((acc, r) => {
      if (!acc[r.endpoint]) acc[r.endpoint] = {};
      const epGroup = acc[r.endpoint];

      // Choose grouping key per endpoint
      let parentKey = 'root';
      if (r.endpoint === '/posts' || r.endpoint === '/todos' || r.endpoint === '/albums') parentKey = `user:${r.user_id}`;
      if (r.endpoint === '/comments') parentKey = `post:${r.post_id}`;
      if (r.endpoint === '/photos') parentKey = `album:${r.album_id}`;

      if (!epGroup[parentKey]) epGroup[parentKey] = [];
      epGroup[parentKey].push({
        id: r.item_id,
        title: r.title ?? undefined,
        name: r.name ?? undefined,
        email: r.email ?? undefined,
        body: r.body ?? undefined,
        url: r.url ?? undefined,
        thumbnailUrl: r.thumbnailUrl ?? undefined,
        completed: typeof r.completed === 'number' ? Boolean(r.completed) : undefined
      });
      return acc;
    }, {});
    res.json(grouped);
  });
});

// Delete stored data
app.delete('/api/stored-data/:id', (req, res) => {
  const id = req.params.id;
  db.run('DELETE FROM api_responses WHERE id = ?', [id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Record not found' });
    res.json({ success: true, message: 'Record deleted successfully' });
  });
});

// Clear all stored data
app.delete('/api/stored-data', (req, res) => {
  db.run('DELETE FROM api_responses', function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, message: `Deleted ${this.changes} records` });
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Using database at: ${dbFilePath}`);
});

// Simple browse endpoints for normalized domain tables
app.get('/api/users', (req, res) => {
  db.all('SELECT * FROM users ORDER BY id', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const pretty = rows.map(u => ({
      id: u.id,
      name: u.name,
      username: u.username,
      email: u.email,
      phone: u.phone,
      website: u.website,
      address: u.address_json ? JSON.parse(u.address_json) : null,
      company: u.company_json ? JSON.parse(u.company_json) : null
    }));
    res.json(pretty);
  });
});

app.get('/api/posts', (req, res) => {
  const { userId } = req.query;
  const where = [];
  const params = [];
  if (userId) { where.push('user_id = ?'); params.push(Number(userId)); }
  const sql = `SELECT * FROM posts ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/comments', (req, res) => {
  const { postId } = req.query;
  const where = [];
  const params = [];
  if (postId) { where.push('post_id = ?'); params.push(Number(postId)); }
  const sql = `SELECT * FROM comments ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/albums', (req, res) => {
  const { userId } = req.query;
  const where = [];
  const params = [];
  if (userId) { where.push('user_id = ?'); params.push(Number(userId)); }
  const sql = `SELECT * FROM albums ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/photos', (req, res) => {
  const { albumId } = req.query;
  const where = [];
  const params = [];
  if (albumId) { where.push('album_id = ?'); params.push(Number(albumId)); }
  const sql = `SELECT * FROM photos ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/todos', (req, res) => {
  const { userId, completed } = req.query;
  const where = [];
  const params = [];
  if (userId) { where.push('user_id = ?'); params.push(Number(userId)); }
  if (completed === '0' || completed === '1') { where.push('completed = ?'); params.push(Number(completed)); }
  const sql = `SELECT id, user_id, title, completed FROM todos ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const pretty = rows.map(t => ({ id: t.id, userId: t.user_id, title: t.title, completed: Boolean(t.completed) }));
    res.json(pretty);
  });
});
