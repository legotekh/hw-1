## Parameters

- **userId**: Filter by user ID (affects posts, albums, todos, etc.)
- **postId**: Filter by post ID (affects comments)
- **albumId**: Filter by album ID (affects photos)

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm run dev
```

3. Open http://localhost:3000 in your browser

## API Routes

- `GET /` - Main application page
- `GET /api/stored-data` - Get all stored data
- `POST /api/fetch-data` - Fetch from external API and save
- `DELETE /api/stored-data/:id` - Delete specific record
- `DELETE /api/stored-data` - Clear all stored data

## Database

```sql
CREATE TABLE api_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  api_endpoint TEXT NOT NULL,
  parameters TEXT,
  response_data TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```
