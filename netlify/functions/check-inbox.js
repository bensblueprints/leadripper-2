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

// Classify email sentiment
function classifySentiment(subject, body) {
  const text = ((subject || '') + ' ' + (body || '')).toLowerCase();

  // OOO patterns
  const oooPatterns = [
    'out of office', 'out of the office', 'away from', 'on vacation',
    'on holiday', 'auto-reply', 'automatic reply', 'auto reply',
    'will be back', 'currently unavailable', 'limited access',
    'away until', 'maternity leave', 'paternity leave', 'sick leave'
  ];
  if (oooPatterns.some(p => text.includes(p))) return 'ooo';

  // Bounce patterns
  const bouncePatterns = [
    'delivery failed', 'undeliverable', 'mail delivery',
    'delivery notification', 'returned mail', 'mailer-daemon',
    'delivery status notification', 'mailbox not found',
    'address rejected', 'user unknown', 'does not exist',
    'permanent failure', 'message not delivered'
  ];
  if (bouncePatterns.some(p => text.includes(p))) return 'bounce';

  // Negative patterns
  const negativePatterns = [
    'not interested', 'no thanks', 'no thank you', 'unsubscribe',
    'remove me', 'stop emailing', 'stop contacting', 'take me off',
    'opt out', 'opt-out', 'don\'t contact', 'do not contact',
    'not looking', 'please remove', 'leave me alone', 'spam',
    'no longer interested', 'don\'t email', 'do not email',
    'we\'re not interested', 'we are not interested', 'pass on this',
    'not at this time', 'delete my', 'cease and desist'
  ];
  if (negativePatterns.some(p => text.includes(p))) return 'negative';

  // Positive patterns
  const positivePatterns = [
    'interested', 'yes', 'sounds good', 'tell me more', 'schedule',
    'let\'s talk', 'let\'s chat', 'set up a call', 'book a meeting',
    'i\'d like', 'i would like', 'when can we', 'available',
    'send me more', 'pricing', 'proposal', 'demo', 'free trial',
    'sounds great', 'let\'s meet', 'looking forward', 'sign me up',
    'count me in', 'absolutely', 'definitely', 'great idea',
    'love to learn more', 'what are your rates', 'how much',
    'send over', 'let\'s connect', 'happy to discuss'
  ];
  if (positivePatterns.some(p => text.includes(p))) return 'positive';

  return 'neutral';
}

