const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

// 1x1 transparent PNG
const TRACKING_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

exports.handler = async (event, context) => {
  try {
    const trackingId = event.queryStringParameters?.id;

    if (trackingId) {
      // Update the email as opened
      await pool.query(
        `UPDATE lr_sent_emails SET opened_at = COALESCE(opened_at, NOW()), open_count = open_count + 1
         WHERE tracking_id = $1`,
        [trackingId]
      );
    }

    // Return tracking pixel
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      },
      body: TRACKING_PIXEL.toString('base64'),
      isBase64Encoded: true
    };
  } catch (error) {
    console.error('Track email error:', error);
    // Still return the pixel even on error
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'image/png' },
      body: TRACKING_PIXEL.toString('base64'),
      isBase64Encoded: true
    };
  }
};
