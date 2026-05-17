import axios from 'axios';
import { getAuthHeaders, normalizeCpiBaseUrl, readJsonBody, sendCpiError } from './_utils';

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
    const endpoint = `${baseUrl}/IntegrationDesigntimeArtifacts(Id='${iflowId}',Version='active')`;
    const authHeaders = await getAuthHeaders(username, password, tokenUrl);

    let csrfToken = '';
    let cookies = '';
    try {
      const csrfRes = await axios.get(`${baseUrl}/$metadata`, {
        headers: {
          ...authHeaders,
          'X-CSRF-Token': 'Fetch',
        },
        timeout: 30000,
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
        timeout: 60000,
      }
    );

    return res.status(200).json({
      success: true,
      message: 'Artifact successfully uploaded to SAP CPI.',
      data: response.data,
    });
  } catch (error: any) {
    return sendCpiError(res, error, 'Failed to upload iFlow to SAP CPI.');
  }
}
