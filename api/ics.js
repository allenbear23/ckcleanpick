const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const hasKV = !!(KV_URL && KV_TOKEN);

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

module.exports = async (req, res) => {
  // CORS and iCal Content-Type
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const calendar = await getKV('clean_class_calendar') || [];

    // Helper to format date to YYYYMMDD
    const getYYYYMMDD = (dateStr) => {
      return dateStr.replace(/[-]/g, '');
    };

    // Helper to calculate the next day in YYYYMMDD (exclusive DTEND)
    const getNextDayYYYYMMDD = (dateStr) => {
      const parts = dateStr.split('-');
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;
      const d = parseInt(parts[2], 10);
      
      const current = new Date(Date.UTC(y, m, d));
      const next = new Date(Date.UTC(y, m, d + 1));
      
      const ny = next.getUTCFullYear();
      const nm = String(next.getUTCMonth() + 1).padStart(2, '0');
      const nd = String(next.getUTCDate()).padStart(2, '0');
      
      return `${ny}${nm}${nd}`;
    };

    // Current timestamp for DTSTAMP
    const nowISO = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    let icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//CKC 091 Class//AI Class Calendar//ZH',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:班級智慧行事曆 (AI Class Calendar)',
      'X-WR-TIMEZONE:Asia/Taipei',
      'X-WR-CALDESC:自動讀取 LINE 群組幹部發言生成的班級重要行事曆。'
    ];

    calendar.forEach(ev => {
      const start = getYYYYMMDD(ev.date);
      const end = getNextDayYYYYMMDD(ev.date);
      
      // Determine type label
      let typeLabel = '一般活動';
      if (ev.type === 'exam') typeLabel = '考試';
      if (ev.type === 'homework') typeLabel = '作業';

      const summary = `[${typeLabel}] ${ev.title}`;
      
      // Escape commas, semicolons, backslashes for standard iCal compliant string
      const escapeField = (str) => {
        if (!str) return '';
        return str
          .replace(/\\/g, '\\\\')
          .replace(/,/g, '\\,')
          .replace(/;/g, '\\;')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '');
      };

      const description = [
        `類別: ${typeLabel}`,
        `發布來源: ${ev.sender || '網頁主頁面'}`,
        `建立時間: ${ev.createdAt || '無'}`,
        `--------------------`,
        `詳細提醒內容:`,
        ev.content ? ev.content : ev.title
      ].map(s => escapeField(s)).join('\\n'); // Join with literal escaped newline

      icsContent.push('BEGIN:VEVENT');
      icsContent.push(`UID:event_${ev.id || Date.now()}@ckc091.vercel.app`);
      icsContent.push(`DTSTAMP:${nowISO}`);
      icsContent.push(`DTSTART;VALUE=DATE:${start}`);
      icsContent.push(`DTEND;VALUE=DATE:${end}`);
      icsContent.push(`SUMMARY:${escapeField(summary)}`);
      icsContent.push(`DESCRIPTION:${description}`);
      icsContent.push('END:VEVENT');
    });

    icsContent.push('END:VCALENDAR');

    // iCal requires CRLF line endings (\r\n)
    const icsText = icsContent.join('\r\n');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename=class_calendar.ics');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    
    return res.status(200).send(icsText);
  } catch (error) {
    console.error('ICS Generation Error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};
