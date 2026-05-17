export default function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  return res.status(200).json({
    success: true,
    message: 'Vercel API backend is running.',
  });
}
