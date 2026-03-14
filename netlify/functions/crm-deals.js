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

  // GET - Get single deal (with activities) or list deals for a pipeline
  if (event.httpMethod === 'GET') {
    try {
      const params = event.queryStringParameters || {};

      // Single deal with activities
      if (params.id) {
        const dealResult = await pool.query(
          `SELECT d.id, d.pipeline_id, d.stage_id, d.title, d.value,
                  d.contact_name, d.contact_email, d.contact_phone,
                  d.notes, d.expected_close_date, d.created_at, d.updated_at
           FROM lr_crm_deals d
           JOIN lr_crm_pipelines p ON d.pipeline_id = p.id
           WHERE d.id = $1 AND p.user_id = $2`,
          [params.id, userId]
        );

        if (dealResult.rows.length === 0) {
          return { statusCode: 404, headers, body: JSON.stringify({ error: 'Deal not found' }) };
        }

        const activitiesResult = await pool.query(
          `SELECT id, deal_id, user_id, type, content, created_at
           FROM lr_crm_activities WHERE deal_id = $1 ORDER BY created_at DESC`,
          [params.id]
        );

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            deal: dealResult.rows[0],
            activities: activitiesResult.rows
          })
        };
      }

      // List deals for a pipeline
      const pipelineId = params.pipelineId;
      if (!pipelineId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'pipelineId or id query parameter is required' }) };
      }

      // Verify the pipeline belongs to the user
      const pipelineCheck = await pool.query(
        'SELECT id FROM lr_crm_pipelines WHERE id = $1 AND user_id = $2',
        [pipelineId, userId]
      );

      if (pipelineCheck.rows.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Pipeline not found' }) };
      }

      const result = await pool.query(
        `SELECT id, pipeline_id, stage_id, title, value,
                contact_name, contact_email, contact_phone,
                notes, expected_close_date, created_at, updated_at
         FROM lr_crm_deals WHERE pipeline_id = $1 ORDER BY created_at DESC`,
        [pipelineId]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, deals: result.rows })
      };
    } catch (error) {
      console.error('Get deals error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  // POST - Create a new deal
  if (event.httpMethod === 'POST') {
    try {
      const { pipelineId, stageId, title, value, contactName, contactEmail, contactPhone, notes, expectedCloseDate } = JSON.parse(event.body);

      if (!pipelineId || !title) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'pipelineId and title are required' }) };
      }

      // Verify the pipeline belongs to the user
      const pipelineCheck = await pool.query(
        'SELECT id FROM lr_crm_pipelines WHERE id = $1 AND user_id = $2',
        [pipelineId, userId]
      );

      if (pipelineCheck.rows.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Pipeline not found' }) };
      }

      const result = await pool.query(
        `INSERT INTO lr_crm_deals
          (pipeline_id, stage_id, user_id, title, value, contact_name, contact_email, contact_phone, notes, expected_close_date, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW()) RETURNING *`,
        [pipelineId, stageId || null, userId, title, value || 0, contactName || null, contactEmail || null, contactPhone || null, notes || null, expectedCloseDate || null]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, deal: result.rows[0] })
      };
    } catch (error) {
      console.error('Create deal error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  // PUT - Update a deal (also used for dragging between stages)
  if (event.httpMethod === 'PUT') {
    try {
      const { id, stageId, title, value, contactName, contactEmail, contactPhone, notes, expectedCloseDate } = JSON.parse(event.body);

      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Deal ID is required' }) };
      }

      // Verify the deal belongs to the user (through pipeline ownership)
      const dealCheck = await pool.query(
        `SELECT d.id FROM lr_crm_deals d
         JOIN lr_crm_pipelines p ON d.pipeline_id = p.id
         WHERE d.id = $1 AND p.user_id = $2`,
        [id, userId]
      );

      if (dealCheck.rows.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Deal not found' }) };
      }

      const result = await pool.query(
        `UPDATE lr_crm_deals SET
          stage_id = COALESCE($1, stage_id),
          title = COALESCE($2, title),
          value = COALESCE($3, value),
          contact_name = COALESCE($4, contact_name),
          contact_email = COALESCE($5, contact_email),
          contact_phone = COALESCE($6, contact_phone),
          notes = COALESCE($7, notes),
          expected_close_date = COALESCE($8, expected_close_date),
          updated_at = NOW()
         WHERE id = $9 RETURNING *`,
        [stageId, title, value, contactName, contactEmail, contactPhone, notes, expectedCloseDate, id]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, deal: result.rows[0] })
      };
    } catch (error) {
      console.error('Update deal error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  // DELETE - Delete a deal
  if (event.httpMethod === 'DELETE') {
    try {
      const { id } = JSON.parse(event.body);

      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Deal ID is required' }) };
      }

      const result = await pool.query(
        `DELETE FROM lr_crm_deals d
         USING lr_crm_pipelines p
         WHERE d.pipeline_id = p.id AND d.id = $1 AND p.user_id = $2 RETURNING d.id`,
        [id, userId]
      );

      if (result.rows.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Deal not found' }) };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: 'Deal deleted' })
      };
    } catch (error) {
      console.error('Delete deal error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
