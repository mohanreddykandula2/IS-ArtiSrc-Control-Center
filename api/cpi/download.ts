import axios from 'axios';
import { getAuthHeaders, normalizeCpiBaseUrl, readJsonBody, sendCpiError } from './_utils';

const VERCEL_RESPONSE_LIMIT_BYTES = 4 * 1024 * 1024;

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
    responseLimit: false,
  },
  maxDuration: 60,
};

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
    return sendCpiError(res, error, 'Failed to download iFlow from SAP CPI.');
  }
}
