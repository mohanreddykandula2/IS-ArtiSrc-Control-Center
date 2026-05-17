import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import react from "@vitejs/plugin-react";
import axios from "axios";
import { fileURLToPath, pathToFileURL } from "url";

// Polyfill __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware to parse JSON
  app.use(express.json({ limit: "50mb" }));

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ success: true, message: "Node.js Backend is running." });
  });

  // Helper function to get authorization headers
  async function getAuthHeaders(username?: string, password?: string, tokenUrl?: string) {
    if (tokenUrl) {
      const params = new URLSearchParams();
      params.append('grant_type', 'client_credentials');
      const tokenRes = await axios.post(tokenUrl, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')
        }
      });
      return { 'Authorization': `Bearer ${tokenRes.data.access_token}` };
    }
    return { 'Authorization': 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64') };
  }

  // Proxy endpoint to interact with SAP CPI
  app.post("/api/cpi/download", async (req, res) => {
    try {
      const { cpiUrl, username, password, iflowId, tokenUrl } = req.body;
      
      if (!cpiUrl || !username || !password || !iflowId) {
        return res.status(400).json({ error: "Missing required SAP CPI credentials or iFlow ID." });
      }

      let baseUrl = cpiUrl.replace(/\/$/, "");
      if (!baseUrl.endsWith('/api/v1')) {
        baseUrl += '/api/v1';
      }
      const endpoint = `${baseUrl}/IntegrationDesigntimeArtifacts(Id='${iflowId}',Version='active')/$value`;
      console.log(`[Download] Calling endpoint: ${endpoint}`);
      const authHeaders = await getAuthHeaders(username, password, tokenUrl);

      const response = await axios.get(endpoint, {
        headers: authHeaders,
        responseType: "arraybuffer", // Important to get the ZIP file correctly
      });

      // Send the downloaded ZIP file to the frontend
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${iflowId}.zip"`);
      res.send(Buffer.from(response.data));

    } catch (error: any) {
      console.error("Error downloading from CPI:", error.message);
      if (error.response) {
         res.status(error.response.status).json({ error: `SAP CPI Error: ${error.response.statusText}` });
      } else {
         res.status(500).json({ error: "Failed to download iFlow from SAP CPI." });
      }
    }
  });

  app.put("/api/cpi/upload", async (req, res) => {
    try {
      const { cpiUrl, username, password, iflowId, zipData, tokenUrl } = req.body;
      
      if (!cpiUrl || !username || !password || !iflowId || !zipData) {
        return res.status(400).json({ error: "Missing required SAP CPI credentials, iFlow ID, or ZIP data." });
      }

      let baseUrl = cpiUrl.replace(/\/$/, "");
      if (!baseUrl.endsWith('/api/v1')) {
        baseUrl += '/api/v1';
      }
      const endpoint = `${baseUrl}/IntegrationDesigntimeArtifacts(Id='${iflowId}',Version='active')`;
      console.log(`[Upload] Calling endpoint: ${endpoint}`);
      const authHeaders = await getAuthHeaders(username, password, tokenUrl);

      // Fetch CSRF Token
      let csrfToken = "";
      let cookies = "";
      try {
        console.log(`[Upload] Fetching CSRF token from: ${baseUrl}/$metadata`);
        const csrfRes = await axios.get(`${baseUrl}/$metadata`, {
          headers: {
            ...authHeaders,
            "X-CSRF-Token": "Fetch"
          }
        });
        if (csrfRes.headers["x-csrf-token"]) {
          csrfToken = csrfRes.headers["x-csrf-token"];
        }
        if (csrfRes.headers["set-cookie"]) {
          cookies = csrfRes.headers["set-cookie"].map((c: string) => c.split(';')[0]).join("; ");
        }
      } catch (tokenErr: any) {
        console.error(`[Upload] CSRF token fetch failed with ${tokenErr.response?.status}`);
        if (tokenErr.response?.headers?.["x-csrf-token"]) {
          csrfToken = tokenErr.response.headers["x-csrf-token"];
        }
        if (tokenErr.response?.headers?.["set-cookie"]) {
          cookies = tokenErr.response.headers["set-cookie"].map((c: string) => c.split(';')[0]).join("; ");
        }
      }
      
      console.log(`[Upload] CSRF Token retrieved: ${!!csrfToken}, Cookies retrieved: ${!!cookies}`);

      // We send a PUT request to the same endpoint but with a JSON body
      // containing the ArtifactContent as a base64 string.
      const payload = {
        Id: iflowId,
        ArtifactContent: zipData
      };
      
      const uploadHeaders: Record<string, string> = {
        ...authHeaders,
        "Content-Type": "application/json",
        "Accept": "application/json"
      };

      if (csrfToken) {
        uploadHeaders["X-CSRF-Token"] = csrfToken;
      }
      if (cookies) {
        uploadHeaders["Cookie"] = cookies;
      }

      console.log(`[Upload] Sending PUT request to ${endpoint}`);
      const response = await axios.put(endpoint, payload, {
        headers: uploadHeaders,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });

      res.json({ success: true, message: "Artifact successfully uploaded to SAP CPI.", data: response.data });
    } catch (error: any) {
      console.error("Error uploading to CPI:", error.message);
      let errorDesc = "Failed to upload iFlow to SAP CPI.";
      let details = error.response?.data ? error.response.data.toString() : undefined;
      
      if (error.response?.status === 403) {
        errorDesc = "403 Forbidden: You may lack the 'AuthGroup_IntegrationDeveloper' role to modify artifacts, or CSRF token validation failed. Check your API permissions.";
      } else if (error.response?.status === 401) {
        errorDesc = "401 Unauthorized: Invalid credentials or expired token.";
      } else if (error.response?.status) {
        errorDesc = `SAP CPI Error: ${error.response.statusText}`;
      }

      res.status(error.response?.status || 500).json({ 
        error: errorDesc, 
        details 
      });
    }
  });


  // Vite middleware for development
  const isProduction = process.env.NODE_ENV === "production" || path.basename(__dirname) === "dist";

  if (!isProduction) {
    const tailwindModule = await import(pathToFileURL(path.join(process.cwd(), "node_modules", "@tailwindcss", "vite", "dist", "index.mjs")).href);
    const tailwindcss = tailwindModule.default;
    const vite = await createViteServer({
      configFile: false,
      plugins: [react(), tailwindcss()],
      resolve: {
        alias: {
          "@": process.cwd(),
        },
      },
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
