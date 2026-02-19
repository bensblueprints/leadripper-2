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

async function cancelAirwallexSubscription(accessToken, subscriptionId) {
  const payload = {
    request_id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  };

  const response = await fetch(`${AIRWALLEX_BASE_URL}/api/v1/subscriptions/${subscriptionId}/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Subscription cancellation failed: ${error}`);
  }

  return response.json();
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
    // Verify JWT token
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Unauthorized' })
      };
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId;

    // Get user's subscription
    const subResult = await pool.query(
      `SELECT airwallex_subscription_id, plan, status, trial_ends_at, current_period_end
       FROM lr_subscriptions
       WHERE user_id = $1 AND status IN ('active', 'in_trial', 'unpaid')`,
      [userId]
    );

    if (subResult.rows.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'No active subscription found' })
      };
    }

    const subscription = subResult.rows[0];
    const airwallexSubId = subscription.airwallex_subscription_id;

    if (!airwallexSubId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Subscription not found in Airwallex' })
      };
    }

    // Cancel subscription in Airwallex
    const accessToken = await getAirwallexToken();
    await cancelAirwallexSubscription(accessToken, airwallexSubId);

    // Update subscription status in database
    await pool.query(
      `UPDATE lr_subscriptions
       SET status = 'cancelled',
           updated_at = NOW()
       WHERE user_id = $1`,
      [userId]
    );

    // Calculate when access expires
    const accessUntil = subscription.trial_ends_at || subscription.current_period_end;
    const expiresAt = accessUntil ? new Date(accessUntil) : new Date();

    console.log(`Subscription cancelled for user ${userId}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Subscription cancelled successfully',
        accessUntil: expiresAt.toISOString(),
        plan: subscription.plan
      })
    };
  } catch (error) {
    console.error('Cancel subscription error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to cancel subscription',
        message: error.message
      })
    };
  }
};
