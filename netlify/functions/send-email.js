const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2026';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'leadripper-encryption-key-32ch';

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

// Replace merge tags in template
function replaceMergeTags(text, lead) {
  if (!text) return '';
  return text
    .replace(/{{business_name}}/gi, lead.business_name || '')
    .replace(/{{first_name}}/gi, (lead.business_name || '').split(' ')[0] || 'there')
    .replace(/{{email}}/gi, lead.email || '')
    .replace(/{{phone}}/gi, lead.phone || '')
    .replace(/{{website}}/gi, lead.website || '')
    .replace(/{{city}}/gi, lead.city || '')
    .replace(/{{industry}}/gi, lead.industry || '')
    .replace(/{{address}}/gi, lead.address || '');
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
    // GET - Get sent emails history
    // ==========================================
    if (event.httpMethod === 'GET') {
      const limit = parseInt(event.queryStringParameters?.limit) || 50;
      const offset = parseInt(event.queryStringParameters?.offset) || 0;

      const result = await pool.query(
        `SELECT se.*, l.business_name, l.email as lead_email, ea.email_address as from_email
         FROM lr_sent_emails se
         LEFT JOIN lr_leads l ON l.id = se.lead_id
         LEFT JOIN lr_email_accounts ea ON ea.id = se.email_account_id
         WHERE se.user_id = $1
         ORDER BY se.sent_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      );

      const countResult = await pool.query(
        `SELECT COUNT(*) FROM lr_sent_emails WHERE user_id = $1`,
        [userId]
      );

      // Get stats
      const statsResult = await pool.query(
        `SELECT
          COUNT(*) as total_sent,
          COUNT(CASE WHEN opened_at IS NOT NULL THEN 1 END) as total_opened,
          COUNT(CASE WHEN clicked_at IS NOT NULL THEN 1 END) as total_clicked,
          COUNT(CASE WHEN sent_at > NOW() - INTERVAL '24 hours' THEN 1 END) as sent_today
         FROM lr_sent_emails WHERE user_id = $1`,
        [userId]
      );

      const stats = statsResult.rows[0];

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          emails: result.rows,
          total: parseInt(countResult.rows[0].count),
          stats: {
            totalSent: parseInt(stats.total_sent) || 0,
            totalOpened: parseInt(stats.total_opened) || 0,
            totalClicked: parseInt(stats.total_clicked) || 0,
            sentToday: parseInt(stats.sent_today) || 0,
            openRate: stats.total_sent > 0 ? Math.round((stats.total_opened / stats.total_sent) * 100) : 0
          }
        })
      };
    }

    // ==========================================
    // POST - Send email(s) to leads
    // ==========================================
    if (event.httpMethod === 'POST') {
      const {
        leadIds,           // Array of lead IDs to email
        emailAccountId,    // Which connected account to use
        templateId,        // Optional template ID
        subject,           // Email subject (with merge tags)
        body,              // Email body (with merge tags)
        // Filters for bulk selection
        filters
      } = JSON.parse(event.body);

      // Get the email account
      let accountId = emailAccountId;
      if (!accountId) {
        // Get default account
        const defaultResult = await pool.query(
          `SELECT id FROM lr_email_accounts WHERE user_id = $1 AND is_default = true AND is_active = true`,
          [userId]
        );
        if (defaultResult.rows.length > 0) {
          accountId = defaultResult.rows[0].id;
        }
      }

      if (!accountId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'No email account connected. Please connect an email account first.' })
        };
      }

      const accountResult = await pool.query(
        `SELECT * FROM lr_email_accounts WHERE id = $1 AND user_id = $2 AND is_active = true`,
        [accountId, userId]
      );

      if (accountResult.rows.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Email account not found or inactive' })
        };
      }

      const emailAccount = accountResult.rows[0];

      // Check daily send limit
      if (emailAccount.sends_today >= emailAccount.daily_send_limit) {
        return {
          statusCode: 429,
          headers,
          body: JSON.stringify({
            error: 'Daily send limit reached',
            limit: emailAccount.daily_send_limit,
            sent: emailAccount.sends_today
          })
        };
      }

      // Get template if provided
      let emailSubject = subject;
      let emailBody = body;

      if (templateId) {
        const templateResult = await pool.query(
          `SELECT * FROM lr_email_templates WHERE id = $1 AND user_id = $2`,
          [templateId, userId]
        );
        if (templateResult.rows.length > 0) {
          const template = templateResult.rows[0];
          emailSubject = emailSubject || template.subject;
          emailBody = emailBody || template.body;
        }
      }

      if (!emailSubject || !emailBody) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Email subject and body are required' })
        };
      }

      // Get leads to email
      let leads = [];

      if (leadIds && leadIds.length > 0) {
        // Specific leads
        const leadsResult = await pool.query(
          `SELECT * FROM lr_leads WHERE id = ANY($1) AND user_id = $2 AND email IS NOT NULL`,
          [leadIds, userId]
        );
        leads = leadsResult.rows;
      } else if (filters) {
        // Filtered selection
        let query = `SELECT * FROM lr_leads WHERE user_id = $1 AND email IS NOT NULL`;
        const values = [userId];
        let paramIndex = 2;

        if (filters.city) {
          query += ` AND city = $${paramIndex}`;
          values.push(filters.city);
          paramIndex++;
        }
        if (filters.industry) {
          query += ` AND industry = $${paramIndex}`;
          values.push(filters.industry);
          paramIndex++;
        }
        if (filters.emailVerified) {
          query += ` AND email_verified = true`;
        }
        if (filters.search) {
          query += ` AND (business_name ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`;
          values.push(`%${filters.search}%`);
          paramIndex++;
        }
        // Exclude already emailed leads (within last 7 days)
        if (filters.excludeRecent !== false) {
          query += ` AND id NOT IN (
            SELECT lead_id FROM lr_sent_emails
            WHERE user_id = $1 AND sent_at > NOW() - INTERVAL '7 days'
          )`;
        }

        query += ` LIMIT $${paramIndex}`;
        values.push(filters.limit || 50);

        const leadsResult = await pool.query(query, values);
        leads = leadsResult.rows;
      }

      if (leads.length === 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'No leads found with valid email addresses' })
        };
      }

      // Check if we'll exceed daily limit
      const remainingLimit = emailAccount.daily_send_limit - emailAccount.sends_today;
      if (leads.length > remainingLimit) {
        leads = leads.slice(0, remainingLimit);
      }

      // Create email transporter based on provider
      let transporter;

      if (emailAccount.provider === 'gmail') {
        // Gmail OAuth - would need OAuth refresh flow
        // For now, use app password approach
        transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: emailAccount.email_address,
            pass: decrypt(emailAccount.password_encrypted) || emailAccount.oauth_access_token
          }
        });
      } else if (emailAccount.provider === 'outlook') {
        transporter = nodemailer.createTransport({
          host: 'smtp.office365.com',
          port: 587,
          secure: false,
          auth: {
            user: emailAccount.email_address,
            pass: decrypt(emailAccount.password_encrypted) || emailAccount.oauth_access_token
          }
        });
      } else if (emailAccount.provider === 'imap') {
        transporter = nodemailer.createTransport({
          host: emailAccount.smtp_host,
          port: emailAccount.smtp_port || 587,
          secure: emailAccount.smtp_port === 465,
          auth: {
            user: emailAccount.username || emailAccount.email_address,
            pass: decrypt(emailAccount.password_encrypted)
          }
        });
      }

      // Send emails
      const results = {
        sent: 0,
        failed: 0,
        errors: []
      };

      // Get user's email signature
      const settingsResult = await pool.query(
        `SELECT email_signature FROM lr_user_settings WHERE user_id = $1`,
        [userId]
      );
      const signature = settingsResult.rows[0]?.email_signature || '';

      for (const lead of leads) {
        try {
          const personalizedSubject = replaceMergeTags(emailSubject, lead);
          let personalizedBody = replaceMergeTags(emailBody, lead);

          // Add signature if exists
          if (signature) {
            personalizedBody += `\n\n${signature}`;
          }

          // Generate tracking pixel ID
          const trackingId = crypto.randomUUID();

          // Add tracking pixel for opens
          const trackingPixel = `<img src="${process.env.URL || 'https://leadripper.com'}/.netlify/functions/track-email?id=${trackingId}" width="1" height="1" style="display:none;" />`;

          // Send the email
          await transporter.sendMail({
            from: emailAccount.display_name
              ? `"${emailAccount.display_name}" <${emailAccount.email_address}>`
              : emailAccount.email_address,
            to: lead.email,
            subject: personalizedSubject,
            text: personalizedBody,
            html: personalizedBody.replace(/\n/g, '<br>') + trackingPixel
          });

          // Log the sent email
          await pool.query(
            `INSERT INTO lr_sent_emails (user_id, lead_id, email_account_id, tracking_id, subject, body, to_email)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [userId, lead.id, accountId, trackingId, personalizedSubject, personalizedBody, lead.email]
          );

          results.sent++;
        } catch (err) {
          results.failed++;
          results.errors.push({ leadId: lead.id, email: lead.email, error: err.message });
          console.error(`Failed to send email to ${lead.email}:`, err.message);
        }
      }

      // Update sends_today count
      await pool.query(
        `UPDATE lr_email_accounts SET sends_today = sends_today + $1, last_send_at = NOW()
         WHERE id = $2`,
        [results.sent, accountId]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: `Sent ${results.sent} emails${results.failed > 0 ? `, ${results.failed} failed` : ''}`,
          results
        })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };

  } catch (error) {
    console.error('Send email error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server error', message: error.message })
    };
  }
};
