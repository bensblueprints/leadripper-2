const fetch = require('node-fetch');

const AIRWALLEX_CLIENT_ID = 'VBU4oeFdS_Of60Y-ZK5bmg';
const AIRWALLEX_API_KEY = '79e1f2c28f844cacbf445e7189c4ca9c66d0bd096e187a980549b8a049d89956e6cfad686023912eb4f9ab9ad222457d';
const AIRWALLEX_BASE_URL = 'https://api.airwallex.com';

async function testSubscriptionAccess() {
  try {
    console.log('Step 1: Authenticating with Airwallex...');
    const authResponse = await fetch(`${AIRWALLEX_BASE_URL}/api/v1/authentication/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': AIRWALLEX_CLIENT_ID,
        'x-api-key': AIRWALLEX_API_KEY
      }
    });

    if (!authResponse.ok) {
      const error = await authResponse.text();
      throw new Error(`Auth failed: ${error}`);
    }

    const authData = await authResponse.json();
    const accessToken = authData.token;
    console.log('✓ Authentication successful');

    // Test 1: Try to list subscriptions
    console.log('\nStep 2: Testing subscription list endpoint...');
    const listResponse = await fetch(`${AIRWALLEX_BASE_URL}/api/v1/subscriptions`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    console.log(`List subscriptions status: ${listResponse.status}`);
    const listData = await listResponse.text();

    if (listResponse.ok) {
      console.log('✓ SUBSCRIPTION API ACCESS CONFIRMED!');
      console.log('Response:', JSON.parse(listData));
    } else {
      console.log('✗ Subscription API not available');
      console.log('Error:', listData);
    }

    // Test 2: Check if we can access billing customers
    console.log('\nStep 3: Testing billing customers endpoint...');
    const customersResponse = await fetch(`${AIRWALLEX_BASE_URL}/api/v1/billing_customers`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    console.log(`Billing customers status: ${customersResponse.status}`);
    const customersData = await customersResponse.text();

    if (customersResponse.ok) {
      console.log('✓ Billing customers API accessible');
      console.log('Response:', JSON.parse(customersData));
    } else {
      console.log('✗ Billing customers API not available');
      console.log('Error:', customersData);
    }

    // Test 3: Check pricing/plans endpoint
    console.log('\nStep 4: Testing prices endpoint...');
    const pricesResponse = await fetch(`${AIRWALLEX_BASE_URL}/api/v1/prices`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    console.log(`Prices status: ${pricesResponse.status}`);
    const pricesData = await pricesResponse.text();

    if (pricesResponse.ok) {
      console.log('✓ Prices API accessible');
      console.log('Response:', JSON.parse(pricesData));
    } else {
      console.log('✗ Prices API not available');
      console.log('Error:', pricesData);
    }

    // Test 4: Try to create a test price
    console.log('\nStep 5: Testing price creation...');
    const createPriceResponse = await fetch(`${AIRWALLEX_BASE_URL}/api/v1/prices/create`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        product_id: 'test_product',
        unit_amount: 2900,
        currency: 'USD',
        type: 'recurring',
        recurring: {
          interval: 'month',
          interval_count: 1
        }
      })
    });

    console.log(`Create price status: ${createPriceResponse.status}`);
    const createPriceData = await createPriceResponse.text();
    console.log('Create price response:', createPriceData);

  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

testSubscriptionAccess();
