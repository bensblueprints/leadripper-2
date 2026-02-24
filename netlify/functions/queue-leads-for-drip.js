const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2026';

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

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const decoded = verifyToken(event.headers.authorization);
  if (!decoded) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Unauthorized' })
    };
  }

  try {
    const { leadIds } = JSON.parse(event.body || '{}');

    // Get user's drip settings
    const settingsResult = await pool.query(
      `SELECT ghl_api_key, ghl_location_id, ghl_pipeline_id, ghl_drip_enabled, ghl_drip_interval
       FROM lr_user_settings WHERE user_id = $1`,
      [decoded.userId]
    );

    const settings = settingsResult.rows[0];

    if (!settings || !settings.ghl_api_key || !settings.ghl_location_id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'GHL API not configured. Please add your API key and Location ID in settings.' })
      };
    }

    if (!settings.ghl_drip_enabled) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Slow-drip sync is not enabled. Enable it in settings to use the queue.' })
      };
    }

    // Get leads to queue - ONLY VALIDATED EMAILS
    let leadsQuery = `
      SELECT l.id
      FROM lr_leads l
      LEFT JOIN lr_ghl_queue q ON l.id = q.lead_id
      WHERE l.user_id = $1
        AND l.ghl_synced = false
        AND l.email IS NOT NULL
        AND l.email != ''
        AND (l.email_verified = true OR l.email_score >= 60)
        AND (l.is_disposable = false OR l.is_disposable IS NULL)
        AND q.id IS NULL
    `;
    const values = [decoded.userId];

    if (leadIds && leadIds.length > 0) {
      leadsQuery += ` AND l.id = ANY($2)`;
      values.push(leadIds);
    }

    const leadsResult = await pool.query(leadsQuery, values);
    const leads = leadsResult.rows;

    if (leads.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'No new leads to queue',
          queuedCount: 0
        })
      };
    }

    // Calculate scheduled times based on drip interval
    const intervalMinutes = settings.ghl_drip_interval || 15;
    const now = new Date();
    let queuedCount = 0;

    // Get current queue position for this user
    const queueCountResult = await pool.query(
      `SELECT COUNT(*) as count FROM lr_ghl_queue WHERE user_id = $1 AND status = 'pending'`,
      [decoded.userId]
    );
    let queuePosition = parseInt(queueCountResult.rows[0]?.count || 0);

    for (const lead of leads) {
      // Calculate scheduled time based on position in queue
      const scheduledFor = new Date(now.getTime() + (queuePosition * intervalMinutes * 60 * 1000));

      await pool.query(
        `INSERT INTO lr_ghl_queue (user_id, lead_id, status, scheduled_for)
         VALUES ($1, $2, 'pending', $3)
         ON CONFLICT (lead_id) DO NOTHING`,
        [decoded.userId, lead.id, scheduledFor]
      );

      queuePosition++;
      queuedCount++;
    }

    // Calculate estimated completion time
    const totalMinutes = queuePosition * intervalMinutes;
    const estimatedCompletion = new Date(now.getTime() + (totalMinutes * 60 * 1000));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Added ${queuedCount} leads to the drip queue`,
        queuedCount,
        totalInQueue: queuePosition,
        intervalMinutes,
        estimatedCompletion: estimatedCompletion.toISOString()
      })
    };

  } catch (error) {
    console.error('Queue leads error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to queue leads', message: error.message })
    };
  }
};
