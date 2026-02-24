const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

// Simple rate limiting - in-memory store (resets on function cold start)
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 5; // max 5 requests per minute per IP

function isRateLimited(ip) {
  const now = Date.now();
  const record = rateLimitStore.get(ip);

  if (!record || now - record.timestamp > RATE_LIMIT_WINDOW) {
    rateLimitStore.set(ip, { timestamp: now, count: 1 });
    return false;
  }

  if (record.count >= RATE_LIMIT_MAX) {
    return true;
  }

  record.count++;
  return false;
}

function validateEmail(email) {
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email);
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  // Handle CORS preflight
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

  try {
    // Get client IP for rate limiting
    const clientIP = event.headers['x-forwarded-for']?.split(',')[0] ||
                     event.headers['client-ip'] ||
                     'unknown';

    // Check rate limit
    if (isRateLimited(clientIP)) {
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Too many requests. Please try again later.'
        })
      };
    }

    const body = JSON.parse(event.body || '{}');
    const { email, source = 'free_trial_gate' } = body;

    // Validate email
    if (!email || !validateEmail(email)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Please enter a valid email address'
        })
      };
    }

    const normalizedEmail = email.toLowerCase().trim();
    const userAgent = event.headers['user-agent'] || '';

    // Check if email already exists
    const existingResult = await pool.query(
      'SELECT id, opted_in FROM lr_marketing_emails WHERE email = $1',
      [normalizedEmail]
    );

    if (existingResult.rows.length > 0) {
      const existing = existingResult.rows[0];

      // If they unsubscribed before, re-subscribe them
      if (!existing.opted_in) {
        await pool.query(
          'UPDATE lr_marketing_emails SET opted_in = true, unsubscribed_at = NULL WHERE id = $1',
          [existing.id]
        );
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Welcome back! You can now access your free leads.',
          alreadyExists: true
        })
      };
    }

    // Insert new marketing email
    await pool.query(
      `INSERT INTO lr_marketing_emails (email, source, ip_address, user_agent, opted_in)
       VALUES ($1, $2, $3, $4, true)`,
      [normalizedEmail, source, clientIP, userAgent]
    );

    console.log(`Marketing email captured: ${normalizedEmail} from ${source}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Success! You now have access to 100 free leads.',
        email: normalizedEmail
      })
    };

  } catch (error) {
    console.error('Error capturing marketing email:', error);

    // Handle unique constraint violation gracefully
    if (error.code === '23505') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'You already have access to free leads!',
          alreadyExists: true
        })
      };
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Something went wrong. Please try again.'
      })
    };
  }
};
