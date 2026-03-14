const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2026';

function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
  } catch {
    return null;
  }
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

  // Return IMAP/SMTP config for Gmail with App Password instructions
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      useImap: true,
      provider: 'gmail',
      imapHost: 'imap.gmail.com',
      imapPort: 993,
      smtpHost: 'smtp.gmail.com',
      smtpPort: 587,
      instructions: 'Gmail requires an App Password. Go to Google Account → Security → 2-Step Verification → App Passwords, create one, and use it as your password below.',
      helpUrl: 'https://myaccount.google.com/apppasswords'
    })
  };
};
