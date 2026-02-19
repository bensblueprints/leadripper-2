const dns = require('dns').promises;
const net = require('net');

/**
 * Email Validation Function
 *
 * Validates emails using multiple techniques without relying on paid APIs:
 * 1. Syntax validation (RFC 5322 compliant)
 * 2. MX record lookup (checks if domain can receive emails)
 * 3. SMTP handshake validation (connects to mail server to verify)
 * 4. Disposable email detection
 * 5. Role-based email detection (info@, admin@, etc.)
 */

// Common disposable email domains
const DISPOSABLE_DOMAINS = [
  'tempmail.com', 'throwaway.email', 'guerrillamail.com', 'mailinator.com',
  '10minutemail.com', 'trashmail.com', 'temp-mail.org', 'getnada.com',
  'maildrop.cc', 'sharklasers.com', 'guerrillamailblock.com'
];

// Common role-based email prefixes
const ROLE_BASED_PREFIXES = [
  'info', 'admin', 'support', 'sales', 'contact', 'hello', 'help',
  'noreply', 'no-reply', 'postmaster', 'webmaster', 'hostmaster'
];

/**
 * Validates email syntax using RFC 5322 regex
 */
function isValidSyntax(email) {
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return emailRegex.test(email);
}

/**
 * Checks if email domain is disposable/temporary
 */
function isDisposable(email) {
  const domain = email.split('@')[1]?.toLowerCase();
  return DISPOSABLE_DOMAINS.includes(domain);
}

/**
 * Checks if email is role-based (info@, admin@, etc.)
 */
function isRoleBased(email) {
  const prefix = email.split('@')[0]?.toLowerCase();
  return ROLE_BASED_PREFIXES.some(role => prefix === role || prefix.startsWith(role + '-') || prefix.startsWith(role + '.'));
}

/**
 * Performs MX record lookup to verify domain can receive emails
 */
async function checkMXRecords(domain) {
  try {
    const mxRecords = await dns.resolveMx(domain);
    return {
      valid: mxRecords && mxRecords.length > 0,
      mxRecords: mxRecords,
      priority: mxRecords.length > 0 ? Math.min(...mxRecords.map(r => r.priority)) : null
    };
  } catch (error) {
    // Check if it's a CNAME that points to MX records
    try {
      const cnameRecords = await dns.resolveCname(domain);
      if (cnameRecords && cnameRecords.length > 0) {
        const mxRecords = await dns.resolveMx(cnameRecords[0]);
        return {
          valid: mxRecords && mxRecords.length > 0,
          mxRecords: mxRecords,
          priority: mxRecords.length > 0 ? Math.min(...mxRecords.map(r => r.priority)) : null,
          cname: cnameRecords[0]
        };
      }
    } catch (cnameError) {
      // Fallback: Check A records
      try {
        const aRecords = await dns.resolve4(domain);
        // Some domains use A records for mail servers (less common but valid)
        return {
          valid: aRecords && aRecords.length > 0,
          fallback: 'A_RECORD',
          aRecords: aRecords
        };
      } catch (aError) {
        return {
          valid: false,
          error: 'NO_MX_RECORDS',
          message: 'Domain does not have MX records configured'
        };
      }
    }

    return {
      valid: false,
      error: error.code || 'MX_LOOKUP_FAILED',
      message: error.message
    };
  }
}

/**
 * Performs SMTP handshake to verify email exists
 * This is more reliable but slower - use for high-value leads
 */
async function verifySMTP(email, mxRecord) {
  return new Promise((resolve) => {
    const timeout = 10000; // 10 second timeout
    const client = new net.Socket();
    let isResolved = false;

    const resolveOnce = (result) => {
      if (!isResolved) {
        isResolved = true;
        client.destroy();
        resolve(result);
      }
    };

    // Timeout handler
    const timeoutId = setTimeout(() => {
      resolveOnce({
        valid: null, // Unknown - timeout
        error: 'TIMEOUT',
        message: 'SMTP verification timed out'
      });
    }, timeout);

    let responses = [];

    client.connect(25, mxRecord.exchange, () => {
      // Connected successfully
    });

    client.on('data', (data) => {
      const response = data.toString();
      responses.push(response);

      // SMTP handshake sequence
      if (response.startsWith('220')) {
        // Server greeting
        client.write(`HELO leadripper.com\r\n`);
      } else if (response.startsWith('250') && responses.length === 2) {
        // HELO accepted
        client.write(`MAIL FROM:<verify@leadripper.com>\r\n`);
      } else if (response.startsWith('250') && responses.length === 3) {
        // MAIL FROM accepted
        client.write(`RCPT TO:<${email}>\r\n`);
      } else if (response.startsWith('250') && responses.length === 4) {
        // RCPT TO accepted - email exists!
        clearTimeout(timeoutId);
        resolveOnce({
          valid: true,
          message: 'Email verified via SMTP'
        });
      } else if (response.startsWith('550') || response.startsWith('551') || response.startsWith('553')) {
        // Email does not exist or is invalid
        clearTimeout(timeoutId);
        resolveOnce({
          valid: false,
          error: 'SMTP_REJECTED',
          message: 'Email address rejected by server'
        });
      } else if (response.startsWith('450') || response.startsWith('451') || response.startsWith('452')) {
        // Temporary error - can't verify
        clearTimeout(timeoutId);
        resolveOnce({
          valid: null, // Unknown
          error: 'TEMP_ERROR',
          message: 'Temporary server error - verification inconclusive'
        });
      }
    });

    client.on('error', (err) => {
      clearTimeout(timeoutId);
      resolveOnce({
        valid: null, // Unknown - connection error
        error: 'CONNECTION_ERROR',
        message: err.message
      });
    });

    client.on('timeout', () => {
      clearTimeout(timeoutId);
      resolveOnce({
        valid: null,
        error: 'TIMEOUT',
        message: 'SMTP connection timed out'
      });
    });
  });
}

