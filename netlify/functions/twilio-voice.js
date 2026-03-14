const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'text/xml'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { ...headers, 'Content-Type': 'application/json' }, body: '' };
  }

  try {
    // Parse parameters from query string and POST body
    const params = event.queryStringParameters || {};
    let bodyParams = {};
    if (event.body) {
      // Twilio sends form-encoded data
      const urlParams = new URLSearchParams(event.body);
      for (const [key, value] of urlParams) {
        bodyParams[key] = value;
      }
    }

    const to = params.To || bodyParams.To;
    const from = params.From || bodyParams.From;
    const callerId = params.CallerId || bodyParams.CallerId;
    const userId = params.UserId || bodyParams.UserId;

    let callerNumber = callerId || from;

    // If we have a userId, look up their Twilio phone number
    if (userId && !callerNumber) {
      try {
        const result = await pool.query(
          'SELECT twilio_phone_number FROM lr_user_settings WHERE user_id = $1',
          [parseInt(userId)]
        );
        if (result.rows.length > 0 && result.rows[0].twilio_phone_number) {
          callerNumber = result.rows[0].twilio_phone_number;
        }
      } catch (dbErr) {
        console.error('DB lookup error:', dbErr);
      }
    }

    let twiml;

    if (to) {
      // Outbound call - dial the destination number
      // Check if it looks like a phone number (starts with + or contains digits)
      const isPhoneNumber = /^[\d\+\-\(\)\s]+$/.test(to.replace(/\s/g, ''));

      if (isPhoneNumber) {
        twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${callerNumber || ''}"${callerNumber ? '' : ' timeout="30"'}>
    <Number>${to}</Number>
  </Dial>
</Response>`;
      } else {
        // It's a client identity - connect to another browser client
        twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Client>${to}</Client>
  </Dial>
</Response>`;
      }
    } else {
      // Incoming call - route to the browser client for this user
      const identity = userId ? `leadripper-user-${userId}` : 'leadripper-browser';
      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Client>${identity}</Client>
  </Dial>
</Response>`;
    }

    return {
      statusCode: 200,
      headers,
      body: twiml
    };

  } catch (error) {
    console.error('Twilio voice handler error:', error);
    return {
      statusCode: 200,
      headers,
      body: `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>An error occurred processing your call. Please try again later.</Say>
</Response>`
    };
  }
};
