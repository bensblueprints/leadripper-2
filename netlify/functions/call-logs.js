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

  // GET - List call logs for user
  if (event.httpMethod === 'GET') {
    try {
      const params = event.queryStringParameters || {};
      const limit = parseInt(params.limit) || 50;
      const offset = parseInt(params.offset) || 0;
      const listId = params.listId;

      let query = `
        SELECT id, user_id, lead_id, list_id, agent_id, elevenlabs_conversation_id,
               phone_number, contact_name, status, duration, recording_url, transcript,
               outcome, email_collected, notes, created_at, updated_at
        FROM lr_call_logs WHERE user_id = $1
      `;
      const values = [userId];
      let paramIndex = 2;

      if (listId) {
        query += ` AND list_id = $${paramIndex}`;
        values.push(listId);
        paramIndex++;
      }

      // Count query with same filters
      let countQuery = 'SELECT COUNT(*) as total FROM lr_call_logs WHERE user_id = $1';
      const countValues = [userId];
      let countParamIndex = 2;

      if (listId) {
        countQuery += ` AND list_id = $${countParamIndex}`;
        countValues.push(listId);
        countParamIndex++;
      }

      query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      values.push(limit, offset);

      const [result, countResult] = await Promise.all([
        pool.query(query, values),
        pool.query(countQuery, countValues)
      ]);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          callLogs: result.rows,
          total: parseInt(countResult.rows[0].total),
          limit,
          offset
        })
      };
    } catch (error) {
      console.error('Get call logs error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  // POST - Create a call log entry
  if (event.httpMethod === 'POST') {
    try {
      const {
        leadId, listId, agentId, phoneNumber, contactName,
        elevenlabsConversationId, status, duration, recordingUrl,
        transcript, outcome, emailCollected, notes
      } = JSON.parse(event.body);

      const result = await pool.query(
        `INSERT INTO lr_call_logs
          (user_id, lead_id, list_id, agent_id, elevenlabs_conversation_id,
           phone_number, contact_name, status, duration, recording_url,
           transcript, outcome, email_collected, notes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
         RETURNING *`,
        [
          userId,
          leadId || null,
          listId || null,
          agentId || null,
          elevenlabsConversationId || null,
          phoneNumber || null,
          contactName || null,
          status || 'initiated',
          duration || 0,
          recordingUrl || null,
          transcript || null,
          outcome || null,
          emailCollected || null,
          notes || null
        ]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, callLog: result.rows[0] })
      };
    } catch (error) {
      console.error('Create call log error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  // PUT - Update a call log entry
  if (event.httpMethod === 'PUT') {
    try {
      const { id, status, duration, recordingUrl, transcript, outcome, emailCollected, notes } = JSON.parse(event.body);

      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Call log ID is required' }) };
      }

      const result = await pool.query(
        `UPDATE lr_call_logs SET
          status = COALESCE($1, status),
          duration = COALESCE($2, duration),
          recording_url = COALESCE($3, recording_url),
          transcript = COALESCE($4, transcript),
          outcome = COALESCE($5, outcome),
          email_collected = COALESCE($6, email_collected),
          notes = COALESCE($7, notes),
          updated_at = NOW()
         WHERE id = $8 AND user_id = $9 RETURNING *`,
        [status, duration, recordingUrl, transcript, outcome, emailCollected, notes, id, userId]
      );

      if (result.rows.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Call log not found' }) };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, callLog: result.rows[0] })
      };
    } catch (error) {
      console.error('Update call log error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
