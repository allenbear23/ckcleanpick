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

// Heuristics-based parser to extract Date, Title, and Type from group reminders
function parseReminder(text) {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const taipeiNow = new Date(utc + (3600000 * 8)); // UTC+8
  
  let targetDate = new Date(taipeiNow);
  let dateFound = false;

  // Pattern 1: MM/DD or MM／DD (e.g. 5/22, 12／25)
  const regexSlash = /(\d{1,2})[\/／](\d{1,2})/;
  const matchSlash = text.match(regexSlash);
  if (matchSlash) {
    const month = parseInt(matchSlash[1], 10) - 1;
    const date = parseInt(matchSlash[2], 10);
    targetDate.setMonth(month, date);
    dateFound = true;
  } 
  // Pattern 2: MM月DD日 (e.g. 5月22日)
  else {
    const regexChinese = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/;
    const matchChinese = text.match(regexChinese);
    if (matchChinese) {
      const month = parseInt(matchChinese[1], 10) - 1;
      const date = parseInt(matchChinese[2], 10);
      targetDate.setMonth(month, date);
      dateFound = true;
    }
  }

  // Handle special keywords: 明天, 後天, 下週一~下週五
  if (!dateFound) {
    if (text.includes('明天')) {
      targetDate.setDate(taipeiNow.getDate() + 1);
      dateFound = true;
    } else if (text.includes('後天')) {
      targetDate.setDate(taipeiNow.getDate() + 2);
      dateFound = true;
    } else {
      const weekMatch = text.match(/下週([一二三四五六日])/);
      if (weekMatch) {
        const weekdays = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7 };
        const targetDay = weekdays[weekMatch[1]];
        const currentDay = taipeiNow.getDay() === 0 ? 7 : taipeiNow.getDay();
        const diff = (7 - currentDay) + targetDay;
        targetDate.setDate(taipeiNow.getDate() + diff);
        dateFound = true;
      }
    }
  }

  // If no date found, default to tomorrow
  if (!dateFound) {
    targetDate.setDate(taipeiNow.getDate() + 1);
  }

  // Format date as YYYY-MM-DD
  const yyyy = targetDate.getFullYear();
  const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
  const dd = String(targetDate.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  // Determine event type
  let type = 'event'; // default
  if (text.includes('考') || text.includes('測') || text.includes('小測') || text.includes('聽寫')) {
    type = 'exam';
  } else if (text.includes('交') || text.includes('作業') || text.includes('報告') || text.includes('習作') || text.includes('簿')) {
    type = 'homework';
  }

  // Deduce title (clean up text, grab first 30 chars or text following trigger keyword)
  let title = text.replace(/幹部提醒[：:]*/g, '')
                  .replace(/[#＃]提醒/g, '')
                  .replace(/[\r\n]+/g, ' ')
                  .trim();
  
  if (title.length > 40) {
    title = title.substring(0, 38) + '...';
  }

  return {
    date: dateStr,
    title: title || '幹部重要提醒',
    type
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('=== Incoming Webhook Request ===');
    console.log('Method:', req.method);
    console.log('KV Configured:', hasKV);
    console.log('Payload Body:', JSON.stringify(req.body));

    const { events } = req.body;

    // Handle LINE verification check
    if (!events || events.length === 0) {
      console.log('Empty events payload received (LINE verification or keepalive).');
      return res.status(200).json({ status: 'ok', message: 'No events found.' });
    }

    const calendar = await getKV('clean_class_calendar') || [];
    console.log('Existing calendar event count in Vercel KV:', calendar.length);

    let parsedEventsCount = 0;

    for (const event of events) {
      console.log('Processing Event:', JSON.stringify(event));
      
      // We only care about message events of type text
      if (event.type === 'message' && event.message.type === 'text') {
        const text = event.message.text.trim();
        console.log(`Extracted Message Text: "${text}"`);

        // Check if message is a cadre reminder (trigger keywords anywhere in text)
        const isReminder = text.includes('幹部提醒') || 
                           text.includes('#提醒') || 
                           text.includes('考試:') || 
                           text.includes('考試：') || 
                           text.includes('作業:') ||
                           text.includes('作業：') ||
                           text.includes('📌');

        console.log(`Is Reminder Trigger Match: ${isReminder}`);

        if (isReminder) {
          const parsed = parseReminder(text);
          const timestamp = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });

          const newEvent = {
            id: `event_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            date: parsed.date,
            title: parsed.title,
            type: parsed.type,
            content: text,
            sender: event.source.userId || 'Group Officer',
            createdAt: timestamp
          };

          // Automatically sync to Google Calendar if configured
          if (gcal.isConfigured) {
            try {
              console.log('Attempting to sync LINE reminder to Google Calendar...');
              const gcalEventId = await gcal.insertGoogleEvent(newEvent);
              if (gcalEventId) {
                newEvent.gcalEventId = gcalEventId;
                console.log(`LINE reminder synced successfully to Google Calendar. Event ID: ${gcalEventId}`);
              }
            } catch (gcalErr) {
              console.error('Google Calendar Webhook Auto-sync Error:', gcalErr);
            }
          }

          console.log('Successfully Parsed Calendar Event:', JSON.stringify(newEvent));
          calendar.push(newEvent);
          parsedEventsCount++;
        }
      } else {
        console.log('Skipping event (not a text message event).');
      }
    }

    // Sort calendar events by date ascending
    calendar.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Limit to max 100 historical items to prevent KV size explosion
    const truncatedCalendar = calendar.slice(-100);

    if (hasKV) {
      await setKV('clean_class_calendar', truncatedCalendar);
    }

    return res.status(200).json({ status: 'ok', parsedCount: events.length });
  } catch (error) {
    console.error('Webhook processing failure:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};
