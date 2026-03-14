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

    const callbackUrl = 'https://leadripper.com/.netlify/functions/rebuild-callback';
    const NETLIFY_TOKEN = 'nfp_2r8NMnaW5BxpaWHWXXu6ZbePvQAQjqkp682b';
    const siteSlug = `lr-${(business_name || 'site').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase().slice(0, 30)}-${leadId}`;

    const openclawPayload = {
      message: `Build a new website for "${business_name}".

TASK:
1. Fetch their current website at ${url} and extract all content (business name, services, about text, phone, address, testimonials, images)
2. Build a complete, beautiful, modern single-page website using Tailwind CSS CDN with their extracted content
3. The site must be mobile-responsive, professional, and conversion-focused with CTAs
4. Deploy the finished HTML to Netlify using their API

NETLIFY DEPLOYMENT:
- API Token: ${NETLIFY_TOKEN}
- Site name: ${siteSlug}

Step 1 - Create site:
POST https://api.netlify.com/api/v1/sites
Authorization: Bearer ${NETLIFY_TOKEN}
Content-Type: application/json
Body: {"name": "${siteSlug}"}

Step 2 - Deploy (after creating, use the site_id from response):
POST https://api.netlify.com/api/v1/sites/{site_id}/deploys
Authorization: Bearer ${NETLIFY_TOKEN}
Content-Type: application/json
Body: {"files": {"/index.html": "<sha1-of-html>"}}

Step 3 - Upload the HTML file:
PUT https://api.netlify.com/api/v1/deploys/{deploy_id}/files/index.html
Authorization: Bearer ${NETLIFY_TOKEN}
Content-Type: application/octet-stream
Body: <the full HTML content>

The deployed URL will be: https://${siteSlug}.netlify.app

AFTER DEPLOYING, send a callback to save the URL:
POST ${callbackUrl}
Authorization: Bearer ${OPENCLAW_HOOKS_TOKEN}
Content-Type: application/json
Body: {"lead_id":${leadId},"phase":"complete","status":"complete","progress_pct":100,"message":"Website built and deployed","preview_url":"https://${siteSlug}.netlify.app","new_website_url":"https://${siteSlug}.netlify.app"}

Also send progress callbacks during the build:
- Start: {"lead_id":${leadId},"phase":"scrape","status":"in_progress","progress_pct":10,"message":"Scraping website..."}
- Building: {"lead_id":${leadId},"phase":"rebuild","status":"in_progress","progress_pct":40,"message":"Building new website..."}
- Deploying: {"lead_id":${leadId},"phase":"deploy","status":"in_progress","progress_pct":80,"message":"Deploying to Netlify..."}

Lead details:
- Business: ${business_name}
- Website: ${url}
- Lead ID: ${leadId}
- Score: ${website_score || 'N/A'}/100 (${website_grade || 'N/A'})
- Issues: ${issues.join(', ')}
${contact_email ? '- Email: ' + contact_email : ''}
${contact_phone ? '- Phone: ' + contact_phone : ''}
${contact_name ? '- Contact: ' + contact_name : ''}

DO NOT email or call the customer. Just build, deploy, and callback.`,
      name: `rebuild-${siteSlug}`,
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
