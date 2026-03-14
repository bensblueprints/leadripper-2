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

// Natural-sounding warmup email subjects
const WARMUP_SUBJECTS = [
  'Quick question about the project timeline',
  'Following up on our earlier conversation',
  'Meeting notes from today',
  'Re: Budget review for Q2',
  'Thoughts on the proposal?',
  'Schedule update for next week',
  'Can you take a look at this?',
  'Thanks for the update',
  'Re: Team sync agenda',
  'Checking in on deliverables',
  'Updated report attached',
  'Re: Client feedback summary',
  'Quick note about the timeline',
  'FYI - new guidelines',
  'Re: Action items from Monday',
  'Appreciate the quick turnaround',
  'Status update request',
  'Re: Partnership discussion',
  'Ideas for the upcoming campaign',
  'Just wanted to circle back',
  'Re: Invoice clarification',
  'Preliminary research findings',
  'Re: Vendor comparison notes',
  'Scheduling a brief check-in',
  'Recap from our call',
  'Re: Quarterly review prep',
  'Document ready for review',
  'Re: Next steps on the initiative',
  'Coordination for Friday',
  'Re: Resource allocation update'
];

// Natural-sounding warmup email bodies
const WARMUP_BODIES = [
  'Hi there,\n\nJust wanted to follow up on our earlier discussion. Let me know if you have any questions or need anything else from my end.\n\nBest regards',
  'Hello,\n\nI reviewed the materials you sent over and everything looks good. Happy to discuss further if you have time this week.\n\nThanks!',
  'Hi,\n\nHope you\'re doing well. I wanted to check in and see if you had a chance to review the latest update. No rush, just keeping track.\n\nCheers',
  'Good morning,\n\nThanks for getting back to me so quickly. I\'ll incorporate your feedback and send over a revised version by end of day.\n\nBest',
  'Hi,\n\nI appreciate you taking the time to share your thoughts on this. It\'s really helpful to get your perspective. Let\'s touch base again next week.\n\nRegards',
  'Hello,\n\nJust a quick note to confirm that everything is on track for our deadline. Please let me know if anything changes on your end.\n\nThank you',
  'Hi there,\n\nWanted to share a quick update - we\'ve made good progress this week and are on schedule. I\'ll send a more detailed summary soon.\n\nBest',
  'Hello,\n\nThanks for the heads up. I\'ll make sure to adjust accordingly. Please keep me posted if there are any other changes.\n\nCheers',
  'Hi,\n\nGreat catch on that detail. I\'ve updated the document to reflect the correction. Let me know if you spot anything else.\n\nThanks!',
  'Good afternoon,\n\nI wanted to loop you in on the latest developments. Everything is moving forward smoothly and we should be ready for the next phase.\n\nBest regards'
];

// Reply bodies for warmup
const WARMUP_REPLIES = [
  'Thanks for the update! Looks great.',
  'Got it, appreciate you sharing this.',
  'Sounds good to me. Let me know if anything changes.',
  'Perfect, thanks for keeping me in the loop.',
  'Received, I\'ll review and get back to you shortly.',
  'Thanks! This is exactly what I needed.',
  'Great, I\'ll take a look and follow up.',
  'Appreciate the quick response on this!',
  'Noted. Let\'s discuss further in our next meeting.',
  'Thanks for the follow-up. All clear on my end.'
];

