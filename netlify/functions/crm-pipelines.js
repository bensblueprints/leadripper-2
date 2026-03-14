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

  // GET - List all pipelines for user
  if (event.httpMethod === 'GET') {
    try {
      const result = await pool.query(
        `SELECT id, user_id, name, created_at, updated_at
         FROM lr_crm_pipelines WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, pipelines: result.rows })
      };
    } catch (error) {
      console.error('List pipelines error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  // POST - Create a new pipeline with default stages
  if (event.httpMethod === 'POST') {
    try {
      const { name } = JSON.parse(event.body);

      if (!name) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Pipeline name is required' }) };
      }

      const pipelineResult = await pool.query(
        `INSERT INTO lr_crm_pipelines (user_id, name, created_at, updated_at)
         VALUES ($1, $2, NOW(), NOW()) RETURNING *`,
        [userId, name]
      );

      const pipeline = pipelineResult.rows[0];

      // Create default stages
      const defaultStages = [
        { name: 'New', position: 0, color: '#4a9eff' },
        { name: 'Contacted', position: 1, color: '#f59e0b' },
        { name: 'Qualified', position: 2, color: '#8b5cf6' },
        { name: 'Proposal', position: 3, color: '#ec4899' },
        { name: 'Won', position: 4, color: '#10b981' },
        { name: 'Lost', position: 5, color: '#ef4444' }
      ];

      for (const stage of defaultStages) {
        await pool.query(
          `INSERT INTO lr_crm_stages (pipeline_id, name, position, color, created_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [pipeline.id, stage.name, stage.position, stage.color]
        );
      }

      const stagesResult = await pool.query(
        `SELECT id, pipeline_id, name, position, color, created_at
         FROM lr_crm_stages WHERE pipeline_id = $1 ORDER BY position ASC`,
        [pipeline.id]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, pipeline, stages: stagesResult.rows })
      };
    } catch (error) {
      console.error('Create pipeline error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  // PUT - Update pipeline name
  if (event.httpMethod === 'PUT') {
    try {
      const { id, name } = JSON.parse(event.body);

      if (!id || !name) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Pipeline ID and name are required' }) };
      }

      const result = await pool.query(
        `UPDATE lr_crm_pipelines SET name = $1, updated_at = NOW()
         WHERE id = $2 AND user_id = $3 RETURNING *`,
        [name, id, userId]
      );

      if (result.rows.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Pipeline not found' }) };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, pipeline: result.rows[0] })
      };
    } catch (error) {
      console.error('Update pipeline error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  // DELETE - Delete pipeline (cascades to stages and deals)
  if (event.httpMethod === 'DELETE') {
    try {
      const { id } = JSON.parse(event.body);

      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Pipeline ID is required' }) };
      }

      const result = await pool.query(
        'DELETE FROM lr_crm_pipelines WHERE id = $1 AND user_id = $2 RETURNING id',
        [id, userId]
      );

      if (result.rows.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Pipeline not found' }) };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: 'Pipeline deleted' })
      };
    } catch (error) {
      console.error('Delete pipeline error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
