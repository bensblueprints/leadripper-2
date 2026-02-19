const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://eyaitfxwjhsrizsbqcem.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5YWl0Znh3amhzcml6c2JxY2VtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzODk0NDYsImV4cCI6MjA4NTk2NTQ0Nn0.xihzbULV2wrhX3JvB8ZER98wUKPlwX2xzEBuYrJVDNA'
);

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2026';
const AIRWALLEX_CLIENT_ID = process.env.AIRWALLEX_CLIENT_ID || 'VBU4oeFdS_Of60Y-ZK5bmg';
const AIRWALLEX_API_KEY = process.env.AIRWALLEX_API_KEY || '79e1f2c28f844cacbf445e7189c4ca9c66d0bd096e187a980549b8a049d89956e6cfad686023912eb4f9ab9ad222457d';
const AIRWALLEX_BASE_URL = 'https://api.airwallex.com';

// Price IDs from Airwallex
const PRICE_IDS = {
  basic: 'pri_sgpdrm4wghfjrwxkqaq',
  starter: 'pri_sgpd5s4zvhfjrnpp80d',
  advanced: 'pri_sgpd5s4zvhfjrnq7ki7',
  premium: 'pri_sgpdbmdcbhfjrnqkr1q',
  enterprise: 'pri_sgpdbmdcbhfjrwy1phi',
  unlimited: 'pri_sgpdbmdcbhfjrnqy8dz'
};

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

async function createBillingCustomer(accessToken, email, name) {
  const payload = {
    request_id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type: 'INDIVIDUAL',
    email: email,
    name: name,
    metadata: {
      source: 'leadripper_trial',
      created_at: new Date().toISOString()
    }
  };

  const response = await fetch(`${AIRWALLEX_BASE_URL}/api/v1/billing_customers/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Billing customer creation failed: ${error}`);
  }

  return response.json();
}

async function createTrialPaymentIntent(accessToken, billingCustomerId, email, orderId) {
  const payload = {
    request_id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    amount: 1.00,
    currency: 'USD',
    merchant_order_id: orderId,
    billing_customer_id: billingCustomerId,
    metadata: {
      customer_email: email,
      source: 'leadripper_trial_payment',
      type: 'trial_activation'
    },
    return_url: `${process.env.URL || 'https://leadripper.com'}/?payment=success&order=${orderId}`,
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
    throw new Error(`Trial payment intent creation failed: ${error}`);
  }

  return response.json();
}

async function createSubscription(accessToken, billingCustomerId, priceId, userId, plan) {
  const payload = {
    request_id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    billing_customer_id: billingCustomerId,
    collection_method: 'AUTO_CHARGE',
    items: [
      {
        price_id: priceId,
        quantity: 1
      }
    ],
    trial_period: {
      period_unit: 'DAY',
      period: 7
    },
    metadata: {
      user_id: userId.toString(),
      plan: plan,
      source: 'leadripper_trial'
    }
  };

  const response = await fetch(`${AIRWALLEX_BASE_URL}/api/v1/subscriptions/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Subscription creation failed: ${error}`);
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

    // Validate plan
    if (!PRICE_IDS[plan]) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid plan selected' })
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

    // Generate order ID
    const orderId = `LR_TRIAL_${Date.now()}_${plan}`;

    // Get Airwallex token
    const accessToken = await getAirwallexToken();

    // Create billing customer in Airwallex
    console.log('Creating billing customer...');
    const billingCustomer = await createBillingCustomer(accessToken, email, name);

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user with pending status using Supabase
    const { data: userData, error: insertError } = await supabase
      .from('lr_users')
      .insert([{
        email: email.toLowerCase(),
        password_hash: passwordHash,
        name: name,
        company: company,
        plan: 'pending',
        leads_limit: 0,
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

    // Create $1 trial payment intent (subscription will be created by webhook after payment succeeds)
    console.log('Creating trial payment intent...');
    const paymentIntent = await createTrialPaymentIntent(
      accessToken,
      billingCustomer.id,
      email,
      orderId
    );

    // Store pending subscription record in database (Airwallex subscription will be created by webhook)
    const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { error: subscriptionError } = await supabase
      .from('lr_subscriptions')
      .insert([{
        user_id: user.id,
        plan: plan,
        status: 'pending_payment',
        payment_intent_id: paymentIntent.id,
        airwallex_customer_id: billingCustomer.id,
        billing_cycle: 'monthly',
        is_trial: true,
        trial_ends_at: trialEndsAt
      }]);

    if (subscriptionError) {
      console.error('Error creating subscription record:', subscriptionError);
      throw new Error('Failed to create subscription record');
    }

    // Return payment intent details for Airwallex SDK
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        billingCustomerId: billingCustomer.id,
        currency: 'USD',
        userId: user.id,
        email: user.email,
        plan: plan,
        orderId: orderId,
        message: '$1 trial payment created - subscription will be activated after payment'
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
