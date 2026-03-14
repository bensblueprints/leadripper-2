const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2026';

function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try { return jwt.verify(authHeader.split(' ')[1], JWT_SECRET); } catch { return null; }
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const decoded = verifyToken(event.headers.authorization);
  if (!decoded) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

  const userId = decoded.userId;

  // Ensure tags column exists
  await pool.query('ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT \'[]\'').catch(() => {});

  // GET - Get all unique tags for this user, or tags for a specific lead
  if (event.httpMethod === 'GET') {
    const params = event.queryStringParameters || {};

    if (params.leadId) {
      // Get tags for specific lead
      const result = await pool.query('SELECT tags FROM lr_leads WHERE id = $1 AND user_id = $2', [params.leadId, userId]);
      const tags = result.rows[0]?.tags || [];
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, tags }) };
    }

    // Get all unique tags across all leads
    const result = await pool.query(
      `SELECT DISTINCT jsonb_array_elements_text(COALESCE(tags, '[]'::jsonb)) as tag
       FROM lr_leads WHERE user_id = $1 ORDER BY tag`,
      [userId]
    );
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, tags: result.rows.map(r => r.tag) }) };
  }

  // POST - Add tag(s) to lead(s)
  if (event.httpMethod === 'POST') {
    try {
      const { leadId, leadIds, tag, tags: tagList } = JSON.parse(event.body);
      const tagsToAdd = tagList || (tag ? [tag] : []);
      const ids = leadIds || (leadId ? [leadId] : []);

      if (tagsToAdd.length === 0) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No tags provided' }) };
      if (ids.length === 0) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No lead ID(s) provided' }) };

      let updated = 0;
      for (const id of ids) {
        const result = await pool.query('SELECT tags FROM lr_leads WHERE id = $1 AND user_id = $2', [id, userId]);
        if (result.rows.length === 0) continue;

        let current = result.rows[0].tags || [];
        if (!Array.isArray(current)) current = [];

        const merged = [...new Set([...current, ...tagsToAdd])];
        await pool.query('UPDATE lr_leads SET tags = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3', [JSON.stringify(merged), id, userId]);
        updated++;
      }

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, updated, message: `Added ${tagsToAdd.length} tag(s) to ${updated} lead(s)` }) };
    } catch (e) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
    }
  }

  // DELETE - Remove tag from lead(s)
  if (event.httpMethod === 'DELETE') {
    try {
      const { leadId, leadIds, tag } = JSON.parse(event.body);
      const ids = leadIds || (leadId ? [leadId] : []);

      if (!tag) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No tag provided' }) };
      if (ids.length === 0) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No lead ID(s) provided' }) };

      let updated = 0;
      for (const id of ids) {
        const result = await pool.query('SELECT tags FROM lr_leads WHERE id = $1 AND user_id = $2', [id, userId]);
        if (result.rows.length === 0) continue;

        let current = result.rows[0].tags || [];
        if (!Array.isArray(current)) current = [];

        const filtered = current.filter(t => t !== tag);
        await pool.query('UPDATE lr_leads SET tags = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3', [JSON.stringify(filtered), id, userId]);
        updated++;
      }

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, updated, message: `Removed "${tag}" from ${updated} lead(s)` }) };
    } catch (e) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
