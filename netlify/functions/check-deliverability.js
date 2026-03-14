const dns = require('dns');
const { promisify } = require('util');
const jwt = require('jsonwebtoken');

const resolveTxt = promisify(dns.resolveTxt);
const resolve4 = promisify(dns.resolve4);
const resolveMx = promisify(dns.resolveMx);

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2026';

function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
  } catch {
    return null;
  }
}

// DNSBLs to check against
const DNSBLS = [
  { name: 'Spamhaus ZEN', host: 'zen.spamhaus.org' },
  { name: 'SpamCop', host: 'bl.spamcop.net' },
  { name: 'Barracuda', host: 'b.barracudacentral.org' },
  { name: 'SORBS', host: 'dnsbl.sorbs.net' },
  { name: 'PSBL', host: 'psbl.surriel.com' }
];

// Check SPF record
async function checkSPF(domain) {
  try {
    const records = await resolveTxt(domain);
    const flat = records.map(r => r.join('')).filter(r => r.startsWith('v=spf1'));
    if (flat.length > 0) {
      return {
        exists: true,
        record: flat[0],
        valid: true,
        details: 'SPF record found'
      };
    }
    return { exists: false, record: null, valid: false, details: 'No SPF record found' };
  } catch (error) {
    if (error.code === 'ENODATA' || error.code === 'ENOTFOUND') {
      return { exists: false, record: null, valid: false, details: 'No SPF record found' };
    }
    return { exists: false, record: null, valid: false, details: `DNS lookup failed: ${error.message}` };
  }
}

// Check DKIM record (common selectors)
async function checkDKIM(domain) {
  const selectors = ['default', 'google', 'dkim', 'selector1', 'selector2', 'k1', 'mail', 'smtp'];

  for (const selector of selectors) {
    try {
      const dkimDomain = `${selector}._domainkey.${domain}`;
      const records = await resolveTxt(dkimDomain);
      const flat = records.map(r => r.join(''));

      if (flat.length > 0) {
        const hasDKIM = flat.some(r => r.includes('v=DKIM1') || r.includes('k=rsa') || r.includes('p='));
        if (hasDKIM) {
          return {
            exists: true,
            selector: selector,
            record: flat[0].substring(0, 100) + (flat[0].length > 100 ? '...' : ''),
            valid: true,
            details: `DKIM found (selector: ${selector})`
          };
        }
      }
    } catch (error) {
      // Try next selector
      continue;
    }
  }

  return {
    exists: false,
    selector: null,
    record: null,
    valid: false,
    details: 'No DKIM record found (checked common selectors)'
  };
}

// Check DMARC record
async function checkDMARC(domain) {
  try {
    const records = await resolveTxt(`_dmarc.${domain}`);
    const flat = records.map(r => r.join('')).filter(r => r.startsWith('v=DMARC1'));

    if (flat.length > 0) {
      const record = flat[0];
      const policy = record.match(/p=(\w+)/);
      const policyValue = policy ? policy[1] : 'unknown';

      return {
        exists: true,
        record: record,
        policy: policyValue,
        valid: true,
        details: `DMARC found (policy: ${policyValue})`
      };
    }
    return { exists: false, record: null, policy: null, valid: false, details: 'No DMARC record found' };
  } catch (error) {
    if (error.code === 'ENODATA' || error.code === 'ENOTFOUND') {
      return { exists: false, record: null, policy: null, valid: false, details: 'No DMARC record found' };
    }
    return { exists: false, record: null, policy: null, valid: false, details: `DNS lookup failed: ${error.message}` };
  }
}

// Check MX records
async function checkMX(domain) {
  try {
    const records = await resolveMx(domain);
    if (records && records.length > 0) {
      return {
        exists: true,
        records: records.sort((a, b) => a.priority - b.priority).map(r => ({
          exchange: r.exchange,
          priority: r.priority
        })),
        details: `${records.length} MX record(s) found`
      };
    }
    return { exists: false, records: [], details: 'No MX records found' };
  } catch (error) {
    return { exists: false, records: [], details: `MX lookup failed: ${error.message}` };
  }
}

