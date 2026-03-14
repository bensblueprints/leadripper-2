const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2026';
const TRACKING_BASE = 'https://leadripper.com/.netlify/functions/email-tracking';
const DEFAULT_PHONE_NUMBER_ID = 'phnum_5601kj25h7fzedxtvrp4ebayyp7e';

function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════
// MERGE TAG REPLACEMENT
// ═══════════════════════════════════════════
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

// Inject tracking pixel and wrap links
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
  if (tracked.includes('</body>')) {
    tracked = tracked.replace('</body>', pixel + '</body>');
  } else {
    tracked += pixel;
  }
  return tracked;
}

// ═══════════════════════════════════════════
// ACTION HANDLERS
// ═══════════════════════════════════════════
const ACTION_HANDLERS = {

  // ─── Send Email ───
  send_email: async (node, contact, context) => {
    const config = node.config || {};
    const { accountId, subject, body: emailBody, templateId } = config;

    if (!accountId) throw new Error('Email account not configured for this step');

    // Load email account
    const acctResult = await pool.query(
      `SELECT id, email_address, display_name, smtp_host, smtp_port, username, password_encrypted
       FROM lr_email_accounts WHERE id = $1 AND user_id = $2 AND is_active = true`,
      [accountId, context.userId]
    );
    if (acctResult.rows.length === 0) throw new Error('Email account not found or inactive');
    const account = acctResult.rows[0];

    // Load template if specified
    let finalBody = emailBody || '';
    let finalSubject = subject || '';
    if (templateId) {
      const tmpl = await pool.query(
        'SELECT subject, body FROM lr_email_templates WHERE id = $1 AND user_id = $2',
        [templateId, context.userId]
      );
      if (tmpl.rows.length > 0) {
        finalSubject = finalSubject || tmpl.rows[0].subject;
        finalBody = finalBody || tmpl.rows[0].body;
      }
    }

    // Replace merge tags
    finalSubject = replaceMergeTags(finalSubject, contact);
    finalBody = replaceMergeTags(finalBody, contact);

    // Tracking
    const trackingId = crypto.randomUUID();
    const trackedBody = injectTracking(finalBody, trackingId);

    const transporter = nodemailer.createTransport({
      host: account.smtp_host,
      port: parseInt(account.smtp_port),
      secure: parseInt(account.smtp_port) === 465,
      auth: { user: account.username, pass: account.password_encrypted },
      connectionTimeout: 15000,
      socketTimeout: 15000
    });

    const toEmail = contact.email;
    const toName = contact.contact_name || contact.business_name || '';

    try {
      await transporter.sendMail({
        from: account.display_name ? `"${account.display_name}" <${account.email_address}>` : account.email_address,
        to: toName ? `"${toName}" <${toEmail}>` : toEmail,
        subject: finalSubject,
        html: trackedBody
      });

      // Record in lr_sent_emails
      await pool.query(
        `INSERT INTO lr_sent_emails
          (user_id, email_account_id, lead_id, to_email, to_name, subject, body, tracking_id, status, sent_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'sent', NOW())`,
        [context.userId, accountId, contact.id, toEmail, toName, finalSubject, trackedBody, trackingId]
      );
    } finally {
      transporter.close();
    }

    return { sent: true, to: toEmail, trackingId };
  },

  // ─── Send SMS (Twilio) ───
  send_sms: async (node, contact, context) => {
    const config = node.config || {};
    const { message, fromNumber } = config;

    if (!contact.phone) throw new Error('Contact has no phone number');
    if (!message) throw new Error('SMS message is required');

    // Load Twilio credentials from user settings
    const settings = await pool.query(
      'SELECT twilio_account_sid, twilio_auth_token FROM lr_user_settings WHERE user_id = $1',
      [context.userId]
    );
    if (settings.rows.length === 0 || !settings.rows[0].twilio_account_sid) {
      throw new Error('Twilio not configured. Add credentials in Settings.');
    }

    const { twilio_account_sid: accountSid, twilio_auth_token: authToken } = settings.rows[0];
    const from = fromNumber || settings.rows[0].twilio_phone_number || null;
    if (!from) throw new Error('No Twilio phone number configured');

    // Normalize phone
    let toPhone = contact.phone.replace(/[^0-9+]/g, '');
    if (!toPhone.startsWith('+')) {
      toPhone = toPhone.length === 10 ? '+1' + toPhone : '+' + toPhone;
    }

    const smsBody = replaceMergeTags(message, contact);

    // Use Twilio REST API directly
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const authStr = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const res = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authStr}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ To: toPhone, From: from, Body: smsBody }).toString()
    });

    const result = await res.json();
    if (!res.ok) throw new Error(`Twilio error: ${result.message || JSON.stringify(result)}`);

    return { sent: true, to: toPhone, sid: result.sid };
  },

  // ─── Voicemail Drop (ElevenLabs) ───
  voicemail_drop: async (node, contact, context) => {
    const config = node.config || {};
    const { agentId, phoneNumberId, message } = config;

    if (!contact.phone) throw new Error('Contact has no phone number');

    const settings = await pool.query(
      'SELECT elevenlabs_api_key FROM lr_user_settings WHERE user_id = $1',
      [context.userId]
    );
    if (settings.rows.length === 0 || !settings.rows[0].elevenlabs_api_key) {
      throw new Error('ElevenLabs API key not configured');
    }

    let toPhone = contact.phone.replace(/[^0-9+]/g, '');
    if (!toPhone.startsWith('+')) {
      toPhone = toPhone.length === 10 ? '+1' + toPhone : '+' + toPhone;
    }

    const res = await fetch('https://api.elevenlabs.io/v1/convai/twilio/outbound-call', {
      method: 'POST',
      headers: {
        'xi-api-key': settings.rows[0].elevenlabs_api_key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        agent_id: agentId || 'agent_7501kknstm2vfw3tm82242mt8kgp',
        agent_phone_number_id: phoneNumberId || DEFAULT_PHONE_NUMBER_ID,
        to_number: toPhone,
        conversation_initiation_client_data: {
          customer_name: contact.contact_name || contact.business_name || 'Unknown',
          lead_id: String(contact.id),
          voicemail_mode: 'true',
          voicemail_message: replaceMergeTags(message || '', contact)
        }
      })
    });

    const result = await res.json();
    if (!res.ok) throw new Error(`ElevenLabs error: ${JSON.stringify(result)}`);

    return { initiated: true, conversationId: result.conversation_id || result.id };
  },

  // ─── AI Call (ElevenLabs outbound) ───
  ai_call: async (node, contact, context) => {
    const config = node.config || {};
    const { agentId, phoneNumberId } = config;

    if (!contact.phone) throw new Error('Contact has no phone number');

    const settings = await pool.query(
      'SELECT elevenlabs_api_key FROM lr_user_settings WHERE user_id = $1',
      [context.userId]
    );
    if (settings.rows.length === 0 || !settings.rows[0].elevenlabs_api_key) {
      throw new Error('ElevenLabs API key not configured');
    }

    let toPhone = contact.phone.replace(/[^0-9+]/g, '');
    if (!toPhone.startsWith('+')) {
      toPhone = toPhone.length === 10 ? '+1' + toPhone : '+' + toPhone;
    }

    const res = await fetch('https://api.elevenlabs.io/v1/convai/twilio/outbound-call', {
      method: 'POST',
      headers: {
        'xi-api-key': settings.rows[0].elevenlabs_api_key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        agent_id: agentId || 'agent_7501kknstm2vfw3tm82242mt8kgp',
        agent_phone_number_id: phoneNumberId || DEFAULT_PHONE_NUMBER_ID,
        to_number: toPhone,
        conversation_initiation_client_data: {
          customer_name: contact.contact_name || contact.business_name || 'Unknown',
          lead_id: String(contact.id)
        }
      })
    });

    const result = await res.json();
    if (!res.ok) throw new Error(`ElevenLabs error: ${JSON.stringify(result)}`);

    // Log the call
    await pool.query(
      `INSERT INTO lr_call_logs
        (user_id, lead_id, agent_id, elevenlabs_conversation_id, phone_number, contact_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'initiated', NOW(), NOW())`,
      [context.userId, contact.id, agentId || DEFAULT_PHONE_NUMBER_ID,
       result.conversation_id || result.id, toPhone,
       contact.contact_name || contact.business_name || null]
    ).catch(err => console.error('Failed to log AI call:', err.message));

    return { initiated: true, conversationId: result.conversation_id || result.id };
  },

  // ─── Wait / Delay ───
  wait: async (node, contact, context) => {
    const config = node.config || {};
    const { duration, unit } = config;

    if (!duration || !unit) throw new Error('Wait duration and unit are required');

    const multipliers = { minutes: 60, hours: 3600, days: 86400 };
    const seconds = parseInt(duration) * (multipliers[unit] || 60);
    const nextActionAt = new Date(Date.now() + seconds * 1000);

    return { status: 'waiting', next_action_at: nextActionAt };
  },

  // ─── If/Else (Conditional Branch) ───
  if_else: async (node, contact, context) => {
    const config = node.config || {};
    const { field, operator, value } = config;

    if (!field || !operator) throw new Error('Condition field and operator are required');

    const contactValue = contact[field] || '';
    const compareValue = value || '';
    let result = false;

    switch (operator) {
      case 'equals':
        result = String(contactValue).toLowerCase() === String(compareValue).toLowerCase();
        break;
      case 'not_equals':
        result = String(contactValue).toLowerCase() !== String(compareValue).toLowerCase();
        break;
      case 'contains':
        result = String(contactValue).toLowerCase().includes(String(compareValue).toLowerCase());
        break;
      case 'not_contains':
        result = !String(contactValue).toLowerCase().includes(String(compareValue).toLowerCase());
        break;
      case 'starts_with':
        result = String(contactValue).toLowerCase().startsWith(String(compareValue).toLowerCase());
        break;
      case 'ends_with':
        result = String(contactValue).toLowerCase().endsWith(String(compareValue).toLowerCase());
        break;
      case 'is_empty':
        result = !contactValue || contactValue === '';
        break;
      case 'is_not_empty':
        result = !!contactValue && contactValue !== '';
        break;
      case 'greater_than':
        result = parseFloat(contactValue) > parseFloat(compareValue);
        break;
      case 'less_than':
        result = parseFloat(contactValue) < parseFloat(compareValue);
        break;
      default:
        result = false;
    }

    return { branch: result ? 'yes' : 'no', field, operator, contactValue: String(contactValue), compareValue };
  },

  // ─── Add Tag ───
  add_tag: async (node, contact, context) => {
    const config = node.config || {};
    const { tag } = config;
    if (!tag) throw new Error('Tag is required');

    // Get current tags, add new one
    const leadResult = await pool.query(
      'SELECT tags FROM lr_leads WHERE id = $1 AND user_id = $2',
      [contact.id, context.userId]
    );

    let currentTags = [];
    if (leadResult.rows.length > 0 && leadResult.rows[0].tags) {
      currentTags = Array.isArray(leadResult.rows[0].tags)
        ? leadResult.rows[0].tags
        : (typeof leadResult.rows[0].tags === 'string' ? JSON.parse(leadResult.rows[0].tags) : []);
    }

    if (!currentTags.includes(tag)) {
      currentTags.push(tag);
      await pool.query(
        'UPDATE lr_leads SET tags = $1 WHERE id = $2 AND user_id = $3',
        [JSON.stringify(currentTags), contact.id, context.userId]
      );
    }

    return { added: true, tag, tags: currentTags };
  },

  // ─── Remove Tag ───
  remove_tag: async (node, contact, context) => {
    const config = node.config || {};
    const { tag } = config;
    if (!tag) throw new Error('Tag is required');

    const leadResult = await pool.query(
      'SELECT tags FROM lr_leads WHERE id = $1 AND user_id = $2',
      [contact.id, context.userId]
    );

    let currentTags = [];
    if (leadResult.rows.length > 0 && leadResult.rows[0].tags) {
      currentTags = Array.isArray(leadResult.rows[0].tags)
        ? leadResult.rows[0].tags
        : (typeof leadResult.rows[0].tags === 'string' ? JSON.parse(leadResult.rows[0].tags) : []);
    }

    const newTags = currentTags.filter(t => t !== tag);
    await pool.query(
      'UPDATE lr_leads SET tags = $1 WHERE id = $2 AND user_id = $3',
      [JSON.stringify(newTags), contact.id, context.userId]
    );

    return { removed: true, tag, tags: newTags };
  },

  // ─── Update Contact ───
  update_contact: async (node, contact, context) => {
    const config = node.config || {};
    const { field, value } = config;
    if (!field) throw new Error('Field is required');

    // Whitelist of allowed fields to update
    const allowedFields = [
      'business_name', 'contact_name', 'first_name', 'last_name',
      'email', 'phone', 'website', 'city', 'state', 'address',
      'industry', 'notes', 'status'
    ];

    if (!allowedFields.includes(field)) {
      throw new Error(`Field '${field}' is not updatable`);
    }

    const resolvedValue = replaceMergeTags(value || '', contact);

    await pool.query(
      `UPDATE lr_leads SET ${field} = $1 WHERE id = $2 AND user_id = $3`,
      [resolvedValue, contact.id, context.userId]
    );

    return { updated: true, field, value: resolvedValue };
  },

  // ─── Move Pipeline Stage ───
  move_pipeline_stage: async (node, contact, context) => {
    const config = node.config || {};
    const { pipelineId, stageId } = config;
    if (!stageId) throw new Error('Stage ID is required');

    // Find deal for this contact
    let query = 'SELECT d.id FROM lr_crm_deals d JOIN lr_crm_pipelines p ON d.pipeline_id = p.id WHERE p.user_id = $1';
    const params = [context.userId];

    if (contact.email) {
      query += ' AND d.contact_email = $2';
      params.push(contact.email);
    } else if (contact.phone) {
      query += ' AND d.contact_phone = $2';
      params.push(contact.phone);
    } else {
      throw new Error('Contact has no email or phone to match deals');
    }

    if (pipelineId) {
      query += ` AND d.pipeline_id = $${params.length + 1}`;
      params.push(pipelineId);
    }

    query += ' LIMIT 1';
    const dealResult = await pool.query(query, params);

    if (dealResult.rows.length === 0) {
      return { moved: false, reason: 'No deal found for this contact' };
    }

    await pool.query(
      'UPDATE lr_crm_deals SET stage_id = $1, updated_at = NOW() WHERE id = $2',
      [stageId, dealResult.rows[0].id]
    );

    return { moved: true, dealId: dealResult.rows[0].id, newStageId: stageId };
  },

  // ─── Webhook (outbound) ───
  webhook: async (node, contact, context) => {
    const config = node.config || {};
    const { url, method, headers: customHeaders, body: webhookBody } = config;

    if (!url) throw new Error('Webhook URL is required');

    const payload = webhookBody
      ? JSON.parse(replaceMergeTags(JSON.stringify(webhookBody), contact))
      : {
          event: 'workflow_action',
          workflow_id: context.workflowId,
          execution_id: context.executionId,
          contact: {
            id: contact.id,
            business_name: contact.business_name,
            email: contact.email,
            phone: contact.phone,
            city: contact.city,
            industry: contact.industry
          },
          timestamp: new Date().toISOString()
        };

    const res = await fetch(url, {
      method: method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(customHeaders || {})
      },
      body: JSON.stringify(payload)
    });

    return { sent: true, statusCode: res.status, url };
  },

  // ─── Internal Notification ───
  notification: async (node, contact, context) => {
    const config = node.config || {};
    const { message, notifyEmail } = config;

    const notifMessage = replaceMergeTags(message || 'Workflow notification', contact);

    // Get user email if notifyEmail not specified
    let toEmail = notifyEmail;
    if (!toEmail) {
      const userResult = await pool.query('SELECT email FROM lr_users WHERE id = $1', [context.userId]);
      toEmail = userResult.rows.length > 0 ? userResult.rows[0].email : null;
    }

    if (!toEmail) {
      return { sent: false, reason: 'No notification email available' };
    }

    // Try to send via Resend
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY || 're_TqppzRWt_LdZL9X1dzPPB4bpS4riMeNHV'}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'LeadRipper Workflows <noreply@advancedmarketing.co>',
          to: toEmail,
          subject: `Workflow Notification: ${context.workflowName || 'Workflow'}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
            <h2 style="color:#4a9eff;">Workflow Notification</h2>
            <p>${notifMessage}</p>
            <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
            <p style="color:#666;font-size:12px;">
              Contact: ${contact.business_name || contact.email || 'Unknown'}<br>
              Workflow: ${context.workflowName || context.workflowId}
            </p>
          </div>`
        })
      });

      const result = await res.json();
      return { sent: res.ok, to: toEmail, message: notifMessage, resendId: result.id };
    } catch (err) {
      return { sent: false, error: err.message };
    }
  },

  // ─── Score Website ───
  score_website: async (node, contact, context) => {
    if (!contact.website) {
      return { scored: false, reason: 'Contact has no website' };
    }

    // Call the analyze-website function internally
    try {
      const res = await fetch('https://leadripper.com/.netlify/functions/analyze-website', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${context.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url: contact.website,
          leadId: contact.id,
          businessName: contact.business_name || '',
          address: contact.address || ''
        })
      });

      const result = await res.json();
      return { scored: true, score: result.score, grade: result.grade };
    } catch (err) {
      return { scored: false, error: err.message };
    }
  }
};

