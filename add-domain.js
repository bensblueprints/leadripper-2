const fetch = require('node-fetch');
const { execSync } = require('child_process');

async function addCustomDomain() {
  const siteId = '1dadeb61-8e1f-48db-9ccf-dff912531b20';
  const domain = 'leadripper.com';

  // Get Netlify auth token
  let token;
  try {
    token = execSync('netlify status --json', { encoding: 'utf8' });
    const statusData = JSON.parse(token);
    // Token is in environment, we need to get it differently
    console.log('Using Netlify CLI authentication...');
  } catch (e) {
    console.error('Failed to get token:', e.message);
    process.exit(1);
  }

  // Method 1: Add domain via API
  try {
    console.log(`Adding domain ${domain} to site ${siteId}...`);

    // Use netlify CLI to execute this
    execSync(`netlify api createDnsRecord --data '{"site_id": "${siteId}", "hostname": "${domain}"}'`, {
      stdio: 'inherit'
    });

    console.log('✅ Domain added successfully!');
  } catch (error) {
    console.log('Trying alternative method...');

    // Method 2: Use sites API
    try {
      execSync(`netlify api updateSite --data '{"site_id": "${siteId}", "body": {"custom_domain": "${domain}"}}'`, {
        stdio: 'inherit'
      });
      console.log('✅ Domain configured!');
    } catch (e2) {
      console.error('Failed to add domain. Please add manually in Netlify UI.');
      console.log('\nSteps:');
      console.log('1. Go to: https://app.netlify.com/sites/leadripper/settings/domain');
      console.log('2. Click "Add custom domain"');
      console.log('3. Enter: leadripper.com');
      console.log('4. Click "Verify" and "Add domain"');
    }
  }
}

addCustomDomain();
