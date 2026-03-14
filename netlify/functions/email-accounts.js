const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2026';

function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
  } catch {
    return null;
  }
}

async function testSmtpConnection(host, port, username, password) {
  const transporter = nodemailer.createTransport({
    host,
    port: parseInt(port),
    secure: parseInt(port) === 465,
    auth: { user: username, pass: password },
    connectionTimeout: 10000,
    socketTimeout: 10000
  });

  await transporter.verify();
  transporter.close();
  return true;
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
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const userId = decoded.userId;

  // GET - List email accounts
  if (event.httpMethod === 'GET') {
    try {
      const result = await pool.query(
        `SELECT id, provider, email_address, display_name, imap_host, imap_port,
                smtp_host, smtp_port, username, is_active, is_default, last_tested_at, test_error, created_at
         FROM lr_email_accounts WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, accounts: result.rows })
      };
    } catch (error) {
      console.error('List email accounts error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  // POST - Add email account (IMAP/SMTP)
  if (event.httpMethod === 'POST') {
    try {
      const { provider, emailAddress, displayName, imapHost, imapPort, smtpHost, smtpPort, username, password } = JSON.parse(event.body);

      if (!emailAddress || !smtpHost || !smtpPort || !username || !password) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Email, SMTP host, port, username, and password are required' })
        };
      }

      // Test SMTP connection before saving
      try {
        await testSmtpConnection(smtpHost, smtpPort, username, password);
      } catch (smtpError) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: 'SMTP connection failed',
            details: smtpError.message,
            hint: provider === 'gmail'
              ? 'For Gmail, use an App Password (Google Account → Security → App Passwords). Regular passwords won\'t work.'
              : provider === 'outlook'
              ? 'For Outlook, make sure IMAP/SMTP is enabled in your Outlook settings and use your account password.'
              : 'Check your SMTP host, port, username, and password.'
          })
        };
      }

      // Check if this email already exists for this user
      const existing = await pool.query(
        'SELECT id FROM lr_email_accounts WHERE user_id = $1 AND email_address = $2',
        [userId, emailAddress]
      );

      if (existing.rows.length > 0) {
        // Update existing
        await pool.query(
          `UPDATE lr_email_accounts SET
            provider = $1, display_name = $2, imap_host = $3, imap_port = $4,
            smtp_host = $5, smtp_port = $6, username = $7, password = $8,
            is_active = true, last_tested_at = NOW(), test_error = NULL, updated_at = NOW()
          WHERE id = $9`,
          [provider || 'imap', displayName, imapHost, imapPort || 993, smtpHost, smtpPort || 587, username, password, existing.rows[0].id]
        );

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, message: 'Email account updated and verified' })
        };
      }

      // Check if this is the first account (make it default)
      const countResult = await pool.query(
        'SELECT COUNT(*) as cnt FROM lr_email_accounts WHERE user_id = $1',
        [userId]
      );
      const isDefault = parseInt(countResult.rows[0].cnt) === 0;

      await pool.query(
        `INSERT INTO lr_email_accounts
          (user_id, provider, email_address, display_name, imap_host, imap_port, smtp_host, smtp_port, username, password, is_active, is_default, last_tested_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11, NOW())`,
        [userId, provider || 'imap', emailAddress, displayName, imapHost, imapPort || 993, smtpHost, smtpPort || 587, username, password, isDefault]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: 'Email account connected and verified' })
      };
    } catch (error) {
      console.error('Add email account error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  // DELETE - Remove email account
  if (event.httpMethod === 'DELETE') {
    try {
      const { id } = JSON.parse(event.body);

      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Account ID required' }) };
      }

      await pool.query(
        'DELETE FROM lr_email_accounts WHERE id = $1 AND user_id = $2',
        [id, userId]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: 'Email account removed' })
      };
    } catch (error) {
      console.error('Delete email account error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
