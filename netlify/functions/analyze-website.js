const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2026';

function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.split(' ')[1];
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

/**
 * Analyze a website for quality signals
 * Returns a score out of 100 with individual checks
 */
async function analyzeWebsite(url) {
  const checks = {
    loads: { label: 'Website Loads', pass: false, weight: 15 },
    ssl: { label: 'SSL/HTTPS', pass: false, weight: 10 },
    mobile: { label: 'Mobile Responsive', pass: false, weight: 10 },
    title: { label: 'Has Title Tag', pass: false, weight: 5 },
    metaDescription: { label: 'Has Meta Description', pass: false, weight: 5 },
    h1: { label: 'Has H1 Tag', pass: false, weight: 5 },
    modernDesign: { label: 'Modern Design Patterns', pass: false, weight: 10 },
    socialLinks: { label: 'Social Media Links', pass: false, weight: 5 },
    contactInfo: { label: 'Contact Info Present', pass: false, weight: 10 },
    cta: { label: 'Clear Call-to-Action', pass: false, weight: 10 },
    analytics: { label: 'Analytics/Tracking', pass: false, weight: 5 },
    copyrightCurrent: { label: 'Copyright Year Current', pass: false, weight: 10 }
  };

  let html = '';

  // Ensure URL has protocol
  if (!url.startsWith('http')) {
    url = 'https://' + url;
  }

  const isHttps = url.startsWith('https://');

  // Try to fetch the website
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: controller.signal,
      redirect: 'follow'
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      // Site returned error
      return buildResult(checks, url, 'Site returned HTTP ' + response.status);
    }

    html = await response.text();
    checks.loads.pass = true;

    // Check if final URL is HTTPS (may have redirected)
    const finalUrl = response.url || url;
    checks.ssl.pass = isHttps || finalUrl.startsWith('https://');

  } catch (error) {
    // Site didn't load at all
    const errorMsg = error.name === 'AbortError' ? 'Timed out after 10s' : error.message;
    return buildResult(checks, url, errorMsg);
  }

  // If we also want to try the HTTPS version when HTTP was given
  if (!isHttps && !checks.ssl.pass) {
    try {
      const httpsUrl = url.replace(/^http:\/\//, 'https://');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const httpsResponse = await fetch(httpsUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: controller.signal,
        redirect: 'follow'
      });
      clearTimeout(timeoutId);
      if (httpsResponse.ok) {
        checks.ssl.pass = true;
      }
    } catch {
      // HTTPS not available
    }
  }

  const htmlLower = html.toLowerCase();

  // --- Mobile Responsiveness ---
  checks.mobile.pass = /meta\s+name\s*=\s*["']viewport["']/i.test(html) ||
    /@media\s*\(/i.test(html) ||
    /bootstrap/i.test(html) ||
    /tailwind/i.test(html) ||
    /responsive/i.test(html);

  // --- SEO: Title Tag ---
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  checks.title.pass = !!(titleMatch && titleMatch[1].trim().length > 0);

  // --- SEO: Meta Description ---
  checks.metaDescription.pass = /meta\s+name\s*=\s*["']description["'][^>]*content\s*=\s*["'][^"']+["']/i.test(html) ||
    /meta\s+content\s*=\s*["'][^"']+["'][^>]*name\s*=\s*["']description["']/i.test(html);

  // --- SEO: H1 Tag ---
  checks.h1.pass = /<h1[\s>]/i.test(html);

  // --- Modern vs Outdated Design ---
  const outdatedSignals = [];
  // Tables for layout (multiple nested tables)
  if ((htmlLower.match(/<table/g) || []).length > 3) outdatedSignals.push('excessive tables');
  // Flash content
  if (/\.swf|<embed[^>]*flash|<object[^>]*flash|shockwave/i.test(html)) outdatedSignals.push('flash');
  // Marquee tags
  if (/<marquee/i.test(html)) outdatedSignals.push('marquee');
  // Excessive inline styles (more than 20 style= attributes suggests old patterns)
  const inlineStyleCount = (html.match(/style\s*=\s*["']/gi) || []).length;
  if (inlineStyleCount > 30) outdatedSignals.push('excessive inline styles');
  // Frames/framesets
  if (/<frameset|<frame\s/i.test(html)) outdatedSignals.push('frames');
  // Font tags
  if ((htmlLower.match(/<font[\s>]/g) || []).length > 5) outdatedSignals.push('font tags');
  // Center tags
  if ((htmlLower.match(/<center[\s>]/g) || []).length > 3) outdatedSignals.push('center tags');
  // Old DOCTYPE or missing
  if (/<!DOCTYPE\s+HTML\s+PUBLIC/i.test(html)) outdatedSignals.push('old doctype');
  // Check for modern frameworks/tools
  const modernSignals = /react|angular|vue|next|nuxt|gatsby|tailwind|bootstrap|webpack|vite/i.test(html);
  const hasCSS = /<link[^>]*stylesheet/i.test(html) || /<style[\s>]/i.test(html);

  checks.modernDesign.pass = outdatedSignals.length <= 1 && (modernSignals || hasCSS);
  checks.modernDesign.details = outdatedSignals.length > 0
    ? 'Outdated: ' + outdatedSignals.join(', ')
    : 'Modern patterns detected';

  // --- Social Media Links ---
  const socialPatterns = [
    /facebook\.com|fb\.com/i,
    /twitter\.com|x\.com/i,
    /instagram\.com/i,
    /linkedin\.com/i,
    /youtube\.com/i,
    /tiktok\.com/i,
    /pinterest\.com/i
  ];
  const foundSocials = socialPatterns.filter(p => p.test(html));
  checks.socialLinks.pass = foundSocials.length >= 1;
  checks.socialLinks.details = `${foundSocials.length} social platform(s) linked`;

  // --- Contact Info ---
  const hasPhone = /(\(\d{3}\)\s*\d{3}[-.]?\d{4}|\d{3}[-.]?\d{3}[-.]?\d{4}|tel:|phone)/i.test(html);
  const hasEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i.test(html) ||
    /mailto:/i.test(html);
  const hasAddress = /\d+\s+[A-Za-z]+\s+(St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place)/i.test(html) ||
    /address/i.test(html);
  const contactSignals = [hasPhone, hasEmail, hasAddress].filter(Boolean).length;
  checks.contactInfo.pass = contactSignals >= 1;
  checks.contactInfo.details = `Phone: ${hasPhone ? 'Yes' : 'No'}, Email: ${hasEmail ? 'Yes' : 'No'}, Address: ${hasAddress ? 'Yes' : 'No'}`;

  // --- Clear CTA ---
  const hasButton = /<button[\s>]/i.test(html) ||
    /class\s*=\s*["'][^"']*btn[^"']*["']/i.test(html) ||
    /class\s*=\s*["'][^"']*button[^"']*["']/i.test(html) ||
    /class\s*=\s*["'][^"']*cta[^"']*["']/i.test(html);
  const hasForm = /<form[\s>]/i.test(html);
  const hasCtaText = /(get started|sign up|contact us|free quote|book now|schedule|learn more|get a quote|request|call now|buy now|order now|shop now|subscribe|download|try free)/i.test(html);
  checks.cta.pass = (hasButton && hasCtaText) || hasForm;
  checks.cta.details = `Buttons: ${hasButton ? 'Yes' : 'No'}, Forms: ${hasForm ? 'Yes' : 'No'}, CTA text: ${hasCtaText ? 'Yes' : 'No'}`;

  // --- Analytics/Tracking ---
  checks.analytics.pass = /google-analytics|googletagmanager|gtag|ga\.js|analytics\.js|fbq|facebook.*pixel|hotjar|mixpanel|segment\.com|plausible|fathom/i.test(html);

  // --- Copyright Year ---
  const currentYear = new Date().getFullYear();
  const copyrightMatches = html.match(/(?:©|\bcopyright\b|&copy;)\s*(\d{4})/gi) || [];
  let latestYear = 0;
  for (const match of copyrightMatches) {
    const yearMatch = match.match(/(\d{4})/);
    if (yearMatch) {
      const year = parseInt(yearMatch[1]);
      if (year > latestYear && year <= currentYear + 1) {
        latestYear = year;
      }
    }
  }
  // Also check for year ranges like "2020-2026"
  const yearRangeMatches = html.match(/(?:©|\bcopyright\b|&copy;)\s*\d{4}\s*[-–]\s*(\d{4})/gi) || [];
  for (const match of yearRangeMatches) {
    const years = match.match(/(\d{4})/g);
    if (years && years.length >= 2) {
      const endYear = parseInt(years[years.length - 1]);
      if (endYear > latestYear && endYear <= currentYear + 1) {
        latestYear = endYear;
      }
    }
  }

  if (latestYear > 0) {
    checks.copyrightCurrent.pass = (currentYear - latestYear) <= 1;
    checks.copyrightCurrent.details = `Copyright year: ${latestYear}${latestYear < currentYear - 1 ? ' (OUTDATED)' : ''}`;
  } else {
    // No copyright found - neutral, give partial credit
    checks.copyrightCurrent.pass = false;
    checks.copyrightCurrent.details = 'No copyright year found';
  }

  return buildResult(checks, url, null);
}

function buildResult(checks, url, errorMessage) {
  let score = 0;
  let maxScore = 0;
  const checkResults = {};

  for (const [key, check] of Object.entries(checks)) {
    maxScore += check.weight;
    if (check.pass) {
      score += check.weight;
    }
    checkResults[key] = {
      label: check.label,
      pass: check.pass,
      weight: check.weight,
      details: check.details || null
    };
  }

  // Normalize to 100
  const normalizedScore = Math.round((score / maxScore) * 100);

  // Grade
  let grade, gradeLabel;
  if (normalizedScore >= 80) {
    grade = 'A';
    gradeLabel = 'Good website - may not need redesign';
  } else if (normalizedScore >= 65) {
    grade = 'B';
    gradeLabel = 'Decent website - could use improvements';
  } else if (normalizedScore >= 50) {
    grade = 'C';
    gradeLabel = 'Mediocre website - needs work';
  } else if (normalizedScore >= 30) {
    grade = 'D';
    gradeLabel = 'Poor website - strong sales opportunity';
  } else {
    grade = 'F';
    gradeLabel = 'Needs a new website - best lead for sales';
  }

  return {
    url,
    score: normalizedScore,
    grade,
    gradeLabel,
    checks: checkResults,
    error: errorMessage || null,
    analyzedAt: new Date().toISOString()
  };
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const decoded = verifyToken(event.headers.authorization);
  if (!decoded) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Unauthorized' })
    };
  }

  try {
    const { url, leadId } = JSON.parse(event.body);

    if (!url) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'URL is required' })
      };
    }

    // Run analysis
    const result = await analyzeWebsite(url);

    // If leadId provided, save the score to the lead
    if (leadId) {
      // Ensure columns exist (safe migration)
      try {
        await pool.query(`
          ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS website_score INTEGER;
          ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS website_grade VARCHAR(2);
          ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS website_analysis JSONB;
          ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS website_analyzed_at TIMESTAMP;
        `);
      } catch (migrationError) {
        console.log('Column migration note:', migrationError.message);
      }

      // Update the lead with the score
      await pool.query(
        `UPDATE lr_leads SET
          website_score = $1,
          website_grade = $2,
          website_analysis = $3,
          website_analyzed_at = NOW()
         WHERE id = $4 AND user_id = $5`,
        [result.score, result.grade, JSON.stringify(result), leadId, decoded.userId]
      );
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        ...result
      })
    };

  } catch (error) {
    console.error('Analyze website error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to analyze website', message: error.message })
    };
  }
};
