const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Lifetime deal limits
const LIFETIME_LIMITS = {
  lifetime_basic: 100,  // First 100 users
  lifetime_pro: 1000    // First 1000 users
};

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

  try {
    // Count sold lifetime basic plans
    const basicResult = await pool.query(
      `SELECT COUNT(*) as count FROM lr_subscriptions
       WHERE plan = 'lifetime_basic' AND status = 'active'`
    );
    const basicSold = parseInt(basicResult.rows[0].count) || 0;
    const basicRemaining = Math.max(0, LIFETIME_LIMITS.lifetime_basic - basicSold);

    // Count sold lifetime pro plans
    const proResult = await pool.query(
      `SELECT COUNT(*) as count FROM lr_subscriptions
       WHERE plan = 'lifetime_pro' AND status = 'active'`
    );
    const proSold = parseInt(proResult.rows[0].count) || 0;
    const proRemaining = Math.max(0, LIFETIME_LIMITS.lifetime_pro - proSold);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        basic: basicRemaining,
        basicSold: basicSold,
        basicTotal: LIFETIME_LIMITS.lifetime_basic,
        pro: proRemaining,
        proSold: proSold,
        proTotal: LIFETIME_LIMITS.lifetime_pro
      })
    };
  } catch (error) {
    console.error('Error fetching lifetime spots:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to fetch lifetime spots' })
    };
  }
};
