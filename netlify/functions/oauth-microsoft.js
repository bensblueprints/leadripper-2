const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2026';

// Microsoft OAuth credentials (set these in Netlify env vars)
const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;
const REDIRECT_URI = process.env.URL ? `${process.env.URL}/.netlify/functions/oauth-microsoft-callback` : 'https://leadripper.com/.netlify/functions/oauth-microsoft-callback';

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

  if (event.httpMethod === 'GET') {
    // Check if Microsoft OAuth is configured
    if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Microsoft OAuth not configured',
          message: 'Please set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET in environment variables'
        })
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

    // Create state token
    const state = Buffer.from(JSON.stringify({
      userId: decoded.userId,
      timestamp: Date.now(),
      nonce: crypto.randomBytes(16).toString('hex')
    })).toString('base64url');

    // Store state
    await pool.query(
      `INSERT INTO lr_oauth_states (state_token, user_id, provider, expires_at)
       VALUES ($1, $2, 'microsoft', NOW() + INTERVAL '10 minutes')
       ON CONFLICT (state_token) DO UPDATE SET expires_at = NOW() + INTERVAL '10 minutes'`,
      [state, decoded.userId]
    );

    // Build Microsoft OAuth URL
    const scopes = [
      'openid',
      'profile',
      'email',
      'offline_access',
      'https://graph.microsoft.com/Mail.Send',
      'https://graph.microsoft.com/Mail.Read'
    ];

    const authUrl = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    authUrl.searchParams.set('client_id', MICROSOFT_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', scopes.join(' '));
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('response_mode', 'query');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        authUrl: authUrl.toString()
      })
    };
  }

  return {
    statusCode: 405,
    headers,
    body: JSON.stringify({ error: 'Method not allowed' })
  };
};
