const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2026';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'leadripper-encryption-key-32ch'; // Must be 32 chars for AES-256

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

// Simple encryption for passwords (in production, use proper key management)
function encrypt(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(encryptedText) {
  if (!encryptedText) return null;
  try {
    const parts = encryptedText.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return null;
  }
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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

  const userId = decoded.userId;

  try {
    // ==========================================
    // GET - List email accounts
    // ==========================================
    if (event.httpMethod === 'GET') {
      const accountId = event.queryStringParameters?.id;

      if (accountId) {
        // Get single account
        const result = await pool.query(
          `SELECT id, provider, email_address, display_name, is_default, is_active,
                  daily_send_limit, sends_today, last_send_at, created_at
           FROM lr_email_accounts WHERE id = $1 AND user_id = $2`,
          [accountId, userId]
        );

        if (result.rows.length === 0) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Email account not found' })
          };
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            account: result.rows[0]
          })
        };
      }

      // List all accounts
      const result = await pool.query(
        `SELECT id, provider, email_address, display_name, is_default, is_active,
                daily_send_limit, sends_today, last_send_at, created_at
         FROM lr_email_accounts WHERE user_id = $1
         ORDER BY is_default DESC, created_at DESC`,
        [userId]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          accounts: result.rows
        })
      };
    }

    // ==========================================
    // POST - Add new email account
    // ==========================================
    if (event.httpMethod === 'POST') {
      const {
        provider, // 'gmail', 'outlook', 'imap'
        emailAddress,
        displayName,
        // OAuth tokens (for Gmail/Outlook)
        oauthAccessToken,
        oauthRefreshToken,
        oauthExpiresAt,
        // IMAP/SMTP settings
        imapHost,
        imapPort,
        smtpHost,
        smtpPort,
        username,
        password,
        // Settings
        isDefault,
        dailySendLimit
      } = JSON.parse(event.body);

      if (!provider || !emailAddress) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Provider and email address are required' })
        };
      }

      // Validate provider
      if (!['gmail', 'outlook', 'imap'].includes(provider)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid provider. Must be gmail, outlook, or imap' })
        };
      }

      // Check if email already exists for this user
      const existingCheck = await pool.query(
        `SELECT id FROM lr_email_accounts WHERE user_id = $1 AND email_address = $2`,
        [userId, emailAddress]
      );

      if (existingCheck.rows.length > 0) {
        return {
          statusCode: 409,
          headers,
          body: JSON.stringify({ error: 'Email account already connected' })
        };
      }

      // If setting as default, unset other defaults
      if (isDefault) {
        await pool.query(
          `UPDATE lr_email_accounts SET is_default = false WHERE user_id = $1`,
          [userId]
        );
      }

      // Encrypt password if provided
      const encryptedPassword = password ? encrypt(password) : null;

      const result = await pool.query(
        `INSERT INTO lr_email_accounts (
          user_id, provider, email_address, display_name,
          oauth_access_token, oauth_refresh_token, oauth_expires_at,
          imap_host, imap_port, smtp_host, smtp_port, username, password_encrypted,
          is_default, daily_send_limit
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING id, provider, email_address, display_name, is_default, is_active,
                  daily_send_limit, sends_today, created_at`,
        [
          userId, provider, emailAddress, displayName || null,
          oauthAccessToken || null, oauthRefreshToken || null, oauthExpiresAt || null,
          imapHost || null, imapPort || null, smtpHost || null, smtpPort || null,
          username || null, encryptedPassword,
          isDefault || false, dailySendLimit || 50
        ]
      );

      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Email account added successfully',
          account: result.rows[0]
        })
      };
    }

    // ==========================================
    // PUT - Update email account
    // ==========================================
    if (event.httpMethod === 'PUT') {
      const {
        id,
        displayName,
        isDefault,
        isActive,
        dailySendLimit,
        // OAuth refresh
        oauthAccessToken,
        oauthRefreshToken,
        oauthExpiresAt,
        // IMAP/SMTP updates
        imapHost,
        imapPort,
        smtpHost,
        smtpPort,
        password
      } = JSON.parse(event.body);

      if (!id) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Account ID is required' })
        };
      }

      // Verify ownership
      const ownerCheck = await pool.query(
        `SELECT id FROM lr_email_accounts WHERE id = $1 AND user_id = $2`,
        [id, userId]
      );

      if (ownerCheck.rows.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Email account not found' })
        };
      }

      // If setting as default, unset other defaults first
      if (isDefault) {
        await pool.query(
          `UPDATE lr_email_accounts SET is_default = false WHERE user_id = $1 AND id != $2`,
          [userId, id]
        );
      }

      // Build dynamic update query
      const updates = [];
      const values = [];
      let paramIndex = 1;

      if (displayName !== undefined) {
        updates.push(`display_name = $${paramIndex}`);
        values.push(displayName);
        paramIndex++;
      }
      if (isDefault !== undefined) {
        updates.push(`is_default = $${paramIndex}`);
        values.push(isDefault);
        paramIndex++;
      }
      if (isActive !== undefined) {
        updates.push(`is_active = $${paramIndex}`);
        values.push(isActive);
        paramIndex++;
      }
      if (dailySendLimit !== undefined) {
        updates.push(`daily_send_limit = $${paramIndex}`);
        values.push(dailySendLimit);
        paramIndex++;
      }
      if (oauthAccessToken !== undefined) {
        updates.push(`oauth_access_token = $${paramIndex}`);
        values.push(oauthAccessToken);
        paramIndex++;
      }
      if (oauthRefreshToken !== undefined) {
        updates.push(`oauth_refresh_token = $${paramIndex}`);
        values.push(oauthRefreshToken);
        paramIndex++;
      }
      if (oauthExpiresAt !== undefined) {
        updates.push(`oauth_expires_at = $${paramIndex}`);
        values.push(oauthExpiresAt);
        paramIndex++;
      }
      if (imapHost !== undefined) {
        updates.push(`imap_host = $${paramIndex}`);
        values.push(imapHost);
        paramIndex++;
      }
      if (imapPort !== undefined) {
        updates.push(`imap_port = $${paramIndex}`);
        values.push(imapPort);
        paramIndex++;
      }
      if (smtpHost !== undefined) {
        updates.push(`smtp_host = $${paramIndex}`);
        values.push(smtpHost);
        paramIndex++;
      }
      if (smtpPort !== undefined) {
        updates.push(`smtp_port = $${paramIndex}`);
        values.push(smtpPort);
        paramIndex++;
      }
      if (password !== undefined) {
        updates.push(`password_encrypted = $${paramIndex}`);
        values.push(encrypt(password));
        paramIndex++;
      }

      if (updates.length === 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'No fields to update' })
        };
      }

      values.push(id);

      const updateResult = await pool.query(
        `UPDATE lr_email_accounts SET ${updates.join(', ')}, updated_at = NOW()
         WHERE id = $${paramIndex}
         RETURNING id, provider, email_address, display_name, is_default, is_active,
                   daily_send_limit, sends_today, created_at`,
        values
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Email account updated successfully',
          account: updateResult.rows[0]
        })
      };
    }

    // ==========================================
    // DELETE - Remove email account
    // ==========================================
    if (event.httpMethod === 'DELETE') {
      const { id } = JSON.parse(event.body || '{}');
      const accountId = id || event.queryStringParameters?.id;

      if (!accountId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Account ID is required' })
        };
      }

      // Verify ownership
      const ownerCheck = await pool.query(
        `SELECT id, is_default FROM lr_email_accounts WHERE id = $1 AND user_id = $2`,
        [accountId, userId]
      );

      if (ownerCheck.rows.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Email account not found' })
        };
      }

      const wasDefault = ownerCheck.rows[0].is_default;

      // Delete the account
      await pool.query(`DELETE FROM lr_email_accounts WHERE id = $1`, [accountId]);

      // If this was the default, set another one as default
      if (wasDefault) {
        await pool.query(
          `UPDATE lr_email_accounts SET is_default = true
           WHERE user_id = $1 AND id = (
             SELECT id FROM lr_email_accounts WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1
           )`,
          [userId]
        );
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Email account removed successfully'
        })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };

  } catch (error) {
    console.error('Email Accounts error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server error', message: error.message })
    };
  }
};
