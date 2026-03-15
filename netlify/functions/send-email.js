const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const { spendCredits, CREDIT_COSTS } = require('./credits');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2026';
const TRACKING_BASE = 'https://leadripper.com/.netlify/functions/email-tracking';

function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
  } catch {
    return null;
  }
}

// Inject tracking pixel and wrap links for click tracking
function injectTracking(htmlBody, trackingId) {
  let tracked = htmlBody;

  // Wrap links for click tracking
  tracked = tracked.replace(
    /href=["'](https?:\/\/[^"']+)["']/gi,
    (match, url) => {
      // Don't wrap mailto: or tracking URLs
      if (url.includes('email-tracking') || url.includes('mailto:')) return match;
      const encodedUrl = encodeURIComponent(url);
      return `href="${TRACKING_BASE}?t=${trackingId}&l=${encodedUrl}"`;
    }
  );

  // Append tracking pixel
  const pixel = `<img src="${TRACKING_BASE}?t=${trackingId}" width="1" height="1" style="display:none;width:1px;height:1px;" alt="">`;
  if (tracked.includes('</body>')) {
    tracked = tracked.replace('</body>', pixel + '</body>');
  } else {
    tracked += pixel;
  }

  return tracked;
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

  // GET - List sent emails with enhanced stats
  if (event.httpMethod === 'GET') {
    try {
      const params = event.queryStringParameters || {};
      const limit = parseInt(params.limit) || 50;
      const offset = parseInt(params.offset) || 0;

      const result = await pool.query(
        `SELECT id, user_id, email_account_id, campaign_id, lead_id, to_email, to_name,
                subject, status, tracking_id, open_count, click_count,
                sequence_step, variant_id, sent_at, opened_at, clicked_at, replied_at, bounced_at
         FROM lr_sent_emails WHERE user_id = $1 ORDER BY sent_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      );

      const countResult = await pool.query(
        'SELECT COUNT(*) as total FROM lr_sent_emails WHERE user_id = $1',
        [userId]
      );

      // Enhanced stats
      const statsResult = await pool.query(
        `SELECT
          COUNT(*) as total_sent,
          COUNT(opened_at) as total_opened,
          COUNT(clicked_at) as total_clicked,
          COUNT(replied_at) as total_replied,
          COUNT(bounced_at) as total_bounced,
          COUNT(CASE WHEN sent_at > CURRENT_DATE THEN 1 END) as sent_today,
          CASE WHEN COUNT(*) > 0
            THEN ROUND((COUNT(opened_at)::numeric / COUNT(*) * 100)::numeric, 1)
            ELSE 0
          END as open_rate,
          CASE WHEN COUNT(*) > 0
            THEN ROUND((COUNT(clicked_at)::numeric / COUNT(*) * 100)::numeric, 1)
            ELSE 0
          END as click_rate,
          CASE WHEN COUNT(*) > 0
            THEN ROUND((COUNT(replied_at)::numeric / COUNT(*) * 100)::numeric, 1)
            ELSE 0
          END as reply_rate
         FROM lr_sent_emails WHERE user_id = $1`,
        [userId]
      );

      const stats = statsResult.rows[0] || {};

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          emails: result.rows,
          total: parseInt(countResult.rows[0].total),
          stats: {
            totalSent: parseInt(stats.total_sent) || 0,
            totalOpened: parseInt(stats.total_opened) || 0,
            totalClicked: parseInt(stats.total_clicked) || 0,
            totalReplied: parseInt(stats.total_replied) || 0,
            totalBounced: parseInt(stats.total_bounced) || 0,
            sentToday: parseInt(stats.sent_today) || 0,
            openRate: parseFloat(stats.open_rate) || 0,
            clickRate: parseFloat(stats.click_rate) || 0,
            replyRate: parseFloat(stats.reply_rate) || 0
          },
          limit,
          offset
        })
      };
    } catch (error) {
      console.error('List sent emails error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  // POST - Send an email (with tracking)
  if (event.httpMethod === 'POST') {
    try {
      const {
        accountId, emailAccountId, toEmail, toName, subject, body: emailBody,
        templateId, leadIds, campaignId, sequenceStep, variantId,
        filters
      } = JSON.parse(event.body);

      const acctId = accountId || emailAccountId;

      // Bulk send mode (with filters)
      if (filters && acctId && subject) {
        return await handleBulkSend(userId, acctId, subject, emailBody, filters, campaignId, headers);
      }

      if (!acctId || !toEmail || !subject) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'accountId, toEmail, and subject are required' }) };
      }

      // Check if user has a lifetime plan with email allowance
      const userPlan = await pool.query(
        'SELECT lifetime_plan, emails_per_month, emails_sent_this_month FROM lr_users WHERE id = $1', [userId]
      ).catch(() => ({ rows: [] }));
      const hasLifetime = userPlan.rows[0]?.lifetime_plan && userPlan.rows[0]?.emails_per_month > 0;

      if (hasLifetime) {
        // Check monthly email limit
        const sent = userPlan.rows[0].emails_sent_this_month || 0;
        const limit = userPlan.rows[0].emails_per_month;
        if (sent >= limit) {
          return { statusCode: 402, headers, body: JSON.stringify({ error: `Monthly email limit reached (${sent}/${limit}). Upgrade your plan for more sends.` }) };
        }
        // Increment counter
        await pool.query('UPDATE lr_users SET emails_sent_this_month = emails_sent_this_month + 1 WHERE id = $1', [userId]).catch(() => {});
      } else {
        // No lifetime plan — use credits
        const creditCheck = await spendCredits(userId, CREDIT_COSTS.email_send, 'email_send', `Email to ${toEmail}`, campaignId ? String(campaignId) : null);
        if (!creditCheck.success) {
          return { statusCode: 402, headers, body: JSON.stringify({ error: 'Insufficient credits', balance: creditCheck.balance, required: CREDIT_COSTS.email_send }) };
        }
      }

      // Look up email account credentials
      const accountResult = await pool.query(
        `SELECT id, email_address, display_name, smtp_host, smtp_port, username, password_encrypted
         FROM lr_email_accounts WHERE id = $1 AND user_id = $2 AND is_active = true`,
        [acctId, userId]
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

      // Generate tracking ID and inject tracking
      const trackingId = crypto.randomUUID();
      const trackedBody = injectTracking(finalBody, trackingId);

      // Create nodemailer transport
      const transporter = nodemailer.createTransport({
        host: account.smtp_host,
        port: parseInt(account.smtp_port),
        secure: parseInt(account.smtp_port) === 465,
        auth: {
          user: account.username,
          pass: account.password_encrypted
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
          html: trackedBody
        });
      } catch (sendError) {
        status = 'failed';
        console.error('Email send failed:', sendError);

        // Record the failed email
        await pool.query(
          `INSERT INTO lr_sent_emails
            (user_id, email_account_id, to_email, to_name, subject, body, tracking_id,
             campaign_id, sequence_step, variant_id, status, sent_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
          [userId, acctId, toEmail, toName || null, finalSubject, trackedBody, trackingId,
           campaignId || null, sequenceStep || 1, variantId || null, status]
        );

        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Failed to send email', details: sendError.message })
        };
      } finally {
        transporter.close();
      }

      // Record the sent email with tracking
      const sentResult = await pool.query(
        `INSERT INTO lr_sent_emails
          (user_id, email_account_id, to_email, to_name, subject, body, tracking_id,
           campaign_id, sequence_step, variant_id, status, sent_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW()) RETURNING *`,
        [userId, acctId, toEmail, toName || null, finalSubject, trackedBody, trackingId,
         campaignId || null, sequenceStep || 1, variantId || null, status]
      );

      // If leadIds provided, record per-lead associations
      if (leadIds && Array.isArray(leadIds) && leadIds.length > 0) {
        for (const leadId of leadIds) {
          try {
            const leadTrackingId = crypto.randomUUID();
            await pool.query(
              `INSERT INTO lr_sent_emails
                (user_id, email_account_id, lead_id, to_email, to_name, subject, body,
                 tracking_id, campaign_id, sequence_step, variant_id, status, sent_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
              [userId, acctId, leadId, toEmail, toName || null, finalSubject, trackedBody,
               leadTrackingId, campaignId || null, sequenceStep || 1, variantId || null, status]
            );
          } catch (leadError) {
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

// Handle bulk send with filters
async function handleBulkSend(userId, accountId, subject, emailBody, filters, campaignId, headers) {
  try {
    // Load email account
    const accountResult = await pool.query(
      `SELECT id, email_address, display_name, smtp_host, smtp_port, username, password_encrypted
       FROM lr_email_accounts WHERE id = $1 AND user_id = $2 AND is_active = true`,
      [accountId, userId]
    );

    if (accountResult.rows.length === 0) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Email account not found' }) };
    }

    const account = accountResult.rows[0];

    // Build lead query from filters
    let whereClause = 'WHERE l.user_id = $1 AND l.email IS NOT NULL';
    const queryParams = [userId];
    let paramIdx = 2;

    if (filters.city) {
      whereClause += ` AND l.city = $${paramIdx}`;
      queryParams.push(filters.city);
      paramIdx++;
    }
    if (filters.industry) {
      whereClause += ` AND l.industry = $${paramIdx}`;
      queryParams.push(filters.industry);
      paramIdx++;
    }
    if (filters.emailVerified) {
      whereClause += ` AND l.email_verified = true`;
    }
    if (filters.excludeRecent) {
      whereClause += ` AND NOT EXISTS (
        SELECT 1 FROM lr_sent_emails se WHERE se.to_email = l.email AND se.sent_at > NOW() - INTERVAL '7 days'
      )`;
    }
    if (filters.listId) {
      whereClause += ` AND l.id IN (SELECT lead_id FROM lr_lead_list_items WHERE list_id = $${paramIdx})`;
      queryParams.push(filters.listId);
      paramIdx++;
    }

    const limit = Math.min(parseInt(filters.limit) || 25, 100);

    const leadsResult = await pool.query(
      `SELECT l.* FROM lr_leads l ${whereClause} ORDER BY l.id ASC LIMIT ${limit}`,
      queryParams
    );

    const leads = leadsResult.rows;
    if (leads.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'No matching leads found', sent: 0 }) };
    }

    // Check credits for bulk send (1 credit per email)
    const totalCreditCost = leads.length * CREDIT_COSTS.email_send;
    const { getBalance } = require('./credits');
    const bulkBalance = await getBalance(userId);
    if (bulkBalance.balance < totalCreditCost) {
      return { statusCode: 402, headers, body: JSON.stringify({ error: 'Insufficient credits', balance: bulkBalance.balance, required: totalCreditCost, message: `Need ${totalCreditCost} credits to send ${leads.length} emails. You have ${bulkBalance.balance}.` }) };
    }

    // Create transporter
    const transporter = nodemailer.createTransport({
      host: account.smtp_host,
      port: parseInt(account.smtp_port),
      secure: parseInt(account.smtp_port) === 465,
      auth: {
        user: account.username,
        pass: account.password_encrypted
      },
      connectionTimeout: 15000,
      socketTimeout: 15000
    });

    let sentCount = 0;
    let failCount = 0;

    for (const lead of leads) {
      try {
        // Replace merge tags
        const leadSubject = replaceMergeTags(subject, lead);
        const leadBody = replaceMergeTags(emailBody, lead);

        // Generate tracking
        const trackingId = crypto.randomUUID();
        const trackedBody = injectTracking(leadBody, trackingId);

        await transporter.sendMail({
          from: account.display_name
            ? `"${account.display_name}" <${account.email_address}>`
            : account.email_address,
          to: lead.contact_name ? `"${lead.contact_name}" <${lead.email}>` : lead.email,
          subject: leadSubject,
          html: trackedBody
        });

        // Record sent email
        await pool.query(
          `INSERT INTO lr_sent_emails
            (user_id, email_account_id, lead_id, to_email, to_name, subject, body,
             tracking_id, campaign_id, sequence_step, status, sent_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, 'sent', NOW())`,
          [userId, accountId, lead.id, lead.email, lead.contact_name || lead.business_name,
           leadSubject, trackedBody, trackingId, campaignId || null]
        );

        // Spend credit for this email
        await spendCredits(userId, CREDIT_COSTS.email_send, 'email_send', `Bulk email to ${lead.email}`, campaignId ? String(campaignId) : null).catch(() => {});

        sentCount++;
      } catch (sendError) {
        console.error(`Failed to send to ${lead.email}:`, sendError.message);
        failCount++;
      }
    }

    transporter.close();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Sent ${sentCount} email(s), ${failCount} failed`,
        sent: sentCount,
        failed: failCount
      })
    };
  } catch (error) {
    console.error('Bulk send error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
}

// Replace merge tags
function replaceMergeTags(text, lead) {
  if (!text) return '';
  return text
    .replace(/\{\{business_name\}\}/gi, lead.business_name || '')
    .replace(/\{\{first_name\}\}/gi, lead.first_name || (lead.contact_name ? lead.contact_name.split(' ')[0] : '') || '')
    .replace(/\{\{last_name\}\}/gi, lead.last_name || '')
    .replace(/\{\{email\}\}/gi, lead.email || '')
    .replace(/\{\{phone\}\}/gi, lead.phone || '')
    .replace(/\{\{website\}\}/gi, lead.website || '')
    .replace(/\{\{city\}\}/gi, lead.city || '')
    .replace(/\{\{state\}\}/gi, lead.state || '')
    .replace(/\{\{industry\}\}/gi, lead.industry || '')
    .replace(/\{\{address\}\}/gi, lead.address || '');
}
