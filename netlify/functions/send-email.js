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

  // GET - List sent emails
  if (event.httpMethod === 'GET') {
    try {
      const params = event.queryStringParameters || {};
      const limit = parseInt(params.limit) || 50;
      const offset = parseInt(params.offset) || 0;

      const result = await pool.query(
        `SELECT id, user_id, account_id, to_email, to_name, subject, body,
                status, sent_at, opened_at
         FROM lr_sent_emails WHERE user_id = $1 ORDER BY sent_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      );

      const countResult = await pool.query(
        'SELECT COUNT(*) as total FROM lr_sent_emails WHERE user_id = $1',
        [userId]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          emails: result.rows,
          total: parseInt(countResult.rows[0].total),
          limit,
          offset
        })
      };
    } catch (error) {
      console.error('List sent emails error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  // POST - Send an email
  if (event.httpMethod === 'POST') {
    try {
      const { accountId, toEmail, toName, subject, body: emailBody, templateId, leadIds } = JSON.parse(event.body);

      if (!accountId || !toEmail || !subject) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'accountId, toEmail, and subject are required' }) };
      }

      // Look up email account credentials
      const accountResult = await pool.query(
        `SELECT id, email_address, display_name, smtp_host, smtp_port, username, password
         FROM lr_email_accounts WHERE id = $1 AND user_id = $2 AND is_active = true`,
        [accountId, userId]
      );

      if (accountResult.rows.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Email account not found or inactive' }) };
      }

      const account = accountResult.rows[0];

      // If templateId provided, load template body
      let finalBody = emailBody || '';
      let finalSubject = subject;

      if (templateId) {
        const templateResult = await pool.query(
          'SELECT subject, body FROM lr_email_templates WHERE id = $1 AND user_id = $2',
          [templateId, userId]
        );

        if (templateResult.rows.length > 0) {
          const template = templateResult.rows[0];
          finalSubject = finalSubject || template.subject;
          finalBody = finalBody || template.body;
        }
      }

      // Create nodemailer transport
      const transporter = nodemailer.createTransport({
        host: account.smtp_host,
        port: parseInt(account.smtp_port),
        secure: parseInt(account.smtp_port) === 465,
        auth: {
          user: account.username,
          pass: account.password
        },
        connectionTimeout: 15000,
        socketTimeout: 15000
      });

      // Send the email
      let status = 'sent';
      try {
        await transporter.sendMail({
          from: account.display_name
            ? `"${account.display_name}" <${account.email_address}>`
            : account.email_address,
          to: toName ? `"${toName}" <${toEmail}>` : toEmail,
          subject: finalSubject,
          html: finalBody
        });
      } catch (sendError) {
        status = 'failed';
        console.error('Email send failed:', sendError);

        // Record the failed email
        await pool.query(
          `INSERT INTO lr_sent_emails
            (user_id, account_id, to_email, to_name, subject, body, status, sent_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
          [userId, accountId, toEmail, toName || null, finalSubject, finalBody, status]
        );

        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Failed to send email', details: sendError.message })
        };
      } finally {
        transporter.close();
      }

      // Record the sent email
      const sentResult = await pool.query(
        `INSERT INTO lr_sent_emails
          (user_id, account_id, to_email, to_name, subject, body, status, sent_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING *`,
        [userId, accountId, toEmail, toName || null, finalSubject, finalBody, status]
      );

      // If leadIds provided, record association (optional, for tracking)
      if (leadIds && Array.isArray(leadIds) && leadIds.length > 0) {
        for (const leadId of leadIds) {
          try {
            await pool.query(
              `INSERT INTO lr_sent_emails
                (user_id, account_id, lead_id, to_email, to_name, subject, body, status, sent_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
              [userId, accountId, leadId, toEmail, toName || null, finalSubject, finalBody, status]
            );
          } catch (leadError) {
            // Non-critical, log and continue
            console.error('Failed to record lead association:', leadError);
          }
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, email: sentResult.rows[0], message: 'Email sent successfully' })
      };
    } catch (error) {
      console.error('Send email error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
