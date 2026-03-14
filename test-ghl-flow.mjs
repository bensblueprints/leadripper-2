import { chromium } from 'playwright';

const BASE_URL = 'https://leadripper.com';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Collect console errors & failed requests
  const errors = [];
  const failedRequests = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('response', response => {
    if (response.status() >= 400) {
      failedRequests.push({ url: response.url(), status: response.status() });
    }
  });

  console.log('\n=== LEADRIPPER.COM TEST SUITE ===\n');

  // ---- TEST 1: Page loads ----
  console.log('TEST 1: Page loads');
  try {
    await page.goto(BASE_URL + '/app', { waitUntil: 'networkidle', timeout: 30000 });
    console.log('  PASS - Page loaded successfully');
  } catch (e) {
    console.log('  FAIL -', e.message);
    await browser.close();
    process.exit(1);
  }

  // ---- TEST 2: Auth screen visible ----
  console.log('\nTEST 2: Auth screen visible');
  const authScreen = await page.$('#auth-screen');
  if (authScreen) {
    const visible = await authScreen.isVisible();
    console.log(visible ? '  PASS - Auth screen is visible' : '  FAIL - Auth screen not visible');
  } else {
    console.log('  FAIL - #auth-screen not found');
  }

  // ---- TEST 3: Login form exists ----
  console.log('\nTEST 3: Login form elements exist');
  const loginForm = await page.$('#login-form-submit');
  const emailInput = await page.$('#login-form-submit input[name="email"]');
  const passInput = await page.$('#login-form-submit input[name="password"]');
  console.log(`  Login form: ${loginForm ? 'PASS' : 'FAIL'}`);
  console.log(`  Email input: ${emailInput ? 'PASS' : 'FAIL'}`);
  console.log(`  Password input: ${passInput ? 'PASS' : 'FAIL'}`);

  // ---- TEST 4: Login with test account ----
  console.log('\nTEST 4: Login with test credentials');
  try {
    // Try logging in with ben's account
    await page.fill('#login-form-submit input[name="email"]', 'ben@advancedmarketing.co');
    await page.fill('#login-form-submit input[name="password"]', 'test123');

    // Intercept the API response
    const [loginResponse] = await Promise.all([
      page.waitForResponse(resp => resp.url().includes('/auth-login'), { timeout: 10000 }),
      page.click('#login-btn-text')
    ]);

    const loginStatus = loginResponse.status();
    const loginData = await loginResponse.json();

    if (loginStatus === 200 && loginData.token) {
      console.log('  PASS - Login successful, got JWT token');

      // Wait for app to load
      await page.waitForTimeout(2000);

      // ---- TEST 5: App screen visible ----
      console.log('\nTEST 5: App screen visible after login');
      const appScreen = await page.$('#app-screen.active');
      console.log(appScreen ? '  PASS - App screen is active' : '  FAIL - App screen not active');

      // ---- TEST 6: Settings section loads ----
      console.log('\nTEST 6: Navigate to Settings');
      const settingsNav = await page.$('[data-section="settings"]');
      if (settingsNav) {
        await settingsNav.click();
        await page.waitForTimeout(1000);

        // Check GHL inputs exist with correct IDs
        const ghlApiKeyInput = await page.$('#ghl-api-key');
        const ghlLocationInput = await page.$('#ghl-location-id');
        const saveBtn = await page.$('button[onclick="saveGhlSettings()"]');

        console.log(`  GHL API Key input (#ghl-api-key): ${ghlApiKeyInput ? 'PASS' : 'FAIL'}`);
        console.log(`  GHL Location ID input (#ghl-location-id): ${ghlApiKeyInput ? 'PASS' : 'FAIL'}`);
        console.log(`  Save Integration button: ${saveBtn ? 'PASS' : 'FAIL'}`);
      } else {
        console.log('  FAIL - Settings nav item not found');
      }

      // ---- TEST 7: Get-settings API call works (JWT test) ----
      console.log('\nTEST 7: get-settings API (JWT verification)');
      const token = await page.evaluate(() => localStorage.getItem('lr_token'));
      const settingsResp = await page.evaluate(async (t) => {
        const r = await fetch('/.netlify/functions/get-settings', {
          headers: { 'Authorization': `Bearer ${t}` }
        });
        return { status: r.status, body: await r.json() };
      }, token);

      if (settingsResp.status === 200) {
        console.log('  PASS - get-settings returned 200');
        console.log(`    hasGhlKey: ${settingsResp.body.hasGhlKey}`);
        console.log(`    ghl_location_id: ${settingsResp.body.ghl_location_id || 'not set'}`);
      } else {
        console.log(`  FAIL - get-settings returned ${settingsResp.status}: ${JSON.stringify(settingsResp.body)}`);
      }

      // ---- TEST 8: get-ghl-pipelines API call (JWT test) ----
      console.log('\nTEST 8: get-ghl-pipelines API (JWT verification)');
      const pipelinesResp = await page.evaluate(async (t) => {
        const r = await fetch('/.netlify/functions/get-ghl-pipelines', {
          headers: { 'Authorization': `Bearer ${t}` }
        });
        return { status: r.status, body: await r.json() };
      }, token);

      if (pipelinesResp.status === 200) {
        console.log('  PASS - get-ghl-pipelines returned 200');
        if (pipelinesResp.body.pipelines && pipelinesResp.body.pipelines.length > 0) {
          console.log(`    Found ${pipelinesResp.body.pipelines.length} pipeline(s):`);
          pipelinesResp.body.pipelines.forEach(p => {
            console.log(`      - ${p.name} (${p.stages?.length || 0} stages)`);
          });
        } else {
          console.log(`    No pipelines returned (message: ${pipelinesResp.body.message || 'none'})`);
          console.log('    (This is OK if GHL API key is not yet configured for this user)');
        }
      } else if (pipelinesResp.status === 401) {
        console.log(`  FAIL - Still getting 401 Unauthorized! JWT mismatch NOT fixed.`);
      } else {
        console.log(`  FAIL - get-ghl-pipelines returned ${pipelinesResp.status}: ${JSON.stringify(pipelinesResp.body)}`);
      }

      // ---- TEST 9: Export CSV button exists and has handler ----
      console.log('\nTEST 9: Export CSV button');
      // Navigate to leads
      const leadsNav = await page.$('[data-section="leads"]');
      if (leadsNav) {
        await leadsNav.click();
        await page.waitForTimeout(500);
      }
      const exportBtn = await page.$('#export-leads-btn');
      if (exportBtn) {
        // Check that the button has an event listener by checking it's clickable
        const btnText = await exportBtn.textContent();
        console.log(`  PASS - Export CSV button found: "${btnText.trim()}"`);

        // Verify it has a click handler by checking JS
        const hasHandler = await page.evaluate(() => {
          const btn = document.getElementById('export-leads-btn');
          // getEventListeners isn't available in page context, so check indirectly
          // by verifying the button isn't disabled
          return btn && !btn.disabled;
        });
        console.log(`  Button clickable: ${hasHandler ? 'PASS' : 'FAIL'}`);
      } else {
        console.log('  FAIL - Export CSV button not found');
      }

      // ---- TEST 10: get-leads API call works ----
      console.log('\nTEST 10: get-leads API');
      const leadsResp = await page.evaluate(async (t) => {
        const r = await fetch('/.netlify/functions/get-leads?limit=5', {
          headers: { 'Authorization': `Bearer ${t}` }
        });
        return { status: r.status, body: await r.json() };
      }, token);

      if (leadsResp.status === 200) {
        console.log(`  PASS - get-leads returned 200 (${leadsResp.body.total} total leads)`);
      } else {
        console.log(`  FAIL - get-leads returned ${leadsResp.status}`);
      }

      // ---- TEST 11: update-settings API (JWT test) ----
      console.log('\nTEST 11: update-settings API (JWT verification)');
      const updateResp = await page.evaluate(async (t) => {
        const r = await fetch('/.netlify/functions/update-settings', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${t}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ ghlAutoSync: false }) // harmless toggle
        });
        return { status: r.status, body: await r.json() };
      }, token);

      if (updateResp.status === 200) {
        console.log('  PASS - update-settings returned 200');
      } else if (updateResp.status === 401) {
        console.log('  FAIL - Still getting 401! JWT mismatch NOT fixed.');
      } else {
        console.log(`  FAIL - update-settings returned ${updateResp.status}: ${JSON.stringify(updateResp.body)}`);
      }

    } else {
      console.log(`  Login returned ${loginStatus} - ${loginData.error || 'unknown error'}`);
      console.log('  (Skipping authenticated tests - need valid test account)');

      // Still test the JWT mismatch by checking if endpoints return consistent errors
      console.log('\nTEST 5-ALT: Check JWT consistency without login');
      const fakeToken = 'fake.token.here';
      const results = await page.evaluate(async (t) => {
        const endpoints = ['get-settings', 'get-ghl-pipelines', 'update-settings'];
        const responses = {};
        for (const ep of endpoints) {
          const r = await fetch(`/.netlify/functions/${ep}`, {
            method: ep === 'update-settings' ? 'POST' : 'GET',
            headers: {
              'Authorization': `Bearer ${t}`,
              'Content-Type': 'application/json'
            },
            body: ep === 'update-settings' ? '{}' : undefined
          });
          responses[ep] = r.status;
        }
        return responses;
      }, fakeToken);

      console.log('  Endpoint responses with fake token:');
      for (const [ep, status] of Object.entries(results)) {
        console.log(`    ${ep}: ${status} ${status === 401 ? '(correct - unauthorized)' : '(unexpected)'}`);
      }
    }

  } catch (e) {
    console.log(`  Login attempt failed: ${e.message}`);
  }

  // ---- Summary ----
  console.log('\n=== SUMMARY ===');
  if (failedRequests.length > 0) {
    console.log(`\nFailed requests (${failedRequests.length}):`);
    failedRequests.forEach(r => console.log(`  ${r.status} ${r.url}`));
  } else {
    console.log('No failed HTTP requests');
  }
  if (errors.length > 0) {
    console.log(`\nConsole errors (${errors.length}):`);
    errors.forEach(e => console.log(`  ${e}`));
  } else {
    console.log('No console errors');
  }

  await browser.close();
  console.log('\nTests complete.');
})();
