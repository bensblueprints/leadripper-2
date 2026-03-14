const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

// ═══════════════════════════════════════════
// PROCESS WAITING WORKFLOW STEPS
// ═══════════════════════════════════════════
// Scheduled to run every 5 minutes.
// Finds executions with status='waiting' where next_action_at <= NOW()
// and resumes execution from the current node.

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    // Find all waiting executions that are ready to resume
    const waitingResult = await pool.query(
      `SELECT e.id, e.workflow_id, e.user_id, e.contact_id, e.current_node, e.execution_data
       FROM lr_workflow_executions e
       WHERE e.status = 'waiting'
       AND e.next_action_at <= NOW()
       ORDER BY e.next_action_at ASC
       LIMIT 50`
    );

    if (waitingResult.rows.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: 'No waiting executions to process', resumed: 0 })
      };
    }

    console.log(`[WaitProcessor] Found ${waitingResult.rows.length} waiting executions to resume`);

    let resumedCount = 0;
    let errorCount = 0;
    const results = [];

    for (const exec of waitingResult.rows) {
      try {
        // Load the workflow
        const wfResult = await pool.query(
          'SELECT * FROM lr_workflows WHERE id = $1',
          [exec.workflow_id]
        );

        if (wfResult.rows.length === 0) {
          // Workflow deleted, mark execution as failed
          await pool.query(
            `UPDATE lr_workflow_executions SET status = 'failed', error = 'Workflow deleted', completed_at = NOW() WHERE id = $1`,
            [exec.id]
          );
          errorCount++;
          continue;
        }

        const workflow = wfResult.rows[0];

        // Check if workflow is still active
        if (workflow.status !== 'active') {
          await pool.query(
            `UPDATE lr_workflow_executions SET status = 'failed', error = 'Workflow paused or deactivated', completed_at = NOW() WHERE id = $1`,
            [exec.id]
          );
          errorCount++;
          continue;
        }

        const nodes = typeof workflow.nodes === 'string' ? JSON.parse(workflow.nodes) : (workflow.nodes || []);
        const edges = typeof workflow.edges === 'string' ? JSON.parse(workflow.edges) : (workflow.edges || []);

        // Build edge map
        const simpleEdgeMap = {};
        for (const edge of edges) {
          if (!simpleEdgeMap[edge.source]) simpleEdgeMap[edge.source] = [];
          simpleEdgeMap[edge.source].push({ target: edge.target, sourceHandle: edge.sourceHandle });
        }

        // Node lookup
        const nodeMap = {};
        for (const node of nodes) {
          nodeMap[node.id] = node;
        }

        // Find the next nodes after the current wait node
        const currentNodeId = exec.current_node;
        const nextEdges = simpleEdgeMap[currentNodeId] || [];
        const nextNodeIds = nextEdges.filter(e => !e.sourceHandle).map(e => e.target);

        if (nextNodeIds.length === 0) {
          // No more nodes, execution is complete
          await pool.query(
            `UPDATE lr_workflow_executions SET status = 'completed', completed_at = NOW(), next_action_at = NULL WHERE id = $1`,
            [exec.id]
          );

          await pool.query(
            `UPDATE lr_workflows SET stats = jsonb_set(
              COALESCE(stats, '{}')::jsonb, '{completed}',
              (COALESCE((stats->>'completed')::int, 0) + 1)::text::jsonb
            ) WHERE id = $1`,
            [exec.workflow_id]
          );

          resumedCount++;
          results.push({ executionId: exec.id, status: 'completed', reason: 'No more nodes after wait' });
          continue;
        }

        // Load contact
        let contact = {};
        if (exec.contact_id) {
          const contactResult = await pool.query(
            'SELECT * FROM lr_leads WHERE id = $1',
            [exec.contact_id]
          );
          if (contactResult.rows.length > 0) {
            contact = contactResult.rows[0];
          }
        }

        // Mark execution as running
        await pool.query(
          `UPDATE lr_workflow_executions SET status = 'running', next_action_at = NULL WHERE id = $1`,
          [exec.id]
        );

        // Resume execution from the nodes after the wait
        const executionContext = {
          userId: exec.user_id,
          workflowId: exec.workflow_id,
          workflowName: workflow.name,
          executionId: exec.id,
          token: null // No token available in scheduled function
        };

        const resumeResult = await resumeExecution(
          exec.id, nextNodeIds, nodeMap, simpleEdgeMap, contact, executionContext, workflow
        );

        resumedCount++;
        results.push({ executionId: exec.id, ...resumeResult });

      } catch (error) {
        console.error(`[WaitProcessor] Failed to resume execution ${exec.id}:`, error.message);
        await pool.query(
          `UPDATE lr_workflow_executions SET status = 'failed', error = $1, completed_at = NOW() WHERE id = $2`,
          [error.message, exec.id]
        );
        errorCount++;
        results.push({ executionId: exec.id, status: 'error', error: error.message });
      }
    }

    console.log(`[WaitProcessor] Resumed: ${resumedCount}, Errors: ${errorCount}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Processed ${waitingResult.rows.length} waiting executions`,
        resumed: resumedCount,
        errors: errorCount,
        results
      })
    };
  } catch (error) {
    console.error('[WaitProcessor] Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};

/**
 * Resume execution of a workflow from given nodes.
 * This is a simplified version of the execution engine for resuming after waits.
 */
async function resumeExecution(executionId, startNodeIds, nodeMap, edgeMap, contact, context, workflow) {
  // Lazy-load the action handlers from execute-workflow
  const { executeWorkflow } = require('./execute-workflow');

  // We need the action handlers but they're encapsulated in execute-workflow.
  // Instead, create a minimal execution by calling the full engine with a trick:
  // We'll walk the remaining nodes manually using the same pattern.

  const ACTION_HANDLERS = getActionHandlers();
  let currentNodes = startNodeIds;
  let stepCount = 0;
  const maxSteps = 50;

  while (currentNodes.length > 0 && stepCount < maxSteps) {
    stepCount++;
    const nextBatch = [];

    for (const nodeId of currentNodes) {
      const node = nodeMap[nodeId];
      if (!node) continue;

      await pool.query(
        'UPDATE lr_workflow_executions SET current_node = $1 WHERE id = $2',
        [nodeId, executionId]
      );

      const logResult = await pool.query(
        `INSERT INTO lr_workflow_logs
          (execution_id, node_id, action_type, status, input_data, created_at)
         VALUES ($1, $2, $3, 'running', $4, NOW()) RETURNING id`,
        [executionId, nodeId, node.type, JSON.stringify(node.config || {})]
      );
      const logId = logResult.rows[0].id;

      try {
        const handler = ACTION_HANDLERS[node.type];
        if (!handler) {
          await pool.query(
            'UPDATE lr_workflow_logs SET status = $1, output_data = $2 WHERE id = $3',
            ['skipped', JSON.stringify({ reason: `Unknown action type: ${node.type}` }), logId]
          );
          const nodeEdges = edgeMap[nodeId] || [];
          for (const edge of nodeEdges) {
            if (!edge.sourceHandle) nextBatch.push(edge.target);
          }
          continue;
        }

        const result = await handler(node, contact, context);

        // Wait step: pause again
        if (result && result.status === 'waiting') {
          await pool.query(
            `UPDATE lr_workflow_executions SET status = 'waiting', current_node = $1, next_action_at = $2 WHERE id = $3`,
            [nodeId, result.next_action_at, executionId]
          );
          await pool.query(
            'UPDATE lr_workflow_logs SET status = $1, output_data = $2 WHERE id = $3',
            ['success', JSON.stringify(result), logId]
          );
          return { status: 'waiting', currentNode: nodeId, nextActionAt: result.next_action_at };
        }

        // If/Else branching
        if (result && result.branch) {
          const branchEdges = edgeMap[nodeId] || [];
          for (const edge of branchEdges) {
            if (edge.sourceHandle === result.branch) {
              nextBatch.push(edge.target);
            }
          }
          await pool.query(
            'UPDATE lr_workflow_logs SET status = $1, output_data = $2 WHERE id = $3',
            ['success', JSON.stringify(result), logId]
          );
          continue;
        }

        // Normal success
        await pool.query(
          'UPDATE lr_workflow_logs SET status = $1, output_data = $2 WHERE id = $3',
          ['success', JSON.stringify(result || {}), logId]
        );

        const nodeEdges = edgeMap[nodeId] || [];
        for (const edge of nodeEdges) {
          if (!edge.sourceHandle) nextBatch.push(edge.target);
        }

      } catch (error) {
        console.error(`[WaitProcessor] Node ${nodeId} (${node.type}) failed:`, error.message);
        await pool.query(
          'UPDATE lr_workflow_logs SET status = $1, error = $2 WHERE id = $3',
          ['failed', error.message, logId]
        );

        const wfSettings = typeof workflow.settings === 'string' ? JSON.parse(workflow.settings) : (workflow.settings || {});
        if (wfSettings.stopOnError) {
          await pool.query(
            `UPDATE lr_workflow_executions SET status = 'failed', error = $1, completed_at = NOW() WHERE id = $2`,
            [`Node ${nodeId} (${node.type}) failed: ${error.message}`, executionId]
          );
          return { status: 'failed', error: error.message };
        }

        const nodeEdges = edgeMap[nodeId] || [];
        for (const edge of nodeEdges) {
          if (!edge.sourceHandle) nextBatch.push(edge.target);
        }
      }
    }

    currentNodes = nextBatch;
  }

  // Completed
  await pool.query(
    `UPDATE lr_workflow_executions SET status = 'completed', completed_at = NOW() WHERE id = $1`,
    [executionId]
  );

  await pool.query(
    `UPDATE lr_workflows SET stats = jsonb_set(
      COALESCE(stats, '{}')::jsonb, '{completed}',
      (COALESCE((stats->>'completed')::int, 0) + 1)::text::jsonb
    ) WHERE id = $1`,
    [context.workflowId]
  );

  return { status: 'completed', stepsExecuted: stepCount };
}

/**
 * Minimal action handlers for the wait processor.
 * The wait step handler and if_else are always needed;
 * other handlers that need external APIs are imported lazily.
 */
function getActionHandlers() {
  // Import handlers from execute-workflow module
  // We can't import ACTION_HANDLERS directly since it's not exported,
  // so we define the critical ones here and use a fallback pattern.
  const nodemailer = require('nodemailer');
  const crypto = require('crypto');

  const TRACKING_BASE = 'https://leadripper.com/.netlify/functions/email-tracking';
  const DEFAULT_PHONE_NUMBER_ID = 'phnum_5601kj25h7fzedxtvrp4ebayyp7e';

  function replaceMergeTags(text, contact) {
    if (!text) return '';
    return text
      .replace(/\{\{business_name\}\}/gi, contact.business_name || '')
      .replace(/\{\{first_name\}\}/gi, contact.first_name || (contact.contact_name ? contact.contact_name.split(' ')[0] : '') || '')
      .replace(/\{\{last_name\}\}/gi, contact.last_name || '')
      .replace(/\{\{email\}\}/gi, contact.email || '')
      .replace(/\{\{phone\}\}/gi, contact.phone || '')
      .replace(/\{\{website\}\}/gi, contact.website || '')
      .replace(/\{\{city\}\}/gi, contact.city || '')
      .replace(/\{\{state\}\}/gi, contact.state || '')
      .replace(/\{\{industry\}\}/gi, contact.industry || '')
      .replace(/\{\{address\}\}/gi, contact.address || '');
  }

  function injectTracking(htmlBody, trackingId) {
    let tracked = htmlBody;
    tracked = tracked.replace(
      /href=["'](https?:\/\/[^"']+)["']/gi,
      (match, url) => {
        if (url.includes('email-tracking') || url.includes('mailto:')) return match;
        return `href="${TRACKING_BASE}?t=${trackingId}&l=${encodeURIComponent(url)}"`;
      }
    );
    const pixel = `<img src="${TRACKING_BASE}?t=${trackingId}" width="1" height="1" style="display:none;width:1px;height:1px;" alt="">`;
    return tracked.includes('</body>') ? tracked.replace('</body>', pixel + '</body>') : tracked + pixel;
  }

  return {
    wait: async (node) => {
      const config = node.config || {};
      const { duration, unit } = config;
      if (!duration || !unit) throw new Error('Wait duration and unit are required');
      const multipliers = { minutes: 60, hours: 3600, days: 86400 };
      const seconds = parseInt(duration) * (multipliers[unit] || 60);
      return { status: 'waiting', next_action_at: new Date(Date.now() + seconds * 1000) };
    },

    if_else: async (node, contact) => {
      const config = node.config || {};
      const { field, operator, value } = config;
      if (!field || !operator) throw new Error('Condition field and operator are required');
      const contactValue = contact[field] || '';
      const compareValue = value || '';
      let result = false;
      switch (operator) {
        case 'equals': result = String(contactValue).toLowerCase() === String(compareValue).toLowerCase(); break;
        case 'not_equals': result = String(contactValue).toLowerCase() !== String(compareValue).toLowerCase(); break;
        case 'contains': result = String(contactValue).toLowerCase().includes(String(compareValue).toLowerCase()); break;
        case 'not_contains': result = !String(contactValue).toLowerCase().includes(String(compareValue).toLowerCase()); break;
        case 'starts_with': result = String(contactValue).toLowerCase().startsWith(String(compareValue).toLowerCase()); break;
        case 'ends_with': result = String(contactValue).toLowerCase().endsWith(String(compareValue).toLowerCase()); break;
        case 'is_empty': result = !contactValue || contactValue === ''; break;
        case 'is_not_empty': result = !!contactValue && contactValue !== ''; break;
        case 'greater_than': result = parseFloat(contactValue) > parseFloat(compareValue); break;
        case 'less_than': result = parseFloat(contactValue) < parseFloat(compareValue); break;
        default: result = false;
      }
      return { branch: result ? 'yes' : 'no', field, operator, contactValue: String(contactValue), compareValue };
    },

    send_email: async (node, contact, context) => {
      const config = node.config || {};
      const { accountId, subject, body: emailBody, templateId } = config;
      if (!accountId) throw new Error('Email account not configured');
      const acctResult = await pool.query(
        'SELECT * FROM lr_email_accounts WHERE id = $1 AND user_id = $2 AND is_active = true',
        [accountId, context.userId]
      );
      if (acctResult.rows.length === 0) throw new Error('Email account not found');
      const account = acctResult.rows[0];
      let finalBody = emailBody || '';
      let finalSubject = subject || '';
      if (templateId) {
        const tmpl = await pool.query('SELECT subject, body FROM lr_email_templates WHERE id = $1 AND user_id = $2', [templateId, context.userId]);
        if (tmpl.rows.length > 0) { finalSubject = finalSubject || tmpl.rows[0].subject; finalBody = finalBody || tmpl.rows[0].body; }
      }
      finalSubject = replaceMergeTags(finalSubject, contact);
      finalBody = replaceMergeTags(finalBody, contact);
      const trackingId = crypto.randomUUID();
      const trackedBody = injectTracking(finalBody, trackingId);
      const transporter = nodemailer.createTransport({
        host: account.smtp_host, port: parseInt(account.smtp_port),
        secure: parseInt(account.smtp_port) === 465,
        auth: { user: account.username, pass: account.password_encrypted },
        connectionTimeout: 15000, socketTimeout: 15000
      });
      const toName = contact.contact_name || contact.business_name || '';
      try {
        await transporter.sendMail({
          from: account.display_name ? `"${account.display_name}" <${account.email_address}>` : account.email_address,
          to: toName ? `"${toName}" <${contact.email}>` : contact.email,
          subject: finalSubject, html: trackedBody
        });
        await pool.query(
          `INSERT INTO lr_sent_emails (user_id, email_account_id, lead_id, to_email, to_name, subject, body, tracking_id, status, sent_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'sent', NOW())`,
          [context.userId, accountId, contact.id, contact.email, toName, finalSubject, trackedBody, trackingId]
        );
      } finally { transporter.close(); }
      return { sent: true, to: contact.email, trackingId };
    },

    send_sms: async (node, contact, context) => {
      const config = node.config || {};
      if (!contact.phone) throw new Error('Contact has no phone');
      const settings = await pool.query('SELECT twilio_account_sid, twilio_auth_token, twilio_phone_number FROM lr_user_settings WHERE user_id = $1', [context.userId]);
      if (settings.rows.length === 0 || !settings.rows[0].twilio_account_sid) throw new Error('Twilio not configured');
      const { twilio_account_sid: sid, twilio_auth_token: authToken, twilio_phone_number: fromNum } = settings.rows[0];
      const from = config.fromNumber || fromNum;
      if (!from) throw new Error('No Twilio phone number');
      let toPhone = contact.phone.replace(/[^0-9+]/g, '');
      if (!toPhone.startsWith('+')) toPhone = toPhone.length === 10 ? '+1' + toPhone : '+' + toPhone;
      const smsBody = replaceMergeTags(config.message || '', contact);
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${Buffer.from(`${sid}:${authToken}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: toPhone, From: from, Body: smsBody }).toString()
      });
      const result = await res.json();
      if (!res.ok) throw new Error(`Twilio: ${result.message || JSON.stringify(result)}`);
      return { sent: true, to: toPhone, sid: result.sid };
    },

    ai_call: async (node, contact, context) => {
      const config = node.config || {};
      if (!contact.phone) throw new Error('Contact has no phone');
      const settings = await pool.query('SELECT elevenlabs_api_key FROM lr_user_settings WHERE user_id = $1', [context.userId]);
      if (settings.rows.length === 0 || !settings.rows[0].elevenlabs_api_key) throw new Error('ElevenLabs not configured');
      let toPhone = contact.phone.replace(/[^0-9+]/g, '');
      if (!toPhone.startsWith('+')) toPhone = toPhone.length === 10 ? '+1' + toPhone : '+' + toPhone;
      const res = await fetch('https://api.elevenlabs.io/v1/convai/twilio/outbound-call', {
        method: 'POST',
        headers: { 'xi-api-key': settings.rows[0].elevenlabs_api_key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: config.agentId || 'agent_7501kknstm2vfw3tm82242mt8kgp',
          agent_phone_number_id: config.phoneNumberId || DEFAULT_PHONE_NUMBER_ID,
          to_number: toPhone,
          conversation_initiation_client_data: { customer_name: contact.contact_name || contact.business_name || 'Unknown', lead_id: String(contact.id) }
        })
      });
      const result = await res.json();
      if (!res.ok) throw new Error(`ElevenLabs: ${JSON.stringify(result)}`);
      return { initiated: true, conversationId: result.conversation_id || result.id };
    },

    voicemail_drop: async (node, contact, context) => {
      const config = node.config || {};
      if (!contact.phone) throw new Error('Contact has no phone');
      const settings = await pool.query('SELECT elevenlabs_api_key FROM lr_user_settings WHERE user_id = $1', [context.userId]);
      if (settings.rows.length === 0 || !settings.rows[0].elevenlabs_api_key) throw new Error('ElevenLabs not configured');
      let toPhone = contact.phone.replace(/[^0-9+]/g, '');
      if (!toPhone.startsWith('+')) toPhone = toPhone.length === 10 ? '+1' + toPhone : '+' + toPhone;
      const res = await fetch('https://api.elevenlabs.io/v1/convai/twilio/outbound-call', {
        method: 'POST',
        headers: { 'xi-api-key': settings.rows[0].elevenlabs_api_key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: config.agentId || 'agent_7501kknstm2vfw3tm82242mt8kgp',
          agent_phone_number_id: config.phoneNumberId || DEFAULT_PHONE_NUMBER_ID,
          to_number: toPhone,
          conversation_initiation_client_data: {
            customer_name: contact.contact_name || contact.business_name || 'Unknown',
            lead_id: String(contact.id), voicemail_mode: 'true',
            voicemail_message: replaceMergeTags(config.message || '', contact)
          }
        })
      });
      const result = await res.json();
      if (!res.ok) throw new Error(`ElevenLabs: ${JSON.stringify(result)}`);
      return { initiated: true, conversationId: result.conversation_id || result.id };
    },

    add_tag: async (node, contact, context) => {
      const config = node.config || {};
      const { tag } = config;
      if (!tag) throw new Error('Tag is required');
      const leadResult = await pool.query('SELECT tags FROM lr_leads WHERE id = $1 AND user_id = $2', [contact.id, context.userId]);
      let currentTags = [];
      if (leadResult.rows.length > 0 && leadResult.rows[0].tags) {
        currentTags = Array.isArray(leadResult.rows[0].tags) ? leadResult.rows[0].tags : JSON.parse(leadResult.rows[0].tags || '[]');
      }
      if (!currentTags.includes(tag)) {
        currentTags.push(tag);
        await pool.query('UPDATE lr_leads SET tags = $1 WHERE id = $2 AND user_id = $3', [JSON.stringify(currentTags), contact.id, context.userId]);
      }
      return { added: true, tag, tags: currentTags };
    },

    remove_tag: async (node, contact, context) => {
      const config = node.config || {};
      const { tag } = config;
      if (!tag) throw new Error('Tag is required');
      const leadResult = await pool.query('SELECT tags FROM lr_leads WHERE id = $1 AND user_id = $2', [contact.id, context.userId]);
      let currentTags = [];
      if (leadResult.rows.length > 0 && leadResult.rows[0].tags) {
        currentTags = Array.isArray(leadResult.rows[0].tags) ? leadResult.rows[0].tags : JSON.parse(leadResult.rows[0].tags || '[]');
      }
      const newTags = currentTags.filter(t => t !== tag);
      await pool.query('UPDATE lr_leads SET tags = $1 WHERE id = $2 AND user_id = $3', [JSON.stringify(newTags), contact.id, context.userId]);
      return { removed: true, tag, tags: newTags };
    },

    update_contact: async (node, contact, context) => {
      const config = node.config || {};
      const { field, value } = config;
      if (!field) throw new Error('Field is required');
      const allowed = ['business_name', 'contact_name', 'first_name', 'last_name', 'email', 'phone', 'website', 'city', 'state', 'address', 'industry', 'notes', 'status'];
      if (!allowed.includes(field)) throw new Error(`Field '${field}' not updatable`);
      const resolvedValue = replaceMergeTags(value || '', contact);
      await pool.query(`UPDATE lr_leads SET ${field} = $1 WHERE id = $2 AND user_id = $3`, [resolvedValue, contact.id, context.userId]);
      return { updated: true, field, value: resolvedValue };
    },

    move_pipeline_stage: async (node, contact, context) => {
      const config = node.config || {};
      const { pipelineId, stageId } = config;
      if (!stageId) throw new Error('Stage ID required');
      let query = 'SELECT d.id FROM lr_crm_deals d JOIN lr_crm_pipelines p ON d.pipeline_id = p.id WHERE p.user_id = $1';
      const params = [context.userId];
      if (contact.email) { query += ' AND d.contact_email = $2'; params.push(contact.email); }
      else if (contact.phone) { query += ' AND d.contact_phone = $2'; params.push(contact.phone); }
      else throw new Error('Contact has no email or phone');
      if (pipelineId) { query += ` AND d.pipeline_id = $${params.length + 1}`; params.push(pipelineId); }
      query += ' LIMIT 1';
      const dealResult = await pool.query(query, params);
      if (dealResult.rows.length === 0) return { moved: false, reason: 'No deal found' };
      await pool.query('UPDATE lr_crm_deals SET stage_id = $1, updated_at = NOW() WHERE id = $2', [stageId, dealResult.rows[0].id]);
      return { moved: true, dealId: dealResult.rows[0].id, newStageId: stageId };
    },

    webhook: async (node, contact, context) => {
      const config = node.config || {};
      const { url, method, headers: customHeaders, body: webhookBody } = config;
      if (!url) throw new Error('Webhook URL required');
      const payload = webhookBody ? JSON.parse(replaceMergeTags(JSON.stringify(webhookBody), contact)) : {
        event: 'workflow_action', workflow_id: context.workflowId, execution_id: context.executionId,
        contact: { id: contact.id, business_name: contact.business_name, email: contact.email, phone: contact.phone },
        timestamp: new Date().toISOString()
      };
      const res = await fetch(url, { method: method || 'POST', headers: { 'Content-Type': 'application/json', ...(customHeaders || {}) }, body: JSON.stringify(payload) });
      return { sent: true, statusCode: res.status, url };
    },

    notification: async (node, contact, context) => {
      const config = node.config || {};
      const notifMessage = replaceMergeTags(config.message || 'Workflow notification', contact);
      let toEmail = config.notifyEmail;
      if (!toEmail) {
        const userResult = await pool.query('SELECT email FROM lr_users WHERE id = $1', [context.userId]);
        toEmail = userResult.rows.length > 0 ? userResult.rows[0].email : null;
      }
      if (!toEmail) return { sent: false, reason: 'No notification email' };
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY || 're_TqppzRWt_LdZL9X1dzPPB4bpS4riMeNHV'}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'LeadRipper Workflows <noreply@advancedmarketing.co>', to: toEmail,
            subject: `Workflow Notification: ${context.workflowName || 'Workflow'}`,
            html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2 style="color:#4a9eff;">Workflow Notification</h2><p>${notifMessage}</p><hr style="border:none;border-top:1px solid #eee;margin:20px 0;"><p style="color:#666;font-size:12px;">Contact: ${contact.business_name || contact.email || 'Unknown'}<br>Workflow: ${context.workflowName || context.workflowId}</p></div>`
          })
        });
        const result = await res.json();
        return { sent: res.ok, to: toEmail, resendId: result.id };
      } catch (err) { return { sent: false, error: err.message }; }
    },

    score_website: async (node, contact, context) => {
      if (!contact.website) return { scored: false, reason: 'No website' };
      try {
        const res = await fetch('https://leadripper.com/.netlify/functions/analyze-website', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(context.token ? { 'Authorization': `Bearer ${context.token}` } : {}) },
          body: JSON.stringify({ url: contact.website, leadId: contact.id, businessName: contact.business_name || '', address: contact.address || '' })
        });
        const result = await res.json();
        return { scored: true, score: result.score, grade: result.grade };
      } catch (err) { return { scored: false, error: err.message }; }
    }
  };
}
