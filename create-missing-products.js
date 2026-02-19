const fetch = require('node-fetch');

const AIRWALLEX_CLIENT_ID = 'VBU4oeFdS_Of60Y-ZK5bmg';
const AIRWALLEX_API_KEY = '79e1f2c28f844cacbf445e7189c4ca9c66d0bd096e187a980549b8a049d89956e6cfad686023912eb4f9ab9ad222457d';
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

async function run() {
  try {
    console.log('Getting Airwallex access token...');
    const accessToken = await getAirwallexToken();

    const products = [
      {
        name: 'LeadRipper Basic',
        description: '500 leads per month with GHL sync and CSV export',
        amount: 29.00,
        metadata: { plan_id: 'basic', leads_limit: '500' }
      },
      {
        name: 'LeadRipper Enterprise',
        description: 'Unlimited leads with white-label exports and dedicated support',
        amount: 297.00,
        metadata: { plan_id: 'enterprise', leads_limit: '-1' }
      }
    ];

    const results = [];

    for (const productData of products) {
      try {
        console.log(`\nCreating product: ${productData.name}`);
        const product = await createProduct(accessToken, productData);
        console.log(`  Product ID: ${product.id}`);

        console.log(`Creating price: $${productData.amount}/month`);
        const price = await createPrice(accessToken, {
          product_id: product.id,
          amount: productData.amount,
          metadata: productData.metadata
        });
        console.log(`  Price ID: ${price.id}`);

        results.push({
          plan_id: productData.metadata.plan_id,
          product_id: product.id,
          price_id: price.id,
          amount: productData.amount
        });

        console.log(`✓ Created ${productData.metadata.plan_id}`);
      } catch (error) {
        console.error(`Failed to create ${productData.name}:`, error.message);
      }
    }

    console.log('\n=== SUMMARY ===');
    console.log(JSON.stringify(results, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
  }
}

run();
