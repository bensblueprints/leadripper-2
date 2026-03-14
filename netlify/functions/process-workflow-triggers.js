const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

// ═══════════════════════════════════════════
// TRIGGER PROCESSOR
// ═══════════════════════════════════════════
// Called by other functions when events happen.
// Checks if any active workflow matches the trigger and starts execution.
//
// Supported trigger types:
//   - contact_created        - when a new lead is saved
//   - contact_updated        - when a lead field changes
//   - tag_added              - when a tag is added to a contact
//   - tag_removed            - when a tag is removed from a contact
//   - pipeline_stage_changed - when a deal stage changes
//   - email_opened           - when a tracked email is opened
//   - email_clicked          - when a tracked email link is clicked
//   - email_replied          - when a reply is detected
//   - email_bounced          - when an email bounces
//   - call_completed         - when an AI call completes
//   - form_submitted         - inbound webhook / form submission
//   - manual                 - manually triggered from UI
//   - webhook                - external webhook trigger
//   - scheduler              - time-based (cron)

/**
 * Fire a trigger event and execute any matching active workflows.
 *
 * @param {number} userId - The user who owns the workflows
 * @param {string} triggerType - The trigger type (e.g. 'contact_created')
 * @param {object} triggerData - Context data for the trigger
 * @param {string} [token] - JWT token for downstream API calls
 * @returns {object} - Results of all triggered workflow executions
 */
async function fireTrigger(userId, triggerType, triggerData, token) {
  const results = [];

  try {
    // Find all active workflows matching this trigger type
    const workflowsResult = await pool.query(
      `SELECT id, name, trigger_type, trigger_config, nodes, edges, settings
       FROM lr_workflows
       WHERE user_id = $1 AND status = 'active' AND trigger_type = $2`,
      [userId, triggerType]
    );

    if (workflowsResult.rows.length === 0) {
      return { triggered: 0, results: [] };
    }

    for (const workflow of workflowsResult.rows) {
      try {
        // Check trigger config for additional conditions
        const triggerConfig = typeof workflow.trigger_config === 'string'
          ? JSON.parse(workflow.trigger_config)
          : (workflow.trigger_config || {});

        if (!matchesTriggerConditions(triggerType, triggerConfig, triggerData)) {
          continue;
        }

        // Determine contact ID from trigger data
        const contactId = triggerData.contactId || triggerData.leadId || triggerData.lead_id || null;

        // Check if this contact is already in a running execution of this workflow
        if (contactId) {
          const existingExec = await pool.query(
            `SELECT id FROM lr_workflow_executions
             WHERE workflow_id = $1 AND contact_id = $2 AND status IN ('running', 'waiting')
             LIMIT 1`,
            [workflow.id, contactId]
          );
          if (existingExec.rows.length > 0) {
            results.push({
              workflowId: workflow.id,
              workflowName: workflow.name,
              skipped: true,
              reason: 'Contact already in active execution'
            });
            continue;
          }
        }

        // Execute the workflow
        const { executeWorkflow } = require('./execute-workflow');
        const execResult = await executeWorkflow(workflow.id, userId, contactId, triggerData, token);

        results.push({
          workflowId: workflow.id,
          workflowName: workflow.name,
          ...execResult
        });
      } catch (error) {
        console.error(`[Trigger] Failed to execute workflow ${workflow.id}:`, error.message);
        results.push({
          workflowId: workflow.id,
          workflowName: workflow.name,
          status: 'error',
          error: error.message
        });
      }
    }

    return { triggered: results.length, results };
  } catch (error) {
    console.error('[Trigger] Fire trigger error:', error);
    throw error;
  }
}

/**
 * Check if trigger data matches the workflow's trigger conditions.
 */
function matchesTriggerConditions(triggerType, config, data) {
  // If no specific conditions, always match
  if (!config || Object.keys(config).length === 0) return true;

  switch (triggerType) {
    case 'contact_created':
    case 'contact_updated':
      // Filter by industry, city, etc.
      if (config.industry && data.industry && data.industry !== config.industry) return false;
      if (config.city && data.city && data.city !== config.city) return false;
      if (config.hasEmail && !data.email) return false;
      if (config.hasPhone && !data.phone) return false;
      return true;

    case 'tag_added':
    case 'tag_removed':
      // Match specific tag
      if (config.tag && data.tag !== config.tag) return false;
      return true;

    case 'pipeline_stage_changed':
      // Match specific pipeline and/or stage
      if (config.pipelineId && data.pipelineId !== config.pipelineId) return false;
      if (config.stageId && data.stageId !== config.stageId) return false;
      if (config.fromStageId && data.fromStageId !== config.fromStageId) return false;
      return true;

    case 'email_opened':
    case 'email_clicked':
    case 'email_replied':
    case 'email_bounced':
      // Match specific campaign
      if (config.campaignId && data.campaignId !== config.campaignId) return false;
      return true;

    case 'call_completed':
      // Match specific outcome
      if (config.outcome && data.outcome !== config.outcome) return false;
      return true;

    case 'form_submitted':
      // Match specific form
      if (config.formId && data.formId !== config.formId) return false;
      return true;

    case 'webhook':
      // Match specific webhook key
      if (config.webhookKey && data.webhookKey !== config.webhookKey) return false;
      return true;

    case 'manual':
    case 'scheduler':
      return true;

    default:
      return true;
  }
}

// ═══════════════════════════════════════════
// HTTP HANDLER (for direct webhook/manual triggers)
// ═══════════════════════════════════════════
const jwt = require('jsonwebtoken');
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

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const body = JSON.parse(event.body);
    const { triggerType, triggerData, userId: providedUserId, webhookKey } = body;

    if (!triggerType) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'triggerType is required' }) };
    }

    let userId;
    let token;

    // For webhook triggers, find user by webhook key
    if (triggerType === 'webhook' && webhookKey) {
      const wfResult = await pool.query(
        `SELECT user_id FROM lr_workflows
         WHERE status = 'active' AND trigger_type = 'webhook'
         AND trigger_config->>'webhookKey' = $1
         LIMIT 1`,
        [webhookKey]
      );

      if (wfResult.rows.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'No matching webhook workflow found' }) };
      }
      userId = wfResult.rows[0].user_id;
    } else {
      // Require JWT auth for non-webhook triggers
      const decoded = verifyToken(event.headers.authorization);
      if (!decoded) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
      }
      userId = decoded.userId;
      token = event.headers.authorization ? event.headers.authorization.split(' ')[1] : null;
    }

    const result = await fireTrigger(userId, triggerType, triggerData || {}, token);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, ...result })
    };
  } catch (error) {
    console.error('Process trigger error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};

// Export fireTrigger for use by other functions
exports.fireTrigger = fireTrigger;
