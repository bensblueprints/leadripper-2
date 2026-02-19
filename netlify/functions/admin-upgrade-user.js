const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
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

  try {
    const { email, plan, leadsLimit } = JSON.parse(event.body);

    if (!email || !plan) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email and plan are required' })
      };
    }

    // Update user plan
    const result = await pool.query(
      `UPDATE lr_users
       SET plan = $1, leads_limit = $2, updated_at = NOW()
       WHERE email = $3
       RETURNING id, email, plan, leads_limit, leads_used`,
      [plan, leadsLimit || -1, email]
    );

    if (result.rows.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'User not found' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        user: result.rows[0]
      })
    };
  } catch (error) {
    console.error('Admin upgrade error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to upgrade user', message: error.message })
    };
  }
};
