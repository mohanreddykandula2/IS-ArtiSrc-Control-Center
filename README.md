# SAP CPI Flow Renamer

SAP CPI Flow Renamer is a React and Node.js application for safely renaming script files inside SAP Cloud Integration iFlow exports.

The application can work in two ways:

- Upload a local SAP CPI iFlow ZIP file, rename the scripts in the browser, and download a modified ZIP.
- Connect to SAP CPI through the backend API, download an active iFlow artifact, rename scripts, and deploy the updated artifact back to CPI.

## What Problem This Solves

SAP CPI iFlows often contain Groovy or JavaScript files under `src/main/resources/script/`. These scripts can be referenced from `.iflw`, XML, property, or manifest files. Renaming scripts manually inside the ZIP is risky because every reference must be updated consistently.

This tool:

- Reads the exported iFlow ZIP.
- Finds scripts in the standard CPI script folder.
- Detects script references in the integration flow definition.
- Shows the related flow step names where possible.
- Lets users rename scripts from a simple UI.
- Rebuilds the ZIP with renamed script files and updated references.
- Optionally uploads the updated artifact directly back to SAP CPI.

## Tech Stack

- React 19 for the user interface
- TypeScript for frontend and backend code
- Vite for frontend development and production builds
- Tailwind CSS for styling
- Express for the backend API server
- JSZip for reading and rebuilding CPI ZIP artifacts
- Axios for SAP CPI HTTP API calls
- Lucide React for icons
- Motion for UI transitions

## Project Structure

```text
.
+-- src/
|   +-- App.tsx          # Main application UI and ZIP processing logic
|   +-- main.tsx         # React application entry point
|   +-- index.css        # Tailwind CSS import
|   +-- lib/
|       +-- utils.ts     # Shared utility helpers
+-- server.ts            # Express server and SAP CPI proxy API routes
+-- index.html           # Vite HTML entry point
+-- vite.config.ts       # Vite, React, Tailwind, and env configuration
+-- tsconfig.json        # TypeScript configuration
+-- package.json         # Scripts and dependencies
+-- package-lock.json    # Locked dependency versions
+-- .env.example         # Example environment variables
+-- metadata.json        # AI Studio app metadata
```

## Main Application Flow

### 1. Local ZIP Upload Flow

1. The user selects or drags an exported SAP CPI iFlow ZIP file into the app.
2. The browser reads the ZIP using JSZip.
3. The app searches for scripts under:

   ```text
   src/main/resources/script/
   ```

4. The app searches `.iflw` files under:

   ```text
   src/main/resources/scenarioflows/integrationflow/
   ```

5. Script references are mapped to nearby integration step names when possible.
6. The user edits the script names in the UI.
7. The app creates a new ZIP:

   - Renamed script file paths are written to the new ZIP.
   - References inside `.iflw`, `.xml`, `.prop`, and `.mf` files are updated.
   - Unchanged files are copied as-is.

8. The user downloads the modified ZIP locally.

### 2. SAP CPI API Flow

1. The user enters SAP CPI service key credentials or pastes a service key JSON.
2. The app sends a request to the local backend.
3. The backend authenticates against SAP CPI.
4. The backend downloads the active iFlow artifact as a ZIP.
5. The frontend processes the ZIP in the same way as the local upload flow.
6. After renaming scripts, the frontend sends the rebuilt ZIP to the backend.
7. The backend uploads the modified artifact back to SAP CPI.

## Backend API Routes

The backend is implemented in `server.ts`.

### Health Check

```http
GET /api/health
```

Returns a simple response confirming that the Node.js backend is running.

### Download iFlow From SAP CPI

```http
POST /api/cpi/download
```

Expected JSON body:

```json
{
  "cpiUrl": "https://example.hana.ondemand.com/api/v1",
  "tokenUrl": "https://example.authentication.hana.ondemand.com/oauth/token",
  "username": "client-id",
  "password": "client-secret",
  "iflowId": "ExampleIFlow"
}
```

