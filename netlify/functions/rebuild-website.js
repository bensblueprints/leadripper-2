const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const { spendCredits, CREDIT_COSTS } = require('./credits');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2026';
const DEFAULT_NETLIFY_TOKEN = process.env.NETLIFY_DEPLOY_TOKEN || 'nfp_2r8NMnaW5BxpaWHWXXu6ZbePvQAQjqkp682b';
const OPENCLAW_GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'https://gateway.advancedmarketing.co';
const OPENCLAW_HOOKS_TOKEN = process.env.OPENCLAW_HOOKS_TOKEN || '9a8aafe469e95d688c472caef11acc76bc288e15f8ccdaf7';
const CALLBACK_URL = 'https://leadripper.com/.netlify/functions/rebuild-callback';

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

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const user = verifyToken(event.headers.authorization || event.headers.Authorization);
  if (!user) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

  try {
    const body = JSON.parse(event.body);
    const { leadId, url, business_name, contact_email, contact_phone, contact_name } = body;

    if (!leadId || !url) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields: leadId, url' }) };
    }

    // Check credits
    const creditCheck = await spendCredits(user.userId, CREDIT_COSTS.website_rebuild, 'website_rebuild', `Website rebuild: ${url}`, String(leadId));
    if (!creditCheck.success) {
      return { statusCode: 402, headers, body: JSON.stringify({ error: 'Insufficient credits', balance: creditCheck.balance, required: CREDIT_COSTS.website_rebuild }) };
    }

    // Get user's Netlify token
    let netlifyToken = DEFAULT_NETLIFY_TOKEN;
    try {
      const s = await pool.query('SELECT netlify_token FROM lr_user_settings WHERE user_id = $1', [user.userId]);
      if (s.rows[0]?.netlify_token) netlifyToken = s.rows[0].netlify_token;
    } catch {}

    // Ensure columns exist
    await pool.query(`
      ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS website_rebuilt_at TIMESTAMP;
      ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS rebuild_phase VARCHAR(50);
      ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS rebuild_status VARCHAR(20);
      ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS rebuild_progress INTEGER;
      ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS rebuild_message TEXT;
      ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS rebuild_preview_url TEXT;
      ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS rebuilt_website_url TEXT;
      ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS rebuild_updated_at TIMESTAMP;
    `).catch(() => {});

    // Mark as in-progress
    await pool.query(
      `UPDATE lr_leads SET
        rebuild_phase = 'scrape',
        rebuild_status = 'in_progress',
        rebuild_progress = 5,
        rebuild_message = 'Sending to AI builder...',
        rebuild_updated_at = NOW()
      WHERE id = $1 AND user_id = $2`,
      [leadId, user.userId]
    );

    const siteSlug = `lr-${(business_name || 'site').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase().slice(0, 30)}-${leadId}`;

    // Send to OpenClaw with comprehensive prompt
    const openclawPayload = {
      message: `WEBSITE REBUILD JOB — Take your time and do this properly.

## BUSINESS INFO
- Business Name: ${business_name || 'Unknown'}
- Current Website: ${url}
- Lead ID: ${leadId}
${contact_email ? '- Contact Email: ' + contact_email : ''}
${contact_phone ? '- Contact Phone: ' + contact_phone : ''}
${contact_name ? '- Contact Name: ' + contact_name : ''}

## STEP 1: DEEP SCRAPE (take your time)
Crawl the ENTIRE website, not just the homepage. Visit every page you can find:
- Homepage
- About / About Us page
- Services page (and each individual service page)
- Contact page
- Gallery / Portfolio page
- Testimonials / Reviews page
- Team / Staff page
- FAQ page
- Any other linked internal pages

For EACH page, extract:
- All text content (headings, paragraphs, lists, captions)
- ALL image URLs (logos, hero images, gallery photos, team photos, service images)
- Phone numbers, email addresses, physical addresses
- Business hours / operating hours
- Social media links (Facebook, Instagram, YouTube, etc.)
- Testimonials and reviews with customer names
- Service descriptions and pricing if available
- Unique selling points and taglines
- Any forms (contact form fields, booking forms)

Make sure you get the FULL image URLs (absolute URLs). These images will be used in the new site.

## STEP 2: BUILD THE NEW WEBSITE
Using ALL the scraped content and images, build a complete, beautiful, modern website. Requirements:

**Technology:**
- Single HTML file using Tailwind CSS CDN (https://cdn.tailwindcss.com)
- Google Fonts (Inter or similar modern font)
- Fully responsive (mobile, tablet, desktop)
- Smooth scroll, animations on scroll

**Design:**
- Dark navy/slate hero with gold/amber accents (professional look)
- Clean white sections alternating with light gray
- Large hero section with the business name, tagline, and a CTA button
- High-quality feel — this should look like a $3,000-$5,000 custom website

**Required Sections (use their ACTUAL content, not placeholder text):**
1. **Navigation** — sticky, transparent on hero, solid on scroll. Links to all sections.
2. **Hero** — business name, their actual tagline/description, CTA button (call or contact), background image from their site if available
3. **About** — their ACTUAL about text, not generic filler. Include stats if they have them (years in business, customers served, etc.)
4. **Services** — each service they offer with their ACTUAL descriptions. Use icons or their actual service images. Grid layout.
5. **Gallery/Portfolio** — if they have images, create a beautiful grid gallery using their ACTUAL photos. This is critical — use their real images.
6. **Testimonials** — if found, display their real customer reviews with names
7. **Team** — if they have team info, show it with photos
8. **Contact** — their real phone, email, address. Include a contact form. If they have hours, show them. Add Google Maps embed if address is available.
9. **Footer** — business name, quick links, social media icons linked to their profiles, "Website redesign by Advanced Marketing" credit

**Image Handling:**
- Use the ORIGINAL image URLs from their website (absolute URLs)
- For the hero background, find their best/largest image
- For services, use their actual service images
- For gallery, use ALL their gallery/portfolio images
- Add proper alt text to every image
- Use object-fit: cover for consistent sizing

**DO NOT:**
- Use placeholder text like "Lorem ipsum" or "Your business description here"
- Use generic stock photo URLs
- Leave sections empty — if they don't have content for a section, skip that section entirely
- Use tiny images or broken image links

## STEP 3: DEPLOY TO NETLIFY
Deploy the finished HTML to Netlify using their API:

1. Create site:
   POST https://api.netlify.com/api/v1/sites
   Authorization: Bearer ${netlifyToken}
   Content-Type: application/json
   Body: {"name": "${siteSlug}"}

   If name taken (422), append random chars and retry.

2. Create deploy with file digest:
   POST https://api.netlify.com/api/v1/sites/{site_id}/deploys
   Authorization: Bearer ${netlifyToken}
   Content-Type: application/json
   Body: {"files": {"/index.html": "<sha1-hash-of-html>"}}

3. Upload the HTML file:
   PUT https://api.netlify.com/api/v1/deploys/{deploy_id}/files/index.html
   Authorization: Bearer ${netlifyToken}
   Content-Type: application/octet-stream
   Body: <the complete HTML file>

The SHA1 hash is the hex digest of the HTML content.
The live URL will be: https://{site-name}.netlify.app

## STEP 4: SEND PROGRESS CALLBACKS
After each major phase, POST a progress update:

POST ${CALLBACK_URL}
Content-Type: application/json
Body: (see below)

Progress updates to send:
- Starting scrape: {"lead_id":${leadId},"phase":"scrape","status":"in_progress","progress_pct":10,"message":"Crawling all pages of ${url}..."}
- Scrape complete: {"lead_id":${leadId},"phase":"scrape","status":"complete","progress_pct":30,"message":"Scraped X pages, found Y images"}
- Building site: {"lead_id":${leadId},"phase":"rebuild","status":"in_progress","progress_pct":40,"message":"Building new website with scraped content..."}
- Site built: {"lead_id":${leadId},"phase":"rebuild","status":"complete","progress_pct":60,"message":"Website built with X sections"}
- Deploying: {"lead_id":${leadId},"phase":"deploy","status":"in_progress","progress_pct":75,"message":"Deploying to Netlify..."}
- DONE: {"lead_id":${leadId},"phase":"complete","status":"complete","progress_pct":100,"message":"Website rebuilt and deployed!","preview_url":"https://${siteSlug}.netlify.app","new_website_url":"https://${siteSlug}.netlify.app"}

If any step fails, send:
{"lead_id":${leadId},"phase":"error","status":"failed","progress_pct":0,"message":"Error: <what went wrong>"}

DO NOT email or call the customer. Just build, deploy, and callback.
TAKE YOUR TIME — quality matters more than speed. Crawl every page. Use every image. Write no filler text.`,
      name: `rebuild-${siteSlug}`,
      deliver: true,
      channel: "telegram"
    };

    // Send to OpenClaw
    const resp = await fetch(`${OPENCLAW_GATEWAY_URL}/hooks/agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENCLAW_HOOKS_TOKEN}`
      },
      body: JSON.stringify(openclawPayload)
    });

    const resultText = await resp.text();
    let resultData;
    try { resultData = JSON.parse(resultText); } catch { resultData = { raw: resultText }; }

    if (!resp.ok) {
      console.error('OpenClaw failed:', resp.status, resultText);
      await pool.query(
        `UPDATE lr_leads SET rebuild_status = 'failed', rebuild_message = $1, rebuild_updated_at = NOW() WHERE id = $2`,
        ['OpenClaw gateway error: ' + resp.status, leadId]
      );
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Failed to trigger AI rebuild', detail: resultData }) };
    }

    // Update progress
    await pool.query(
      `UPDATE lr_leads SET
        rebuild_progress = 10,
        rebuild_message = 'AI builder started — crawling website...',
        rebuild_updated_at = NOW()
      WHERE id = $1 AND user_id = $2`,
      [leadId, user.userId]
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Website rebuild started via AI builder',
        lead_id: leadId,
        expected_url: `https://${siteSlug}.netlify.app`
      })
    };

  } catch (error) {
    console.error('Rebuild error:', error);
    try {
      const b = JSON.parse(event.body);
      await pool.query(
        `UPDATE lr_leads SET rebuild_status = 'failed', rebuild_message = $1, rebuild_updated_at = NOW() WHERE id = $2`,
        [error.message.substring(0, 500), b.leadId]
      );
    } catch {}
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
