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

  // Helper to verify pipeline ownership
  async function verifyPipelineOwnership(pipelineId) {
    const result = await pool.query(
      `SELECT id FROM lr_crm_pipelines WHERE id = $1 AND user_id = $2`,
      [pipelineId, userId]
    );
    return result.rows.length > 0;
  }

  try {
    // ==========================================
    // GET - List stages for a pipeline
    // ==========================================
    if (event.httpMethod === 'GET') {
      const pipelineId = event.queryStringParameters?.pipelineId;

      if (!pipelineId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Pipeline ID is required' })
        };
      }

      if (!(await verifyPipelineOwnership(pipelineId))) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Pipeline not found' })
        };
      }

      const stagesResult = await pool.query(
        `SELECT s.*,
                COUNT(d.id) as deal_count,
                COALESCE(SUM(d.value), 0) as total_value
         FROM lr_crm_stages s
         LEFT JOIN lr_crm_deals d ON d.stage_id = s.id AND d.status = 'open'
         WHERE s.pipeline_id = $1
         GROUP BY s.id
         ORDER BY s.sort_order ASC`,
        [pipelineId]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          stages: stagesResult.rows.map(s => ({
            ...s,
            deal_count: parseInt(s.deal_count),
            total_value: parseFloat(s.total_value)
          }))
        })
      };
    }

    // ==========================================
    // POST - Create new stage
    // ==========================================
    if (event.httpMethod === 'POST') {
      const { pipelineId, name, color, winProbability, autoMoveDays } = JSON.parse(event.body);

      if (!pipelineId || !name) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Pipeline ID and stage name are required' })
        };
      }

      if (!(await verifyPipelineOwnership(pipelineId))) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Pipeline not found' })
        };
      }

      // Get next sort order
      const sortResult = await pool.query(
        `SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order FROM lr_crm_stages WHERE pipeline_id = $1`,
        [pipelineId]
      );
      const sortOrder = sortResult.rows[0].next_order;

      const stageResult = await pool.query(
        `INSERT INTO lr_crm_stages (pipeline_id, name, color, sort_order, win_probability, auto_move_days)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [pipelineId, name, color || '#333333', sortOrder, winProbability || 0, autoMoveDays || null]
      );

      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Stage created successfully',
          stage: stageResult.rows[0]
        })
      };
    }

    // ==========================================
    // PUT - Update stage or reorder stages
    // ==========================================
    if (event.httpMethod === 'PUT') {
      const body = JSON.parse(event.body);

      // Handle bulk reorder
      if (body.reorder && Array.isArray(body.stages)) {
        const { pipelineId, stages } = body;

        if (!(await verifyPipelineOwnership(pipelineId))) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Pipeline not found' })
          };
        }

        // Update sort order for each stage
        for (let i = 0; i < stages.length; i++) {
          await pool.query(
            `UPDATE lr_crm_stages SET sort_order = $1 WHERE id = $2 AND pipeline_id = $3`,
            [i, stages[i].id, pipelineId]
          );
        }

        // Return updated stages
        const stagesResult = await pool.query(
          `SELECT * FROM lr_crm_stages WHERE pipeline_id = $1 ORDER BY sort_order ASC`,
          [pipelineId]
        );

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            message: 'Stages reordered successfully',
            stages: stagesResult.rows
          })
        };
      }

      // Handle single stage update
      const { id, name, color, winProbability, autoMoveDays } = body;

      if (!id) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Stage ID is required' })
        };
      }

      // Verify stage ownership through pipeline
      const stageCheck = await pool.query(
        `SELECT s.id, s.pipeline_id FROM lr_crm_stages s
         JOIN lr_crm_pipelines p ON p.id = s.pipeline_id
         WHERE s.id = $1 AND p.user_id = $2`,
        [id, userId]
      );

      if (stageCheck.rows.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Stage not found' })
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
      if (color !== undefined) {
        updates.push(`color = $${paramIndex}`);
        values.push(color);
        paramIndex++;
      }
      if (winProbability !== undefined) {
        updates.push(`win_probability = $${paramIndex}`);
        values.push(winProbability);
        paramIndex++;
      }
      if (autoMoveDays !== undefined) {
        updates.push(`auto_move_days = $${paramIndex}`);
        values.push(autoMoveDays);
        paramIndex++;
      }

      if (updates.length === 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'No fields to update' })
        };
      }

      values.push(id);

      const updateResult = await pool.query(
        `UPDATE lr_crm_stages SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
        values
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Stage updated successfully',
          stage: updateResult.rows[0]
        })
      };
    }

    // ==========================================
    // DELETE - Delete stage
    // ==========================================
    if (event.httpMethod === 'DELETE') {
      const { id, moveDealsTo } = JSON.parse(event.body || '{}');
      const stageId = id || event.queryStringParameters?.id;

      if (!stageId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Stage ID is required' })
        };
      }

      // Verify stage ownership and get pipeline info
      const stageCheck = await pool.query(
        `SELECT s.id, s.pipeline_id FROM lr_crm_stages s
         JOIN lr_crm_pipelines p ON p.id = s.pipeline_id
         WHERE s.id = $1 AND p.user_id = $2`,
        [stageId, userId]
      );

      if (stageCheck.rows.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Stage not found' })
        };
      }

      const pipelineId = stageCheck.rows[0].pipeline_id;

      // Check for deals in this stage
      const dealsResult = await pool.query(
        `SELECT COUNT(*) FROM lr_crm_deals WHERE stage_id = $1`,
        [stageId]
      );

      const dealCount = parseInt(dealsResult.rows[0].count);

      if (dealCount > 0) {
        if (moveDealsTo) {
          // Verify target stage is in same pipeline
          const targetCheck = await pool.query(
            `SELECT id FROM lr_crm_stages WHERE id = $1 AND pipeline_id = $2`,
            [moveDealsTo, pipelineId]
          );

          if (targetCheck.rows.length === 0) {
            return {
              statusCode: 400,
              headers,
              body: JSON.stringify({ error: 'Target stage not found in same pipeline' })
            };
          }

          // Move deals to target stage
          await pool.query(
            `UPDATE lr_crm_deals SET stage_id = $1, updated_at = NOW() WHERE stage_id = $2`,
            [moveDealsTo, stageId]
          );
        } else {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({
              error: 'Stage has deals',
              dealCount,
              message: 'Provide moveDealsTo parameter to move deals to another stage'
            })
          };
        }
      }

      // Delete the stage
      await pool.query(`DELETE FROM lr_crm_stages WHERE id = $1`, [stageId]);

      // Reorder remaining stages
      await pool.query(
        `WITH numbered AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order) - 1 as new_order
          FROM lr_crm_stages WHERE pipeline_id = $1
        )
        UPDATE lr_crm_stages s SET sort_order = n.new_order
        FROM numbered n WHERE s.id = n.id`,
        [pipelineId]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Stage deleted successfully',
          movedDeals: dealCount > 0 && moveDealsTo ? dealCount : 0
        })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };

  } catch (error) {
    console.error('CRM Stages error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server error', message: error.message })
    };
  }
};
