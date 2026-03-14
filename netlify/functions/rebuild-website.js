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

    if (!leadId || !url) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields: leadId, url' })
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

    // Determine the app's base URL for callbacks
    const appBaseUrl = `https://${event.headers.host || 'leadripper2.netlify.app'}`;
    const callbackUrl = `${appBaseUrl}/.netlify/functions/rebuild-callback`;

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
- Lead ID: ${leadId}
- Current Score: ${website_score || 'N/A'}/100 (${website_grade || 'N/A'})
- Issues: ${issues.join(', ')}

IMPORTANT — Progress Callback:
After EACH phase completes, you MUST send a progress update by running:
curl -X POST "${callbackUrl}" -H "Authorization: Bearer ${OPENCLAW_HOOKS_TOKEN}" -H "Content-Type: application/json" -d '<JSON>'

Use these payloads for each phase:
- Scraping started: {"lead_id":${leadId},"phase":"scrape","status":"in_progress","progress_pct":10,"message":"Scraping original website..."}
- Scraping done: {"lead_id":${leadId},"phase":"scrape","status":"complete","progress_pct":20,"message":"Site scraped successfully"}
- Rebuilding started: {"lead_id":${leadId},"phase":"rebuild","status":"in_progress","progress_pct":25,"message":"AI is building your new website..."}
- Rebuilding done: {"lead_id":${leadId},"phase":"rebuild","status":"complete","progress_pct":50,"message":"New website built"}
- QA testing started: {"lead_id":${leadId},"phase":"qa","status":"in_progress","progress_pct":55,"message":"QA agents testing links, images & content..."}
- QA testing done: {"lead_id":${leadId},"phase":"qa","status":"complete","progress_pct":70,"message":"QA passed"}
- Fixing issues (if any): {"lead_id":${leadId},"phase":"fix","status":"in_progress","progress_pct":75,"message":"Fixing QA issues..."}
- Deploying preview: {"lead_id":${leadId},"phase":"deploy","status":"in_progress","progress_pct":80,"message":"Deploying preview site..."}
- Deploy done: {"lead_id":${leadId},"phase":"deploy","status":"complete","progress_pct":85,"message":"Preview ready","preview_url":"<URL>"}
- Emailing customer: {"lead_id":${leadId},"phase":"email","status":"in_progress","progress_pct":90,"message":"Emailing preview to customer..."}
- Email sent: {"lead_id":${leadId},"phase":"email","status":"complete","progress_pct":95,"message":"Email sent to ${contact_email}"}
- Calling customer: {"lead_id":${leadId},"phase":"call","status":"in_progress","progress_pct":97,"message":"AI calling customer..."}
- ALL DONE: {"lead_id":${leadId},"phase":"complete","status":"complete","progress_pct":100,"message":"Pipeline complete!","new_website_url":"<PREVIEW_URL>"}

You MUST call the callback at each step. This updates the LeadRipper dashboard in real-time.`,
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

    // Ensure columns exist and set initial progress
    await pool.query(`
      ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS website_rebuilt_at TIMESTAMP;
      ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS rebuild_phase VARCHAR(50);
      ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS rebuild_status VARCHAR(20);
      ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS rebuild_progress INTEGER;
      ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS rebuild_message TEXT;
      ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS rebuild_preview_url TEXT;
      ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS rebuilt_website_url TEXT;
      ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS rebuild_updated_at TIMESTAMP;
    `);
    await pool.query(
      `UPDATE lr_leads SET
        website_rebuilt_at = NOW(),
        rebuild_phase = 'initialized',
        rebuild_status = 'in_progress',
        rebuild_progress = 5,
        rebuild_message = 'Pipeline launched — starting scrape...',
        rebuild_updated_at = NOW()
      WHERE id = $1 AND user_id = $2`,
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
