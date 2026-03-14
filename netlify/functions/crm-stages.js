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

// Ensure the position column exists (handles tables created before migration)
let positionColumnEnsured = false;
async function ensurePositionColumn() {
  if (positionColumnEnsured) return;
  try {
    await pool.query(`
      ALTER TABLE lr_crm_stages ADD COLUMN IF NOT EXISTS position INTEGER DEFAULT 0
    `);
    await pool.query(`
      ALTER TABLE lr_crm_stages ADD COLUMN IF NOT EXISTS color VARCHAR(20) DEFAULT '#4a9eff'
    `);
    positionColumnEnsured = true;
  } catch (e) {
    console.error('ensurePositionColumn error (non-fatal):', e.message);
    positionColumnEnsured = true; // Don't retry on error
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

  // Ensure position column exists before any query
  await ensurePositionColumn();

  // GET - List stages for a pipeline
  if (event.httpMethod === 'GET') {
    try {
      const params = event.queryStringParameters || {};
      const pipelineId = params.pipelineId;

      if (!pipelineId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'pipelineId query parameter is required' }) };
      }

      // Verify the pipeline belongs to the user
      const pipelineCheck = await pool.query(
        'SELECT id FROM lr_crm_pipelines WHERE id = $1 AND user_id = $2',
        [pipelineId, decoded.userId]
      );

      if (pipelineCheck.rows.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Pipeline not found' }) };
      }

      const result = await pool.query(
        `SELECT id, pipeline_id, name, position, color, created_at
         FROM lr_crm_stages WHERE pipeline_id = $1 ORDER BY position ASC`,
        [pipelineId]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, stages: result.rows })
      };
    } catch (error) {
      console.error('List stages error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
