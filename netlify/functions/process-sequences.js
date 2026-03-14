const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

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

// Inject tracking pixel and wrap links
function injectTracking(htmlBody, trackingId) {
  // Wrap links for click tracking
  let tracked = htmlBody.replace(
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

// Replace merge tags in text
function replaceMergeTags(text, lead) {
  if (!text) return '';
  return text
    .replace(/\{\{business_name\}\}/gi, lead.business_name || '')
    .replace(/\{\{first_name\}\}/gi, lead.first_name || lead.contact_name?.split(' ')[0] || '')
    .replace(/\{\{last_name\}\}/gi, lead.last_name || '')
    .replace(/\{\{email\}\}/gi, lead.email || '')
    .replace(/\{\{phone\}\}/gi, lead.phone || '')
    .replace(/\{\{website\}\}/gi, lead.website || '')
    .replace(/\{\{city\}\}/gi, lead.city || '')
    .replace(/\{\{state\}\}/gi, lead.state || '')
    .replace(/\{\{industry\}\}/gi, lead.industry || '')
    .replace(/\{\{address\}\}/gi, lead.address || '');
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

  // This can be called manually (with auth) or as scheduled function
  let userId = null;

  // Check if called with auth (manual trigger for specific user)
  const decoded = verifyToken(event.headers.authorization);
  if (decoded) {
    userId = decoded.userId;
  }

  // If scheduled / no auth, process all active campaigns
  try {
    let campaigns;

    if (userId) {
      campaigns = await pool.query(
        `SELECT c.*, ea.email_address, ea.display_name, ea.smtp_host, ea.smtp_port,
                ea.username, ea.password_encrypted
         FROM lr_campaigns c
         JOIN lr_email_accounts ea ON ea.id = c.from_account_id
         WHERE c.user_id = $1 AND c.status = 'active'
           AND jsonb_array_length(c.sequence_steps) > 0`,
        [userId]
      );
    } else {
      campaigns = await pool.query(
        `SELECT c.*, ea.email_address, ea.display_name, ea.smtp_host, ea.smtp_port,
                ea.username, ea.password_encrypted
         FROM lr_campaigns c
         JOIN lr_email_accounts ea ON ea.id = c.from_account_id
         WHERE c.status = 'active'
           AND jsonb_array_length(c.sequence_steps) > 0`
      );
    }

    let totalSent = 0;
    let totalSkipped = 0;
    const errors = [];

    for (const campaign of campaigns.rows) {
      try {
        const steps = campaign.sequence_steps || [];
        const settings = campaign.settings || {};

        // Check send window
        if (settings.sendWindowStart && settings.sendWindowEnd) {
          const now = new Date();
          const tz = settings.timezone || 'UTC';
          const localTime = new Date(now.toLocaleString('en-US', { timeZone: tz }));
          const currentHour = localTime.getHours();
          const startHour = parseInt(settings.sendWindowStart);
          const endHour = parseInt(settings.sendWindowEnd);

          if (currentHour < startHour || currentHour >= endHour) {
            totalSkipped++;
            continue; // Outside send window
          }
        }

        // Check daily limit
        if (settings.dailyLimit) {
          const sentToday = await pool.query(
            `SELECT COUNT(*) as cnt FROM lr_sent_emails
             WHERE campaign_id = $1 AND sent_at > CURRENT_DATE`,
            [campaign.id]
          );
          if (parseInt(sentToday.rows[0].cnt) >= settings.dailyLimit) {
            continue; // Daily limit reached
          }
        }

        // Process each step
        for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
          const step = steps[stepIdx];
          const stepNum = step.step || (stepIdx + 1);
          const delayDays = step.delay_days || 0;

          // Find leads who received previous step but not this step
          let eligibleLeads;

          if (stepNum === 1) {
            // First step: find campaign recipients that haven't gotten step 1
            // These should already be queued somewhere - skip for now
            // (Step 1 is sent via the regular send flow)
            continue;
          }

          // Follow-up steps: find leads who received step N-1 but not step N
          eligibleLeads = await pool.query(
            `SELECT DISTINCT se.lead_id, se.to_email, se.to_name, se.variant_id
             FROM lr_sent_emails se
             WHERE se.campaign_id = $1
               AND se.sequence_step = $2
               AND se.user_id = $3
               AND se.lead_id IS NOT NULL
               -- Not replied
               AND se.status != 'replied'
               -- Enough time has passed
               AND se.sent_at <= NOW() - INTERVAL '${parseInt(delayDays)} days'
               -- Haven't received next step yet
               AND NOT EXISTS (
                 SELECT 1 FROM lr_sent_emails se2
                 WHERE se2.campaign_id = $1
                   AND se2.lead_id = se.lead_id
                   AND se2.sequence_step = $4
               )
               -- Haven't replied to any step
               AND NOT EXISTS (
                 SELECT 1 FROM lr_sent_emails se3
                 WHERE se3.campaign_id = $1
                   AND se3.lead_id = se.lead_id
                   AND se3.status = 'replied'
               )
             LIMIT 50`,
            [campaign.id, stepNum - 1, campaign.user_id, stepNum]
          );

          if (eligibleLeads.rows.length === 0) continue;

          // Create transporter
          const transporter = nodemailer.createTransport({
            host: campaign.smtp_host,
            port: parseInt(campaign.smtp_port),
            secure: parseInt(campaign.smtp_port) === 465,
            auth: {
              user: campaign.username,
              pass: campaign.password_encrypted
            },
            connectionTimeout: 10000,
            socketTimeout: 10000
          });

          // Get A/B variants if applicable
          const variants = settings.ab_variants || [];
          const useVariants = variants.length > 0;

          for (const lead of eligibleLeads.rows) {
            try {
              // Load full lead data for merge tags
              let leadData = {};
              if (lead.lead_id) {
                const leadResult = await pool.query(
                  'SELECT * FROM lr_leads WHERE id = $1',
                  [lead.lead_id]
                );
                if (leadResult.rows.length > 0) {
                  leadData = leadResult.rows[0];
                }
              }

              // Determine subject and body (use step's or variant's)
              let stepSubject = step.subject || campaign.subject || '';
              let stepBody = step.body || campaign.body || '';

              // If A/B testing, use the same variant as step 1
              if (useVariants && lead.variant_id) {
                const variant = variants.find(v => v.id === lead.variant_id);
                if (variant) {
                  stepSubject = step.subject || variant.subject || stepSubject;
                  stepBody = step.body || variant.body || stepBody;
                }
              }

              // Replace merge tags
              stepSubject = replaceMergeTags(stepSubject, leadData);
              stepBody = replaceMergeTags(stepBody, leadData);

              // Generate tracking
              const trackingId = crypto.randomUUID();
              const trackedBody = injectTracking(stepBody, trackingId);

              // Send
              await transporter.sendMail({
                from: campaign.display_name
                  ? `"${campaign.display_name}" <${campaign.email_address}>`
                  : campaign.email_address,
                to: lead.to_name ? `"${lead.to_name}" <${lead.to_email}>` : lead.to_email,
                subject: stepSubject,
                html: trackedBody
              });

              // Record sent email
              await pool.query(
                `INSERT INTO lr_sent_emails
                  (user_id, email_account_id, campaign_id, lead_id, from_account_id,
                   to_email, to_name, subject, body, tracking_id, status,
                   sequence_step, variant_id, sent_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'sent', $11, $12, NOW())`,
                [campaign.user_id, campaign.from_account_id, campaign.id, lead.lead_id,
                 campaign.from_account_id, lead.to_email, lead.to_name,
                 stepSubject, trackedBody, trackingId, stepNum, lead.variant_id]
              );

              totalSent++;

              // Delay between sends
              if (settings.delayBetweenSends) {
                await new Promise(r => setTimeout(r, parseInt(settings.delayBetweenSends) * 1000));
              }
            } catch (sendError) {
              errors.push(`Failed to send to ${lead.to_email}: ${sendError.message}`);
            }
          }

          transporter.close();
        }
      } catch (campaignError) {
        errors.push(`Campaign ${campaign.id} error: ${campaignError.message}`);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Processed ${campaigns.rows.length} campaign(s). Sent ${totalSent}, skipped ${totalSkipped}.`,
        sent: totalSent,
        skipped: totalSkipped,
        errors: errors.length > 0 ? errors : undefined
      })
    };
  } catch (error) {
    console.error('Process sequences error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
