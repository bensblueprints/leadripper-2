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

  const decoded = verifyToken(event.headers.authorization);
  if (!decoded) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Unauthorized' })
    };
  }

  try {
    // Get user info
    const userResult = await pool.query(
      'SELECT id, email, name, company, plan, leads_used, leads_limit FROM lr_users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'User not found' })
      };
    }

    const user = userResult.rows[0];

    // Get total leads
    const totalResult = await pool.query(
      'SELECT COUNT(*) as total FROM lr_leads WHERE user_id = $1',
      [decoded.userId]
    );
    const totalLeads = parseInt(totalResult.rows[0].total) || 0;

    // Get synced leads
    const syncedResult = await pool.query(
      "SELECT COUNT(*) as total FROM lr_leads WHERE user_id = $1 AND ghl_synced = true",
      [decoded.userId]
    );
    const syncedLeads = parseInt(syncedResult.rows[0].total) || 0;

    // Get scraped cities count
    const citiesResult = await pool.query(
      'SELECT COUNT(DISTINCT city) as total FROM lr_leads WHERE user_id = $1 AND city IS NOT NULL',
      [decoded.userId]
    );
    const citiesScraped = parseInt(citiesResult.rows[0].total) || 0;

    // Get recent activity (last 7 days)
    const activityResult = await pool.query(
      `SELECT DATE(created_at) as date, COUNT(*) as count
       FROM lr_leads WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '7 days'
       GROUP BY DATE(created_at) ORDER BY date DESC`,
      [decoded.userId]
    );
    const activity = activityResult.rows.map(r => ({ date: r.date, count: parseInt(r.count) }));

    // Get top industries
    const industriesResult = await pool.query(
      `SELECT industry, COUNT(*) as count FROM lr_leads
       WHERE user_id = $1 AND industry IS NOT NULL AND industry != ''
       GROUP BY industry ORDER BY count DESC LIMIT 5`,
      [decoded.userId]
    );
    const topIndustries = industriesResult.rows.map(r => ({ industry: r.industry, count: parseInt(r.count) }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          company: user.company,
          plan: user.plan,
          leadsUsed: user.leads_used,
          leadsLimit: user.leads_limit
        },
        stats: {
          totalLeads,
          syncedLeads,
          citiesScraped,
          leadsRemaining: user.leads_limit === -1 ? -1 : (user.leads_limit - user.leads_used)
        },
        activity,
        topIndustries
      })
    };
  } catch (error) {
    console.error('Get stats error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to get stats', message: error.message })
    };
  }
};
