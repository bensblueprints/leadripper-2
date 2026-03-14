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
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const decoded = verifyToken(event.headers.authorization);
  if (!decoded) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

  const userId = decoded.userId;

  try {
    // Find duplicates: same phone number (normalized - digits only), keep the one with the most data
    // We keep the lead with the most filled fields (email, website, contact_name, etc.)
    const result = await pool.query(`
      WITH normalized AS (
        SELECT id, business_name, phone, email, city, state, website, contact_name,
               REGEXP_REPLACE(phone, '[^0-9]', '', 'g') as phone_digits,
               (CASE WHEN email IS NOT NULL AND email != '' THEN 1 ELSE 0 END +
                CASE WHEN website IS NOT NULL AND website != '' THEN 1 ELSE 0 END +
                CASE WHEN contact_name IS NOT NULL AND contact_name != '' THEN 1 ELSE 0 END +
                CASE WHEN city IS NOT NULL AND city != '' THEN 1 ELSE 0 END) as data_score
        FROM lr_leads
        WHERE user_id = $1 AND phone IS NOT NULL AND phone != ''
      ),
      dupes AS (
        SELECT phone_digits, COUNT(*) as cnt
        FROM normalized
        WHERE LENGTH(phone_digits) >= 7
        GROUP BY phone_digits
        HAVING COUNT(*) > 1
      ),
      to_delete AS (
        SELECT n.id, n.business_name, n.phone, n.city
        FROM normalized n
        JOIN dupes d ON n.phone_digits = d.phone_digits
        WHERE n.id NOT IN (
          SELECT DISTINCT ON (n2.phone_digits) n2.id
          FROM normalized n2
          JOIN dupes d2 ON n2.phone_digits = d2.phone_digits
          ORDER BY n2.phone_digits, n2.data_score DESC, n2.id ASC
        )
      )
      SELECT * FROM to_delete
    `, [userId]);

    const duplicates = result.rows;

    if (duplicates.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, removed: 0, message: 'No duplicates found' }) };
    }

    // Delete the duplicates
    const ids = duplicates.map(d => d.id);
    await pool.query('DELETE FROM lr_leads WHERE id = ANY($1) AND user_id = $2', [ids, userId]);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        removed: duplicates.length,
        message: `Removed ${duplicates.length} duplicate leads (kept the version with most data)`,
        examples: duplicates.slice(0, 10).map(d => ({ id: d.id, name: d.business_name, phone: d.phone, city: d.city }))
      })
    };
  } catch (error) {
    console.error('Dedup error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
