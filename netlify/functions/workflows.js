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

// Auto-create workflow tables if they don't exist
let tablesEnsured = false;
async function ensureWorkflowTables() {
  if (tablesEnsured) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_workflows (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        status VARCHAR(20) DEFAULT 'draft',
        trigger_type VARCHAR(50) NOT NULL,
        trigger_config JSONB DEFAULT '{}',
        nodes JSONB DEFAULT '[]',
        edges JSONB DEFAULT '[]',
        settings JSONB DEFAULT '{}',
        stats JSONB DEFAULT '{"enrolled": 0, "completed": 0, "active": 0}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_workflow_executions (
        id BIGSERIAL PRIMARY KEY,
        workflow_id BIGINT NOT NULL,
        user_id BIGINT NOT NULL,
        contact_id BIGINT,
        status VARCHAR(20) DEFAULT 'running',
        current_node VARCHAR(50),
        execution_data JSONB DEFAULT '{}',
        started_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        next_action_at TIMESTAMPTZ,
        error TEXT
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_workflow_logs (
        id BIGSERIAL PRIMARY KEY,
        execution_id BIGINT NOT NULL,
        node_id VARCHAR(50),
        action_type VARCHAR(50),
        status VARCHAR(20),
        input_data JSONB,
        output_data JSONB,
        error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    tablesEnsured = true;
  } catch (e) {
    console.error('ensureWorkflowTables error (non-fatal):', e.message);
    tablesEnsured = true;
  }
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const decoded = verifyToken(event.headers.authorization);
  if (!decoded) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  // Ensure workflow tables exist
  await ensureWorkflowTables();

  const userId = decoded.userId;

  // ─── GET - List workflows or get single workflow ───
  if (event.httpMethod === 'GET') {
    try {
      const params = event.queryStringParameters || {};

      // Single workflow by id
      if (params.id) {
        const result = await pool.query(
          'SELECT * FROM lr_workflows WHERE id = $1 AND user_id = $2',
          [params.id, userId]
        );

        if (result.rows.length === 0) {
          return { statusCode: 404, headers, body: JSON.stringify({ error: 'Workflow not found' }) };
        }

        // Get execution stats
        const statsResult = await pool.query(
          `SELECT
            COUNT(*) as total_executions,
            COUNT(CASE WHEN status = 'running' THEN 1 END) as active,
            COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
            COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
            COUNT(CASE WHEN status = 'waiting' THEN 1 END) as waiting
           FROM lr_workflow_executions WHERE workflow_id = $1`,
          [params.id]
        );

        // Get recent executions
        const recentExecs = await pool.query(
          `SELECT e.id, e.contact_id, e.status, e.current_node, e.started_at, e.completed_at, e.error,
                  l.business_name as contact_name, l.email as contact_email
           FROM lr_workflow_executions e
           LEFT JOIN lr_leads l ON e.contact_id = l.id
           WHERE e.workflow_id = $1
           ORDER BY e.started_at DESC
           LIMIT 20`,
          [params.id]
        );

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            workflow: result.rows[0],
            executionStats: statsResult.rows[0] || {},
            recentExecutions: recentExecs.rows
          })
        };
      }

      // List all workflows with stats
      const result = await pool.query(
        `SELECT w.*,
          COALESCE(e.total_executions, 0) as total_executions,
          COALESCE(e.active_count, 0) as active_count,
          COALESCE(e.completed_count, 0) as completed_count
         FROM lr_workflows w
         LEFT JOIN LATERAL (
           SELECT
             COUNT(*) as total_executions,
             COUNT(CASE WHEN status = 'running' OR status = 'waiting' THEN 1 END) as active_count,
             COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count
           FROM lr_workflow_executions WHERE workflow_id = w.id
         ) e ON true
         WHERE w.user_id = $1
         ORDER BY w.updated_at DESC`,
        [userId]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, workflows: result.rows })
      };
    } catch (error) {
      console.error('List workflows error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  // ─── POST - Create new workflow ───
  if (event.httpMethod === 'POST') {
    try {
      const { name, description, triggerType, triggerConfig, nodes, edges, settings } = JSON.parse(event.body);

      if (!name) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Workflow name is required' }) };
      }
      if (!triggerType) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Trigger type is required' }) };
      }

      const result = await pool.query(
        `INSERT INTO lr_workflows
          (user_id, name, description, trigger_type, trigger_config, nodes, edges, settings)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          userId, name, description || null, triggerType,
          JSON.stringify(triggerConfig || {}),
          JSON.stringify(nodes || []),
          JSON.stringify(edges || []),
          JSON.stringify(settings || {})
        ]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, workflow: result.rows[0], message: 'Workflow created' })
      };
    } catch (error) {
      console.error('Create workflow error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  // ─── PUT - Update workflow (nodes, edges, trigger, settings) ───
  if (event.httpMethod === 'PUT') {
    try {
      const { id, name, description, triggerType, triggerConfig, nodes, edges, settings } = JSON.parse(event.body);

      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Workflow ID is required' }) };
      }

      // Verify ownership
      const check = await pool.query(
        'SELECT id, status FROM lr_workflows WHERE id = $1 AND user_id = $2',
        [id, userId]
      );
      if (check.rows.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Workflow not found' }) };
      }

      const result = await pool.query(
        `UPDATE lr_workflows SET
          name = COALESCE($1, name),
          description = COALESCE($2, description),
          trigger_type = COALESCE($3, trigger_type),
          trigger_config = COALESCE($4, trigger_config),
          nodes = COALESCE($5, nodes),
          edges = COALESCE($6, edges),
          settings = COALESCE($7, settings),
          updated_at = NOW()
         WHERE id = $8 AND user_id = $9 RETURNING *`,
        [
          name || null,
          description !== undefined ? description : null,
          triggerType || null,
          triggerConfig ? JSON.stringify(triggerConfig) : null,
          nodes ? JSON.stringify(nodes) : null,
          edges ? JSON.stringify(edges) : null,
          settings ? JSON.stringify(settings) : null,
          id, userId
        ]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, workflow: result.rows[0], message: 'Workflow updated' })
      };
    } catch (error) {
      console.error('Update workflow error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  // ─── PATCH - Update workflow status (activate/pause/draft) ───
  if (event.httpMethod === 'PATCH') {
    try {
      const { id, status } = JSON.parse(event.body);

      if (!id || !status) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Workflow ID and status are required' }) };
      }

      const validStatuses = ['draft', 'active', 'paused'];
      if (!validStatuses.includes(status)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` }) };
      }

      // Verify ownership and get current state
      const check = await pool.query(
        'SELECT id, nodes, trigger_type FROM lr_workflows WHERE id = $1 AND user_id = $2',
        [id, userId]
      );
      if (check.rows.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Workflow not found' }) };
      }

      // If activating, validate the workflow has at least a trigger and one action
      if (status === 'active') {
        const workflow = check.rows[0];
        const nodes = typeof workflow.nodes === 'string' ? JSON.parse(workflow.nodes) : (workflow.nodes || []);
        if (nodes.length < 2) {
          return {
            statusCode: 400, headers,
            body: JSON.stringify({ error: 'Workflow must have at least a trigger and one action node to activate' })
          };
        }
      }

      const result = await pool.query(
        `UPDATE lr_workflows SET status = $1, updated_at = NOW()
         WHERE id = $2 AND user_id = $3 RETURNING *`,
        [status, id, userId]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, workflow: result.rows[0], message: `Workflow ${status}` })
      };
    } catch (error) {
      console.error('Update workflow status error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  // ─── DELETE - Delete workflow ───
  if (event.httpMethod === 'DELETE') {
    try {
      const { id } = JSON.parse(event.body);

      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Workflow ID is required' }) };
      }

      // Delete executions and logs first (cascade should handle it, but be explicit)
      await pool.query(
        `DELETE FROM lr_workflow_logs WHERE execution_id IN
          (SELECT id FROM lr_workflow_executions WHERE workflow_id = $1 AND user_id = $2)`,
        [id, userId]
      );
      await pool.query(
        'DELETE FROM lr_workflow_executions WHERE workflow_id = $1 AND user_id = $2',
        [id, userId]
      );

      const result = await pool.query(
        'DELETE FROM lr_workflows WHERE id = $1 AND user_id = $2 RETURNING id',
        [id, userId]
      );

      if (result.rows.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Workflow not found' }) };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: 'Workflow deleted' })
      };
    } catch (error) {
      console.error('Delete workflow error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
