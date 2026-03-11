const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2026';
const STARTUPHUB_API_URL = 'https://www.startuphub.ai/api/email-validator/discover';

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
 * Extract domain from company name or website
 */
function extractDomain(company, website) {
  // If website is provided, extract domain
  if (website) {
    try {
      const url = website.startsWith('http') ? website : `https://${website}`;
      const domain = new URL(url).hostname.replace('www.', '');
      return domain;
    } catch (e) {
      // Fall through to company name processing
    }
  }

  // Try to derive domain from company name
  if (company) {
    // Remove common suffixes and convert to domain format
    const cleaned = company
      .toLowerCase()
      .replace(/\s*(inc\.?|llc\.?|ltd\.?|corp\.?|co\.?|company|group|services|solutions)\.?\s*$/i, '')
      .replace(/[^a-z0-9]+/g, '')
      .trim();

    if (cleaned.length > 2) {
      return `${cleaned}.com`;
    }
  }

  return null;
}

/**
 * Parse contact name into first and last name
 */
function parseContactName(fullName) {
  if (!fullName) return { firstName: '', lastName: '' };

  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' ')
  };
}

/**
 * Discover email using StartupHub.ai API
 */
async function discoverEmail(firstName, lastName, domain) {
  try {
    console.log(`Discovering email for: ${firstName} ${lastName} @ ${domain}`);

    const response = await fetch(STARTUPHUB_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        firstName: firstName,
        lastName: lastName,
        domain: domain
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`StartupHub API error: ${response.status} - ${errorText}`);
      return { success: false, error: `API returned ${response.status}` };
    }

    const result = await response.json();
    console.log('StartupHub API response:', JSON.stringify(result));

    return {
      success: true,
      email: result.email || null,
      confidence: result.confidence || result.score || 0,
      pattern: result.pattern || null,
      verified: result.verified || result.valid || false
    };
  } catch (error) {
    console.error('Email discovery error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Email Discovery Function
 *
 * Discovers emails for leads that don't have emails using StartupHub.ai API
 * Can discover single email or batch discover for multiple leads
 */
exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
    const body = JSON.parse(event.body || '{}');

    // Single email discovery mode
    if (body.mode === 'single' || body.firstName) {
      const { firstName, lastName, domain, company, website } = body;

      // Determine domain
      const targetDomain = domain || extractDomain(company, website);

      if (!firstName) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'First name is required' })
        };
      }

      if (!targetDomain) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Domain, company name, or website is required' })
        };
      }

      const result = await discoverEmail(firstName, lastName || '', targetDomain);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: result.success,
          email: result.email,
          confidence: result.confidence,
          pattern: result.pattern,
          verified: result.verified,
          domain: targetDomain,
          error: result.error
        })
      };
    }

    // Batch discovery mode - discover emails for leads without emails
    const {
      limit = 50,
      leadIds = null,  // Optional: specific lead IDs to process
      statsOnly = false
    } = body;

    // Get stats first
    const statsResult = await pool.query(
      `SELECT
        COUNT(*) as total_leads,
        COUNT(CASE WHEN email IS NOT NULL AND email != '' THEN 1 END) as with_email,
        COUNT(CASE WHEN (email IS NULL OR email = '') AND contact_name IS NOT NULL THEN 1 END) as discoverable,
        COUNT(CASE WHEN email_discovered = true THEN 1 END) as discovered_count
       FROM lr_leads
       WHERE user_id = $1`,
      [decoded.userId]
    );

    const stats = statsResult.rows[0];

    if (statsOnly) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          stats: {
            totalLeads: parseInt(stats.total_leads),
            withEmail: parseInt(stats.with_email),
            withoutEmail: parseInt(stats.total_leads) - parseInt(stats.with_email),
            discoverable: parseInt(stats.discoverable),
            alreadyDiscovered: parseInt(stats.discovered_count)
          }
        })
      };
    }

    // Get leads that need email discovery
    let query = `
      SELECT id, business_name, contact_name, website, city, industry
      FROM lr_leads
      WHERE user_id = $1
        AND (email IS NULL OR email = '')
        AND (contact_name IS NOT NULL AND contact_name != '')
        AND (email_discovery_attempted IS NULL OR email_discovery_attempted = false)
    `;

    const queryParams = [decoded.userId];

    if (leadIds && leadIds.length > 0) {
      query += ` AND id = ANY($2)`;
      queryParams.push(leadIds);
    }

    query += ` LIMIT $${queryParams.length + 1}`;
    queryParams.push(limit);

    const leadsResult = await pool.query(query, queryParams);
    const leadsToProcess = leadsResult.rows;

    if (leadsToProcess.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'No leads available for email discovery',
          processed: 0,
          discovered: 0,
          stats: {
            totalLeads: parseInt(stats.total_leads),
            withEmail: parseInt(stats.with_email),
            withoutEmail: parseInt(stats.total_leads) - parseInt(stats.with_email),
            discoverable: parseInt(stats.discoverable),
            alreadyDiscovered: parseInt(stats.discovered_count)
          }
        })
      };
    }

    console.log(`Processing ${leadsToProcess.length} leads for email discovery`);

    let processedCount = 0;
    let discoveredCount = 0;
    let failedCount = 0;
    const results = [];

    for (const lead of leadsToProcess) {
      const { firstName, lastName } = parseContactName(lead.contact_name);
      const domain = extractDomain(lead.business_name, lead.website);

      if (!domain || !firstName) {
        // Mark as attempted but couldn't process
        await pool.query(
          `UPDATE lr_leads SET
            email_discovery_attempted = true,
            email_discovery_error = $1,
            updated_at = NOW()
           WHERE id = $2`,
          [!domain ? 'Could not determine domain' : 'No contact name', lead.id]
        );
        failedCount++;
        continue;
      }

      const result = await discoverEmail(firstName, lastName, domain);
      processedCount++;

      if (result.success && result.email) {
        // Update lead with discovered email
        await pool.query(
          `UPDATE lr_leads SET
            email = $1,
            email_discovered = true,
            email_discovery_attempted = true,
            email_discovery_confidence = $2,
            email_discovery_date = NOW(),
            updated_at = NOW()
           WHERE id = $3`,
          [result.email, result.confidence || 0, lead.id]
        );
        discoveredCount++;

        results.push({
          leadId: lead.id,
          businessName: lead.business_name,
          email: result.email,
          confidence: result.confidence,
          status: 'discovered'
        });
      } else {
        // Mark as attempted but failed
        await pool.query(
          `UPDATE lr_leads SET
            email_discovery_attempted = true,
            email_discovery_error = $1,
            updated_at = NOW()
           WHERE id = $2`,
          [result.error || 'No email found', lead.id]
        );
        failedCount++;

        results.push({
          leadId: lead.id,
          businessName: lead.business_name,
          status: 'not_found',
          error: result.error
        });
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Refresh stats
    const updatedStatsResult = await pool.query(
      `SELECT
        COUNT(*) as total_leads,
        COUNT(CASE WHEN email IS NOT NULL AND email != '' THEN 1 END) as with_email,
        COUNT(CASE WHEN email_discovered = true THEN 1 END) as discovered_count
       FROM lr_leads
       WHERE user_id = $1`,
      [decoded.userId]
    );

    const updatedStats = updatedStatsResult.rows[0];

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Email discovery complete`,
        batch: {
          processed: processedCount,
          discovered: discoveredCount,
          failed: failedCount
        },
        results: results.slice(0, 20), // Return first 20 results
        stats: {
          totalLeads: parseInt(updatedStats.total_leads),
          withEmail: parseInt(updatedStats.with_email),
          withoutEmail: parseInt(updatedStats.total_leads) - parseInt(updatedStats.with_email),
          alreadyDiscovered: parseInt(updatedStats.discovered_count)
        }
      })
    };

  } catch (error) {
    console.error('Email discovery error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Email discovery failed',
        message: error.message
      })
    };
  }
};
