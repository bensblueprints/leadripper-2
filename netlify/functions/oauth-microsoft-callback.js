const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;
const REDIRECT_URI = process.env.URL ? `${process.env.URL}/.netlify/functions/oauth-microsoft-callback` : 'https://leadripper.com/.netlify/functions/oauth-microsoft-callback';
const APP_URL = process.env.URL || 'https://leadripper.com';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'leadripper-encryption-key-32ch';

function encrypt(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

exports.handler = async (event, context) => {
  const { code, state, error, error_description } = event.queryStringParameters || {};

  if (error) {
    return {
      statusCode: 302,
      headers: {
        'Location': `${APP_URL}/app?oauth_error=${encodeURIComponent(error_description || error)}`
      },
      body: ''
    };
  }

  if (!code || !state) {
    return {
      statusCode: 302,
      headers: {
        'Location': `${APP_URL}/app?oauth_error=missing_params`
      },
      body: ''
    };
  }

  try {
    // Verify state token
    const stateResult = await pool.query(
      `SELECT user_id FROM lr_oauth_states
       WHERE state_token = $1 AND provider = 'microsoft' AND expires_at > NOW()`,
      [state]
    );

    if (stateResult.rows.length === 0) {
      return {
        statusCode: 302,
        headers: {
          'Location': `${APP_URL}/app?oauth_error=invalid_state`
        },
        body: ''
      };
    }

    const userId = stateResult.rows[0].user_id;
    await pool.query(`DELETE FROM lr_oauth_states WHERE state_token = $1`, [state]);

    // Exchange code for tokens
    const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        code,
        client_id: MICROSOFT_CLIENT_ID,
        client_secret: MICROSOFT_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code'
      })
    });

    const tokens = await tokenResponse.json();

    if (tokens.error) {
      console.error('Microsoft token error:', tokens);
      return {
        statusCode: 302,
        headers: {
          'Location': `${APP_URL}/app?oauth_error=${encodeURIComponent(tokens.error_description || tokens.error)}`
        },
        body: ''
      };
    }

    // Get user info from Microsoft Graph
    const userInfoResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`
      }
    });

    const userInfo = await userInfoResponse.json();
    const email = userInfo.mail || userInfo.userPrincipalName;

    if (!email) {
      return {
        statusCode: 302,
        headers: {
          'Location': `${APP_URL}/app?oauth_error=no_email`
        },
        body: ''
      };
    }

    const expiresAt = new Date(Date.now() + (tokens.expires_in * 1000));

    // Check if account already exists
    const existingAccount = await pool.query(
      `SELECT id FROM lr_email_accounts WHERE user_id = $1 AND email_address = $2`,
      [userId, email]
    );

    if (existingAccount.rows.length > 0) {
      await pool.query(
        `UPDATE lr_email_accounts SET
          oauth_access_token = $1,
          oauth_refresh_token = COALESCE($2, oauth_refresh_token),
          oauth_expires_at = $3,
          display_name = $4,
          is_active = true,
          updated_at = NOW()
         WHERE id = $5`,
        [
          encrypt(tokens.access_token),
          tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
          expiresAt,
          userInfo.displayName || email,
          existingAccount.rows[0].id
        ]
      );
    } else {
      const countResult = await pool.query(
        `SELECT COUNT(*) FROM lr_email_accounts WHERE user_id = $1`,
        [userId]
      );
      const isDefault = parseInt(countResult.rows[0].count) === 0;

      await pool.query(
        `INSERT INTO lr_email_accounts (
          user_id, provider, email_address, display_name,
          oauth_access_token, oauth_refresh_token, oauth_expires_at,
          is_default, daily_send_limit
        ) VALUES ($1, 'outlook', $2, $3, $4, $5, $6, $7, 100)`,
        [
          userId,
          email,
          userInfo.displayName || email,
          encrypt(tokens.access_token),
          tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
          expiresAt,
          isDefault
        ]
      );
    }

    return {
      statusCode: 302,
      headers: {
        'Location': `${APP_URL}/app?oauth_success=outlook&email=${encodeURIComponent(email)}`
      },
      body: ''
    };

  } catch (error) {
    console.error('Microsoft OAuth callback error:', error);
    return {
      statusCode: 302,
      headers: {
        'Location': `${APP_URL}/app?oauth_error=${encodeURIComponent(error.message)}`
      },
      body: ''
    };
  }
};