// Extract snippet from email body
function extractSnippet(body, maxLen = 200) {
  if (!body) return '';
  // Strip HTML tags
  let text = body.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
  // Remove quoted replies (lines starting with > or On ... wrote:)
  text = text.split('\n').filter(line => !line.trim().startsWith('>') && !line.match(/^On .+ wrote:$/)).join(' ').trim();
  if (text.length > maxLen) text = text.substring(0, maxLen) + '...';
  return text;
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

  // GET - Fetch inbox messages
  if (event.httpMethod === 'GET') {
    try {
      const params = event.queryStringParameters || {};
      const filter = params.filter || '';
      const limit = parseInt(params.limit) || 50;
      const offset = parseInt(params.offset) || 0;

      let whereClause = 'WHERE i.user_id = $1';
      const queryParams = [userId];
      let paramIdx = 2;

      if (filter === 'unread') {
        whereClause += ' AND i.is_read = false';
      } else if (filter === 'positive' || filter === 'negative' || filter === 'ooo' || filter === 'neutral' || filter === 'bounce') {
        whereClause += ` AND i.sentiment = $${paramIdx}`;
        queryParams.push(filter);
        paramIdx++;
      } else if (filter === 'starred') {
        whereClause += ' AND i.is_starred = true';
      }

      const result = await pool.query(
        `SELECT i.*, se.subject as original_subject, se.campaign_id as orig_campaign_id
         FROM lr_inbox i
         LEFT JOIN lr_sent_emails se ON i.sent_email_id = se.id
         ${whereClause}
         ORDER BY i.received_at DESC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...queryParams, limit, offset]
      );

      const countResult = await pool.query(
        `SELECT COUNT(*) as total FROM lr_inbox i ${whereClause}`,
        queryParams
      );

      // Get unread count
      const unreadResult = await pool.query(
        'SELECT COUNT(*) as unread FROM lr_inbox WHERE user_id = $1 AND is_read = false',
        [userId]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          messages: result.rows,
          total: parseInt(countResult.rows[0].total),
          unread: parseInt(unreadResult.rows[0].unread),
          limit,
          offset
        })
      };
    } catch (error) {
      console.error('Fetch inbox error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  // POST - Check for new replies via IMAP (manual trigger)
  if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body || '{}');
      const action = body.action;

      // Mark message as read
      if (action === 'markRead') {
        await pool.query(
          'UPDATE lr_inbox SET is_read = true WHERE id = $1 AND user_id = $2',
          [body.messageId, userId]
        );
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      // Toggle star
      if (action === 'toggleStar') {
        await pool.query(
          'UPDATE lr_inbox SET is_starred = NOT is_starred WHERE id = $1 AND user_id = $2',
          [body.messageId, userId]
        );
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      // Mark all as read
      if (action === 'markAllRead') {
        await pool.query(
          'UPDATE lr_inbox SET is_read = true WHERE user_id = $1 AND is_read = false',
          [userId]
        );
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      // Default: poll for new emails via IMAP
      const accounts = await pool.query(
        `SELECT id, email_address, imap_host, imap_port, username, password_encrypted, provider
         FROM lr_email_accounts WHERE user_id = $1 AND is_active = true`,
        [userId]
      );

      if (accounts.rows.length === 0) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, message: 'No email accounts connected', checked: 0 })
        };
      }

      let totalNew = 0;

      for (const account of accounts.rows) {
        if (!account.imap_host || !account.username || !account.password_encrypted) {
          continue;
        }

        try {
          const newMessages = await checkImapAccount(account, userId);
          totalNew += newMessages;
        } catch (accountError) {
          console.error(`IMAP check failed for ${account.email_address}:`, accountError.message);
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: `Checked ${accounts.rows.length} account(s), found ${totalNew} new message(s)`,
          newMessages: totalNew,
          accountsChecked: accounts.rows.length
        })
      };
    } catch (error) {
      console.error('Check inbox error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};

// Check single IMAP account for new messages (lightweight approach)
async function checkImapAccount(account, userId) {
  const Imap = require('imap');

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      try { imap.end(); } catch (e) {}
      reject(new Error('IMAP timeout'));
    }, 8000); // 8s timeout (Netlify has 10s limit)

    const imap = new Imap({
      user: account.username,
      password: account.password_encrypted,
      host: account.imap_host,
      port: parseInt(account.imap_port) || 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 5000,
      authTimeout: 5000
    });

    let newCount = 0;

    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err, box) => {
        if (err) {
          clearTimeout(timeout);
          imap.end();
          return reject(err);
        }

        // Search for recent unseen messages (last 3 days)
        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - 3);
        const dateStr = sinceDate.toISOString().split('T')[0];

        imap.search(['UNSEEN', ['SINCE', dateStr]], (err, results) => {
          if (err || !results || results.length === 0) {
            clearTimeout(timeout);
            imap.end();
            return resolve(0);
          }

          // Only fetch last 20 messages max
          const uids = results.slice(-20);

          const f = imap.fetch(uids, {
            bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES)', 'TEXT'],
            struct: true
          });

          const messages = [];

          f.on('message', (msg, seqno) => {
            let headerData = '';
            let bodyData = '';

            msg.on('body', (stream, info) => {
              let buffer = '';
              stream.on('data', (chunk) => { buffer += chunk.toString('utf8'); });
              stream.on('end', () => {
                if (info.which.includes('HEADER')) {
                  headerData = buffer;
                } else {
                  bodyData = buffer;
                }
              });
            });

            msg.once('end', () => {
              messages.push({ header: headerData, body: bodyData });
            });
          });

          f.once('error', (err) => {
            console.error('Fetch error:', err);
          });

          f.once('end', async () => {
            clearTimeout(timeout);
            imap.end();

            // Process messages
            for (const msg of messages) {
              try {
                const parsed = parseHeaders(msg.header);
                const fromEmail = parsed.from || '';
                const messageId = parsed['message-id'] || '';
                const inReplyTo = parsed['in-reply-to'] || '';
                const subject = parsed.subject || '';
                const date = parsed.date || new Date().toISOString();

                // Check if we already have this message
                const exists = await pool.query(
                  'SELECT id FROM lr_inbox WHERE user_id = $1 AND message_id = $2',
                  [userId, messageId]
                );
                if (exists.rows.length > 0) continue;

                // Try to match to a sent email
                let sentEmailId = null;
                let campaignId = null;
                let leadId = null;

                if (inReplyTo) {
                  // Match by In-Reply-To header
                  const sentMatch = await pool.query(
                    `SELECT id, campaign_id, lead_id FROM lr_sent_emails
                     WHERE user_id = $1 AND to_email = $2
                     ORDER BY sent_at DESC LIMIT 1`,
                    [userId, fromEmail]
                  );
                  if (sentMatch.rows.length > 0) {
                    sentEmailId = sentMatch.rows[0].id;
                    campaignId = sentMatch.rows[0].campaign_id;
                    leadId = sentMatch.rows[0].lead_id;
                  }
                }

                // Also try subject line matching
                if (!sentEmailId && subject) {
                  const cleanSubject = subject.replace(/^(re|fwd|fw):\s*/gi, '').trim();
                  const sentMatch = await pool.query(
                    `SELECT id, campaign_id, lead_id FROM lr_sent_emails
                     WHERE user_id = $1 AND to_email = $2 AND subject ILIKE $3
                     ORDER BY sent_at DESC LIMIT 1`,
                    [userId, fromEmail, '%' + cleanSubject + '%']
                  );
                  if (sentMatch.rows.length > 0) {
                    sentEmailId = sentMatch.rows[0].id;
                    campaignId = sentMatch.rows[0].campaign_id;
                    leadId = sentMatch.rows[0].lead_id;
                  }
                }

                const sentiment = classifySentiment(subject, msg.body);
                const snippet = extractSnippet(msg.body);
                const fromParts = fromEmail.match(/^"?([^"<]*)"?\s*<?([^>]*)>?$/);
                const fromName = fromParts ? fromParts[1].trim() : '';
                const fromAddr = fromParts ? fromParts[2].trim() : fromEmail;

                await pool.query(
                  `INSERT INTO lr_inbox
                    (user_id, account_id, lead_id, campaign_id, sent_email_id,
                     from_email, from_name, to_email, subject, body, body_snippet,
                     message_id, in_reply_to, sentiment, received_at)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
                  [userId, account.id, leadId, campaignId, sentEmailId,
                   fromAddr, fromName, account.email_address, subject, msg.body, snippet,
                   messageId, inReplyTo, sentiment, new Date(date)]
                );

                // Update sent email status to replied
                if (sentEmailId) {
                  await pool.query(
                    `UPDATE lr_sent_emails SET
                      status = 'replied',
                      replied_at = COALESCE(replied_at, NOW())
                     WHERE id = $1`,
                    [sentEmailId]
                  );
                }

                newCount++;
              } catch (msgError) {
                console.error('Message processing error:', msgError.message);
              }
            }

            resolve(newCount);
          });
        });
      });
    });

    imap.once('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    imap.connect();
  });
}

// Simple header parser
function parseHeaders(headerStr) {
  const result = {};
  const lines = headerStr.split(/\r?\n/);
  let currentKey = '';
  let currentVal = '';

  for (const line of lines) {
    if (line.match(/^\s/) && currentKey) {
      currentVal += ' ' + line.trim();
    } else {
      if (currentKey) {
        result[currentKey.toLowerCase()] = currentVal;
      }
      const match = line.match(/^([^:]+):\s*(.*)/);
      if (match) {
        currentKey = match[1];
        currentVal = match[2];
      }
    }
  }
  if (currentKey) {
    result[currentKey.toLowerCase()] = currentVal;
  }

  return result;
}
