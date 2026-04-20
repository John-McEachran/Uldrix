export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const apiKey = process.env.MAILCHIMP_API_KEY;
  const listId = '7ca33656ef';

  const response = await fetch(
    `https://us3.api.mailchimp.com/3.0/lists/${listId}/members`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`anystring:${apiKey}`).toString('base64')}`,
      },
      body: JSON.stringify({ email_address: email, status: 'subscribed' }),
    }
  );

  const data = await response.json();

  if (response.ok) {
    return res.status(200).json({ success: true });
  }

  // Already subscribed is fine
  if (data.title === 'Member Exists') {
    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ error: data.detail || 'Subscription failed' });
}