The backend calls the SAP CPI OData endpoint:

```text
/IntegrationDesigntimeArtifacts(Id='{iflowId}',Version='active')/$value
```

It returns the iFlow artifact ZIP to the frontend.

### Upload Updated iFlow To SAP CPI

```http
PUT /api/cpi/upload
```

Expected JSON body:

```json
{
  "cpiUrl": "https://example.hana.ondemand.com/api/v1",
  "tokenUrl": "https://example.authentication.hana.ondemand.com/oauth/token",
  "username": "client-id",
  "password": "client-secret",
  "iflowId": "ExampleIFlow",
  "zipData": "base64-encoded-zip-content"
}
```

The backend:

- Authenticates with SAP CPI.
- Fetches a CSRF token from the CPI metadata endpoint.
- Sends the updated artifact content to:

  ```text
  /IntegrationDesigntimeArtifacts(Id='{iflowId}',Version='active')
  ```

## Authentication

The backend supports two authentication styles:

- OAuth client credentials when `tokenUrl` is provided.
- Basic authentication when `tokenUrl` is not provided.

For SAP BTP service keys, the frontend can auto-fill:

- `url`
- `tokenurl`
- `clientid`
- `clientsecret`

The app stores CPI connection history in browser `localStorage` for convenience.

## Environment Variables

The example environment file is `.env.example`.

```env
GEMINI_API_KEY="MY_GEMINI_API_KEY"
APP_URL="MY_APP_URL"
```

At the moment, the core CPI renaming workflow does not depend on Gemini. These variables are included from the AI Studio scaffold and may be useful if AI-assisted features are added later.

For local development, create `.env.local` if you need local environment values.

## Local Development

### Prerequisites

- Node.js
- npm

This project currently uses dependencies that expect a modern Node.js runtime. If you see engine warnings, upgrade Node.js to the version required by the installed packages.

### Install Dependencies

```bash
npm install
```

For a clean install using the lockfile:

```bash
npm ci
```

### Run The App

```bash
npm run dev
```

The app runs at:

```text
http://localhost:3000
```

The dev command starts the Express server from `server.ts`. In development mode, the Express server also mounts Vite middleware for the React frontend.

### Type Check

```bash
npm run lint
```

This runs:

```bash
tsc --noEmit
```

### Production Build

```bash
npm run build
```

The build command:

1. Builds the React frontend using Vite.
2. Bundles `server.ts` using esbuild.

### Start Production Build

```bash
npm start
```

This starts the bundled server from:

```text
dist/server.cjs
```

## Important Implementation Details

- Script files are detected only when they are inside `src/main/resources/script/`.
- Integration flow files are detected when they are `.iflw` files inside `src/main/resources/scenarioflows/integrationflow/`.
- Script references are updated using escaped regular expressions to avoid accidental regex syntax issues.
- The app updates references in `.iflw`, `.xml`, `.prop`, and `.mf` files.
- If no scripts are found, the UI shows a message and lets the user select a different artifact.
- When using CPI API mode, credentials are sent only to the local backend route for the current request.

## Known Notes

- `npm run build` may show a warning because `server.ts` uses `import.meta.url` while the current server bundle is emitted as CommonJS. Development mode works normally, but the production server bundle may need to be changed to ESM or adjusted to avoid `import.meta.url`.
- The README from the original AI Studio scaffold has been replaced with project-specific documentation.

## Common Commands

```bash
npm ci
npm run dev
npm run lint
npm run build
npm start
```

## Recommended Next Improvements

- Add validation to prevent duplicate or empty script names.
- Add unit tests for ZIP rename and reference replacement behavior.
- Split large UI and ZIP-processing logic out of `src/App.tsx`.
- Fix the production server bundle warning.
- Add clearer CPI upload success and failure states in the UI.
