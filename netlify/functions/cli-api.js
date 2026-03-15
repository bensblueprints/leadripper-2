const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { getBalance, addCredits: addCreditsHelper, CREDIT_COSTS, PLAN_CREDITS } = require('./credits');

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2026';
const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_KEY || 'AIzaSyCngyzhiymWqY3ypkY4U5znvC_m18F1srA';
const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY || 'sk_748454d1dce0403d4513bf8c34fc05f7453c6291e0be522e';
const DEFAULT_PHONE_NUMBER_ID = 'phnum_5601kj25h7fzedxtvrp4ebayyp7e';
const DEFAULT_AGENT_ID = 'agent_7501kknstm2vfw3tm82242mt8kgp';

// Ensure api_keys table exists
async function ensureApiKeysTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lr_api_keys (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      api_key VARCHAR(64) NOT NULL UNIQUE,
      created_at TIMESTAMP DEFAULT NOW(),
      last_used_at TIMESTAMP,
      revoked BOOLEAN DEFAULT false
    )
  `).catch(() => {});
}

// Auth via API key header OR JWT Bearer token
async function auth(event) {
  // Try API key first
  const apiKey = event.headers['x-api-key'] || event.headers['X-Api-Key'];
  if (apiKey) {
    await ensureApiKeysTable();
    const result = await pool.query(
      'SELECT user_id FROM lr_api_keys WHERE api_key = $1 AND revoked = false',
      [apiKey]
    );
    if (result.rows.length > 0) {
      // Update last used
      pool.query('UPDATE lr_api_keys SET last_used_at = NOW() WHERE api_key = $1', [apiKey]).catch(() => {});
      return result.rows[0].user_id;
    }
    return null;
  }

  // Fallback to JWT Bearer
  const authHeader = event.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
      return decoded.userId;
    } catch {}
  }

  return null;
}

// API key management actions (require JWT auth, not API key)
async function getMyKey(userId) {
  await ensureApiKeysTable();
  const result = await pool.query(
    'SELECT api_key, created_at, last_used_at FROM lr_api_keys WHERE user_id = $1 AND revoked = false ORDER BY created_at DESC LIMIT 1',
    [userId]
  );
  return result.rows[0] || { api_key: null };
}

async function generateKey(userId) {
  await ensureApiKeysTable();
  // Revoke any existing keys
  await pool.query('UPDATE lr_api_keys SET revoked = true WHERE user_id = $1', [userId]);
  // Generate new key
  const key = 'lr_' + crypto.randomBytes(24).toString('hex');
  const result = await pool.query(
    'INSERT INTO lr_api_keys (user_id, api_key) VALUES ($1, $2) RETURNING api_key, created_at',
    [userId, key]
  );
  return result.rows[0];
}

async function revokeKey(userId) {
  await ensureApiKeysTable();
  await pool.query('UPDATE lr_api_keys SET revoked = true WHERE user_id = $1', [userId]);
  return { message: 'API key revoked' };
}

// ═══════════════════════════════════════
// ACTIONS
// ═══════════════════════════════════════

async function getLeads({ userId, city, industry, status, search, limit, offset }) {
  let query = 'SELECT * FROM lr_leads WHERE user_id = $1';
  const values = [userId];
  let idx = 2;

  if (city) { query += ` AND LOWER(city) = LOWER($${idx++})`; values.push(city); }
  if (industry) { query += ` AND LOWER(industry) = LOWER($${idx++})`; values.push(industry); }
  if (status === 'no-email') query += ' AND (email IS NULL OR email = \'\')';
  if (status === 'has-email') query += ' AND email IS NOT NULL AND email != \'\'';
  if (status === 'validated') query += ' AND email_verified = true';
  if (status === 'synced') query += ' AND ghl_synced = true';
  if (search) { query += ` AND (LOWER(business_name) LIKE LOWER($${idx++}) OR LOWER(email) LIKE LOWER($${idx++}))`; values.push(`%${search}%`, `%${search}%`); }

  query += ' ORDER BY created_at DESC';
  query += ` LIMIT $${idx++}`; values.push(limit || 50);
  query += ` OFFSET $${idx++}`; values.push(offset || 0);

  const result = await pool.query(query, values);

  const countResult = await pool.query(
    'SELECT COUNT(*) as total FROM lr_leads WHERE user_id = $1',
    [userId]
  );

  return { leads: result.rows, total: parseInt(countResult.rows[0].total), returned: result.rows.length };
}

async function getStats({ userId }) {
  const r = await pool.query(`
    SELECT
      COUNT(*) as total_leads,
      COUNT(email) FILTER (WHERE email IS NOT NULL AND email != '') as with_email,
      COUNT(*) FILTER (WHERE email IS NULL OR email = '') as without_email,
      COUNT(*) FILTER (WHERE email_verified = true) as validated,
      COUNT(*) FILTER (WHERE ghl_synced = true) as synced_to_ghl,
      COUNT(DISTINCT city) as cities,
      COUNT(DISTINCT industry) as industries
    FROM lr_leads WHERE user_id = $1
  `, [userId]);

  // Get credit balance
  let credits = { balance: 0, lifetime_credits: 0 };
  try {
    credits = await getBalance(userId);
  } catch {}

  return { ...r.rows[0], credit_balance: credits.balance, lifetime_credits: credits.lifetime_credits };
}

async function searchLeads({ userId, query }) {
  const result = await pool.query(
    `SELECT id, business_name, phone, email, city, state, industry, website, rating, reviews,
            email_verified, ghl_synced, website_score, website_grade, contact_name
     FROM lr_leads
     WHERE user_id = $1 AND (
       LOWER(business_name) LIKE LOWER($2) OR
       LOWER(email) LIKE LOWER($2) OR
       LOWER(city) LIKE LOWER($2) OR
       LOWER(industry) LIKE LOWER($2) OR
       phone LIKE $2
     )
     ORDER BY created_at DESC LIMIT 100`,
    [userId, `%${query}%`]
  );
  return { leads: result.rows, count: result.rows.length };
}

async function updateLead({ userId, leadId, email, contactName, phone, businessName, notes }) {
  const updates = [];
  const values = [];
  let idx = 1;

  if (email) { updates.push(`email = $${idx++}`); values.push(email); }
  if (contactName) {
    await pool.query('ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255)').catch(() => {});
    updates.push(`contact_name = $${idx++}`); values.push(contactName);
  }
  if (phone) { updates.push(`phone = $${idx++}`); values.push(phone); }
  if (businessName) { updates.push(`business_name = $${idx++}`); values.push(businessName); }
  updates.push('updated_at = NOW()');

  if (updates.length <= 1) return { error: 'Nothing to update' };

  values.push(leadId, userId);
  const result = await pool.query(
    `UPDATE lr_leads SET ${updates.join(', ')} WHERE id = $${idx++} AND user_id = $${idx} RETURNING *`,
    values
  );
  return { updated: result.rows[0] || null };
}

async function deleteLead({ userId, leadId }) {
  const result = await pool.query(
    'DELETE FROM lr_leads WHERE id = $1 AND user_id = $2 RETURNING id, business_name',
    [leadId, userId]
  );
  return { deleted: result.rows[0] || null };
}

async function createList({ userId, name, description }) {
  const result = await pool.query(
    'INSERT INTO lr_lead_lists (user_id, name, description, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()) RETURNING *',
    [userId, name, description || null]
  );
  return { list: result.rows[0] };
}

async function getLists({ userId }) {
  const result = await pool.query(
    `SELECT ll.*, COUNT(li.id)::INTEGER AS item_count
     FROM lr_lead_lists ll LEFT JOIN lr_lead_list_items li ON ll.id = li.list_id
     WHERE ll.user_id = $1 GROUP BY ll.id ORDER BY ll.created_at DESC`,
    [userId]
  );
  return { lists: result.rows };
}

async function addToList({ userId, listId, leadIds, filter }) {
  let ids = leadIds || [];

  // If filter provided instead of explicit IDs, query matching leads
  if (filter && ids.length === 0) {
    let q = 'SELECT id FROM lr_leads WHERE user_id = $1';
    const v = [userId];
    let i = 2;
    if (filter === 'no-email') q += ' AND (email IS NULL OR email = \'\')';
    if (filter === 'has-phone') q += ' AND phone IS NOT NULL AND phone != \'\'';
    if (filter === 'no-email-has-phone') q += ' AND (email IS NULL OR email = \'\') AND phone IS NOT NULL AND phone != \'\'';
    if (filter.city) { q += ` AND LOWER(city) = LOWER($${i++})`; v.push(filter.city); }
    if (filter.industry) { q += ` AND LOWER(industry) = LOWER($${i++})`; v.push(filter.industry); }
    const r = await pool.query(q, v);
    ids = r.rows.map(row => row.id);
  }

  if (ids.length === 0) return { added: 0, message: 'No matching leads' };

  let added = 0;
  for (const id of ids) {
    try {
      await pool.query(
        'INSERT INTO lr_lead_list_items (list_id, lead_id, added_at) VALUES ($1, $2, NOW()) ON CONFLICT DO NOTHING',
        [listId, id]
      );
      added++;
    } catch {}
  }
  return { added, listId };
}

async function callLead({ userId, leadId, phoneNumber, contactName, agentId, phoneNumberId }) {
  const phone = phoneNumber || (leadId ? (await pool.query('SELECT phone, business_name FROM lr_leads WHERE id = $1', [leadId])).rows[0]?.phone : null);
  const name = contactName || (leadId ? (await pool.query('SELECT business_name FROM lr_leads WHERE id = $1', [leadId])).rows[0]?.business_name : 'Unknown');

  if (!phone) return { error: 'No phone number' };

  // Normalize
  let normalized = phone.replace(/[^0-9+]/g, '');
  if (!normalized.startsWith('+')) {
    if (normalized.length === 11 && normalized.startsWith('1')) normalized = '+' + normalized;
    else if (normalized.length === 10) normalized = '+1' + normalized;
    else normalized = '+' + normalized;
  }

  const res = await fetch('https://api.elevenlabs.io/v1/convai/twilio/outbound-call', {
    method: 'POST',
    headers: { 'xi-api-key': ELEVENLABS_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent_id: agentId || DEFAULT_AGENT_ID,
      agent_phone_number_id: phoneNumberId || DEFAULT_PHONE_NUMBER_ID,
      to_number: normalized,
      conversation_initiation_client_data: { customer_name: name }
    })
  });
  const data = await res.json();

  // Log it
  await pool.query(
    `INSERT INTO lr_call_logs (user_id, lead_id, agent_id, phone_number, contact_name, status, elevenlabs_conversation_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
    [userId, leadId || null, agentId || DEFAULT_AGENT_ID, normalized, name,
     res.ok ? 'initiated' : 'failed', data.conversation_id || null]
  ).catch(() => {});

  return { success: res.ok, phone: normalized, response: data };
}

