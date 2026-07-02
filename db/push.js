const https = require('https');

const ONE_SIGNAL_API = 'https://api.onesignal.com/notifications';

function isConfigured() {
  return !!(process.env.ONESIGNAL_APP_ID && process.env.ONESIGNAL_API_KEY);
}

function sendPush({ userIds, title, body, url }) {
  if (!isConfigured()) {
    console.log('[push] OneSignal no configurado. Se omitió notificación push para:', title);
    return Promise.resolve({ sent: false, reason: 'not_configured' });
  }

  const payload = JSON.stringify({
    app_id: process.env.ONESIGNAL_APP_ID,
    include_external_user_ids: userIds,
    headings: { en: title, es: title },
    contents: { en: body, es: body },
    url: url || '/'
  });

  return new Promise((resolve) => {
    const req = https.request(ONE_SIGNAL_API, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${process.env.ONESIGNAL_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ sent: true, response: JSON.parse(data) }));
    });
    req.on('error', err => {
      console.error('[push] Error:', err.message);
      resolve({ sent: false, error: err.message });
    });
    req.write(payload);
    req.end();
  });
}

module.exports = { sendPush, isConfigured };
