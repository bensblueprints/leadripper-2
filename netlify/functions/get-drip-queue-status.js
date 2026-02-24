const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
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

  if (event.httpMethod !== 'GET') {
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
    // Get queue statistics
    const statsResult = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'processing') as processing,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE status = 'completed' AND processed_at > NOW() - INTERVAL '24 hours') as completed_today,
        MIN(scheduled_for) FILTER (WHERE status = 'pending') as next_scheduled
      FROM lr_ghl_queue
      WHERE user_id = $1
    `, [decoded.userId]);

    const stats = statsResult.rows[0];

    // Get user's drip settings
    const settingsResult = await pool.query(
      `SELECT ghl_drip_enabled, ghl_drip_interval, ghl_last_drip_at
       FROM lr_user_settings WHERE user_id = $1`,
      [decoded.userId]
    );

    const settings = settingsResult.rows[0] || {};

    // Calculate estimated completion time
    const pendingCount = parseInt(stats.pending || 0);
    const intervalMinutes = settings.ghl_drip_interval || 15;
    const totalMinutes = pendingCount * intervalMinutes;
    const estimatedCompletion = pendingCount > 0
      ? new Date(Date.now() + (totalMinutes * 60 * 1000)).toISOString()
      : null;

    // Get recent queue items for display
    const recentResult = await pool.query(`
      SELECT q.id, q.lead_id, q.status, q.scheduled_for, q.processed_at, q.last_error,
             l.business_name, l.email
      FROM lr_ghl_queue q
      JOIN lr_leads l ON q.lead_id = l.id
      WHERE q.user_id = $1
      ORDER BY q.created_at DESC
      LIMIT 10
    `, [decoded.userId]);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        stats: {
          pending: parseInt(stats.pending || 0),
          processing: parseInt(stats.processing || 0),
          completed: parseInt(stats.completed || 0),
          failed: parseInt(stats.failed || 0),
          completedToday: parseInt(stats.completed_today || 0),
          nextScheduled: stats.next_scheduled
        },
        settings: {
          dripEnabled: settings.ghl_drip_enabled || false,
          intervalMinutes: settings.ghl_drip_interval || 15,
          lastDripAt: settings.ghl_last_drip_at
        },
        estimatedCompletion,
        recentItems: recentResult.rows
      })
    };

  } catch (error) {
    console.error('Get queue status error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to get queue status', message: error.message })
    };
  }
};
