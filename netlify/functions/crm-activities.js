const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2026';

function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.split(' ')[1];
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const decoded = verifyToken(event.headers.authorization);
  if (!decoded) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Unauthorized' })
    };
  }

  const userId = decoded.userId;

  // Helper to verify deal ownership
  async function verifyDealOwnership(dealId) {
    const result = await pool.query(
      `SELECT id FROM lr_crm_deals WHERE id = $1 AND user_id = $2`,
      [dealId, userId]
    );
    return result.rows.length > 0;
  }

  try {
    // ==========================================
    // GET - Get activities for a deal
    // ==========================================
    if (event.httpMethod === 'GET') {
      const dealId = event.queryStringParameters?.dealId;
      const limit = parseInt(event.queryStringParameters?.limit) || 50;
      const offset = parseInt(event.queryStringParameters?.offset) || 0;
      const activityType = event.queryStringParameters?.type;

      if (!dealId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Deal ID is required' })
        };
      }

      if (!(await verifyDealOwnership(dealId))) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Deal not found' })
        };
      }

      let query = `SELECT * FROM lr_crm_activities WHERE deal_id = $1`;
      const values = [dealId];
      let paramIndex = 2;

      if (activityType) {
        query += ` AND activity_type = $${paramIndex}`;
        values.push(activityType);
        paramIndex++;
      }

      query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      values.push(limit, offset);

      const activitiesResult = await pool.query(query, values);

      // Get total count
      let countQuery = `SELECT COUNT(*) FROM lr_crm_activities WHERE deal_id = $1`;
      const countValues = [dealId];
      if (activityType) {
        countQuery += ` AND activity_type = $2`;
        countValues.push(activityType);
      }
      const countResult = await pool.query(countQuery, countValues);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          activities: activitiesResult.rows,
          total: parseInt(countResult.rows[0].count),
          limit,
          offset
        })
      };
    }

    // ==========================================
    // POST - Add activity to a deal
    // ==========================================
    if (event.httpMethod === 'POST') {
      const { dealId, activityType, subject, content, metadata } = JSON.parse(event.body);

      if (!dealId || !activityType) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Deal ID and activity type are required' })
        };
      }

      // Validate activity type
      const validTypes = ['note', 'email', 'call', 'meeting', 'task', 'stage_change', 'deal_won', 'deal_lost', 'value_change', 'custom'];
      if (!validTypes.includes(activityType)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: `Invalid activity type. Must be one of: ${validTypes.join(', ')}` })
        };
      }

      if (!(await verifyDealOwnership(dealId))) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Deal not found' })
        };
      }

      // Create activity
      const activityResult = await pool.query(
        `INSERT INTO lr_crm_activities (deal_id, user_id, activity_type, subject, content, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [dealId, userId, activityType, subject || null, content || null, JSON.stringify(metadata || {})]
      );

      // Update deal's last_activity_at
      await pool.query(
        `UPDATE lr_crm_deals SET last_activity_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [dealId]
      );

      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Activity added successfully',
          activity: activityResult.rows[0]
        })
      };
    }

    // ==========================================
    // DELETE - Delete activity
    // ==========================================
    if (event.httpMethod === 'DELETE') {
      const { id } = JSON.parse(event.body || '{}');
      const activityId = id || event.queryStringParameters?.id;

      if (!activityId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Activity ID is required' })
        };
      }

      // Verify ownership through deal
      const activityCheck = await pool.query(
        `SELECT a.id FROM lr_crm_activities a
         JOIN lr_crm_deals d ON d.id = a.deal_id
         WHERE a.id = $1 AND d.user_id = $2`,
        [activityId, userId]
      );

      if (activityCheck.rows.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Activity not found' })
        };
      }

      await pool.query(`DELETE FROM lr_crm_activities WHERE id = $1`, [activityId]);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Activity deleted successfully'
        })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };

  } catch (error) {
    console.error('CRM Activities error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server error', message: error.message })
    };
  }
};
