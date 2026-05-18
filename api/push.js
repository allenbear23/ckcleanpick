module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Handle GET request to check configuration status securely
  if (req.method === 'GET') {
    const tokenConfigured = !!process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const groupConfigured = !!process.env.LINE_GROUP_ID;
    return res.status(200).json({
      tokenConfigured,
      groupConfigured,
      allConfigured: tokenConfigured && groupConfigured
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message, messages, groupId } = req.body;
    
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const targetGroupId = groupId || process.env.LINE_GROUP_ID;

    if (!token) {
      return res.status(500).json({ 
        error: 'LINE_CHANNEL_ACCESS_TOKEN environment variable is not configured on Vercel.' 
      });
    }

    if (!targetGroupId) {
      return res.status(400).json({ 
        error: 'LINE_GROUP_ID is not configured in Vercel environment variables and was not provided in the request.' 
      });
    }

    let finalMessages = [];
    if (messages && Array.isArray(messages) && messages.length > 0) {
      finalMessages = messages;
    } else if (message) {
      finalMessages = [
        {
          type: 'text',
          text: message
        }
      ];
    } else {
      return res.status(400).json({ error: 'Message content is missing.' });
    }

    // Call LINE Messaging API push endpoint
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        to: targetGroupId,
        messages: finalMessages
      })
    });

    const responseText = await response.text();
    let responseData = {};
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      responseData = { text: responseText };
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'Failed to push message to LINE',
        details: responseData
      });
    }

    return res.status(200).json({ success: true, details: responseData });
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};
