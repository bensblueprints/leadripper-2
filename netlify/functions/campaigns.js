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

  // GET - List campaigns with analytics
  if (event.httpMethod === 'GET') {
    try {
      const params = event.queryStringParameters || {};

      // If id provided, get single campaign detail
      if (params.id) {
        const result = await pool.query(
          'SELECT * FROM lr_campaigns WHERE id = $1 AND user_id = $2',
          [params.id, userId]
        );
        if (result.rows.length === 0) {
          return { statusCode: 404, headers, body: JSON.stringify({ error: 'Campaign not found' }) };
        }

        // Get per-step analytics
        const stats = await pool.query(
          `SELECT
            sequence_step,
            variant_id,
            COUNT(*) as sent,
            COUNT(opened_at) as opened,
            COUNT(clicked_at) as clicked,
            COUNT(replied_at) as replied,
            COUNT(bounced_at) as bounced
           FROM lr_sent_emails
           WHERE campaign_id = $1 AND user_id = $2
           GROUP BY sequence_step, variant_id
           ORDER BY sequence_step, variant_id`,
          [params.id, userId]
        );

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            campaign: result.rows[0],
            stepStats: stats.rows
          })
        };
      }

      // List all campaigns
      const result = await pool.query(
        `SELECT c.*,
          COALESCE(s.sent_count, 0) as sent_count,
          COALESCE(s.open_count, 0) as open_count,
          COALESCE(s.click_count, 0) as click_count,
          COALESCE(s.reply_count, 0) as reply_count,
          COALESCE(s.bounce_count, 0) as bounce_count
         FROM lr_campaigns c
         LEFT JOIN LATERAL (
           SELECT
             COUNT(*) as sent_count,
             COUNT(opened_at) as open_count,
             COUNT(clicked_at) as click_count,
             COUNT(replied_at) as reply_count,
             COUNT(bounced_at) as bounce_count
           FROM lr_sent_emails WHERE campaign_id = c.id
         ) s ON true
         WHERE c.user_id = $1
         ORDER BY c.created_at DESC`,
        [userId]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, campaigns: result.rows })
      };
    } catch (error) {
      console.error('List campaigns error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  // POST - Create or update campaign
  if (event.httpMethod === 'POST') {
    try {
      const { id, name, subject, body: emailBody, fromAccountId, sequenceSteps, settings, status } = JSON.parse(event.body);

      if (!name) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Campaign name is required' }) };
      }

      if (id) {
        // Update existing
        const result = await pool.query(
          `UPDATE lr_campaigns SET
            name = $1, subject = $2, body = $3, from_account_id = $4,
            sequence_steps = $5, settings = $6, status = COALESCE($7, status),
            updated_at = NOW()
           WHERE id = $8 AND user_id = $9 RETURNING *`,
          [name, subject, emailBody, fromAccountId,
           JSON.stringify(sequenceSteps || []),
           JSON.stringify(settings || {}),
           status, id, userId]
        );

        if (result.rows.length === 0) {
          return { statusCode: 404, headers, body: JSON.stringify({ error: 'Campaign not found' }) };
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, campaign: result.rows[0], message: 'Campaign updated' })
        };
      }

      // Create new
      const result = await pool.query(
        `INSERT INTO lr_campaigns
          (user_id, name, subject, body, from_account_id, sequence_steps, settings, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [userId, name, subject, emailBody, fromAccountId,
         JSON.stringify(sequenceSteps || []),
         JSON.stringify(settings || {}),
         status || 'draft']
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, campaign: result.rows[0], message: 'Campaign created' })
      };
    } catch (error) {
      console.error('Create/update campaign error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  // PUT - Update campaign status
  if (event.httpMethod === 'PUT') {
    try {
      const { id, status } = JSON.parse(event.body);

      if (!id || !status) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Campaign ID and status required' }) };
      }

      const result = await pool.query(
        `UPDATE lr_campaigns SET status = $1, updated_at = NOW()
         WHERE id = $2 AND user_id = $3 RETURNING *`,
        [status, id, userId]
      );

      if (result.rows.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Campaign not found' }) };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, campaign: result.rows[0] })
      };
    } catch (error) {
      console.error('Update campaign status error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  // DELETE - Delete campaign
  if (event.httpMethod === 'DELETE') {
    try {
      const { id } = JSON.parse(event.body);

      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Campaign ID required' }) };
      }

      await pool.query(
        'DELETE FROM lr_campaigns WHERE id = $1 AND user_id = $2',
        [id, userId]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: 'Campaign deleted' })
      };
    } catch (error) {
      console.error('Delete campaign error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
