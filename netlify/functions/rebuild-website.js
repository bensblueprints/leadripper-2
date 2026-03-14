const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2026';

// OpenClaw gateway config — set these as Netlify env vars in production
const OPENCLAW_GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'https://gateway.advancedmarketing.co';
const OPENCLAW_HOOKS_TOKEN = process.env.OPENCLAW_HOOKS_TOKEN || '9a8aafe469e95d688c472caef11acc76bc288e15f8ccdaf7';

function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try { return jwt.verify(authHeader.split(' ')[1], JWT_SECRET); } catch { return null; }
}

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

  // Verify auth
  const user = verifyToken(event.headers.authorization || event.headers.Authorization);
  if (!user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const {
      leadId,
      url,
      business_name,
      contact_email,
      contact_phone,
      contact_name,
      website_score,
      website_grade,
      website_analysis
    } = body;

    if (!leadId || !url || !contact_email) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields: leadId, url, contact_email' })
      };
    }

    // Build the issues list from website analysis
    const issues = [];
    if (website_score && website_score < 50) issues.push('low website score');
    if (website_grade === 'F' || website_grade === 'D') issues.push('poor website grade');
    if (website_analysis) {
      if (typeof website_analysis === 'string') {
        issues.push(website_analysis);
      } else if (website_analysis.outdatedSignals) {
        issues.push(...website_analysis.outdatedSignals);
      }
    }
    if (issues.length === 0) issues.push('outdated design', 'needs modernization');

    // Send webhook to OpenClaw gateway to trigger the lead-rebuilder skill
    const openclawPayload = {
      message: `lead-rebuild: Rebuild the website for ${business_name}. Their current site is ${url}.

Use the lead-rebuilder skill to:
1. Scrape their current website at ${url}
2. Build a beautiful new modern website with Tailwind CSS using their original content
3. Run QA sub-agents to check all links, images, and content accuracy
4. Email the preview to ${contact_email} (${contact_name}) via himalaya
5. Trigger the AI calling agent to call ${contact_phone || 'N/A'} and tell them to check their email for their free website redesign preview

Lead details:
- Business: ${business_name}
- Website: ${url}
- Email: ${contact_email}
- Phone: ${contact_phone || 'N/A'}
- Contact: ${contact_name}
- Current Score: ${website_score || 'N/A'}/100 (${website_grade || 'N/A'})
- Issues: ${issues.join(', ')}`,
      name: `rebuild-${business_name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`,
      deliver: true,
      channel: "telegram"
    };

    const openclawResponse = await fetch(`${OPENCLAW_GATEWAY_URL}/hooks/agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENCLAW_HOOKS_TOKEN}`
      },
      body: JSON.stringify(openclawPayload)
    });

    const openclawResult = await openclawResponse.text();
    let resultData;
    try {
      resultData = JSON.parse(openclawResult);
    } catch {
      resultData = { raw: openclawResult };
    }

    if (!openclawResponse.ok) {
      console.error('OpenClaw webhook failed:', openclawResponse.status, openclawResult);
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          error: 'Failed to trigger AI rebuild pipeline',
          detail: resultData
        })
      };
    }

    // Ensure column exists and update lead
    await pool.query(`ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS website_rebuilt_at TIMESTAMP`);
    await pool.query(
      `UPDATE lr_leads SET website_rebuilt_at = NOW() WHERE id = $1 AND user_id = $2`,
      [leadId, user.userId]
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `AI rebuild pipeline launched for ${business_name}`,
        lead_id: leadId,
        openclaw: resultData
      })
    };

  } catch (error) {
    console.error('Rebuild error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error: ' + error.message })
    };
  }
};
