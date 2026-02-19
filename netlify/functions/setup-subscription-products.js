const fetch = require('node-fetch');

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

async function createProduct(accessToken, productData) {
  const payload = {
    request_id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    name: productData.name,
    description: productData.description,
    type: 'RECURRING',
    metadata: productData.metadata || {}
  };

  const response = await fetch(`${AIRWALLEX_BASE_URL}/api/v1/products/create`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Product creation failed: ${error}`);
  }

  return response.json();
}

async function createPrice(accessToken, priceData) {
  const payload = {
    request_id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    product_id: priceData.product_id,
    type: 'RECURRING',
    currency: 'USD',
    pricing_model: 'FLAT',
    flat_amount: priceData.amount,
    billing_type: 'IN_ADVANCE',
    recurring: {
      period_unit: 'MONTH',
      period: 1
    },
    active: true,
    metadata: priceData.metadata || {}
  };

  const response = await fetch(`${AIRWALLEX_BASE_URL}/api/v1/prices/create`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Price creation failed: ${error}`);
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

  try {
    console.log('Getting Airwallex access token...');
    const accessToken = await getAirwallexToken();

    const products = [
      {
        name: 'LeadRipper Starter',
        description: '500 leads per month with GHL sync and CSV export',
        amount: 29.00,
        metadata: { plan_id: 'starter', leads_limit: '500' }
      },
      {
        name: 'LeadRipper Advanced',
        description: '2,500 leads per month with email verification and priority support',
        amount: 79.00,
        metadata: { plan_id: 'advanced', leads_limit: '2500' }
      },
      {
        name: 'LeadRipper Premium',
        description: '10,000 leads per month with API access and webhooks',
        amount: 149.00,
        metadata: { plan_id: 'premium', leads_limit: '10000' }
      },
      {
        name: 'LeadRipper Unlimited',
        description: 'Unlimited leads with white-label exports and dedicated support',
        amount: 997.00,
        metadata: { plan_id: 'unlimited', leads_limit: '-1' }
      }
    ];

    const results = [];

    for (const productData of products) {
      try {
        // Create product
        console.log(`Creating product: ${productData.name}`);
        const product = await createProduct(accessToken, productData);

        // Create price
        console.log(`Creating price for ${productData.name}: $${productData.amount}`);
        const price = await createPrice(accessToken, {
          product_id: product.id,
          amount: productData.amount,
          metadata: productData.metadata
        });

        results.push({
          product_id: product.id,
          product_name: product.name,
          price_id: price.id,
          price_amount: price.flat_amount,
          plan_id: productData.metadata.plan_id
        });

        console.log(`✓ Created ${productData.metadata.plan_id}: Product ${product.id}, Price ${price.id}`);
      } catch (error) {
        console.error(`Failed to create ${productData.name}:`, error.message);
        results.push({
          product_name: productData.name,
          error: error.message
        });
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Products and prices created',
        results
      })
    };
  } catch (error) {
    console.error('Setup error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to setup subscription products',
        message: error.message
      })
    };
  }
};
