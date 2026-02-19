const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://eyaitfxwjhsrizsbqcem.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5YWl0Znh3amhzcml6c2JxY2VtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzODk0NDYsImV4cCI6MjA4NTk2NTQ0Nn0.xihzbULV2wrhX3JvB8ZER98wUKPlwX2xzEBuYrJVDNA'
);

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
    const { email, password } = JSON.parse(event.body);

    if (!email || !password) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email and password are required' })
      };
    }

    // Find user using Supabase
    const { data: users, error: queryError } = await supabase
      .from('lr_users')
      .select('id, email, password_hash, name, company, plan, leads_limit, leads_used, trial_ends_at, is_admin, created_at')
      .eq('email', email.toLowerCase())
      .limit(1);

    if (queryError) {
      console.error('Error finding user:', queryError);
      throw new Error('Database query failed');
    }

    if (!users || users.length === 0) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid email or password' })
      };
    }

    const user = users[0];

    // Verify password
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid email or password' })
      };
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email, isAdmin: user.is_admin },
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
          trialEndsAt: user.trial_ends_at,
          isAdmin: user.is_admin,
          createdAt: user.created_at
        }
      })
    };
  } catch (error) {
    console.error('Login error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Login failed',
        message: error.message
      })
    };
  }
};
