import axios from 'axios';

const VERCEL_RESPONSE_LIMIT_BYTES = 4 * 1024 * 1024;
const OUTBOUND_TIMEOUT_MS = 8000;

type CpiRequestBody = {
  cpiUrl?: string;
  tokenUrl?: string;
  username?: string;
  password?: string;
  iflowId?: string;
};

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
    responseLimit: false,
  },
  maxDuration: 10,
};

function readJsonBody(req: any): CpiRequestBody {
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

function normalizeCpiBaseUrl(cpiUrl: string) {
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

function validateTokenUrl(tokenUrl?: string) {
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

async function getAuthHeaders(username: string, password: string, tokenUrl?: string) {
  if (tokenUrl) {
    validateTokenUrl(tokenUrl);
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    const tokenRes = await axios.post(tokenUrl, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64'),
      },
      timeout: OUTBOUND_TIMEOUT_MS,
    });
    return { Authorization: `Bearer ${tokenRes.data.access_token}` };
  }

  return { Authorization: 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64') };
}

function odataString(value: string) {
  return value.replace(/'/g, "''");
}

function sendError(res: any, error: any) {
  console.error('Vercel CPI download failed:', {
    message: error?.message,
    code: error?.code,
    status: error?.response?.status,
    statusText: error?.response?.statusText,
  });

  if (error?.code === 'ECONNABORTED') {
    return res.status(504).json({
      error: 'The CPI download request timed out from Vercel. Try again, or use the local app / full Node backend for slower CPI tenants.',
    });
  }

  if (error?.response) {
    const details = Buffer.isBuffer(error.response.data)
      ? error.response.data.toString('utf8').slice(0, 1000)
      : typeof error.response.data === 'string'
        ? error.response.data.slice(0, 1000)
        : undefined;

    return res.status(error.response.status).json({
      error: `SAP CPI Error: ${error.response.statusText || error.response.status}`,
      details,
    });
  }

  return res.status(500).json({
    error: error?.message || 'Failed to download iFlow from SAP CPI.',
  });
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const { cpiUrl, username, password, iflowId, tokenUrl } = readJsonBody(req);

    if (!cpiUrl || !username || !password || !iflowId) {
      return res.status(400).json({ error: 'Missing required SAP CPI credentials or iFlow ID.' });
    }

    const baseUrl = normalizeCpiBaseUrl(cpiUrl);
    const endpoint = `${baseUrl}/IntegrationDesigntimeArtifacts(Id='${odataString(iflowId)}',Version='active')/$value`;
    const authHeaders = await getAuthHeaders(username, password, tokenUrl);

    const response = await axios.get(endpoint, {
      headers: authHeaders,
      responseType: 'arraybuffer',
      timeout: OUTBOUND_TIMEOUT_MS,
    });

    const zipBuffer = Buffer.from(response.data);
    if (zipBuffer.byteLength > VERCEL_RESPONSE_LIMIT_BYTES) {
      return res.status(413).json({
        error: 'The downloaded iFlow ZIP is too large for Vercel serverless response limits. Use the local app or deploy the Node backend to a server platform for large CPI artifacts.',
        sizeMb: Number((zipBuffer.byteLength / 1024 / 1024).toFixed(2)),
      });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${iflowId}.zip"`);
    return res.status(200).send(zipBuffer);
  } catch (error: any) {
    return sendError(res, error);
  }
}
