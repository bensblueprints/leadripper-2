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

  // GET - List all lists (with item counts) or get single list with leads
  if (event.httpMethod === 'GET') {
    try {
      const params = event.queryStringParameters || {};

      // Single list with all its leads
      if (params.id) {
        const listResult = await pool.query(
          `SELECT id, user_id, name, description, created_at, updated_at
           FROM lr_lead_lists WHERE id = $1 AND user_id = $2`,
          [params.id, userId]
        );

        if (listResult.rows.length === 0) {
          return { statusCode: 404, headers, body: JSON.stringify({ error: 'List not found' }) };
        }

        const leadsResult = await pool.query(
          `SELECT l.id, l.business_name, l.phone, l.email, l.address, l.city, l.state,
                  l.industry, l.website, l.rating, l.reviews, l.created_at,
                  li.added_at
           FROM lr_lead_list_items li
           JOIN lr_leads l ON li.lead_id = l.id
           WHERE li.list_id = $1
           ORDER BY li.added_at DESC`,
          [params.id]
        );

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            list: listResult.rows[0],
            leads: leadsResult.rows
          })
        };
      }

      // All lists with item counts
      const result = await pool.query(
        `SELECT ll.id, ll.user_id, ll.name, ll.description, ll.created_at, ll.updated_at,
                COUNT(li.id)::INTEGER AS item_count
         FROM lr_lead_lists ll
         LEFT JOIN lr_lead_list_items li ON ll.id = li.list_id
         WHERE ll.user_id = $1
         GROUP BY ll.id
         ORDER BY ll.created_at DESC`,
        [userId]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, lists: result.rows })
      };
    } catch (error) {
      console.error('Get lead lists error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  // POST - Create a new list
  if (event.httpMethod === 'POST') {
    try {
      const { name, description } = JSON.parse(event.body);

      if (!name) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'List name is required' }) };
      }

      const result = await pool.query(
        `INSERT INTO lr_lead_lists (user_id, name, description, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) RETURNING *`,
        [userId, name, description || null]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, list: result.rows[0] })
      };
    } catch (error) {
      console.error('Create lead list error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  // PUT - Update a list
  if (event.httpMethod === 'PUT') {
    try {
      const { id, name, description } = JSON.parse(event.body);

      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'List ID is required' }) };
      }

      const result = await pool.query(
        `UPDATE lr_lead_lists SET
          name = COALESCE($1, name),
          description = COALESCE($2, description),
          updated_at = NOW()
         WHERE id = $3 AND user_id = $4 RETURNING *`,
        [name, description, id, userId]
      );

      if (result.rows.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'List not found' }) };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, list: result.rows[0] })
      };
    } catch (error) {
      console.error('Update lead list error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  // DELETE - Delete a list
  if (event.httpMethod === 'DELETE') {
    try {
      const { id } = JSON.parse(event.body);

      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'List ID is required' }) };
      }

      const result = await pool.query(
        'DELETE FROM lr_lead_lists WHERE id = $1 AND user_id = $2 RETURNING id',
        [id, userId]
      );

      if (result.rows.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'List not found' }) };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: 'List deleted' })
      };
    } catch (error) {
      console.error('Delete lead list error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
