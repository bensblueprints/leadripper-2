const fetch = require('node-fetch');

async function testTrialSignup() {
  try {
    const testEmail = `test_${Date.now()}@leadripper.com`;
    const payload = {
      email: testEmail,
      password: 'TestPassword123!',
      name: 'Test User',
      company: 'Test Company',
      plan: 'starter'
    };

    console.log('Testing trial signup with payload:');
    console.log(JSON.stringify(payload, null, 2));
    console.log('\nCalling trial-signup function...\n');

    const response = await fetch('http://localhost:8888/.netlify/functions/trial-signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    console.log('Status:', response.status);
    const result = await response.text();
    console.log('Response:', result);

    if (response.ok) {
      const data = JSON.parse(result);
      console.log('\n✓ SUCCESS! Trial signup created:');
      console.log('  User ID:', data.userId);
      console.log('  Email:', data.email);
      console.log('  Plan:', data.plan);
      console.log('  Subscription ID:', data.subscriptionId);
      console.log('  Payment Intent ID:', data.paymentIntentId);
      console.log('  Billing Customer ID:', data.billingCustomerId);
      console.log('\nTrial signup is now working correctly!');
    } else {
      console.log('\n✗ FAILED - Trial signup still has issues');
      console.log('Error:', result);
    }

  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

testTrialSignup();
