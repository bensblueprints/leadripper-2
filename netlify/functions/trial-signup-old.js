const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const fetch = require('node-fetch');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2026';
const AIRWALLEX_CLIENT_ID = process.env.AIRWALLEX_CLIENT_ID || 'VBU4oeFdS_Of60Y-ZK5bmg';
const AIRWALLEX_API_KEY = process.env.AIRWALLEX_API_KEY || '79e1f2c28f844cacbf445e7189c4ca9c66d0bd096e187a980549b8a049d89956e6cfad686023912eb4f9ab9ad222457d';
const AIRWALLEX_BASE_URL = 'https://api.airwallex.com';

async function getAirwallexToken() {
  const response = await fetch(`${AIRWALLEX_BASE_URL}/api/v1/authentication/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': AIRWALLEX_CLIENT_ID,
      'x-api-key': AIRWALLEX_API_KEY
    }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Airwallex auth failed: ${error}`);
  }

  const data = await response.json();
  return data.token;
}

async function createPaymentIntent(accessToken, email, plan, orderId) {
  const payload = {
    request_id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    amount: 1.00, // $1 trial
    currency: 'USD',
    merchant_order_id: orderId,
    metadata: {
      customer_email: email,
      plan_id: plan,
      source: 'leadripper_trial'
    },
    return_url: `${process.env.URL || 'https://leadripper.netlify.app'}/?payment=success&order=${orderId}`,
    descriptor: 'LeadRipper $1 Trial'
  };

  const response = await fetch(`${AIRWALLEX_BASE_URL}/api/v1/pa/payment_intents/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Payment intent creation failed: ${error}`);
  }

  return response.json();
}

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
    const { email, password, name, company, plan = 'starter' } = JSON.parse(event.body);

    // Validation
    if (!email || !password || !name) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email, password, and name are required' })
      };
    }

    // Check if user exists
    const existingUser = await pool.query(
      'SELECT id FROM lr_users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email already registered' })
      };
    }

    // Generate order ID
    const orderId = `LR_TRIAL_${Date.now()}_${plan}`;

    // Get Airwallex token and create payment intent
    const accessToken = await getAirwallexToken();
    const paymentIntent = await createPaymentIntent(accessToken, email, plan, orderId);

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user with pending status (will activate after payment)
    const result = await pool.query(
      `INSERT INTO lr_users (email, password_hash, name, company, plan, leads_limit, leads_used)
       VALUES ($1, $2, $3, $4, 'pending', 0, 0)
       RETURNING id, email, name, company`,
      [email.toLowerCase(), passwordHash, name, company]
    );

    const user = result.rows[0];

    // Create user settings record
    await pool.query(
      'INSERT INTO lr_user_settings (user_id) VALUES ($1)',
      [user.id]
    );

    // Store pending subscription with payment intent
    await pool.query(
      `INSERT INTO lr_subscriptions (user_id, plan, status, payment_intent_id, billing_cycle, is_trial, trial_ends_at)
       VALUES ($1, $2, 'pending', $3, 'monthly', true, NOW() + INTERVAL '7 days')`,
      [user.id, plan, paymentIntent.id]
    );

    // Return payment intent details for Airwallex SDK
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        currency: 'USD',
        userId: user.id,
        email: user.email,
        plan: plan,
        orderId: orderId
      })
    };
  } catch (error) {
    console.error('Trial signup error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to create trial signup',
        message: error.message
      })
    };
  }
};
