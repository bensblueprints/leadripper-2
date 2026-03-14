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

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
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
    // Ensure website analysis columns exist
    try {
      await pool.query(`
        ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS website_score INTEGER;
        ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS website_grade VARCHAR(2);
        ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS website_analysis JSONB;
        ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS website_analyzed_at TIMESTAMP;
        ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS website_rebuilt_at TIMESTAMP;
      `);
    } catch (migrationErr) {
      console.log('Column check note:', migrationErr.message);
    }

    const params = event.queryStringParameters || {};
    const limit = parseInt(params.limit) || 50;
    const offset = parseInt(params.offset) || 0;
    const industry = params.industry;
    const city = params.city;
    const synced = params.synced;
    const search = params.search;

    let query = `
      SELECT id, business_name, phone, email, address, city, state, industry,
             website, rating, reviews, ghl_synced, ghl_contact_id, created_at,
             email_verified, email_score, email_validation_date,
             website_score, website_grade, website_analysis, website_analyzed_at,
             website_rebuilt_at, rebuild_phase, rebuild_status, rebuild_progress,
             rebuild_message, rebuild_preview_url, rebuilt_website_url, rebuild_updated_at,
             tags, contact_name
      FROM lr_leads WHERE user_id = $1
    `;
    const values = [decoded.userId];
    let paramIndex = 2;

    if (search) {
      query += ` AND (business_name ILIKE $${paramIndex} OR email ILIKE $${paramIndex} OR phone ILIKE $${paramIndex} OR address ILIKE $${paramIndex} OR city ILIKE $${paramIndex} OR state ILIKE $${paramIndex})`;
      values.push(`%${search}%`);
      paramIndex++;
    }

    if (industry) {
      query += ` AND industry = $${paramIndex}`;
      values.push(industry);
      paramIndex++;
    }

    if (city) {
      query += ` AND city ILIKE $${paramIndex}`;
      values.push(`%${city}%`);
      paramIndex++;
    }

    if (synced !== undefined) {
      query += ` AND ghl_synced = $${paramIndex}`;
      values.push(synced === 'true');
      paramIndex++;
    }

    // Build count query with same filters (without LIMIT/OFFSET)
    let countQuery = 'SELECT COUNT(*) as total FROM lr_leads WHERE user_id = $1';
    const countValues = [decoded.userId];
    let countParamIndex = 2;

    if (search) {
      countQuery += ` AND (business_name ILIKE $${countParamIndex} OR email ILIKE $${countParamIndex} OR phone ILIKE $${countParamIndex} OR address ILIKE $${countParamIndex} OR city ILIKE $${countParamIndex} OR state ILIKE $${countParamIndex})`;
      countValues.push(`%${search}%`);
      countParamIndex++;
    }
    if (industry) {
      countQuery += ` AND industry = $${countParamIndex}`;
      countValues.push(industry);
      countParamIndex++;
    }
    if (city) {
      countQuery += ` AND city ILIKE $${countParamIndex}`;
      countValues.push(`%${city}%`);
      countParamIndex++;
    }
    if (synced !== undefined) {
      countQuery += ` AND ghl_synced = $${countParamIndex}`;
      countValues.push(synced === 'true');
      countParamIndex++;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    values.push(limit, offset);

    const [result, countResult, citiesResult, industriesResult] = await Promise.all([
      pool.query(query, values),
      pool.query(countQuery, countValues),
      pool.query('SELECT DISTINCT city FROM lr_leads WHERE user_id = $1 AND city IS NOT NULL AND city != \'\' ORDER BY city', [decoded.userId]),
      pool.query('SELECT DISTINCT industry FROM lr_leads WHERE user_id = $1 AND industry IS NOT NULL AND industry != \'\' ORDER BY industry', [decoded.userId])
    ]);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        leads: result.rows,
        total: parseInt(countResult.rows[0].total),
        limit,
        offset,
        availableCities: citiesResult.rows.map(r => r.city),
        availableIndustries: industriesResult.rows.map(r => r.industry)
      })
    };
  } catch (error) {
    console.error('Get leads error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to get leads', message: error.message })
    };
  }
};
