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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const targetGroupId = process.env.LINE_GROUP_ID;
  const pushPassword = process.env.PUSH_PASSWORD;

  // Verify manual password if PUSH_PASSWORD is configured and this is a manual trigger
  const providedPassword = req.query.password || (req.body && req.body.password);
  const isVercelCron = req.headers['x-vercel-cron'] === 'true';

  if (pushPassword && !isVercelCron && providedPassword !== pushPassword) {
    // If it's not a vercel cron call and the password is wrong or missing, deny access
    return res.status(403).json({ error: '授權密碼錯誤，您無權手動觸發提醒！' });
  }

  try {
    // 1. Calculate Tomorrow's Date in Taipei Standard Time (UTC+8)
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const taipeiNow = new Date(utc + (3600000 * 8)); // UTC+8
    
    const tomorrow = new Date(taipeiNow);
    tomorrow.setDate(taipeiNow.getDate() + 1);
    
    const yyyy = tomorrow.getFullYear();
    const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const dd = String(tomorrow.getDate()).padStart(2, '0');
    const tomorrowStr = `${yyyy}-${mm}-${dd}`;
    
    // Day of week in Chinese
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    const tomorrowDayOfWeek = weekdays[tomorrow.getDay()];

    let calendar = [];
    let isTest = req.query.test === 'true' || (req.body && req.body.test === true);

    if (isTest) {
      // Simulation payload for testing
      calendar = [
        {
          id: 'test_ev_1',
          date: tomorrowStr,
          title: '考英文第六課單字',
          type: 'exam',
          content: '幹部提醒：5/22（五）考英文第六課單字',
          sender: 'Web Dashboard (測試模擬)'
        },
        {
          id: 'test_ev_2',
          date: tomorrowStr,
          title: '繳交物理實驗報告',
          type: 'homework',
          content: '#提醒 物理實驗報告請於明天第二節課前繳交',
          sender: 'Web Dashboard (測試模擬)'
        }
      ];
    } else {
      calendar = await getKV('clean_class_calendar') || [];
    }

    // 2. Filter events for tomorrow
    const tomorrowEvents = calendar.filter(ev => ev.date === tomorrowStr);

    if (tomorrowEvents.length === 0) {
      return res.status(200).json({
        success: true,
        date: tomorrowStr,
        message: '明天沒有任何排定的考試或作業日程，已自動跳過推送。'
      });
    }

    // 3. Format line message
    const exams = tomorrowEvents.filter(ev => ev.type === 'exam');
    const homeworks = tomorrowEvents.filter(ev => ev.type === 'homework');
    const events = tomorrowEvents.filter(ev => ev.type !== 'exam' && ev.type !== 'homework');

    let msgText = `🔔 【明日班級待辦重要提醒】\n`;
    msgText += `📅 日期：${tomorrowStr}（週${tomorrowDayOfWeek}）\n`;
    msgText += `📝 明天共有 ${tomorrowEvents.length} 項待辦事項，請同學們提前準備！\n\n`;

    if (exams.length > 0) {
      msgText += `🔥 【⚠️ 明日考試 Exams】\n`;
      exams.forEach((ev, idx) => {
        msgText += ` 🎯 ${idx + 1}. ${ev.title}\n`;
        if (ev.content && ev.content !== ev.title) {
          const details = ev.content.replace(/\r?\n/g, '\n    ');
          msgText += `    └ 詳細內容: ${details}\n`;
        }
      });
      msgText += `\n`;
    }

    if (homeworks.length > 0) {
      msgText += `📝 【📋 明日待交作業 Homework】\n`;
      homeworks.forEach((ev, idx) => {
        msgText += ` 📌 ${idx + 1}. ${ev.title}\n`;
        if (ev.content && ev.content !== ev.title) {
          const details = ev.content.replace(/\r?\n/g, '\n    ');
          msgText += `    └ 詳細內容: ${details}\n`;
        }
      });
      msgText += `\n`;
    }

    if (events.length > 0) {
      msgText += `📢 【🔔 其他活動 & 提醒 Events】\n`;
      events.forEach((ev, idx) => {
        msgText += ` 💡 ${idx + 1}. ${ev.title}\n`;
        if (ev.content && ev.content !== ev.title) {
          const details = ev.content.replace(/\r?\n/g, '\n    ');
          msgText += `    └ 詳細內容: ${details}\n`;
        }
      });
      msgText += `\n`;
    }

    // Auto-detect host or fallback to standard URL
    const host = req.headers.host || 'ckc091.vercel.app';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    msgText += `💡 點擊下方連結查看詳細雲端行事曆：\n`;
    msgText += `🔗 ${protocol}://${host}\n\n`;
    msgText += `（本提醒由班級排程機器人於每日晚間自動配發）`;

    // 4. Send Message to LINE Group
    let pushed = false;
    let pushDetails = null;

    if (token && targetGroupId) {
      const lineRes = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          to: targetGroupId,
          messages: [
            {
              type: 'text',
              text: msgText
            }
          ]
        })
      });

      pushed = lineRes.ok;
      pushDetails = await lineRes.json().catch(() => ({}));
      
      if (!pushed) {
        console.error('LINE Push Failed:', JSON.stringify(pushDetails));
      }
    } else {
      console.warn('LINE Credentials missing in environment.');
    }

    return res.status(200).json({
      success: true,
      date: tomorrowStr,
      eventCount: tomorrowEvents.length,
      pushedToLine: pushed,
      pushDetails,
      isTestSimulation: isTest,
      messageText: msgText
    });
  } catch (error) {
    console.error('Remind Process Error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};
