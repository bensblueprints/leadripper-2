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

async function testSubscriptionCreate() {
  try {
    console.log('Getting Airwallex token...');
    const accessToken = await getAirwallexToken();
    console.log('✓ Auth successful\n');

    // Test 3: Without trial_ends_at
    console.log('Test 3: Without trial_ends_at field');
    const payload3 = {
      request_id: `req_test3_${Date.now()}`,
      billing_customer_id: 'bcus_sgpdk7dnkhdswfmu4i6',
      collection_method: 'CHARGE_AUTOMATICALLY',
      items: [{ price_id: 'pri_sgpd5s4zvhfjrnq7ki7', quantity: 1 }],
      metadata: { test: '3', format: 'no_trial' }
    };

    console.log('Payload:', JSON.stringify(payload3, null, 2));
    const response3 = await fetch(`${AIRWALLEX_BASE_URL}/api/v1/subscriptions/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify(payload3)
    });

    console.log('Status:', response3.status);
    const result3 = await response3.text();
    console.log('Response:', result3);

    if (response3.ok) {
      console.log('\n✓ Success! Subscription created without trial_ends_at');
      const subData = JSON.parse(result3);
      console.log('Subscription ID:', subData.id);
      console.log('Status:', subData.status);
    } else {
      console.log('\n✗ Failed without trial_ends_at');
    }

    // Test 4: With trial_period instead
    console.log('\n\nTest 4: With trial_period field');
    const payload4 = {
      request_id: `req_test4_${Date.now()}`,
      billing_customer_id: 'bcus_sgpdk7dnkhdswfmu4i6',
      collection_method: 'CHARGE_AUTOMATICALLY',
      items: [{ price_id: 'pri_sgpd5s4zvhfjrnq7ki7', quantity: 1 }],
      trial_period: {
        period_unit: 'DAY',
        period: 7
      },
      metadata: { test: '4', format: 'trial_period' }
    };

    console.log('Payload:', JSON.stringify(payload4, null, 2));
    const response4 = await fetch(`${AIRWALLEX_BASE_URL}/api/v1/subscriptions/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify(payload4)
    });

    console.log('Status:', response4.status);
    const result4 = await response4.text();
    console.log('Response:', result4);

    if (response4.ok) {
      console.log('\n✓ Success with trial_period!');
      const subData = JSON.parse(result4);
      console.log('Subscription ID:', subData.id);
      console.log('Status:', subData.status);
    } else {
      console.log('\n✗ Failed with trial_period');
    }

  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

testSubscriptionCreate();
