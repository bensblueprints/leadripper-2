const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2026';

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
    const { email, password, name, company } = JSON.parse(event.body);

    // Validation
    if (!email || !password) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email and password are required' })
      };
    }

    // Check if user exists using pg
    const existingResult = await pool.query(
      'SELECT id FROM lr_users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existingResult.rows.length > 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email already registered' })
      };
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user with 100 free leads
    const userResult = await pool.query(
      `INSERT INTO lr_users (email, password_hash, name, company, plan, leads_limit, leads_used, created_at)
       VALUES ($1, $2, $3, $4, 'free', 100, 0, NOW())
       RETURNING id, email, name, company, plan, leads_limit, leads_used, created_at`,
      [email.toLowerCase(), passwordHash, name || '', company || '']
    );

    const user = userResult.rows[0];

    // Create user settings record
    try {
      await pool.query(
        'INSERT INTO lr_user_settings (user_id, created_at) VALUES ($1, NOW()) ON CONFLICT (user_id) DO NOTHING',
        [user.id]
      );
    } catch (settingsError) {
      console.error('Error creating user settings:', settingsError.message);
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          company: user.company,
          plan: user.plan,
          leadsLimit: user.leads_limit,
          leadsUsed: user.leads_used,
          createdAt: user.created_at
        }
      })
    };
  } catch (error) {
    console.error('Registration error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Registration failed',
        message: error.message
      })
    };
  }
};
