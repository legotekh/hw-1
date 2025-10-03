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
  db.run(`
    CREATE TABLE IF NOT EXISTS api_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_endpoint TEXT NOT NULL,
      parameters TEXT,
      response_data TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
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

    const apiData = await fetchFromAPI(endpoint, params);

    const stmt = db.prepare(`
      INSERT INTO api_responses (api_endpoint, parameters, response_data)
      VALUES (?, ?, ?)
    `);
    stmt.run(
      endpoint,
      JSON.stringify(params),
      JSON.stringify(apiData),
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, data: apiData, savedId: this.lastID, message: 'Data fetched and saved successfully' });
      }
    );
    stmt.finalize();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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
