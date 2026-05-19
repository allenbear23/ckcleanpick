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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET: Fetch current check-in states from Vercel KV
  if (req.method === 'GET') {
    try {
      const checkinStates = await getKV('clean_checkin_states') || {};
      return res.status(200).json({
        success: true,
        hasKV,
        checkinStates
      });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to retrieve checkin states', message: err.message });
    }
  }

  // POST: Update check-in state for a student
  if (req.method === 'POST') {
    try {
      const { seat, checked } = req.body;

      if (seat === undefined) {
        return res.status(400).json({ error: 'Seat number is required.' });
      }

      const checkinStates = await getKV('clean_checkin_states') || {};
      checkinStates[seat] = !!checked;

      await setKV('clean_checkin_states', checkinStates);

      return res.status(200).json({
        success: true,
        hasKV,
        seat,
        checked: !!checked,
        checkinStates
      });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to save checkin state', message: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