/**
 * Main validation function
 */
async function validateEmail(email, options = {}) {
  const {
    checkSMTP = false, // Set to true for deep verification (slower)
    skipDisposable = true,
    skipRoleBased = false
  } = options;

  const result = {
    email,
    valid: false,
    score: 0, // 0-100 confidence score
    checks: {},
    warnings: [],
    errors: []
  };

  // 1. Syntax validation
  const syntaxValid = isValidSyntax(email);
  result.checks.syntax = syntaxValid;
  if (!syntaxValid) {
    result.errors.push('Invalid email syntax');
    return result;
  }
  result.score += 20;

  // 2. Disposable email check
  const disposable = isDisposable(email);
  result.checks.disposable = disposable;
  if (disposable && skipDisposable) {
    result.warnings.push('Disposable/temporary email address');
    result.score -= 30;
  }

  // 3. Role-based email check
  const roleBased = isRoleBased(email);
  result.checks.roleBased = roleBased;
  if (roleBased) {
    result.warnings.push('Role-based email (info@, admin@, etc.) - may have lower deliverability');
    if (skipRoleBased) {
      result.score -= 20;
    }
  }

  // 4. MX record validation
  const domain = email.split('@')[1];
  const mxResult = await checkMXRecords(domain);
  result.checks.mx = mxResult;

  if (!mxResult.valid) {
    result.errors.push(mxResult.message || 'Domain cannot receive emails');
    result.score = Math.max(0, result.score - 40);
    return result;
  }
  result.score += 40;

  // 5. SMTP verification (optional - slower but more accurate)
  if (checkSMTP && mxResult.mxRecords && mxResult.mxRecords.length > 0) {
    // Use the highest priority MX record
    const primaryMX = mxResult.mxRecords.reduce((prev, curr) =>
      prev.priority < curr.priority ? prev : curr
    );

    const smtpResult = await verifySMTP(email, primaryMX);
    result.checks.smtp = smtpResult;

    if (smtpResult.valid === true) {
      result.score += 40;
      result.valid = true;
    } else if (smtpResult.valid === false) {
      result.errors.push(smtpResult.message || 'Email rejected by mail server');
      result.score = Math.max(0, result.score - 30);
    } else {
      // Unknown - couldn't verify
      result.warnings.push('Could not verify email via SMTP - ' + (smtpResult.message || 'unknown error'));
      result.score += 15; // Partial credit
    }
  } else {
    result.score += 20; // Without SMTP check, give partial credit
  }

  // Final validity determination
  result.valid = result.score >= 60 && result.errors.length === 0;
  result.recommendation = getRecommendation(result);

  return result;
}

/**
 * Provides a recommendation based on validation results
 */
function getRecommendation(result) {
  if (result.score >= 90) {
    return 'EXCELLENT - Highly deliverable email address';
  } else if (result.score >= 70) {
    return 'GOOD - Email address appears valid and deliverable';
  } else if (result.score >= 50) {
    return 'ACCEPTABLE - Email may be valid but has some concerns';
  } else if (result.score >= 30) {
    return 'RISKY - Email address has significant deliverability concerns';
  } else {
    return 'BAD - Email address is likely to bounce or is invalid';
  }
}

/**
 * Netlify function handler
 */
exports.handler = async (event) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { email, options } = JSON.parse(event.body || '{}');

    if (!email) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email address is required' })
      };
    }

    const result = await validateEmail(email, options);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result)
    };

  } catch (error) {
    console.error('[Email Validation Error]', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error.message
      })
    };
  }
};
