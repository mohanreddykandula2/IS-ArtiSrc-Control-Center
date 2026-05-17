import axios from 'axios';

const OUTBOUND_TIMEOUT_MS = 8000;

type CpiRequestBody = {
  cpiUrl?: string;
  tokenUrl?: string;
  username?: string;
  password?: string;
  iflowId?: string;
  zipData?: string;
};

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
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
  console.error('Vercel CPI upload failed:', {
    message: error?.message,
    code: error?.code,
    status: error?.response?.status,
    statusText: error?.response?.statusText,
  });

  if (error?.code === 'ECONNABORTED') {
    return res.status(504).json({
      error: 'The CPI upload request timed out from Vercel. Try again, or use the local app / full Node backend for slower CPI tenants.',
    });
  }

  if (error?.response) {
    const details = typeof error.response.data === 'string'
      ? error.response.data.slice(0, 1000)
      : undefined;

    return res.status(error.response.status).json({
      error: `SAP CPI Error: ${error.response.statusText || error.response.status}`,
      details,
    });
  }

  return res.status(500).json({
    error: error?.message || 'Failed to upload iFlow to SAP CPI.',
  });
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'PUT') {
    res.setHeader('Allow', 'PUT');
    return res.status(405).json({ error: 'Method not allowed. Use PUT.' });
  }

  try {
    const { cpiUrl, username, password, iflowId, zipData, tokenUrl } = readJsonBody(req);

    if (!cpiUrl || !username || !password || !iflowId || !zipData) {
      return res.status(400).json({ error: 'Missing required SAP CPI credentials, iFlow ID, or ZIP data.' });
    }

    const baseUrl = normalizeCpiBaseUrl(cpiUrl);
    const endpoint = `${baseUrl}/IntegrationDesigntimeArtifacts(Id='${odataString(iflowId)}',Version='active')`;
    const authHeaders = await getAuthHeaders(username, password, tokenUrl);

    let csrfToken = '';
    let cookies = '';
    try {
      const csrfRes = await axios.get(`${baseUrl}/$metadata`, {
        headers: {
          ...authHeaders,
          'X-CSRF-Token': 'Fetch',
        },
        timeout: OUTBOUND_TIMEOUT_MS,
      });
      if (csrfRes.headers['x-csrf-token']) {
        csrfToken = csrfRes.headers['x-csrf-token'];
      }
      if (csrfRes.headers['set-cookie']) {
        cookies = csrfRes.headers['set-cookie'].map((cookie: string) => cookie.split(';')[0]).join('; ');
      }
    } catch (tokenErr: any) {
      if (tokenErr.response?.headers?.['x-csrf-token']) {
        csrfToken = tokenErr.response.headers['x-csrf-token'];
      }
      if (tokenErr.response?.headers?.['set-cookie']) {
        cookies = tokenErr.response.headers['set-cookie'].map((cookie: string) => cookie.split(';')[0]).join('; ');
      }
    }

    const uploadHeaders: Record<string, string> = {
      ...authHeaders,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (csrfToken) uploadHeaders['X-CSRF-Token'] = csrfToken;
    if (cookies) uploadHeaders.Cookie = cookies;

    const response = await axios.put(
      endpoint,
      {
        Id: iflowId,
        ArtifactContent: zipData,
      },
      {
        headers: uploadHeaders,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: OUTBOUND_TIMEOUT_MS,
      }
    );

    return res.status(200).json({
      success: true,
      message: 'Artifact successfully uploaded to SAP CPI.',
      data: response.data,
    });
  } catch (error: any) {
    return sendError(res, error);
  }
}
