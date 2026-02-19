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
    const { email, password, name, company } = JSON.parse(event.body);

    // Validation
    if (!email || !password) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email and password are required' })
      };
    }

    // Check if user exists using Supabase
    const { data: existingUsers, error: checkError } = await supabase
      .from('lr_users')
      .select('id')
      .eq('email', email.toLowerCase())
      .limit(1);

    if (checkError) {
      console.error('Error checking existing user:', checkError);
      throw new Error('Database query failed');
    }

    if (existingUsers && existingUsers.length > 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email already registered' })
      };
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user with 50 free leads using Supabase
    const { data: userData, error: insertError } = await supabase
      .from('lr_users')
      .insert([{
        email: email.toLowerCase(),
        password_hash: passwordHash,
        name: name,
        company: company,
        plan: 'free',
        leads_limit: 50,
        leads_used: 0
      }])
      .select()
      .single();

    if (insertError) {
      console.error('Error creating user:', insertError);
      throw new Error('Failed to create user account');
    }

    const user = userData;

    // Create user settings record
    const { error: settingsError } = await supabase
      .from('lr_user_settings')
      .insert([{ user_id: user.id }]);

    if (settingsError) {
      console.error('Error creating user settings:', settingsError);
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
