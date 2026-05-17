import axios from 'axios';

export type CpiRequestBody = {
  cpiUrl?: string;
  tokenUrl?: string;
  username?: string;
  password?: string;
  iflowId?: string;
  zipData?: string;
};

export function readJsonBody(req: any): CpiRequestBody {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

export function normalizeCpiBaseUrl(cpiUrl?: string) {
  if (!cpiUrl) throw new Error('Missing CPI URL.');

  let parsed: URL;
  try {
    parsed = new URL(cpiUrl);
  } catch {
    throw new Error('CPI URL must be a valid URL.');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('CPI URL must use HTTPS.');
  }

  let baseUrl = cpiUrl.replace(/\/$/, '');
  if (!baseUrl.endsWith('/api/v1')) {
    baseUrl += '/api/v1';
  }

  return baseUrl;
}

export function validateTokenUrl(tokenUrl?: string) {
  if (!tokenUrl) return;

  let parsed: URL;
  try {
    parsed = new URL(tokenUrl);
  } catch {
    throw new Error('Token URL must be a valid URL.');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Token URL must use HTTPS.');
  }
}

export async function getAuthHeaders(username?: string, password?: string, tokenUrl?: string) {
  if (tokenUrl) {
    validateTokenUrl(tokenUrl);
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    const tokenRes = await axios.post(tokenUrl, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64'),
      },
      timeout: 30000,
    });
    return { Authorization: `Bearer ${tokenRes.data.access_token}` };
  }

  return { Authorization: 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64') };
}

export function sendCpiError(res: any, error: any, fallback: string) {
  console.error(fallback, error.message);

  if (error.response) {
    return res.status(error.response.status).json({
      error: `SAP CPI Error: ${error.response.statusText}`,
      details: typeof error.response.data === 'string' ? error.response.data : undefined,
    });
  }

  return res.status(500).json({ error: error.message || fallback });
}
