const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2026';

function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
  } catch {
    return null;
  }
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const decoded = verifyToken(event.headers.authorization);
  if (!decoded) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const userId = decoded.userId;

  // GET - Get all lead IDs in a list
  if (event.httpMethod === 'GET') {
    try {
      const params = event.queryStringParameters || {};

      if (!params.listId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'listId query parameter is required' }) };
      }

      // Verify list belongs to user
      const listCheck = await pool.query(
        'SELECT id FROM lr_lead_lists WHERE id = $1 AND user_id = $2',
        [params.listId, userId]
      );

      if (listCheck.rows.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'List not found' }) };
      }

      const result = await pool.query(
        `SELECT lead_id, added_at FROM lr_lead_list_items WHERE list_id = $1 ORDER BY added_at DESC`,
        [params.listId]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          listId: parseInt(params.listId),
          leadIds: result.rows.map(r => r.lead_id),
          items: result.rows
        })
      };
    } catch (error) {
      console.error('Get lead list items error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  // POST - Add leads to a list
  if (event.httpMethod === 'POST') {
    try {
      const { listId, leadIds } = JSON.parse(event.body);

      if (!listId || !leadIds || !Array.isArray(leadIds)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'listId and leadIds array are required' }) };
      }

      // Verify list belongs to user
      const listCheck = await pool.query(
        'SELECT id FROM lr_lead_lists WHERE id = $1 AND user_id = $2',
        [listId, userId]
      );

      if (listCheck.rows.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'List not found' }) };
      }

      let addedCount = 0;
      let skippedCount = 0;

      for (const leadId of leadIds) {
        try {
          await pool.query(
            `INSERT INTO lr_lead_list_items (list_id, lead_id, added_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (list_id, lead_id) DO NOTHING`,
            [listId, leadId]
          );
          addedCount++;
        } catch (e) {
          skippedCount++;
        }
      }

      // Update list's updated_at
      await pool.query(
        'UPDATE lr_lead_lists SET updated_at = NOW() WHERE id = $1',
        [listId]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: `Added ${addedCount} leads to list`,
          addedCount,
          skippedCount
        })
      };
    } catch (error) {
      console.error('Add lead list items error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  // DELETE - Remove leads from a list
  if (event.httpMethod === 'DELETE') {
    try {
      const { listId, leadIds } = JSON.parse(event.body);

      if (!listId || !leadIds || !Array.isArray(leadIds)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'listId and leadIds array are required' }) };
      }

      // Verify list belongs to user
      const listCheck = await pool.query(
        'SELECT id FROM lr_lead_lists WHERE id = $1 AND user_id = $2',
        [listId, userId]
      );

      if (listCheck.rows.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'List not found' }) };
      }

      const result = await pool.query(
        `DELETE FROM lr_lead_list_items WHERE list_id = $1 AND lead_id = ANY($2) RETURNING id`,
        [listId, leadIds]
      );

      // Update list's updated_at
      await pool.query(
        'UPDATE lr_lead_lists SET updated_at = NOW() WHERE id = $1',
        [listId]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: `Removed ${result.rowCount} leads from list`,
          removedCount: result.rowCount
        })
      };
    } catch (error) {
      console.error('Remove lead list items error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
