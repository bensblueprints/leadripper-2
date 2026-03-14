const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2026';
const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_KEY || 'AIzaSyCngyzhiymWqY3ypkY4U5znvC_m18F1srA';

function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try { return jwt.verify(authHeader.split(' ')[1], JWT_SECRET); } catch { return null; }
}

// ═══════════════════════════════════════════
// WEBSITE ANALYSIS
// ═══════════════════════════════════════════
async function analyzeWebsite(url) {
  const result = {
    loads: false, ssl: false, loadTime: null, error: null,
    title: null, metaDescription: null, hasH1: false,
    mobile: false, modernDesign: true, outdatedSignals: [],
    // Tech stack
    hasGTM: false, hasGA: false, hasFBPixel: false, hasGoogleAdsPixel: false,
    hasGoogleAds: false, hasHotjar: false, hasChatWidget: false, chatWidgetName: null,
    // Hosting detection
    hostingPlatform: null,
    // Contact & CTA
    hasPhone: false, hasEmail: false, hasAddress: false, hasForm: false,
    hasCTA: false, hasSocialLinks: false, socialPlatforms: [],
    // Copyright
    copyrightYear: null, copyrightCurrent: false,
    // Content quality
    wordCount: 0, imageCount: 0, linkCount: 0,
  };

  if (!url.startsWith('http')) url = 'https://' + url;

  const startTime = Date.now();
  let html = '';

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      },
      signal: controller.signal, redirect: 'follow'
    });
    clearTimeout(timeoutId);
    result.loadTime = Date.now() - startTime;
    if (!res.ok) { result.error = 'HTTP ' + res.status; return result; }
    html = await res.text();
    result.loads = true;
    result.ssl = url.startsWith('https://') || (res.url || '').startsWith('https://');
  } catch (e) {
    result.error = e.name === 'AbortError' ? 'Timed out after 10s' : e.message;
    return result;
  }

  // Also check HTTPS if loaded via HTTP
  if (!result.ssl) {
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch(url.replace(/^http:/, 'https:'), { signal: ctrl.signal, redirect: 'follow' });
      if (r.ok) result.ssl = true;
    } catch {}
  }

  const h = html.toLowerCase();

  // ── SEO ──
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  result.title = titleMatch ? titleMatch[1].trim() : null;
  result.metaDescription = /meta\s+name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']+)["']/i.test(html) ||
    /meta\s+content\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']description["']/i.test(html);
  result.hasH1 = /<h1[\s>]/i.test(html);

  // ── Mobile ──
  result.mobile = /meta\s+name\s*=\s*["']viewport["']/i.test(html) ||
    /@media\s*\(/i.test(html) || /bootstrap|tailwind|foundation/i.test(html);

  // ── Modern Design ──
  const outdated = [];
  if ((h.match(/<table/g) || []).length > 3) outdated.push('excessive tables');
  if (/\.swf|<embed[^>]*flash|shockwave/i.test(html)) outdated.push('flash');
  if (/<marquee/i.test(html)) outdated.push('marquee');
  if (/<frameset|<frame\s/i.test(html)) outdated.push('frames');
  if ((h.match(/<font[\s>]/g) || []).length > 5) outdated.push('font tags');
  if ((h.match(/<center[\s>]/g) || []).length > 3) outdated.push('center tags');
  if (/<!DOCTYPE\s+HTML\s+PUBLIC/i.test(html)) outdated.push('old doctype');
  result.outdatedSignals = outdated;
  result.modernDesign = outdated.length <= 1;

  // ── Tech Stack / Tracking ──
  result.hasGTM = /googletagmanager\.com\/gtm|GTM-[A-Z0-9]+/i.test(html);
  result.hasGA = /google-analytics\.com|googletagmanager\.com\/gtag|gtag\s*\(\s*['"]config['"]|ga\s*\(\s*['"]create['"]|analytics\.js|G-[A-Z0-9]+|UA-\d+-\d+/i.test(html);
  result.hasFBPixel = /connect\.facebook\.net\/.*fbevents|fbq\s*\(\s*['"]init['"]|facebook.*pixel/i.test(html);
  result.hasGoogleAdsPixel = /googleads\.g\.doubleclick|googleadservices\.com\/pagead\/conversion|AW-[0-9]+/i.test(html);
  result.hasGoogleAds = result.hasGoogleAdsPixel; // Detected via pixel
  result.hasHotjar = /hotjar\.com|hj\s*\(\s*['"]init['"]/i.test(html);

  // ── Chat Widget ──
  const chatWidgets = [
    { name: 'Tawk.to', pattern: /tawk\.to/i },
    { name: 'Intercom', pattern: /intercom\.com|intercomcdn/i },
    { name: 'Drift', pattern: /drift\.com|driftt/i },
    { name: 'LiveChat', pattern: /livechat\.com|livechatinc/i },
    { name: 'Zendesk', pattern: /zdassets\.com|zendesk/i },
    { name: 'HubSpot Chat', pattern: /hubspot\.com.*conversations|hs-scripts/i },
    { name: 'Crisp', pattern: /crisp\.chat/i },
    { name: 'Olark', pattern: /olark\.com/i },
    { name: 'Tidio', pattern: /tidio\.co/i },
    { name: 'GoHighLevel', pattern: /leadconnectorhq\.com|msgsndr\.com/i },
    { name: 'Facebook Messenger', pattern: /connect\.facebook\.net.*customerchat|fb-customerchat/i },
  ];
  for (const cw of chatWidgets) {
    if (cw.pattern.test(html)) {
      result.hasChatWidget = true;
      result.chatWidgetName = cw.name;
      break;
    }
  }

  // ── Hosting Platform ──
  const hostingPatterns = [
    { name: 'WordPress', pattern: /wp-content|wp-includes|wordpress/i },
    { name: 'Wix', pattern: /wix\.com|wixstatic\.com/i },
    { name: 'Squarespace', pattern: /squarespace\.com|sqsp\.com/i },
    { name: 'Shopify', pattern: /shopify\.com|cdn\.shopify/i },
    { name: 'GoDaddy', pattern: /godaddy\.com|secureserver\.net/i },
    { name: 'Webflow', pattern: /webflow\.com|webflow\.io/i },
    { name: 'Weebly', pattern: /weebly\.com/i },
    { name: 'LeadConnector/GHL', pattern: /leadconnectorhq|msgsndr\.com/i },
    { name: 'HubSpot CMS', pattern: /hubspot\.com.*hub_generated|hs-sites/i },
    { name: 'Netlify', pattern: /netlify/i },
    { name: 'Vercel', pattern: /vercel\.app|_next/i },
    { name: 'Google Sites', pattern: /sites\.google\.com/i },
  ];
  for (const hp of hostingPatterns) {
    if (hp.pattern.test(html)) { result.hostingPlatform = hp.name; break; }
  }

  // ── Contact Info ──
  result.hasPhone = /(\(\d{3}\)\s*\d{3}[-.]?\d{4}|\d{3}[-.]?\d{3}[-.]?\d{4}|tel:|phone)/i.test(html);
  result.hasEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i.test(html) || /mailto:/i.test(html);
  result.hasAddress = /\d+\s+[A-Za-z]+\s+(St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court)/i.test(html) || /address/i.test(html);
  result.hasForm = /<form[\s>]/i.test(html);
  result.hasCTA = (/<button[\s>]/i.test(html) || /class\s*=\s*["'][^"']*btn[^"']*["']/i.test(html)) &&
    /(get started|sign up|contact us|free quote|book now|schedule|learn more|get a quote|request|call now|buy now|order now|subscribe|download|try free)/i.test(html);

  // ── Social Links ──
  const socials = [
    { name: 'Facebook', p: /facebook\.com|fb\.com/i },
    { name: 'Twitter/X', p: /twitter\.com|x\.com/i },
    { name: 'Instagram', p: /instagram\.com/i },
    { name: 'LinkedIn', p: /linkedin\.com/i },
    { name: 'YouTube', p: /youtube\.com/i },
    { name: 'TikTok', p: /tiktok\.com/i },
    { name: 'Pinterest', p: /pinterest\.com/i },
    { name: 'Yelp', p: /yelp\.com/i },
  ];
  result.socialPlatforms = socials.filter(s => s.p.test(html)).map(s => s.name);
  result.hasSocialLinks = result.socialPlatforms.length > 0;

  // ── Copyright ──
  const currentYear = new Date().getFullYear();
  const cpMatches = html.match(/(?:©|\bcopyright\b|&copy;)\s*(\d{4})/gi) || [];
  let latestYear = 0;
  for (const m of cpMatches) {
    const ym = m.match(/(\d{4})/);
    if (ym) { const y = parseInt(ym[1]); if (y > latestYear && y <= currentYear + 1) latestYear = y; }
  }
  const rangeMatches = html.match(/(?:©|\bcopyright\b|&copy;)\s*\d{4}\s*[-–]\s*(\d{4})/gi) || [];
  for (const m of rangeMatches) {
    const yrs = m.match(/(\d{4})/g);
    if (yrs && yrs.length >= 2) { const y = parseInt(yrs[yrs.length - 1]); if (y > latestYear && y <= currentYear + 1) latestYear = y; }
  }
  result.copyrightYear = latestYear > 0 ? latestYear : null;
  result.copyrightCurrent = latestYear > 0 && (currentYear - latestYear) <= 1;

  // ── Content Stats ──
  const textOnly = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ');
  result.wordCount = textOnly.split(/\s+/).filter(w => w.length > 1).length;
  result.imageCount = (html.match(/<img[\s>]/gi) || []).length;
  result.linkCount = (html.match(/<a[\s>]/gi) || []).length;

  return result;
}

// ═══════════════════════════════════════════
// GOOGLE BUSINESS PROFILE LOOKUP
// ═══════════════════════════════════════════
async function lookupGBP(businessName, address) {
  const gbp = {
    found: false, placeId: null, name: null, rating: 0, totalReviews: 0,
    address: null, phone: null, website: null, hours: null,
    hasPhotos: false, photoCount: 0, types: [],
    addressVerified: false, phoneVerified: false, websiteVerified: false,
    hoursVerified: false, photosVerified: false,
  };

  if (!GOOGLE_MAPS_KEY) return gbp;

  const query = encodeURIComponent(`${businessName} ${address || ''}`);
  try {
    const searchRes = await fetch(
      `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${query}&inputtype=textquery&fields=place_id,name,formatted_address,rating,user_ratings_total,types&key=${GOOGLE_MAPS_KEY}`
    );
    const searchData = await searchRes.json();
    if (!searchData.candidates || searchData.candidates.length === 0) return gbp;

    const candidate = searchData.candidates[0];
    gbp.found = true;
    gbp.placeId = candidate.place_id;
    gbp.name = candidate.name;
    gbp.rating = candidate.rating || 0;
    gbp.totalReviews = candidate.user_ratings_total || 0;
    gbp.types = candidate.types || [];

    // Get full details
    const detailRes = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${candidate.place_id}&fields=name,formatted_address,formatted_phone_number,website,opening_hours,photos,reviews,url&key=${GOOGLE_MAPS_KEY}`
    );
    const detailData = await detailRes.json();
    const place = detailData.result;
    if (place) {
      gbp.address = place.formatted_address || null;
      gbp.phone = place.formatted_phone_number || null;
      gbp.website = place.website || null;
      gbp.hours = place.opening_hours ? (place.opening_hours.weekday_text || []) : null;
      gbp.hasPhotos = !!(place.photos && place.photos.length > 0);
      gbp.photoCount = place.photos ? place.photos.length : 0;
      gbp.reviews = (place.reviews || []).map(r => ({
        author: r.author_name, rating: r.rating,
        text: (r.text || '').slice(0, 300), time: r.relative_time_description
      }));
      gbp.mapsUrl = place.url || null;

      // Verification flags
      gbp.addressVerified = !!place.formatted_address;
      gbp.phoneVerified = !!place.formatted_phone_number;
      gbp.websiteVerified = !!place.website;
      gbp.hoursVerified = !!(place.opening_hours && place.opening_hours.weekday_text);
      gbp.photosVerified = gbp.photoCount >= 3;
    }
  } catch (e) {
    console.error('GBP lookup error:', e.message);
  }

  return gbp;
}

// ═══════════════════════════════════════════
// SCORING
// ═══════════════════════════════════════════
function calculateScores(website, gbp) {
  // ── Website & Tech Stack (40%) ──
  const websiteChecks = {
    loads: { pass: website.loads, weight: 5, label: 'Website Loads' },
    ssl: { pass: website.ssl, weight: 5, label: 'SSL/HTTPS Security' },
    mobile: { pass: website.mobile, weight: 5, label: 'Mobile Responsive' },
    title: { pass: !!website.title, weight: 3, label: 'Has Title Tag' },
    metaDesc: { pass: !!website.metaDescription, weight: 3, label: 'Has Meta Description' },
    h1: { pass: website.hasH1, weight: 2, label: 'Has H1 Tag' },
    modern: { pass: website.modernDesign, weight: 5, label: 'Modern Design' },
    chatWidget: { pass: website.hasChatWidget, weight: 4, label: 'Chat Widget', detail: website.chatWidgetName || 'Not found' },
    hosting: { pass: !!website.hostingPlatform, weight: 3, label: 'Identified Hosting', detail: website.hostingPlatform || 'Unknown' },
    contactInfo: { pass: website.hasPhone || website.hasEmail, weight: 3, label: 'Contact Info on Site' },
    cta: { pass: website.hasCTA || website.hasForm, weight: 4, label: 'Clear Call-to-Action' },
    copyright: { pass: website.copyrightCurrent, weight: 3, label: 'Current Copyright Year', detail: website.copyrightYear ? `${website.copyrightYear}` : 'Not found' },
  };

  const techChecks = {
    gtm: { pass: website.hasGTM, weight: 4, label: 'Google Tag Manager' },
    ga: { pass: website.hasGA, weight: 5, label: 'Google Analytics' },
    fbPixel: { pass: website.hasFBPixel, weight: 4, label: 'Facebook Pixel' },
    gadsPixel: { pass: website.hasGoogleAdsPixel, weight: 4, label: 'Google Ads Pixel' },
    socialLinks: { pass: website.hasSocialLinks, weight: 3, label: 'Social Media Links', detail: website.socialPlatforms.join(', ') || 'None' },
  };

  // ── Google Business Profile (30%) ──
  const gbpChecks = {
    claimed: { pass: gbp.found, weight: 6, label: 'Profile Found & Claimed' },
    address: { pass: gbp.addressVerified, weight: 4, label: 'Business Address' },
    website: { pass: gbp.websiteVerified, weight: 4, label: 'Business Website' },
    phone: { pass: gbp.phoneVerified, weight: 4, label: 'Phone Number' },
    hours: { pass: gbp.hoursVerified, weight: 4, label: 'Operational Hours' },
    photos: { pass: gbp.photosVerified, weight: 4, label: 'Google Photos (3+)', detail: `${gbp.photoCount} photos` },
    reviews: { pass: gbp.totalReviews >= 5, weight: 4, label: 'Has Reviews (5+)', detail: `${gbp.totalReviews} reviews, ${gbp.rating} stars` },
  };

  // Calculate section scores
  function sectionScore(checks) {
    let earned = 0, total = 0;
    for (const c of Object.values(checks)) { total += c.weight; if (c.pass) earned += c.weight; }
    return total > 0 ? Math.round((earned / total) * 100) : 0;
  }

  const websiteScore = sectionScore(websiteChecks);
  const techScore = sectionScore(techChecks);
  const gbpScore = sectionScore(gbpChecks);

  // Reputation score from reviews
  const reputationScore = gbp.found
    ? Math.min(100, Math.round(((gbp.rating / 5) * 60) + (Math.min(gbp.totalReviews, 50) / 50 * 40)))
    : 0;

  // Overall weighted score
  const overall = Math.round(
    websiteScore * 0.30 +
    techScore * 0.20 +
    gbpScore * 0.30 +
    reputationScore * 0.20
  );

  let grade, gradeLabel;
  if (overall >= 80) { grade = 'A'; gradeLabel = 'Strong online presence'; }
  else if (overall >= 65) { grade = 'B'; gradeLabel = 'Decent - room for improvement'; }
  else if (overall >= 50) { grade = 'C'; gradeLabel = 'Mediocre - needs work'; }
  else if (overall >= 30) { grade = 'D'; gradeLabel = 'Poor - strong sales opportunity'; }
  else { grade = 'F'; gradeLabel = 'Weak online presence - best lead for sales'; }

  return {
    overall, grade, gradeLabel,
    sections: {
      website: { score: websiteScore, checks: websiteChecks },
      techStack: { score: techScore, checks: techChecks },
      gbp: { score: gbpScore, checks: gbpChecks },
      reputation: { score: reputationScore },
    },
    websiteData: website,
    gbpData: gbp,
  };
}

// ═══════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const decoded = verifyToken(event.headers.authorization);
  if (!decoded) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

  try {
    const { url, leadId, businessName, address } = JSON.parse(event.body);
    if (!url) return { statusCode: 400, headers, body: JSON.stringify({ error: 'URL is required' }) };

    // Run both analyses in parallel
    const [websiteResult, gbpResult] = await Promise.all([
      analyzeWebsite(url),
      lookupGBP(businessName || '', address || '')
    ]);

    const scores = calculateScores(websiteResult, gbpResult);

    // Save to lead if leadId provided
    if (leadId) {
      try {
        await pool.query(`
          ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS website_score INTEGER;
          ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS website_grade VARCHAR(2);
          ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS website_analysis JSONB;
          ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS website_analyzed_at TIMESTAMP;
        `);
      } catch {}

      await pool.query(
        `UPDATE lr_leads SET website_score=$1, website_grade=$2, website_analysis=$3, website_analyzed_at=NOW() WHERE id=$4 AND user_id=$5`,
        [scores.overall, scores.grade, JSON.stringify(scores), leadId, decoded.userId]
      );
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        success: true,
        score: scores.overall,
        grade: scores.grade,
        gradeLabel: scores.gradeLabel,
        sections: scores.sections,
        websiteData: scores.websiteData,
        gbpData: scores.gbpData,
        analyzedAt: new Date().toISOString(),
      })
    };
  } catch (error) {
    console.error('Analyze error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
