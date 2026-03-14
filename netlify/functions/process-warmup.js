const { Pool } = require('pg');
const nodemailer = require('nodemailer');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

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
  'Just wanted to circle back'
];

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

function getRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Scheduled function - processes all active warmups across all users
exports.handler = async (event, context) => {
  console.log('Process warmup triggered at', new Date().toISOString());

  try {
    // Ensure tables exist
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

    // Get all active warmup settings
    const activeWarmups = await pool.query(
      `SELECT ws.*, ea.email_address, ea.display_name, ea.smtp_host, ea.smtp_port,
              ea.username, ea.password_encrypted, ea.is_active
       FROM lr_warmup_settings ws
       JOIN lr_email_accounts ea ON ea.id = ws.account_id
       WHERE ws.enabled = true AND ea.is_active = true`
    );

    if (activeWarmups.rows.length === 0) {
      console.log('No active warmups to process');
      return { statusCode: 200, body: JSON.stringify({ message: 'No active warmups' }) };
    }

    let totalSent = 0;

    for (const warmup of activeWarmups.rows) {
      try {
        // Calculate today's target
        const todayTarget = Math.min(
          warmup.ramp_increment * (warmup.current_day + 1),
          warmup.max_daily
        );

        // Check how many already sent today
        const todayCount = await pool.query(
          `SELECT COUNT(*) as cnt FROM lr_warmup_log
           WHERE user_id = $1 AND account_id = $2 AND action = 'sent'
           AND created_at >= CURRENT_DATE`,
          [warmup.user_id, warmup.account_id]
        );

        const alreadySent = parseInt(todayCount.rows[0].cnt);
        const remaining = todayTarget - alreadySent;

        if (remaining <= 0) {
          console.log(`Account ${warmup.email_address}: daily target reached (${alreadySent}/${todayTarget})`);
          continue;
        }

        // Get other connected accounts for this user
        const otherAccounts = await pool.query(
          `SELECT id, email_address FROM lr_email_accounts
           WHERE user_id = $1 AND id != $2 AND is_active = true`,
          [warmup.user_id, warmup.account_id]
        );

        const recipients = otherAccounts.rows.length > 0
          ? otherAccounts.rows.map(a => a.email_address)
          : [warmup.email_address];

        // Create transporter
        const transporter = nodemailer.createTransport({
          host: warmup.smtp_host,
          port: parseInt(warmup.smtp_port),
          secure: parseInt(warmup.smtp_port) === 465,
          auth: {
            user: warmup.username,
            pass: warmup.password_encrypted
          },
          connectionTimeout: 15000,
          socketTimeout: 15000
        });

        // Send a batch (spread throughout the day - send 2-3 per hour trigger)
        const batchSize = Math.min(remaining, 3);
        let sentCount = 0;

        for (let i = 0; i < batchSize; i++) {
          const toEmail = recipients[i % recipients.length];
          const subject = getRandomItem(WARMUP_SUBJECTS);
          const body = getRandomItem(WARMUP_BODIES);

          try {
            await transporter.sendMail({
              from: warmup.display_name
                ? `"${warmup.display_name}" <${warmup.email_address}>`
                : warmup.email_address,
              to: toEmail,
              subject: subject,
              text: body
            });

            await pool.query(
              `INSERT INTO lr_warmup_log (user_id, account_id, action, to_email, subject)
               VALUES ($1, $2, 'sent', $3, $4)`,
              [warmup.user_id, warmup.account_id, toEmail, subject]
            );

            sentCount++;
          } catch (sendError) {
            console.error(`Warmup send failed for ${warmup.email_address} to ${toEmail}:`, sendError.message);
          }
        }

        transporter.close();
        totalSent += sentCount;

        // Check if we should increment the day
        const newTodayCount = alreadySent + sentCount;
        if (newTodayCount >= todayTarget) {
          const lastWarmup = warmup.last_warmup_at ? new Date(warmup.last_warmup_at) : null;
          const today = new Date();
          today.setHours(0, 0, 0, 0);

          if (!lastWarmup || lastWarmup < today) {
            await pool.query(
              `UPDATE lr_warmup_settings
               SET current_day = current_day + 1,
                   daily_limit = LEAST($1 * (current_day + 2), $2),
                   last_warmup_at = NOW()
               WHERE user_id = $3 AND account_id = $4`,
              [warmup.ramp_increment, warmup.max_daily, warmup.user_id, warmup.account_id]
            );
          }
        }

        console.log(`Account ${warmup.email_address}: sent ${sentCount}/${remaining} remaining (day ${warmup.current_day + 1})`);
      } catch (accountError) {
        console.error(`Error processing warmup for account ${warmup.account_id}:`, accountError.message);
      }
    }

    console.log(`Warmup processing complete. Total sent: ${totalSent}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Processed ${activeWarmups.rows.length} warmups, sent ${totalSent} emails`
      })
    };
  } catch (error) {
    console.error('Process warmup error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
