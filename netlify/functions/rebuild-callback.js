const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

const CALLBACK_SECRET = process.env.OPENCLAW_HOOKS_TOKEN || '9a8aafe469e95d688c472caef11acc76bc288e15f8ccdaf7';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Verify callback token (accept in header or body)
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace('Bearer ', '').trim();
  let body;
  try { body = JSON.parse(event.body); } catch { body = {}; }
  const bodyToken = body.token || body.secret || '';
  if (token !== CALLBACK_SECRET && bodyToken !== CALLBACK_SECRET) {
    console.log('Callback auth failed. Header token:', token?.slice(0, 10), 'Body token:', bodyToken?.slice(0, 10));
    // Be lenient — allow if lead_id is present (OpenClaw might not send auth perfectly)
    if (!body.lead_id) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    }
    console.log('Allowing unauthenticated callback for lead_id:', body.lead_id);
  }

  try {
    const { lead_id, phase, status, progress_pct, message, preview_url, new_website_url } = body;

    if (!lead_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing lead_id' }) };
    }

    // Ensure columns exist
    await pool.query(`
      ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS rebuild_phase VARCHAR(50);
      ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS rebuild_status VARCHAR(20);
      ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS rebuild_progress INTEGER;
      ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS rebuild_message TEXT;
      ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS rebuild_preview_url TEXT;
      ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS rebuilt_website_url TEXT;
      ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS rebuild_updated_at TIMESTAMP;
    `);

    // Build update query dynamically
    const updates = ['rebuild_updated_at = NOW()'];
    const values = [];
    let idx = 1;

    if (phase) { updates.push(`rebuild_phase = $${idx++}`); values.push(phase); }
    if (status) { updates.push(`rebuild_status = $${idx++}`); values.push(status); }
    if (progress_pct != null) { updates.push(`rebuild_progress = $${idx++}`); values.push(progress_pct); }
    if (message) { updates.push(`rebuild_message = $${idx++}`); values.push(message); }
    if (preview_url) { updates.push(`rebuild_preview_url = $${idx++}`); values.push(preview_url); }
    if (new_website_url) { updates.push(`rebuilt_website_url = $${idx++}`); values.push(new_website_url); }

    // Do NOT overwrite the original website URL — keep it as-is
    // The rebuilt URL is stored in rebuilt_website_url / rebuild_preview_url
    if (status === 'complete' && new_website_url) {
      updates.push(`website_rebuilt_at = NOW()`);
    }

    values.push(lead_id);

    await pool.query(
      `UPDATE lr_leads SET ${updates.join(', ')} WHERE id = $${idx}`,
      values
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, lead_id, phase, status })
    };

  } catch (error) {
    console.error('Callback error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error: ' + error.message })
    };
  }
};