// Check IP against a DNSBL
async function checkDNSBL(ip, dnsbl) {
  const reversedIP = ip.split('.').reverse().join('.');
  const query = `${reversedIP}.${dnsbl}`;

  return new Promise((resolve) => {
    dns.resolve4(query, (err, addresses) => {
      if (err) {
        // NXDOMAIN or NODATA means NOT listed (good)
        resolve({ listed: false });
      } else {
        // Got a response = listed (bad)
        resolve({ listed: true, response: addresses });
      }
    });
  });
}

// Get domain's sending IPs (from MX records)
async function getDomainIPs(domain) {
  const ips = new Set();

  try {
    // Try to resolve the domain itself
    const aRecords = await resolve4(domain);
    aRecords.forEach(ip => ips.add(ip));
  } catch (e) { /* ignore */ }

  try {
    // Resolve MX records' IPs
    const mxRecords = await resolveMx(domain);
    for (const mx of mxRecords) {
      try {
        const mxIPs = await resolve4(mx.exchange);
        mxIPs.forEach(ip => ips.add(ip));
      } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }

  return Array.from(ips);
}

// Calculate overall health score
function calculateScore(spf, dkim, dmarc, mx, blacklistResults) {
  let score = 0;
  const maxScore = 100;

  // SPF: 25 points
  if (spf.exists && spf.valid) score += 25;

  // DKIM: 25 points
  if (dkim.exists && dkim.valid) score += 25;

  // DMARC: 20 points
  if (dmarc.exists && dmarc.valid) {
    score += 15;
    if (dmarc.policy === 'reject') score += 5;
    else if (dmarc.policy === 'quarantine') score += 3;
    else score += 1; // 'none' policy
  }

  // MX: 10 points
  if (mx.exists) score += 10;

  // Blacklists: 20 points (4 per clean DNSBL)
  const totalChecks = blacklistResults.length;
  const cleanChecks = blacklistResults.filter(r => !r.listed).length;
  if (totalChecks > 0) {
    score += Math.round((cleanChecks / totalChecks) * 20);
  } else {
    score += 20; // No IPs to check = assume clean
  }

  return Math.min(score, maxScore);
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const decoded = verifyToken(event.headers.authorization);
  if (!decoded) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { domain } = JSON.parse(event.body);

    if (!domain) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Domain is required' }) };
    }

    // Clean domain (remove protocol, path, etc.)
    const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').trim().toLowerCase();

    if (!cleanDomain || !cleanDomain.includes('.')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid domain' }) };
    }

    // Run all checks in parallel
    const [spf, dkim, dmarc, mx] = await Promise.all([
      checkSPF(cleanDomain),
      checkDKIM(cleanDomain),
      checkDMARC(cleanDomain),
      checkMX(cleanDomain)
    ]);

    // Get IPs for blacklist checking
    const ips = await getDomainIPs(cleanDomain);

    // Check each IP against each DNSBL
    const blacklistResults = [];
    for (const ip of ips) {
      // Skip private/local IPs
      if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('127.')) continue;

      for (const dnsbl of DNSBLS) {
        try {
          const result = await checkDNSBL(ip, dnsbl.host);
          blacklistResults.push({
            ip,
            dnsbl: dnsbl.name,
            host: dnsbl.host,
            listed: result.listed,
            response: result.response || null
          });
        } catch (error) {
          blacklistResults.push({
            ip,
            dnsbl: dnsbl.name,
            host: dnsbl.host,
            listed: false,
            error: error.message
          });
        }
      }
    }

    // Calculate overall score
    const score = calculateScore(spf, dkim, dmarc, mx, blacklistResults);

    // Determine grade
    let grade;
    if (score >= 90) grade = 'A';
    else if (score >= 75) grade = 'B';
    else if (score >= 60) grade = 'C';
    else if (score >= 40) grade = 'D';
    else grade = 'F';

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        domain: cleanDomain,
        score,
        grade,
        checks: {
          spf,
          dkim,
          dmarc,
          mx
        },
        blacklists: blacklistResults,
        ips,
        checkedAt: new Date().toISOString()
      })
    };
  } catch (error) {
    console.error('Check deliverability error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
