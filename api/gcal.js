const crypto = require('crypto');

const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = process.env.GOOGLE_PRIVATE_KEY;
const calendarId = process.env.GOOGLE_CALENDAR_ID;

const isConfigured = !!(email && privateKey && calendarId);

function signJWT(payload, key) {
  const header = { alg: 'RS256', typ: 'JWT' };
  
  const base64Encode = (obj) => {
    return Buffer.from(JSON.stringify(obj)).toString('base64url');
  };
  
  const base64Header = base64Encode(header);
  const base64Payload = base64Encode(payload);
  const signInput = `${base64Header}.${base64Payload}`;
  
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signInput);
  
  // Format private key correctly if newline escapes exist
  const formattedKey = key.replace(/\\n/g, '\n');
  const signature = sign.sign(formattedKey, 'base64url');
  
  return `${signInput}.${signature}`;
}

async function getGoogleAccessToken() {
  if (!isConfigured) {
    console.warn('Google Calendar credentials are not fully configured.');
    return null;
  }
  
  try {
    const now = Math.floor(Date.now() / 1000);
    const claim = {
      iss: email,
      scope: 'https://www.googleapis.com/auth/calendar.events',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now
    };
    
    const jwt = signJWT(claim, privateKey);
    
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt
      })
    });
    
    if (!res.ok) {
      const errText = await res.text();
      console.error('Google Token Exchange Failed:', errText);
      return null;
    }
    
    const data = await res.json();
    return data.access_token;
  } catch (e) {
    console.error('getGoogleAccessToken Error:', e);
    return null;
  }
}

const getNextDayStr = (dateStr) => {
  const parts = dateStr.split('-');
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);
  const next = new Date(Date.UTC(y, m, d + 1));
  const ny = next.getUTCFullYear();
  const nm = String(next.getUTCMonth() + 1).padStart(2, '0');
  const nd = String(next.getUTCDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
};

async function insertGoogleEvent(event) {
  if (!isConfigured) return null;
  
  try {
    const token = await getGoogleAccessToken();
    if (!token) return null;
    
    let typeLabel = '一般活動';
    if (event.type === 'exam') typeLabel = '考試';
    if (event.type === 'homework') typeLabel = '作業';
    
    const summary = `[${typeLabel}] ${event.title}`;
    const description = [
      `類別: ${typeLabel}`,
      `發布來源: ${event.sender || '網頁主頁面'}`,
      `建立時間: ${event.createdAt || new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`,
      `--------------------`,
      `詳細提醒內容:`,
      event.content || event.title
    ].join('\n');
    
    const endStr = getNextDayStr(event.date);
    
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        summary,
        description,
        start: { date: event.date },
        end: { date: endStr }
      })
    });
    
    if (!res.ok) {
      const errText = await res.text();
      console.error('Google Calendar Insert Event Failed:', errText);
      return null;
    }
    
    const data = await res.json();
    console.log(`Successfully synced event to Google Calendar. Event ID: ${data.id}`);
    return data.id;
  } catch (e) {
    console.error('insertGoogleEvent Error:', e);
    return null;
  }
}

async function deleteGoogleEvent(gcalEventId) {
  if (!isConfigured || !gcalEventId) return false;
  
  try {
    const token = await getGoogleAccessToken();
    if (!token) return false;
    
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(gcalEventId)}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (res.status === 404) {
      console.warn(`Event ${gcalEventId} not found in Google Calendar, skipping.`);
      return true;
    }
    
    if (!res.ok) {
      const errText = await res.text();
      console.error('Google Calendar Delete Event Failed:', errText);
      return false;
    }
    
    console.log(`Successfully deleted event from Google Calendar. Event ID: ${gcalEventId}`);
    return true;
  } catch (e) {
    console.error('deleteGoogleEvent Error:', e);
    return false;
  }
}

module.exports = {
  isConfigured,
  getGoogleAccessToken,
  insertGoogleEvent,
  deleteGoogleEvent
};
