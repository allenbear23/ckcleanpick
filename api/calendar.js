const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const hasKV = !!(KV_URL && KV_TOKEN);
const gcal = require('./gcal');

async function getKV(key) {
  if (!hasKV) return null;
  try {
    const res = await fetch(`${KV_URL}/get/${key}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.result ? JSON.parse(data.result) : null;
  } catch (e) {
    console.error('KV Get Error:', e);
    return null;
  }
}

async function setKV(key, value) {
  if (!hasKV) return false;
  try {
    const res = await fetch(`${KV_URL}/set/${key}`, {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${KV_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(value)
    });
    return res.ok;
  } catch (e) {
    console.error('KV Set Error:', e);
    return false;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const pushPassword = process.env.PUSH_PASSWORD;

  try {
    // 1. GET: Fetch all calendar events
    if (req.method === 'GET') {
      const calendar = await getKV('clean_class_calendar') || [];
      return res.status(200).json({ success: true, hasKV, calendar });
    }

    // 2. POST: Manually create a calendar event
    if (req.method === 'POST') {
      const { title, date, type, content, password } = req.body;

      if (pushPassword && password !== pushPassword) {
        return res.status(403).json({ error: '授權密碼錯誤，您無權修改班級行事曆！' });
      }

      if (!title || !date || !type) {
        return res.status(400).json({ error: 'Title, Date, and Type are required fields.' });
      }

      const calendar = await getKV('clean_class_calendar') || [];
      
      const newEvent = {
        id: `event_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        date,
        title,
        type,
        content: content || '',
        sender: 'Web Dashboard',
        createdAt: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
      };

      // Automatically sync to Google Calendar if configured
      if (gcal.isConfigured) {
        try {
          console.log('Attempting to sync manual event to Google Calendar...');
          const gcalEventId = await gcal.insertGoogleEvent(newEvent);
          if (gcalEventId) {
            newEvent.gcalEventId = gcalEventId;
            console.log(`Manual event synced successfully to Google Calendar. Event ID: ${gcalEventId}`);
          }
        } catch (gcalErr) {
          console.error('Google Calendar Manual Sync Error:', gcalErr);
        }
      }

      calendar.push(newEvent);
      calendar.sort((a, b) => new Date(a.date) - new Date(b.date));

      if (hasKV) {
        await setKV('clean_class_calendar', calendar);
      }

      return res.status(200).json({ success: true, calendar });
    }

    // 3. DELETE: Remove an event
    if (req.method === 'DELETE') {
      const { id, password } = req.body;

      if (pushPassword && password !== pushPassword) {
        return res.status(403).json({ error: '授權密碼錯誤，您無權修改班級行事曆！' });
      }

      if (!id) {
        return res.status(400).json({ error: 'Event ID is required for deletion.' });
      }

      const calendar = await getKV('clean_class_calendar') || [];
      const eventToDelete = calendar.find(ev => ev.id === id);

      // Automatically delete from Google Calendar if configured and exists
      if (eventToDelete && eventToDelete.gcalEventId && gcal.isConfigured) {
        try {
          console.log(`Attempting to delete event from Google Calendar. ID: ${eventToDelete.gcalEventId}...`);
          await gcal.deleteGoogleEvent(eventToDelete.gcalEventId);
        } catch (gcalErr) {
          console.error('Google Calendar Manual Delete Error:', gcalErr);
        }
      }

      const updatedCalendar = calendar.filter(ev => ev.id !== id);

      if (hasKV) {
        await setKV('clean_class_calendar', updatedCalendar);
      }

      return res.status(200).json({ success: true, calendar: updatedCalendar });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};