async function ensureWarmupTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lr_warmup_settings (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      enabled BOOLEAN DEFAULT false,
      daily_limit INTEGER DEFAULT 5,
      ramp_increment INTEGER DEFAULT 2,
      max_daily INTEGER DEFAULT 40,
      current_day INTEGER DEFAULT 0,
      last_warmup_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, account_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS lr_warmup_log (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      account_id INTEGER,
      action VARCHAR(20),
      to_email VARCHAR(255),
      subject VARCHAR(500),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

function getRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
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

  await ensureWarmupTables();

  // GET - Get warmup status for all accounts
  if (event.httpMethod === 'GET') {
    try {
      const params = event.queryStringParameters || {};

      // If accountId specified, get status for that account
      if (params.accountId) {
        const settingsResult = await pool.query(
          'SELECT * FROM lr_warmup_settings WHERE user_id = $1 AND account_id = $2',
          [userId, params.accountId]
        );

        const logResult = await pool.query(
          `SELECT action, to_email, subject, created_at
           FROM lr_warmup_log
           WHERE user_id = $1 AND account_id = $2
           ORDER BY created_at DESC LIMIT 20`,
          [userId, params.accountId]
        );

        // Get today's warmup count
        const todayCount = await pool.query(
          `SELECT COUNT(*) as cnt FROM lr_warmup_log
           WHERE user_id = $1 AND account_id = $2 AND action = 'sent'
           AND created_at >= CURRENT_DATE`,
          [userId, params.accountId]
        );

        const settings = settingsResult.rows[0] || {
          enabled: false, daily_limit: 5, ramp_increment: 2,
          max_daily: 40, current_day: 0
        };

        // Calculate today's target based on ramp
        const todayTarget = Math.min(
          settings.ramp_increment * (settings.current_day + 1),
          settings.max_daily
        );

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            settings: {
              ...settings,
              today_target: todayTarget,
              today_sent: parseInt(todayCount.rows[0].cnt)
            },
            log: logResult.rows
          })
        };
      }

      // Otherwise get all warmup settings for this user
      const allSettings = await pool.query(
        `SELECT ws.*, ea.email_address,
          (SELECT COUNT(*) FROM lr_warmup_log wl
           WHERE wl.user_id = ws.user_id AND wl.account_id = ws.account_id
           AND wl.action = 'sent' AND wl.created_at >= CURRENT_DATE) as today_sent
         FROM lr_warmup_settings ws
         JOIN lr_email_accounts ea ON ea.id = ws.account_id
         WHERE ws.user_id = $1
         ORDER BY ws.created_at DESC`,
        [userId]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, warmups: allSettings.rows })
      };
    } catch (error) {
      console.error('Get warmup status error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  // POST - Start/stop/trigger warmup
  if (event.httpMethod === 'POST') {
    try {
      const { accountId, action, settings } = JSON.parse(event.body);

      if (!accountId || !action) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'accountId and action required' }) };
      }

      if (action === 'start') {
        // Enable warmup for this account
        const rampIncrement = (settings && settings.rampIncrement) || 2;
        const maxDaily = (settings && settings.maxDaily) || 40;

        await pool.query(
          `INSERT INTO lr_warmup_settings (user_id, account_id, enabled, daily_limit, ramp_increment, max_daily, current_day, created_at)
           VALUES ($1, $2, true, $3, $4, $5, 0, NOW())
           ON CONFLICT (user_id, account_id)
           DO UPDATE SET enabled = true, ramp_increment = $4, max_daily = $5, current_day = 0, last_warmup_at = NULL`,
          [userId, accountId, rampIncrement, rampIncrement, maxDaily]
        );

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, message: 'Warmup started' })
        };

      } else if (action === 'stop') {
        await pool.query(
          `UPDATE lr_warmup_settings SET enabled = false WHERE user_id = $1 AND account_id = $2`,
          [userId, accountId]
        );

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, message: 'Warmup stopped' })
        };

      } else if (action === 'trigger') {
        // Manually trigger warmup for this account
        const result = await runWarmupForAccount(userId, accountId);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, ...result })
        };

      } else if (action === 'status') {
        const settingsResult = await pool.query(
          'SELECT * FROM lr_warmup_settings WHERE user_id = $1 AND account_id = $2',
          [userId, accountId]
        );

        const todayCount = await pool.query(
          `SELECT COUNT(*) as cnt FROM lr_warmup_log
           WHERE user_id = $1 AND account_id = $2 AND action = 'sent'
           AND created_at >= CURRENT_DATE`,
          [userId, accountId]
        );

        const logResult = await pool.query(
          `SELECT action, to_email, subject, created_at
           FROM lr_warmup_log
           WHERE user_id = $1 AND account_id = $2
           ORDER BY created_at DESC LIMIT 20`,
          [userId, accountId]
        );

        const s = settingsResult.rows[0] || {
          enabled: false, ramp_increment: 2, max_daily: 40, current_day: 0
        };

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            settings: {
              ...s,
              today_target: Math.min(s.ramp_increment * (s.current_day + 1), s.max_daily),
              today_sent: parseInt(todayCount.rows[0].cnt)
            },
            log: logResult.rows
          })
        };
      }

      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action' }) };
    } catch (error) {
      console.error('Warmup action error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};

async function runWarmupForAccount(userId, accountId) {
  // Get warmup settings
  const settingsResult = await pool.query(
    'SELECT * FROM lr_warmup_settings WHERE user_id = $1 AND account_id = $2 AND enabled = true',
    [userId, accountId]
  );

  if (settingsResult.rows.length === 0) {
    return { message: 'Warmup not enabled for this account', sent: 0 };
  }

  const settings = settingsResult.rows[0];

  // Calculate today's target
  const todayTarget = Math.min(
    settings.ramp_increment * (settings.current_day + 1),
    settings.max_daily
  );

  // Check how many already sent today
  const todayCount = await pool.query(
    `SELECT COUNT(*) as cnt FROM lr_warmup_log
     WHERE user_id = $1 AND account_id = $2 AND action = 'sent'
     AND created_at >= CURRENT_DATE`,
    [userId, accountId]
  );

  const alreadySent = parseInt(todayCount.rows[0].cnt);
  const remaining = todayTarget - alreadySent;

  if (remaining <= 0) {
    return { message: 'Daily warmup target already reached', sent: 0, todayTarget, alreadySent };
  }

  // Get the sending account credentials
  const accountResult = await pool.query(
    `SELECT id, email_address, display_name, smtp_host, smtp_port, username, password_encrypted
     FROM lr_email_accounts WHERE id = $1 AND user_id = $2 AND is_active = true`,
    [accountId, userId]
  );

  if (accountResult.rows.length === 0) {
    return { message: 'Email account not found or inactive', sent: 0 };
  }

  const senderAccount = accountResult.rows[0];

  // Get other connected accounts to send warmup emails between them
  const otherAccounts = await pool.query(
    `SELECT id, email_address FROM lr_email_accounts
     WHERE user_id = $1 AND id != $2 AND is_active = true`,
    [userId, accountId]
  );

  // If no other accounts, send to self
  const recipients = otherAccounts.rows.length > 0
    ? otherAccounts.rows.map(a => a.email_address)
    : [senderAccount.email_address];

  // Create transporter
  const transporter = nodemailer.createTransport({
    host: senderAccount.smtp_host,
    port: parseInt(senderAccount.smtp_port),
    secure: parseInt(senderAccount.smtp_port) === 465,
    auth: {
      user: senderAccount.username,
      pass: senderAccount.password_encrypted
    },
    connectionTimeout: 15000,
    socketTimeout: 15000
  });

  let sentCount = 0;
  const toSend = Math.min(remaining, 5); // Send max 5 per trigger to avoid timeout

  for (let i = 0; i < toSend; i++) {
    const toEmail = recipients[i % recipients.length];
    const subject = getRandomItem(WARMUP_SUBJECTS);
    const body = getRandomItem(WARMUP_BODIES);

    try {
      await transporter.sendMail({
        from: senderAccount.display_name
          ? `"${senderAccount.display_name}" <${senderAccount.email_address}>`
          : senderAccount.email_address,
        to: toEmail,
        subject: subject,
        text: body
      });

      // Log the warmup send
      await pool.query(
        `INSERT INTO lr_warmup_log (user_id, account_id, action, to_email, subject)
         VALUES ($1, $2, 'sent', $3, $4)`,
        [userId, accountId, toEmail, subject]
      );

      sentCount++;
    } catch (sendError) {
      console.error(`Warmup send failed to ${toEmail}:`, sendError.message);
    }
  }

  transporter.close();

  // Check if we should increment the day (if today's target is met)
  const newTodayCount = alreadySent + sentCount;
  if (newTodayCount >= todayTarget) {
    // Check if last_warmup_at was before today
    const lastWarmup = settings.last_warmup_at ? new Date(settings.last_warmup_at) : null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (!lastWarmup || lastWarmup < today) {
      await pool.query(
        `UPDATE lr_warmup_settings
         SET current_day = current_day + 1,
             daily_limit = LEAST($1 * (current_day + 2), $2),
             last_warmup_at = NOW()
         WHERE user_id = $3 AND account_id = $4`,
        [settings.ramp_increment, settings.max_daily, userId, accountId]
      );
    }
  }

  return {
    message: `Sent ${sentCount} warmup emails`,
    sent: sentCount,
    todayTarget,
    todaySent: newTodayCount
  };
}
