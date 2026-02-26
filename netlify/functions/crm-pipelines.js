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
    // GET - List all pipelines with stages
    // ==========================================
    if (event.httpMethod === 'GET') {
      const pipelineId = event.queryStringParameters?.id;

      if (pipelineId) {
        // Get single pipeline with stages
        const pipelineResult = await pool.query(
          `SELECT * FROM lr_crm_pipelines WHERE id = $1 AND user_id = $2`,
          [pipelineId, userId]
        );

        if (pipelineResult.rows.length === 0) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Pipeline not found' })
          };
        }

        const stagesResult = await pool.query(
          `SELECT * FROM lr_crm_stages WHERE pipeline_id = $1 ORDER BY sort_order ASC`,
          [pipelineId]
        );

        // Get deal counts per stage
        const dealCountsResult = await pool.query(
          `SELECT stage_id, COUNT(*) as count, SUM(value) as total_value
           FROM lr_crm_deals WHERE pipeline_id = $1 AND status = 'open'
           GROUP BY stage_id`,
          [pipelineId]
        );

        const dealCounts = {};
        dealCountsResult.rows.forEach(row => {
          dealCounts[row.stage_id] = {
            count: parseInt(row.count),
            totalValue: parseFloat(row.total_value) || 0
          };
        });

        const pipeline = pipelineResult.rows[0];
        pipeline.stages = stagesResult.rows.map(stage => ({
          ...stage,
          dealCount: dealCounts[stage.id]?.count || 0,
          totalValue: dealCounts[stage.id]?.totalValue || 0
        }));

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, pipeline })
        };
      }

      // List all pipelines with stages and counts
      const pipelinesResult = await pool.query(
        `SELECT * FROM lr_crm_pipelines WHERE user_id = $1 ORDER BY sort_order ASC, created_at ASC`,
        [userId]
      );

      const pipelines = [];
      for (const pipeline of pipelinesResult.rows) {
        const stagesResult = await pool.query(
          `SELECT * FROM lr_crm_stages WHERE pipeline_id = $1 ORDER BY sort_order ASC`,
          [pipeline.id]
        );

        const dealCountResult = await pool.query(
          `SELECT COUNT(*) as count, SUM(value) as total_value
           FROM lr_crm_deals WHERE pipeline_id = $1 AND status = 'open'`,
          [pipeline.id]
        );

        pipelines.push({
          ...pipeline,
          stages: stagesResult.rows,
          dealCount: parseInt(dealCountResult.rows[0].count) || 0,
          totalValue: parseFloat(dealCountResult.rows[0].total_value) || 0
        });
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, pipelines })
      };
    }

    // ==========================================
    // POST - Create new pipeline
    // ==========================================
    if (event.httpMethod === 'POST') {
      const { name, description, color, stages, isDefault } = JSON.parse(event.body);

      if (!name) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Pipeline name is required' })
        };
      }

      // If setting as default, unset other defaults
      if (isDefault) {
        await pool.query(
          `UPDATE lr_crm_pipelines SET is_default = false WHERE user_id = $1`,
          [userId]
        );
      }

      // Get next sort order
      const sortResult = await pool.query(
        `SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order FROM lr_crm_pipelines WHERE user_id = $1`,
        [userId]
      );
      const sortOrder = sortResult.rows[0].next_order;

      // Check if this is the first pipeline (make it default)
      const countResult = await pool.query(
        `SELECT COUNT(*) FROM lr_crm_pipelines WHERE user_id = $1`,
        [userId]
      );
      const makeDefault = parseInt(countResult.rows[0].count) === 0 || isDefault;

      // Create pipeline
      const pipelineResult = await pool.query(
        `INSERT INTO lr_crm_pipelines (user_id, name, description, color, is_default, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [userId, name, description || null, color || '#ff3e00', makeDefault, sortOrder]
      );

      const pipeline = pipelineResult.rows[0];

      // Create default stages if none provided
      const defaultStages = stages || [
        { name: 'New Lead', color: '#666666' },
        { name: 'Contacted', color: '#3b82f6' },
        { name: 'Qualified', color: '#f59e0b' },
        { name: 'Proposal', color: '#8b5cf6' },
        { name: 'Negotiation', color: '#ec4899' },
        { name: 'Won', color: '#22c55e' }
      ];

      const createdStages = [];
      for (let i = 0; i < defaultStages.length; i++) {
        const stage = defaultStages[i];
        const stageResult = await pool.query(
          `INSERT INTO lr_crm_stages (pipeline_id, name, color, sort_order, win_probability)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [pipeline.id, stage.name, stage.color || '#333333', i, stage.winProbability || Math.round((i / defaultStages.length) * 100)]
        );
        createdStages.push(stageResult.rows[0]);
      }

      pipeline.stages = createdStages;

      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Pipeline created successfully',
          pipeline
        })
      };
    }

    // ==========================================
    // PUT - Update pipeline
    // ==========================================
    if (event.httpMethod === 'PUT') {
      const { id, name, description, color, isDefault, sortOrder } = JSON.parse(event.body);

      if (!id) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Pipeline ID is required' })
        };
      }

      // Verify ownership
      const checkResult = await pool.query(
        `SELECT id FROM lr_crm_pipelines WHERE id = $1 AND user_id = $2`,
        [id, userId]
      );

      if (checkResult.rows.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Pipeline not found' })
        };
      }

      // If setting as default, unset other defaults
      if (isDefault) {
        await pool.query(
          `UPDATE lr_crm_pipelines SET is_default = false WHERE user_id = $1 AND id != $2`,
          [userId, id]
        );
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
      if (color !== undefined) {
        updates.push(`color = $${paramIndex}`);
        values.push(color);
        paramIndex++;
      }
      if (isDefault !== undefined) {
        updates.push(`is_default = $${paramIndex}`);
        values.push(isDefault);
        paramIndex++;
      }
      if (sortOrder !== undefined) {
        updates.push(`sort_order = $${paramIndex}`);
        values.push(sortOrder);
        paramIndex++;
      }

      updates.push('updated_at = NOW()');
      values.push(id);

      const updateResult = await pool.query(
        `UPDATE lr_crm_pipelines SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
        values
      );

      // Get stages
      const stagesResult = await pool.query(
        `SELECT * FROM lr_crm_stages WHERE pipeline_id = $1 ORDER BY sort_order ASC`,
        [id]
      );

      const pipeline = updateResult.rows[0];
      pipeline.stages = stagesResult.rows;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Pipeline updated successfully',
          pipeline
        })
      };
    }

    // ==========================================
    // DELETE - Delete pipeline
    // ==========================================
    if (event.httpMethod === 'DELETE') {
      const { id, moveDealsTo } = JSON.parse(event.body || '{}');
      const pipelineId = id || event.queryStringParameters?.id;

      if (!pipelineId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Pipeline ID is required' })
        };
      }

      // Verify ownership
      const checkResult = await pool.query(
        `SELECT id, is_default FROM lr_crm_pipelines WHERE id = $1 AND user_id = $2`,
        [pipelineId, userId]
      );

      if (checkResult.rows.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Pipeline not found' })
        };
      }

      // Check for deals in this pipeline
      const dealsResult = await pool.query(
        `SELECT COUNT(*) FROM lr_crm_deals WHERE pipeline_id = $1`,
        [pipelineId]
      );

      const dealCount = parseInt(dealsResult.rows[0].count);

      if (dealCount > 0) {
        if (moveDealsTo) {
          // Move deals to another pipeline
          const targetPipeline = await pool.query(
            `SELECT id FROM lr_crm_pipelines WHERE id = $1 AND user_id = $2`,
            [moveDealsTo, userId]
          );

          if (targetPipeline.rows.length === 0) {
            return {
              statusCode: 400,
              headers,
              body: JSON.stringify({ error: 'Target pipeline not found' })
            };
          }

          // Get first stage of target pipeline
          const firstStage = await pool.query(
            `SELECT id FROM lr_crm_stages WHERE pipeline_id = $1 ORDER BY sort_order ASC LIMIT 1`,
            [moveDealsTo]
          );

          await pool.query(
            `UPDATE lr_crm_deals SET pipeline_id = $1, stage_id = $2, updated_at = NOW() WHERE pipeline_id = $3`,
            [moveDealsTo, firstStage.rows[0]?.id || null, pipelineId]
          );
        } else {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({
              error: 'Pipeline has deals',
              dealCount,
              message: 'Provide moveDealsTo parameter to move deals to another pipeline, or delete deals first'
            })
          };
        }
      }

      // Delete stages first
      await pool.query(`DELETE FROM lr_crm_stages WHERE pipeline_id = $1`, [pipelineId]);

      // Delete pipeline
      await pool.query(`DELETE FROM lr_crm_pipelines WHERE id = $1`, [pipelineId]);

      // If deleted was default, set another as default
      if (checkResult.rows[0].is_default) {
        await pool.query(
          `UPDATE lr_crm_pipelines SET is_default = true
           WHERE user_id = $1 AND id = (SELECT id FROM lr_crm_pipelines WHERE user_id = $1 ORDER BY sort_order ASC LIMIT 1)`,
          [userId]
        );
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Pipeline deleted successfully',
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
    console.error('CRM Pipelines error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server error', message: error.message })
    };
  }
};
