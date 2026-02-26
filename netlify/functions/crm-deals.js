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

  // Helper to log activity
  async function logActivity(dealId, activityType, subject, content, metadata = {}) {
    await pool.query(
      `INSERT INTO lr_crm_activities (deal_id, user_id, activity_type, subject, content, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [dealId, userId, activityType, subject, content, JSON.stringify(metadata)]
    );
  }

  try {
    // ==========================================
    // GET - List deals or get single deal
    // ==========================================
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      const dealId = params.id;

      // Get single deal with full details
      if (dealId) {
        const dealResult = await pool.query(
          `SELECT d.*,
                  p.name as pipeline_name,
                  s.name as stage_name,
                  s.color as stage_color
           FROM lr_crm_deals d
           LEFT JOIN lr_crm_pipelines p ON p.id = d.pipeline_id
           LEFT JOIN lr_crm_stages s ON s.id = d.stage_id
           WHERE d.id = $1 AND d.user_id = $2`,
          [dealId, userId]
        );

        if (dealResult.rows.length === 0) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Deal not found' })
          };
        }

        const deal = dealResult.rows[0];

        // Get associated lead data if exists
        if (deal.lead_id) {
          const leadResult = await pool.query(
            `SELECT business_name, email, phone, address, city, state, website, industry, rating, reviews
             FROM lr_leads WHERE id = $1`,
            [deal.lead_id]
          );
          if (leadResult.rows.length > 0) {
            deal.lead = leadResult.rows[0];
          }
        }

        // Get recent activities
        const activitiesResult = await pool.query(
          `SELECT * FROM lr_crm_activities WHERE deal_id = $1 ORDER BY created_at DESC LIMIT 20`,
          [dealId]
        );
        deal.activities = activitiesResult.rows;

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, deal })
        };
      }

      // List deals with filters
      const pipelineId = params.pipelineId;
      const stageId = params.stageId;
      const status = params.status;
      const search = params.search;
      const limit = parseInt(params.limit) || 100;
      const offset = parseInt(params.offset) || 0;

      let query = `
        SELECT d.*,
               p.name as pipeline_name,
               s.name as stage_name,
               s.color as stage_color,
               l.business_name, l.email, l.phone, l.city, l.state, l.industry
        FROM lr_crm_deals d
        LEFT JOIN lr_crm_pipelines p ON p.id = d.pipeline_id
        LEFT JOIN lr_crm_stages s ON s.id = d.stage_id
        LEFT JOIN lr_leads l ON l.id = d.lead_id
        WHERE d.user_id = $1
      `;
      const values = [userId];
      let paramIndex = 2;

      if (pipelineId) {
        query += ` AND d.pipeline_id = $${paramIndex}`;
        values.push(pipelineId);
        paramIndex++;
      }

      if (stageId) {
        query += ` AND d.stage_id = $${paramIndex}`;
        values.push(stageId);
        paramIndex++;
      }

      if (status) {
        query += ` AND d.status = $${paramIndex}`;
        values.push(status);
        paramIndex++;
      }

      if (search) {
        query += ` AND (d.title ILIKE $${paramIndex} OR l.business_name ILIKE $${paramIndex} OR l.email ILIKE $${paramIndex})`;
        values.push(`%${search}%`);
        paramIndex++;
      }

      query += ` ORDER BY d.updated_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      values.push(limit, offset);

      const dealsResult = await pool.query(query, values);

      // Get total count
      let countQuery = `SELECT COUNT(*) FROM lr_crm_deals d WHERE d.user_id = $1`;
      const countValues = [userId];
      let countParamIndex = 2;

      if (pipelineId) {
        countQuery += ` AND d.pipeline_id = $${countParamIndex}`;
        countValues.push(pipelineId);
        countParamIndex++;
      }
      if (stageId) {
        countQuery += ` AND d.stage_id = $${countParamIndex}`;
        countValues.push(stageId);
        countParamIndex++;
      }
      if (status) {
        countQuery += ` AND d.status = $${countParamIndex}`;
        countValues.push(status);
        countParamIndex++;
      }

      const countResult = await pool.query(countQuery, countValues);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          deals: dealsResult.rows,
          total: parseInt(countResult.rows[0].count),
          limit,
          offset
        })
      };
    }

    // ==========================================
    // POST - Create deal (from lead or standalone)
    // ==========================================
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body);

      // Handle bulk create from leads
      if (body.bulkCreate && Array.isArray(body.leadIds)) {
        const { leadIds, pipelineId } = body;

        // Verify pipeline ownership
        const pipelineCheck = await pool.query(
          `SELECT id FROM lr_crm_pipelines WHERE id = $1 AND user_id = $2`,
          [pipelineId, userId]
        );

        if (pipelineCheck.rows.length === 0) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Pipeline not found' })
          };
        }

        // Get first stage
        const firstStage = await pool.query(
          `SELECT id FROM lr_crm_stages WHERE pipeline_id = $1 ORDER BY sort_order ASC LIMIT 1`,
          [pipelineId]
        );
        const stageId = firstStage.rows[0]?.id;

        const createdDeals = [];
        const errors = [];

        for (const leadId of leadIds) {
          try {
            // Check if lead exists and belongs to user
            const leadResult = await pool.query(
              `SELECT id, business_name, in_crm FROM lr_leads WHERE id = $1 AND user_id = $2`,
              [leadId, userId]
            );

            if (leadResult.rows.length === 0) {
              errors.push({ leadId, error: 'Lead not found' });
              continue;
            }

            if (leadResult.rows[0].in_crm) {
              errors.push({ leadId, error: 'Lead already in CRM' });
              continue;
            }

            const lead = leadResult.rows[0];

            // Create deal
            const dealResult = await pool.query(
              `INSERT INTO lr_crm_deals (user_id, lead_id, pipeline_id, stage_id, title, status, last_activity_at)
               VALUES ($1, $2, $3, $4, $5, 'open', NOW())
               RETURNING id`,
              [userId, leadId, pipelineId, stageId, lead.business_name]
            );

            // Mark lead as in CRM
            await pool.query(
              `UPDATE lr_leads SET in_crm = true, crm_deal_id = $1 WHERE id = $2`,
              [dealResult.rows[0].id, leadId]
            );

            // Log activity
            await logActivity(dealResult.rows[0].id, 'deal_created', 'Deal created', `Created from lead "${lead.business_name}"`, { leadId });

            createdDeals.push(dealResult.rows[0].id);
          } catch (e) {
            errors.push({ leadId, error: e.message });
          }
        }

        return {
          statusCode: 201,
          headers,
          body: JSON.stringify({
            success: true,
            message: `Created ${createdDeals.length} deals`,
            createdDeals,
            errors: errors.length > 0 ? errors : undefined
          })
        };
      }

      // Single deal creation
      const { leadId, pipelineId, stageId, title, value, notes, expectedCloseDate, assignedTo } = body;

      if (!pipelineId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Pipeline ID is required' })
        };
      }

      // Verify pipeline ownership
      const pipelineCheck = await pool.query(
        `SELECT id FROM lr_crm_pipelines WHERE id = $1 AND user_id = $2`,
        [pipelineId, userId]
      );

      if (pipelineCheck.rows.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Pipeline not found' })
        };
      }

      // Get stage (use provided or first stage)
      let finalStageId = stageId;
      if (!finalStageId) {
        const firstStage = await pool.query(
          `SELECT id FROM lr_crm_stages WHERE pipeline_id = $1 ORDER BY sort_order ASC LIMIT 1`,
          [pipelineId]
        );
        finalStageId = firstStage.rows[0]?.id;
      }

      let dealTitle = title;
      let leadData = null;

      // If creating from lead, get lead data
      if (leadId) {
        const leadResult = await pool.query(
          `SELECT id, business_name, in_crm FROM lr_leads WHERE id = $1 AND user_id = $2`,
          [leadId, userId]
        );

        if (leadResult.rows.length === 0) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Lead not found' })
          };
        }

        if (leadResult.rows[0].in_crm) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Lead is already in CRM' })
          };
        }

        leadData = leadResult.rows[0];
        dealTitle = dealTitle || leadData.business_name;
      }

      // Create the deal
      const dealResult = await pool.query(
        `INSERT INTO lr_crm_deals
         (user_id, lead_id, pipeline_id, stage_id, title, value, notes, expected_close_date, assigned_to, status, last_activity_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open', NOW())
         RETURNING *`,
        [userId, leadId || null, pipelineId, finalStageId, dealTitle || 'New Deal', value || 0, notes || null, expectedCloseDate || null, assignedTo || null]
      );

      const deal = dealResult.rows[0];

      // Mark lead as in CRM if from lead
      if (leadId) {
        await pool.query(
          `UPDATE lr_leads SET in_crm = true, crm_deal_id = $1 WHERE id = $2`,
          [deal.id, leadId]
        );
      }

      // Log activity
      await logActivity(deal.id, 'deal_created', 'Deal created', leadId ? `Created from lead "${dealTitle}"` : 'Deal created manually');

      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Deal created successfully',
          deal
        })
      };
    }

    // ==========================================
    // PUT - Update deal (including stage moves)
    // ==========================================
    if (event.httpMethod === 'PUT') {
      const body = JSON.parse(event.body);
      const { id, stageId, pipelineId, title, value, notes, status, expectedCloseDate, assignedTo, lostReason, tags } = body;

      if (!id) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Deal ID is required' })
        };
      }

      // Verify deal ownership and get current state
      const dealCheck = await pool.query(
        `SELECT * FROM lr_crm_deals WHERE id = $1 AND user_id = $2`,
        [id, userId]
      );

      if (dealCheck.rows.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Deal not found' })
        };
      }

      const currentDeal = dealCheck.rows[0];

      // Build update query
      const updates = ['updated_at = NOW()', 'last_activity_at = NOW()'];
      const values = [];
      let paramIndex = 1;

      // Track changes for activity log
      const changes = [];

      if (stageId !== undefined && stageId !== currentDeal.stage_id) {
        // Get stage names for activity log
        const oldStage = await pool.query(`SELECT name FROM lr_crm_stages WHERE id = $1`, [currentDeal.stage_id]);
        const newStage = await pool.query(`SELECT name FROM lr_crm_stages WHERE id = $1`, [stageId]);

        updates.push(`stage_id = $${paramIndex}`);
        values.push(stageId);
        paramIndex++;

        changes.push({
          type: 'stage_change',
          from: oldStage.rows[0]?.name,
          to: newStage.rows[0]?.name
        });
      }

      if (pipelineId !== undefined && pipelineId !== currentDeal.pipeline_id) {
        updates.push(`pipeline_id = $${paramIndex}`);
        values.push(pipelineId);
        paramIndex++;
        changes.push({ type: 'pipeline_change' });
      }

      if (title !== undefined) {
        updates.push(`title = $${paramIndex}`);
        values.push(title);
        paramIndex++;
      }

      if (value !== undefined) {
        updates.push(`value = $${paramIndex}`);
        values.push(value);
        paramIndex++;
        if (value !== currentDeal.value) {
          changes.push({ type: 'value_change', from: currentDeal.value, to: value });
        }
      }

      if (notes !== undefined) {
        updates.push(`notes = $${paramIndex}`);
        values.push(notes);
        paramIndex++;
      }

      if (expectedCloseDate !== undefined) {
        updates.push(`expected_close_date = $${paramIndex}`);
        values.push(expectedCloseDate);
        paramIndex++;
      }

      if (assignedTo !== undefined) {
        updates.push(`assigned_to = $${paramIndex}`);
        values.push(assignedTo);
        paramIndex++;
      }

      if (tags !== undefined) {
        updates.push(`tags = $${paramIndex}`);
        values.push(tags);
        paramIndex++;
      }

      if (status !== undefined && status !== currentDeal.status) {
        updates.push(`status = $${paramIndex}`);
        values.push(status);
        paramIndex++;

        if (status === 'won') {
          updates.push(`won_at = NOW()`);
          changes.push({ type: 'status_change', to: 'won' });
        } else if (status === 'lost') {
          updates.push(`lost_at = NOW()`);
          if (lostReason) {
            updates.push(`lost_reason = $${paramIndex}`);
            values.push(lostReason);
            paramIndex++;
          }
          changes.push({ type: 'status_change', to: 'lost', reason: lostReason });
        }
      }

      values.push(id);

      const updateResult = await pool.query(
        `UPDATE lr_crm_deals SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
        values
      );

      // Log activities for changes
      for (const change of changes) {
        if (change.type === 'stage_change') {
          await logActivity(id, 'stage_change', 'Stage changed', `Moved from "${change.from}" to "${change.to}"`, change);
        } else if (change.type === 'status_change') {
          const subject = change.to === 'won' ? 'Deal won!' : 'Deal lost';
          await logActivity(id, change.to === 'won' ? 'deal_won' : 'deal_lost', subject, change.reason || '', change);
        } else if (change.type === 'value_change') {
          await logActivity(id, 'value_change', 'Deal value updated', `Changed from $${change.from} to $${change.to}`, change);
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Deal updated successfully',
          deal: updateResult.rows[0],
          changes
        })
      };
    }

    // ==========================================
    // DELETE - Delete deal
    // ==========================================
    if (event.httpMethod === 'DELETE') {
      const { id } = JSON.parse(event.body || '{}');
      const dealId = id || event.queryStringParameters?.id;

      if (!dealId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Deal ID is required' })
        };
      }

      // Verify ownership and get lead_id
      const dealCheck = await pool.query(
        `SELECT id, lead_id FROM lr_crm_deals WHERE id = $1 AND user_id = $2`,
        [dealId, userId]
      );

      if (dealCheck.rows.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Deal not found' })
        };
      }

      const leadId = dealCheck.rows[0].lead_id;

      // Delete activities first
      await pool.query(`DELETE FROM lr_crm_activities WHERE deal_id = $1`, [dealId]);

      // Delete the deal
      await pool.query(`DELETE FROM lr_crm_deals WHERE id = $1`, [dealId]);

      // If was from lead, unmark lead
      if (leadId) {
        await pool.query(
          `UPDATE lr_leads SET in_crm = false, crm_deal_id = NULL WHERE id = $1`,
          [leadId]
        );
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Deal deleted successfully'
        })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };

  } catch (error) {
    console.error('CRM Deals error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server error', message: error.message })
    };
  }
};
