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

  // GET - List activities for a deal
  if (event.httpMethod === 'GET') {
    try {
      const params = event.queryStringParameters || {};
      const dealId = params.dealId;

      if (!dealId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'dealId query parameter is required' }) };
      }

      // Verify the deal belongs to the user (through pipeline ownership)
      const dealCheck = await pool.query(
        `SELECT d.id FROM lr_crm_deals d
         JOIN lr_crm_pipelines p ON d.pipeline_id = p.id
         WHERE d.id = $1 AND p.user_id = $2`,
        [dealId, userId]
      );

      if (dealCheck.rows.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Deal not found' }) };
      }

      const result = await pool.query(
        `SELECT id, deal_id, user_id, type, content, created_at
         FROM lr_crm_activities WHERE deal_id = $1 ORDER BY created_at DESC`,
        [dealId]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, activities: result.rows })
      };
    } catch (error) {
      console.error('List activities error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  // POST - Create an activity
  if (event.httpMethod === 'POST') {
    try {
      const { dealId, type, content } = JSON.parse(event.body);

      if (!dealId || !content) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'dealId and content are required' }) };
      }

      // Verify the deal belongs to the user
      const dealCheck = await pool.query(
        `SELECT d.id FROM lr_crm_deals d
         JOIN lr_crm_pipelines p ON d.pipeline_id = p.id
         WHERE d.id = $1 AND p.user_id = $2`,
        [dealId, userId]
      );

      if (dealCheck.rows.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Deal not found' }) };
      }

      const validTypes = ['call', 'email', 'note', 'meeting'];
      const activityType = validTypes.includes(type) ? type : 'note';

      const result = await pool.query(
        `INSERT INTO lr_crm_activities (deal_id, user_id, type, content, created_at)
         VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
        [dealId, userId, activityType, content]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, activity: result.rows[0] })
      };
    } catch (error) {
      console.error('Create activity error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