async function callList({ userId, listId, agentId, phoneNumberId, delay }) {
  const leadsResult = await pool.query(
    `SELECT l.id, l.business_name, l.phone, l.contact_name
     FROM lr_lead_list_items li JOIN lr_leads l ON li.lead_id = l.id
     WHERE li.list_id = $1 AND l.phone IS NOT NULL AND l.phone != ''`,
    [listId]
  );

  const leads = leadsResult.rows;
  if (leads.length === 0) return { error: 'No leads with phone numbers in this list' };

  let initiated = 0, failed = 0;
  const results = [];

  for (const lead of leads) {
    const r = await callLead({
      leadId: lead.id,
      phoneNumber: lead.phone,
      contactName: lead.business_name || lead.contact_name || 'Unknown',
      agentId, phoneNumberId
    });
    if (r.success) initiated++; else failed++;
    results.push({ id: lead.id, name: lead.business_name, phone: lead.phone, ...r });
    await new Promise(resolve => setTimeout(resolve, (delay || 3) * 1000));
  }

  return { total: leads.length, initiated, failed, results };
}

async function getCallLogs({ userId, limit, listId }) {
  let q = 'SELECT * FROM lr_call_logs WHERE user_id = $1';
  const v = [userId];
  let i = 2;
  if (listId) { q += ` AND list_id = $${i++}`; v.push(listId); }
  q += ' ORDER BY created_at DESC';
  q += ` LIMIT $${i++}`; v.push(limit || 50);
  const result = await pool.query(q, v);
  return { calls: result.rows };
}

