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

    const trialEndDate = new Date();
    trialEndDate.setDate(trialEndDate.getDate() + 7);

    // Test 1: ISO 8601 format
    console.log('Test 1: ISO 8601 format');
    const payload1 = {
      request_id: `req_test1_${Date.now()}`,
      billing_customer_id: 'bcus_sgpdk7dnkhdswfmu4i6', // Existing test customer
      collection_method: 'CHARGE_AUTOMATICALLY',
      items: [{ price_id: 'pri_sgpd5s4zvhfjrnq7ki7', quantity: 1 }], // Advanced plan
      trial_ends_at: trialEndDate.toISOString(),
      metadata: { test: '1', format: 'iso8601' }
    };

    console.log('Payload:', JSON.stringify(payload1, null, 2));
    const response1 = await fetch(`${AIRWALLEX_BASE_URL}/api/v1/subscriptions/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify(payload1)
    });

    console.log('Status:', response1.status);
    const result1 = await response1.text();
    console.log('Response:', result1);

    if (!response1.ok) {
      console.log('✗ ISO 8601 format failed\n');

      // Test 2: Unix timestamp (seconds)
      console.log('\nTest 2: Unix timestamp (seconds)');
      const payload2 = {
        request_id: `req_test2_${Date.now()}`,
        billing_customer_id: 'bcus_sgpdk7dnkhdswfmu4i6',
        collection_method: 'CHARGE_AUTOMATICALLY',
        items: [{ price_id: 'pri_sgpd5s4zvhfjrnq7ki7', quantity: 1 }],
        trial_ends_at: Math.floor(trialEndDate.getTime() / 1000),
        metadata: { test: '2', format: 'unix_seconds' }
      };

      console.log('Payload:', JSON.stringify(payload2, null, 2));
      const response2 = await fetch(`${AIRWALLEX_BASE_URL}/api/v1/subscriptions/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify(payload2)
      });

      console.log('Status:', response2.status);
      const result2 = await response2.text();
      console.log('Response:', result2);

      if (!response2.ok) {
        console.log('✗ Unix timestamp (seconds) failed\n');
      } else {
        console.log('✓ Unix timestamp (seconds) WORKS!\n');
      }
    } else {
      console.log('✓ ISO 8601 format WORKS!\n');
    }

  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

testSubscriptionCreate();