// ═══════════════════════════════════════════
// EXECUTION ENGINE
// ═══════════════════════════════════════════
async function executeWorkflow(workflowId, userId, contactId, triggerData, token) {
  // Load workflow
  const wfResult = await pool.query(
    'SELECT * FROM lr_workflows WHERE id = $1 AND user_id = $2',
    [workflowId, userId]
  );
  if (wfResult.rows.length === 0) throw new Error('Workflow not found');

  const workflow = wfResult.rows[0];
  const nodes = typeof workflow.nodes === 'string' ? JSON.parse(workflow.nodes) : (workflow.nodes || []);
  const edges = typeof workflow.edges === 'string' ? JSON.parse(workflow.edges) : (workflow.edges || []);

  if (nodes.length === 0) throw new Error('Workflow has no nodes');

  // Load contact
  let contact = {};
  if (contactId) {
    const contactResult = await pool.query(
      'SELECT * FROM lr_leads WHERE id = $1 AND user_id = $2',
      [contactId, userId]
    );
    if (contactResult.rows.length > 0) {
      contact = contactResult.rows[0];
    }
  }

  // Merge trigger data into contact for webhook/manual triggers
  if (triggerData) {
    contact = { ...contact, ...triggerData };
  }

  // Create execution record
  const execResult = await pool.query(
    `INSERT INTO lr_workflow_executions
      (workflow_id, user_id, contact_id, status, execution_data, started_at)
     VALUES ($1, $2, $3, 'running', $4, NOW()) RETURNING *`,
    [workflowId, userId, contactId || null, JSON.stringify({ triggerData: triggerData || {} })]
  );
  const execution = execResult.rows[0];

  // Update workflow enrolled stat
  await pool.query(
    `UPDATE lr_workflows SET stats = jsonb_set(
      COALESCE(stats, '{}')::jsonb, '{enrolled}',
      (COALESCE((stats->>'enrolled')::int, 0) + 1)::text::jsonb
    ), updated_at = NOW() WHERE id = $1`,
    [workflowId]
  );

  // Build adjacency map: nodeId -> [target nodes]
  const edgeMap = {};
  for (const edge of edges) {
    const key = edge.sourceHandle ? `${edge.source}:${edge.sourceHandle}` : edge.source;
    if (!edgeMap[key]) edgeMap[key] = [];
    edgeMap[key].push(edge.target);
    // Also add without handle for simple lookups
    if (!edgeMap[edge.source]) edgeMap[edge.source] = [];
    if (edge.sourceHandle) {
      // Don't duplicate: only add to handle-specific key
    } else {
      // Already added above
    }
  }

  // Also build a simple source -> targets map
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

  // Find the trigger node (first node of type 'trigger' or the first node)
  const triggerNode = nodes.find(n => n.type === 'trigger') || nodes[0];

  // Get first action nodes after trigger
  const firstEdges = simpleEdgeMap[triggerNode.id] || [];
  const nextNodeIds = firstEdges.map(e => e.target);

  const context = {
    userId,
    workflowId,
    workflowName: workflow.name,
    executionId: execution.id,
    token
  };

  // Execute nodes sequentially following edges
  let currentNodes = nextNodeIds;
  let stepCount = 0;
  const maxSteps = 50; // Safety limit

  while (currentNodes.length > 0 && stepCount < maxSteps) {
    stepCount++;
    const nextBatch = [];

    for (const nodeId of currentNodes) {
      const node = nodeMap[nodeId];
      if (!node) continue;

      // Update current node
      await pool.query(
        'UPDATE lr_workflow_executions SET current_node = $1 WHERE id = $2',
        [nodeId, execution.id]
      );

      // Log the start
      const logResult = await pool.query(
        `INSERT INTO lr_workflow_logs
          (execution_id, node_id, action_type, status, input_data, created_at)
         VALUES ($1, $2, $3, 'running', $4, NOW()) RETURNING id`,
        [execution.id, nodeId, node.type, JSON.stringify(node.config || {})]
      );
      const logId = logResult.rows[0].id;

      try {
        const handler = ACTION_HANDLERS[node.type];
        if (!handler) {
          // Unknown node type - skip and continue
          await pool.query(
            'UPDATE lr_workflow_logs SET status = $1, output_data = $2 WHERE id = $3',
            ['skipped', JSON.stringify({ reason: `Unknown action type: ${node.type}` }), logId]
          );

          // Follow edges to next nodes
          const nodeEdges = simpleEdgeMap[nodeId] || [];
          for (const edge of nodeEdges) {
            nextBatch.push(edge.target);
          }
          continue;
        }

        // Execute the handler
        const result = await handler(node, contact, context);

        // Handle special results
        if (result && result.status === 'waiting') {
          // Wait step: pause execution
          await pool.query(
            `UPDATE lr_workflow_executions SET status = 'waiting', current_node = $1, next_action_at = $2 WHERE id = $3`,
            [nodeId, result.next_action_at, execution.id]
          );
          await pool.query(
            'UPDATE lr_workflow_logs SET status = $1, output_data = $2 WHERE id = $3',
            ['success', JSON.stringify(result), logId]
          );
          // Don't continue execution - it will be resumed by process-workflow-waits
          return {
            executionId: execution.id,
            status: 'waiting',
            currentNode: nodeId,
            nextActionAt: result.next_action_at
          };
        }

        if (result && result.branch) {
          // If/Else node: follow the correct branch
          const branchEdges = simpleEdgeMap[nodeId] || [];
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

        // Follow edges to next nodes
        const nodeEdges = simpleEdgeMap[nodeId] || [];
        for (const edge of nodeEdges) {
          if (!edge.sourceHandle) {
            nextBatch.push(edge.target);
          }
        }

      } catch (error) {
        console.error(`[Workflow] Node ${nodeId} (${node.type}) failed:`, error.message);
        await pool.query(
          'UPDATE lr_workflow_logs SET status = $1, error = $2 WHERE id = $3',
          ['failed', error.message, logId]
        );

        // Check if settings say to stop on error
        const wfSettings = typeof workflow.settings === 'string' ? JSON.parse(workflow.settings) : (workflow.settings || {});
        if (wfSettings.stopOnError) {
          await pool.query(
            `UPDATE lr_workflow_executions SET status = 'failed', error = $1, completed_at = NOW() WHERE id = $2`,
            [`Node ${nodeId} (${node.type}) failed: ${error.message}`, execution.id]
          );
          return { executionId: execution.id, status: 'failed', error: error.message };
        }

        // Otherwise continue to next nodes
        const nodeEdges = simpleEdgeMap[nodeId] || [];
        for (const edge of nodeEdges) {
          if (!edge.sourceHandle) {
            nextBatch.push(edge.target);
          }
        }
      }
    }

    currentNodes = nextBatch;
  }

  // Execution complete
  await pool.query(
    `UPDATE lr_workflow_executions SET status = 'completed', completed_at = NOW() WHERE id = $1`,
    [execution.id]
  );

  // Update workflow stats
  await pool.query(
    `UPDATE lr_workflows SET stats = jsonb_set(
      COALESCE(stats, '{}')::jsonb, '{completed}',
      (COALESCE((stats->>'completed')::int, 0) + 1)::text::jsonb
    ) WHERE id = $1`,
    [workflowId]
  );

  return { executionId: execution.id, status: 'completed', stepsExecuted: stepCount };
}

// ═══════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════
exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const decoded = verifyToken(event.headers.authorization);
  if (!decoded) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

  try {
    const { workflowId, contactId, triggerData } = JSON.parse(event.body);

    if (!workflowId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'workflowId is required' }) };
    }

    const token = event.headers.authorization ? event.headers.authorization.split(' ')[1] : null;
    const result = await executeWorkflow(workflowId, decoded.userId, contactId, triggerData, token);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, ...result })
    };
  } catch (error) {
    console.error('Execute workflow error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};

// Export for use by other functions
exports.executeWorkflow = executeWorkflow;