async function scoreWebsite({ leadId, url }) {
  if (!url && leadId) {
    const r = await pool.query('SELECT website, business_name, address, city, state FROM lr_leads WHERE id = $1', [leadId]);
    if (r.rows[0]) { url = r.rows[0].website; }
  }
  if (!url) return { error: 'No URL' };

  // Call our own analyze-website function internally
  const res = await fetch('https://leadripper.com/.netlify/functions/analyze-website', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer internal-bypass' },
    body: JSON.stringify({ url, leadId })
  });

  // If internal auth fails, do a basic analysis here
  if (!res.ok) {
    return { error: 'Analysis failed', status: res.status };
  }
  return await res.json();
}

async function getPhoneNumbers() {
  const res = await fetch('https://api.elevenlabs.io/v1/convai/phone-numbers', {
    headers: { 'xi-api-key': ELEVENLABS_KEY }
  });
  return await res.json();
}

async function getAgents() {
  const res = await fetch('https://api.elevenlabs.io/v1/convai/agents', {
    headers: { 'xi-api-key': ELEVENLABS_KEY }
  });
  return await res.json();
}

async function assignPhone({ phoneNumberId, agentId }) {
  const res = await fetch(`https://api.elevenlabs.io/v1/convai/phone-numbers/${phoneNumberId}`, {
    method: 'PATCH',
    headers: { 'xi-api-key': ELEVENLABS_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_id: agentId || null })
  });
  return await res.json();
}

