import axios from 'axios';
import { getAuthHeaders, normalizeCpiBaseUrl, readJsonBody, sendCpiError } from './_utils';

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
    const endpoint = `${baseUrl}/IntegrationDesigntimeArtifacts(Id='${iflowId}',Version='active')/$value`;
    const authHeaders = await getAuthHeaders(username, password, tokenUrl);

    const response = await axios.get(endpoint, {
      headers: authHeaders,
      responseType: 'arraybuffer',
      timeout: 60000,
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${iflowId}.zip"`);
    return res.status(200).send(Buffer.from(response.data));
  } catch (error: any) {
    return sendCpiError(res, error, 'Failed to download iFlow from SAP CPI.');
  }
}
