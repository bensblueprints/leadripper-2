const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

// 1x1 transparent PNG pixel
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAABJRU5ErkJggg==',
  'base64'
);

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: ''
    };
  }

  const params = event.queryStringParameters || {};
  const trackingId = params.t;
  const linkUrl = params.l;

  if (!trackingId) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store, no-cache' },
      body: PIXEL.toString('base64'),
      isBase64Encoded: true
    };
  }

  const ip = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
  const userAgent = event.headers['user-agent'] || 'unknown';

  try {
    if (linkUrl) {
      // Click tracking
      await pool.query(
        `INSERT INTO lr_tracking_events (tracking_id, event_type, ip_address, user_agent, link_url)
         VALUES ($1, 'click', $2, $3, $4)`,
        [trackingId, ip, userAgent, linkUrl]
      );

      // Update sent email record
      await pool.query(
        `UPDATE lr_sent_emails SET
          click_count = COALESCE(click_count, 0) + 1,
          clicked_at = COALESCE(clicked_at, NOW()),
          status = CASE WHEN status IN ('sent', 'opened') THEN 'clicked' ELSE status END
         WHERE tracking_id = $1`,
        [trackingId]
      );

      // Redirect to actual URL
      const decodedUrl = decodeURIComponent(linkUrl);
      // Ensure URL has protocol
      const redirectUrl = decodedUrl.startsWith('http') ? decodedUrl : 'https://' + decodedUrl;

      return {
        statusCode: 302,
        headers: {
          'Location': redirectUrl,
          'Cache-Control': 'no-store, no-cache'
        },
        body: ''
      };
    } else {
      // Open tracking (pixel request)
      await pool.query(
        `INSERT INTO lr_tracking_events (tracking_id, event_type, ip_address, user_agent)
         VALUES ($1, 'open', $2, $3)`,
        [trackingId, ip, userAgent]
      );

      // Update sent email record
      await pool.query(
        `UPDATE lr_sent_emails SET
          open_count = COALESCE(open_count, 0) + 1,
          opened_at = COALESCE(opened_at, NOW()),
          status = CASE WHEN status = 'sent' THEN 'opened' ELSE status END
         WHERE tracking_id = $1`,
        [trackingId]
      );

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        },
        body: PIXEL.toString('base64'),
        isBase64Encoded: true
      };
    }
  } catch (error) {
    console.error('Tracking error:', error);

    // Still return pixel/redirect even if DB fails
    if (linkUrl) {
      const decodedUrl = decodeURIComponent(linkUrl);
      const redirectUrl = decodedUrl.startsWith('http') ? decodedUrl : 'https://' + decodedUrl;
      return { statusCode: 302, headers: { 'Location': redirectUrl }, body: '' };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store, no-cache' },
      body: PIXEL.toString('base64'),
      isBase64Encoded: true
    };
  }
};
