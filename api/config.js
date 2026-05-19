const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const EDGE_CONFIG_URL = process.env.EDGE_CONFIG;
const hasKV = !!(KV_URL && KV_TOKEN);

// Ephemeral memory cache fallback
let memoryConfig = null;

async function getEdgeConfigValue(key) {
  if (!EDGE_CONFIG_URL) return null;
  try {
    // Edge Config URL fetch returns all items in the store
    const res = await fetch(EDGE_CONFIG_URL);
    if (!res.ok) return null;
    const items = await res.json();
    return items[key] || null;
  } catch (e) {
    console.error('Edge Config Read Error:', e);
    return null;
  }
}

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

  const pushPassword = process.env.PUSH_PASSWORD;

  // 1. GET Request: Get active cloud schedule configuration
  if (req.method === 'GET') {
    try {
      let config = null;
      let source = 'memory';

      // Prioritize KV, then Edge Config, then Memory
      if (hasKV) {
        config = await getKV('clean_pick_config');
        source = 'vercel-kv';
      }
      
      if (!config && EDGE_CONFIG_URL) {
        config = await getEdgeConfigValue('clean_pick_config');
        source = 'edge-config';
      }

      if (!config) {
        config = memoryConfig;
      }

      return res.status(200).json({
        hasKV,
        hasEdgeConfig: !!EDGE_CONFIG_URL,
        hasCloudConfig: !!config,
        source,
        config: config ? {
          studentCount: config.students?.length || 0,
          defsCount: config.defs?.length || 0,
          prefs: config.prefs || {},
          updatedAt: config.updatedAt
        } : null
      });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to retrieve config', message: err.message });
    }
  }

  // 2. POST Request: Save/Sync configuration to the cloud
  if (req.method === 'POST') {
    try {
      const { students, defs, prefs, password } = req.body;

      // Password security check
      if (pushPassword && password !== pushPassword) {
        return res.status(403).json({ error: '授權密碼錯誤，您無權同步排程設定！' });
      }

      if (!students || !Array.isArray(students) || students.length === 0) {
        return res.status(400).json({ error: 'Students roster is required and cannot be empty.' });
      }

      if (!defs || !Array.isArray(defs) || defs.length === 0) {
        return res.status(400).json({ error: 'Sweep area definitions are required and cannot be empty.' });
      }

      const configData = {
        students,
        defs,
        prefs: prefs || {},
        updatedAt: new Date().toLocaleString()
      };

      let success = false;
      if (hasKV) {
        success = await setKV('clean_pick_config', configData);
      } else {
        memoryConfig = configData;
        success = true;
      }

      return res.status(200).json({
        success,
        hasKV,
        hasEdgeConfig: !!EDGE_CONFIG_URL,
        message: hasKV 
          ? '排程設定成功同步至 Vercel KV 雲端資料庫！'
          : (EDGE_CONFIG_URL 
              ? '偵測到 Edge Config！唯讀模式下設定已暫存於記憶體，建議啟用 Vercel KV 以進行每週排程自動寫入。'
              : '排程設定已暫存於伺服器記憶體中 (未偵測到 Vercel KV 資料庫)')
      });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to save config', message: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