async function bulkAddNoEmailToCallList({ userId }) {
  const listName = 'CLI Call List - ' + new Date().toISOString().slice(0, 10);
  const { list } = await createList({ userId, name: listName });
  const result = await addToList({ userId, listId: list.id, filter: 'no-email-has-phone' });
  return { list, added: result.added };
}

// ═══════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════

const ACTIONS = {
  // Leads
  get_leads: getLeads,
  search: searchLeads,
  stats: getStats,
  update_lead: updateLead,
  delete_lead: deleteLead,

  // Lists
  get_lists: getLists,
  create_list: createList,
  add_to_list: addToList,
  bulk_no_email_list: bulkAddNoEmailToCallList,

  // Calling
  call_lead: callLead,
  call_list: callList,
  get_call_logs: getCallLogs,

  // Website scoring
  score_website: scoreWebsite,

  // ElevenLabs management
  get_phone_numbers: getPhoneNumbers,
  get_agents: getAgents,
  assign_phone: assignPhone,

  // Credits
  get_credits: async ({ userId }) => {
    const balance = await getBalance(userId);
    return { ...balance, costs: CREDIT_COSTS, plan_credits: PLAN_CREDITS };
  },
  add_credits: async ({ userId, amount, description }) => {
    if (!amount || amount <= 0) return { error: 'amount must be positive' };
    return await addCreditsHelper(userId, parseInt(amount), 'bonus', description || `CLI bonus: ${amount} credits`);
  },

  // Help
  help: async () => ({
    actions: Object.keys(ACTIONS),
    examples: {
      get_leads: { city: 'Miami', industry: 'plumbing', status: 'no-email', limit: 20 },
      search: { query: 'solar' },
      stats: {},
      update_lead: { leadId: 123, email: 'owner@biz.com', contactName: 'John Smith' },
      create_list: { name: 'Hot Leads March' },
      add_to_list: { listId: 5, leadIds: [1, 2, 3] },
      add_to_list_filter: { listId: 5, filter: 'no-email-has-phone' },
      bulk_no_email_list: {},
      call_lead: { leadId: 123 },
      call_list: { listId: 5, delay: 3 },
      score_website: { leadId: 123 },
      get_phone_numbers: {},
      get_agents: {},
      assign_phone: { phoneNumberId: 'phnum_xxx', agentId: 'agent_xxx' },
      get_credits: {},
      add_credits: { amount: 100, description: 'Bonus credits' },
    }
  })
};

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const userId = await auth(event);
  if (!userId) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid API key or token. Use header: X-Api-Key or Authorization: Bearer <token>' }) };
  }

  try {
    let action, params;

    if (event.httpMethod === 'GET') {
      const qs = event.queryStringParameters || {};
      action = qs.action || 'help';
      params = qs;
    } else {
      const body = JSON.parse(event.body || '{}');
      action = body.action || 'help';
      params = body;
    }

    delete params.action;

    // Key management actions (always available)
    if (action === 'get_my_key') return { statusCode: 200, headers, body: JSON.stringify({ success: true, action, ...await getMyKey(userId) }) };
    if (action === 'generate_key') return { statusCode: 200, headers, body: JSON.stringify({ success: true, action, ...await generateKey(userId) }) };
    if (action === 'revoke_key') return { statusCode: 200, headers, body: JSON.stringify({ success: true, action, ...await revokeKey(userId) }) };

    // Inject userId into params for all actions
    params.userId = userId;

    const handler = ACTIONS[action];
    if (!handler) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown action: ${action}`, available: [...Object.keys(ACTIONS), 'get_my_key', 'generate_key', 'revoke_key'] }) };
    }

    const result = await handler(params);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, action, ...result }) };
  } catch (error) {
    console.error('CLI API error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
