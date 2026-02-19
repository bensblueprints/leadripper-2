const fetch = require('node-fetch');

// Airwallex API Configuration
const AIRWALLEX_CLIENT_ID = process.env.AIRWALLEX_CLIENT_ID || 'VBU4oeFdS_Of60Y-ZK5bmg';
const AIRWALLEX_API_KEY = process.env.AIRWALLEX_API_KEY || '79e1f2c28f844cacbf445e7189c4ca9c66d0bd096e187a980549b8a049d89956e6cfad686023912eb4f9ab9ad222457d';
const AIRWALLEX_BASE_URL = 'https://api.airwallex.com';

// LeadRipper Products
const PRODUCTS = [
  {
    id: 'leadripper_starter',
    name: 'LeadRipper Starter',
    description: '500 leads per month with CSV export and email support',
    type: 'subscription',
    plans: [
      {
        id: 'starter_monthly_trial',
        interval: 'month',
        interval_count: 1,
        trial_days: 7,
        price: 2900, // $29 in cents
        currency: 'USD'
      },
      {
        id: 'starter_annual_trial',
        interval: 'year',
        interval_count: 1,
        trial_days: 7,
        price: 27840, // $278.40 in cents (20% off)
        currency: 'USD'
      }
    ]
  },
  {
    id: 'leadripper_advanced',
    name: 'LeadRipper Advanced',
    description: '2,500 leads per month with GHL sync and priority support',
    type: 'subscription',
    plans: [
      {
        id: 'advanced_monthly_trial',
        interval: 'month',
        interval_count: 1,
        trial_days: 7,
        price: 7900, // $79 in cents
        currency: 'USD'
      },
      {
        id: 'advanced_annual_trial',
        interval: 'year',
        interval_count: 1,
        trial_days: 7,
        price: 75840, // $758.40 in cents (20% off)
        currency: 'USD'
      }
    ]
  },
  {
    id: 'leadripper_premium',
    name: 'LeadRipper Premium',
    description: '10,000 leads per month with API access and dedicated support',
    type: 'subscription',
    plans: [
      {
        id: 'premium_monthly_trial',
        interval: 'month',
        interval_count: 1,
        trial_days: 7,
        price: 14900, // $149 in cents
        currency: 'USD'
      },
      {
        id: 'premium_annual_trial',
        interval: 'year',
        interval_count: 1,
        trial_days: 7,
        price: 143040, // $1,430.40 in cents (20% off)
        currency: 'USD'
      }
    ]
  },
  {
    id: 'leadripper_unlimited',
    name: 'LeadRipper Unlimited',
    description: 'Unlimited leads with white-label exports and SLA guarantee',
    type: 'subscription',
    plans: [
      {
        id: 'unlimited_monthly_trial',
        interval: 'month',
        interval_count: 1,
        trial_days: 7,
        price: 99700, // $997 in cents
        currency: 'USD'
      }
    ]
  }
];

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

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    console.log('Getting Airwallex access token...');
    const accessToken = await getAirwallexToken();

    const results = {
      success: true,
      products: [],
      message: 'Airwallex products configured successfully'
    };

    // NOTE: Airwallex Payment Intents API is for one-time payments
    // For recurring subscriptions, you would typically use:
    // 1. Airwallex Recurring API (if available in your account tier)
    // 2. Or handle subscription logic manually with payment intents

    // Since we're using payment intents, we'll rely on webhook handling
    // to upgrade users after trial payment and schedule next payment

    results.note = 'Using Airwallex Payment Intents for manual subscription management';
    results.plans = PRODUCTS;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(results)
    };
  } catch (error) {
    console.error('Setup error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to setup Airwallex plans',
        message: error.message
      })
    };
  }
};
