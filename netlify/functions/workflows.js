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
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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

  try {
    // ==========================================
    // GET - List workflows or get single workflow with actions
    // ==========================================
    if (event.httpMethod === 'GET') {
      const workflowId = event.queryStringParameters?.id;

      if (workflowId) {
        // Get single workflow with actions
        const workflowResult = await pool.query(
          `SELECT * FROM lr_workflows WHERE id = $1 AND user_id = $2`,
          [workflowId, userId]
        );

        if (workflowResult.rows.length === 0) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Workflow not found' })
          };
        }

        const workflow = workflowResult.rows[0];

        // Parse trigger config
        if (workflow.trigger_config && typeof workflow.trigger_config === 'string') {
          try {
            workflow.trigger_config = JSON.parse(workflow.trigger_config);
          } catch (e) {
            workflow.trigger_config = {};
          }
        }

        // Get actions for this workflow
        const actionsResult = await pool.query(
          `SELECT * FROM lr_workflow_actions WHERE workflow_id = $1 ORDER BY sort_order ASC`,
          [workflowId]
        );

        const actions = actionsResult.rows.map(action => {
          if (action.action_config && typeof action.action_config === 'string') {
            try {
              action.action_config = JSON.parse(action.action_config);
            } catch (e) {
              action.action_config = {};
            }
          }
          return action;
        });

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            workflow: {
              ...workflow,
              actions
            }
          })
        };
      }

      // List all workflows
      const result = await pool.query(
        `SELECT w.*,
                (SELECT COUNT(*) FROM lr_workflow_actions WHERE workflow_id = w.id) as action_count,
                (SELECT COUNT(*) FROM lr_workflow_executions WHERE workflow_id = w.id AND status = 'running') as running_count
         FROM lr_workflows w
         WHERE w.user_id = $1
         ORDER BY w.created_at DESC`,
        [userId]
      );

      const workflows = result.rows.map(w => {
        if (w.trigger_config && typeof w.trigger_config === 'string') {
          try {
            w.trigger_config = JSON.parse(w.trigger_config);
          } catch (e) {
            w.trigger_config = {};
          }
        }
        return {
          ...w,
          action_count: parseInt(w.action_count),
          running_count: parseInt(w.running_count)
        };
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          workflows
        })
      };
    }

    // ==========================================
    // POST - Create new workflow with actions
    // ==========================================
    if (event.httpMethod === 'POST') {
      const {
        name,
        description,
        triggerType, // 'deal_created', 'stage_changed', 'email_opened', 'time_delay', 'call_completed'
        triggerConfig, // e.g., { stageId: 123 } for stage_changed trigger
        actions, // Array of actions
        isActive
      } = JSON.parse(event.body);

      if (!name || !triggerType) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Name and trigger type are required' })
        };
      }

      // Validate trigger type
      const validTriggers = ['deal_created', 'stage_changed', 'deal_won', 'deal_lost', 'time_in_stage', 'email_opened', 'email_clicked', 'call_completed'];
      if (!validTriggers.includes(triggerType)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: `Invalid trigger type. Must be one of: ${validTriggers.join(', ')}` })
        };
      }

      // Create workflow
      const workflowResult = await pool.query(
        `INSERT INTO lr_workflows (user_id, name, description, trigger_type, trigger_config, is_active)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [userId, name, description || null, triggerType, JSON.stringify(triggerConfig || {}), isActive !== false]
      );

      const workflow = workflowResult.rows[0];

      // Create actions if provided
      if (actions && Array.isArray(actions) && actions.length > 0) {
        for (let i = 0; i < actions.length; i++) {
          const action = actions[i];
          await pool.query(
            `INSERT INTO lr_workflow_actions (workflow_id, action_type, action_config, sort_order, delay_minutes)
             VALUES ($1, $2, $3, $4, $5)`,
            [workflow.id, action.actionType, JSON.stringify(action.actionConfig || {}), i, action.delayMinutes || 0]
          );
        }
      }

      // Reload with actions
      const fullWorkflow = await loadWorkflowWithActions(workflow.id);

      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Workflow created successfully',
          workflow: fullWorkflow
        })
      };
    }

    // ==========================================
    // PUT - Update workflow and/or actions
    // ==========================================
    if (event.httpMethod === 'PUT') {
      const {
        id,
        name,
        description,
        triggerType,
        triggerConfig,
        actions, // If provided, replaces all actions
        isActive
      } = JSON.parse(event.body);

      if (!id) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Workflow ID is required' })
        };
      }

      // Verify ownership
      const ownerCheck = await pool.query(
        `SELECT id FROM lr_workflows WHERE id = $1 AND user_id = $2`,
        [id, userId]
      );

      if (ownerCheck.rows.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Workflow not found' })
        };
      }

      // Build update query
      const updates = [];
      const values = [];
      let paramIndex = 1;

      if (name !== undefined) {
        updates.push(`name = $${paramIndex}`);
        values.push(name);
        paramIndex++;
      }
      if (description !== undefined) {
        updates.push(`description = $${paramIndex}`);
        values.push(description);
        paramIndex++;
      }
      if (triggerType !== undefined) {
        updates.push(`trigger_type = $${paramIndex}`);
        values.push(triggerType);
        paramIndex++;
      }
      if (triggerConfig !== undefined) {
        updates.push(`trigger_config = $${paramIndex}`);
        values.push(JSON.stringify(triggerConfig));
        paramIndex++;
      }
      if (isActive !== undefined) {
        updates.push(`is_active = $${paramIndex}`);
        values.push(isActive);
        paramIndex++;
      }

      if (updates.length > 0) {
        values.push(id);
        await pool.query(
          `UPDATE lr_workflows SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramIndex}`,
          values
        );
      }

      // Replace actions if provided
      if (actions !== undefined && Array.isArray(actions)) {
        // Delete existing actions
        await pool.query(`DELETE FROM lr_workflow_actions WHERE workflow_id = $1`, [id]);

        // Insert new actions
        for (let i = 0; i < actions.length; i++) {
          const action = actions[i];
          await pool.query(
            `INSERT INTO lr_workflow_actions (workflow_id, action_type, action_config, sort_order, delay_minutes)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, action.actionType, JSON.stringify(action.actionConfig || {}), i, action.delayMinutes || 0]
          );
        }
      }

      // Reload with actions
      const fullWorkflow = await loadWorkflowWithActions(id);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Workflow updated successfully',
          workflow: fullWorkflow
        })
      };
    }

    // ==========================================
    // DELETE - Delete workflow
    // ==========================================
    if (event.httpMethod === 'DELETE') {
      const { id } = JSON.parse(event.body || '{}');
      const workflowId = id || event.queryStringParameters?.id;

      if (!workflowId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Workflow ID is required' })
        };
      }

      // Verify ownership
      const ownerCheck = await pool.query(
        `SELECT id FROM lr_workflows WHERE id = $1 AND user_id = $2`,
        [workflowId, userId]
      );

      if (ownerCheck.rows.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Workflow not found' })
        };
      }

      // Cancel any running executions
      await pool.query(
        `UPDATE lr_workflow_executions SET status = 'cancelled', completed_at = NOW()
         WHERE workflow_id = $1 AND status = 'running'`,
        [workflowId]
      );

      // Delete actions (cascades with foreign key)
      await pool.query(`DELETE FROM lr_workflow_actions WHERE workflow_id = $1`, [workflowId]);

      // Delete workflow
      await pool.query(`DELETE FROM lr_workflows WHERE id = $1`, [workflowId]);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Workflow deleted successfully'
        })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };

  } catch (error) {
    console.error('Workflows error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server error', message: error.message })
    };
  }
};

// Helper function to load workflow with actions
async function loadWorkflowWithActions(workflowId) {
  const workflowResult = await pool.query(
    `SELECT * FROM lr_workflows WHERE id = $1`,
    [workflowId]
  );

  if (workflowResult.rows.length === 0) return null;

  const workflow = workflowResult.rows[0];

  if (workflow.trigger_config && typeof workflow.trigger_config === 'string') {
    try {
      workflow.trigger_config = JSON.parse(workflow.trigger_config);
    } catch (e) {
      workflow.trigger_config = {};
    }
  }

  const actionsResult = await pool.query(
    `SELECT * FROM lr_workflow_actions WHERE workflow_id = $1 ORDER BY sort_order ASC`,
    [workflowId]
  );

  const actions = actionsResult.rows.map(action => {
    if (action.action_config && typeof action.action_config === 'string') {
      try {
        action.action_config = JSON.parse(action.action_config);
      } catch (e) {
        action.action_config = {};
      }
    }
    return action;
  });

  return {
    ...workflow,
    actions
  };
}
