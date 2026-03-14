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

  // GET - Get single agent or list all agents for user
  if (event.httpMethod === 'GET') {
    try {
      const params = event.queryStringParameters || {};

      if (params.id) {
        const result = await pool.query(
          `SELECT id, user_id, name, voice_id, greeting, goal, max_duration,
                  phone_number, is_active, created_at, updated_at
           FROM lr_ai_agents WHERE id = $1 AND user_id = $2`,
          [params.id, userId]
        );

        if (result.rows.length === 0) {
          return { statusCode: 404, headers, body: JSON.stringify({ error: 'Agent not found' }) };
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, agent: result.rows[0] })
        };
      }

      const result = await pool.query(
        `SELECT id, user_id, name, voice_id, greeting, goal, max_duration,
                phone_number, is_active, created_at, updated_at
         FROM lr_ai_agents WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, agents: result.rows })
      };
    } catch (error) {
      console.error('Get agents error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  // POST - Create agent
  if (event.httpMethod === 'POST') {
    try {
      const { name, voiceId, greeting, goal, maxDuration, phoneNumber } = JSON.parse(event.body);

      if (!name) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Agent name is required' }) };
      }

      const result = await pool.query(
        `INSERT INTO lr_ai_agents
          (user_id, name, voice_id, greeting, goal, max_duration, phone_number, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW(), NOW()) RETURNING *`,
        [userId, name, voiceId || null, greeting || null, goal || null, maxDuration || 300, phoneNumber || null]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, agent: result.rows[0] })
      };
    } catch (error) {
      console.error('Create agent error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  // PUT - Update agent
  if (event.httpMethod === 'PUT') {
    try {
      const { id, name, voiceId, greeting, goal, maxDuration, phoneNumber, isActive } = JSON.parse(event.body);

      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Agent ID is required' }) };
      }

      const result = await pool.query(
        `UPDATE lr_ai_agents SET
          name = COALESCE($1, name),
          voice_id = COALESCE($2, voice_id),
          greeting = COALESCE($3, greeting),
          goal = COALESCE($4, goal),
          max_duration = COALESCE($5, max_duration),
          phone_number = COALESCE($6, phone_number),
          is_active = COALESCE($7, is_active),
          updated_at = NOW()
         WHERE id = $8 AND user_id = $9 RETURNING *`,
        [name, voiceId, greeting, goal, maxDuration, phoneNumber, isActive, id, userId]
      );

      if (result.rows.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Agent not found' }) };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, agent: result.rows[0] })
      };
    } catch (error) {
      console.error('Update agent error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  // DELETE - Delete agent
  if (event.httpMethod === 'DELETE') {
    try {
      const { id } = JSON.parse(event.body);

      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Agent ID is required' }) };
      }

      const result = await pool.query(
        'DELETE FROM lr_ai_agents WHERE id = $1 AND user_id = $2 RETURNING id',
        [id, userId]
      );

      if (result.rows.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Agent not found' }) };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: 'Agent deleted' })
      };
    } catch (error) {
      console.error('Delete agent error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
