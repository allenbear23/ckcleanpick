const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const hasKV = !!(KV_URL && KV_TOKEN);

// Ephemeral memory fallbacks
let memoryConfig = null;
let memoryHistory = null;
let memoryRound = 0;

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

// Fisher-Yates shuffle algorithm
function shuffle(array) {
  let currentIndex = array.length, randomIndex;
  const arr = [...array];
  while (currentIndex !== 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [arr[currentIndex], arr[randomIndex]] = [arr[randomIndex], arr[currentIndex]];
  }
  return arr;
}

// Formatter for seat and name
function formatSN(student) {
  if (!student) return '';
  return `(${student.seat}) ${student.name}`;
}

// Dynamically calculate current week Monday to Friday range (Taipei Timezone)
function getWeekRange() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const taipeiNow = new Date(utc + (3600000 * 8)); // UTC+8
  
  const day = taipeiNow.getDay();
  // Adjust to Monday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  
  const monday = new Date(taipeiNow.getTime() + diffToMonday * 86400000);
  const friday = new Date(monday.getTime() + 4 * 86400000);
  
  const fmt = (d) => `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  return `${fmt(monday)} ~ ${fmt(friday)}`;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Allow GET or POST to trigger the Cron job (Vercel Cron is a GET request)
  try {
    // 1. Fetch Cloud Config
    let config = null;
    if (hasKV) {
      config = await getKV('clean_pick_config');
    } else {
      config = memoryConfig; // Ephemeral fallback
    }

    if (!config) {
      return res.status(400).json({
        error: 'No active schedule configuration found. Please sync your class roster and areas config first from the web dashboard!'
      });
    }

    const { students, defs, prefs } = config;
    
    // 2. Fetch History stats
    let history = null;
    let roundCounter = 0;
    if (hasKV) {
      history = await getKV('clean_pick_history') || {};
      const storedRound = await getKV('clean_pick_round_counter');
      roundCounter = storedRound ? parseInt(storedRound, 10) : 0;
    } else {
      history = memoryHistory || {};
      roundCounter = memoryRound;
    }

    roundCounter += 1;

    // 3. Process Cadres Allocation
    const seatMap = new Map(students.map(s => [s.seat, s.name]));
    const usedSeats = new Set();
    const cadres = { hygieneLead: null, envLead: null, hygieneOfficer: null };

    const pickCadre = (seatVal, key) => {
      if (!seatVal) return;
      const s = Number(seatVal);
      if (seatMap.has(s)) {
        usedSeats.add(s);
        cadres[key] = { seat: s, name: seatMap.get(s) };
      }
    };

    pickCadre(prefs.hSeat, 'hygieneLead');
    pickCadre(prefs.eSeat, 'envLead');
    pickCadre(prefs.oSeat, 'hygieneOfficer');

    // 4. Random Drawing Core Logic
    const pool = students.filter(x => !usedSeats.has(x.seat)).map(x => ({ seat: x.seat, name: x.name }));
    const areaAssignments = defs.map(a => ({ name: a.name, cap: a.capacity, members: [] }));

    const shuffledPool = shuffle(pool);
    let ptr = 0;
    areaAssignments.forEach(a => {
      a.members = shuffledPool.slice(ptr, ptr + a.cap);
      ptr += a.cap;
    });

    const standby = shuffledPool.slice(ptr);

    // 5. Update History & Fairness Statistics
    const drawnSet = new Set();
    areaAssignments.forEach(a => {
      a.members.forEach(m => {
        drawnSet.add(`${m.name}_${m.seat}`);
      });
    });

    pool.forEach(p => {
      const key = `${p.name}_${p.seat}`;
      if (!history[key]) {
        history[key] = {
          name: p.name,
          seat: p.seat,
          drawCount: 0,
          standbyCount: 0,
          consecutiveStandby: 0,
          lastDrawnRound: 0
        };
      }

      if (drawnSet.has(key)) {
        history[key].drawCount += 1;
        history[key].consecutiveStandby = 0;
        history[key].lastDrawnRound = roundCounter;
      } else {
        history[key].standbyCount += 1;
        history[key].consecutiveStandby += 1;
      }
    });

    // Save updated history back
    if (hasKV) {
      await setKV('clean_pick_history', history);
      await setKV('clean_pick_round_counter', roundCounter);
    } else {
      memoryHistory = history;
      memoryRound = roundCounter;
    }

    // 6. Build the LINE Push Message (Premium Formatting)
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const targetGroupId = prefs.localGroupId || process.env.LINE_GROUP_ID;
    const weekDates = getWeekRange();
    const productionTime = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });

    let messageText = `🧹 【自動排程 班級掃區自動分配】\n`;
    messageText += `適用日期：${weekDates}\n`;
    messageText += `系統分配時間：${productionTime}\n\n`;

    messageText += `👑 幹部名冊：\n`;
    messageText += ` - 衛生股長：${cadres.hygieneLead ? formatSN(cadres.hygieneLead) : '未指定'}\n`;
    messageText += ` - 環保股長：${cadres.envLead ? formatSN(cadres.envLead) : '未指定'}\n`;
    messageText += ` - 衛生幹事：${cadres.hygieneOfficer ? formatSN(cadres.hygieneOfficer) : '未指定'}\n\n`;

    messageText += `📋 掃區分配名冊：\n`;
    areaAssignments.forEach(a => {
      const membersStr = a.members.length > 0 
        ? a.members.map(m => formatSN(m)).join('、')
        : '無';
      messageText += `[${a.name}] (名額: ${a.cap})\n指派成員：${membersStr}\n\n`;
    });

    const standbyStr = standby.length > 0 
      ? standby.map(m => formatSN(m)).join('、')
      : '無';
    messageText += `💤 候補人員（今日休息）：\n${standbyStr}\n\n`;

    // Add fairness statistics section to prove the draw is super transparent and fair!
    const activeStatsList = Object.values(history).filter(s => {
      return students.some(cur => cur.name === s.name && cur.seat === s.seat);
    });

    const sortedStats = [...activeStatsList].sort((a, b) => {
      if (b.consecutiveStandby !== a.consecutiveStandby) {
        return b.consecutiveStandby - a.consecutiveStandby;
      }
      return a.drawCount - b.drawCount;
    });

    messageText += `📊 公平性追蹤 (連續休息最久)：\n`;
    sortedStats.slice(0, 3).forEach((s, idx) => {
      messageText += ` ${idx + 1}. 座號 ${s.seat} ${s.name} (連休 ${s.consecutiveStandby} 輪/累計抽中 ${s.drawCount} 次)\n`;
    });

    messageText += `\n💡 備註：請任何假需自行找代理人。本結果由 Vercel 排程機器人自動公平配發！`;

    // 7. Push to LINE
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
              text: messageText
            }
          ]
        })
      });

      pushed = lineRes.ok;
      pushDetails = await lineRes.json().catch(() => ({}));
    }

    return res.status(200).json({
      success: true,
      round: roundCounter,
      pushedToLine: pushed,
      hasKV,
      dateRange: weekDates,
      pushDetails,
      cadres,
      assignments: areaAssignments.map(a => ({ name: a.name, members: a.members })),
      standbyCount: standby.length
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Automatic weekly draw failed',
      message: err.message
    });
  }
};
