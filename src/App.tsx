import React, { useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CloudCog,
  Download,
  FileArchive,
  FileCode2,
  Info,
  Lock,
  RefreshCw,
  Server,
  Settings,
  ShieldCheck,
  UploadCloud,
  User,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from './lib/utils';

type ScriptFile = {
  originalPath: string;
  originalName: string;
  newName: string;
  zipObject: JSZip.JSZipObject;
  stepNames: string[];
};

type CpiConfig = {
  url: string;
  tokenUrl: string;
  username: string;
  password?: string;
  iflowId: string;
};

type UnusedResource = {
  name: string;
  path: string;
};

type Notice = {
  tone: 'success' | 'warning' | 'error';
  title: string;
  message: string;
};

type ApiErrors = Partial<Record<keyof CpiConfig, string>>;

const emptyConfig: CpiConfig = { url: '', tokenUrl: '', username: '', password: '', iflowId: '' };

function isValidHttpsUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function getApiErrors(config: CpiConfig): ApiErrors {
  const errors: ApiErrors = {};
  const trimmedUrl = config.url.trim();
  const trimmedTokenUrl = config.tokenUrl.trim();

  if (!trimmedUrl) {
    errors.url = 'API URL is required.';
  } else if (!isValidHttpsUrl(trimmedUrl)) {
    errors.url = 'Enter a valid HTTPS API URL.';
  }

  if (trimmedTokenUrl && !isValidHttpsUrl(trimmedTokenUrl)) {
    errors.tokenUrl = 'Token URL must be a valid HTTPS URL.';
  }

  if (!config.username.trim()) {
    errors.username = 'Client ID is required.';
  }

  if (!config.password?.trim()) {
    errors.password = 'Client secret is required for CPI API access.';
  }

  if (!config.iflowId.trim()) {
    errors.iflowId = 'iFlow ID is required.';
  }

  return errors;
}

function getScriptNameWarnings(script: ScriptFile, scripts: ScriptFile[]) {
  const warnings: string[] = [];
  const nextName = script.newName.trim();

  if (!nextName) {
    warnings.push('Script name cannot be empty.');
    return warnings;
  }

  if (/[\\/]/.test(nextName)) {
    warnings.push('Use a file name only, not a folder path.');
  }

  if (!/\.(groovy|js)$/i.test(nextName)) {
    warnings.push('Use a .groovy or .js extension.');
  }

  const duplicateCount = scripts.filter(item => item.newName.trim().toLowerCase() === nextName.toLowerCase()).length;
  if (duplicateCount > 1) {
    warnings.push('This new script name is duplicated.');
  }

  return warnings;
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [iFlowName, setIFlowName] = useState('');
  const [scripts, setScripts] = useState<ScriptFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [zipInstance, setZipInstance] = useState<JSZip | null>(null);
  const [unusedResources, setUnusedResources] = useState<UnusedResource[] | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [formSubmitted, setFormSubmitted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<'upload' | 'api'>('upload');
  const [serviceKeyJson, setServiceKeyJson] = useState('');

  const [cpiConfig, setCpiConfig] = useState<CpiConfig>(() => {
    const sessionSaved = sessionStorage.getItem('sap-cpi-config');
    if (sessionSaved) {
      try {
        return JSON.parse(sessionSaved);
      } catch (e) {}
    }

    const localSaved = localStorage.getItem('sap-cpi-config');
    if (localSaved) {
      try {
        const parsed = JSON.parse(localSaved);
        const { password, ...safeConfig } = parsed;
        localStorage.setItem('sap-cpi-config', JSON.stringify(safeConfig));
        return { ...safeConfig, password: '' };
      } catch (e) {}
    }

    return emptyConfig;
  });

  const [configHistory, setConfigHistory] = useState(() => {
    const saved = localStorage.getItem('sap-cpi-history');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }

    return { urls: [] as string[], tokenUrls: [] as string[], usernames: [] as string[], iflowIds: [] as string[] };
  });

  const [isApiLoading, setIsApiLoading] = useState(false);
  const [isApiDeployed, setIsApiDeployed] = useState(false);
  const [loadedFromApi, setLoadedFromApi] = useState(false);

  const apiErrors = useMemo(() => getApiErrors(cpiConfig), [cpiConfig]);
  const hasApiErrors = Object.keys(apiErrors).length > 0;
  const scriptWarnings = useMemo(() => scripts.map(script => getScriptNameWarnings(script, scripts)), [scripts]);
  const hasScriptWarnings = scriptWarnings.some(warnings => warnings.length > 0);
  const hasScriptChanges = scripts.some(script => script.newName.trim() && script.newName.trim() !== script.originalName);
  const canProcessScripts = scripts.length > 0 && hasScriptChanges && !hasScriptWarnings && !isProcessing;

  const saveConfigToStorage = (config: CpiConfig) => {
    sessionStorage.setItem('sap-cpi-config', JSON.stringify(config));

    const { password, ...safeConfig } = config;
    localStorage.setItem('sap-cpi-config', JSON.stringify(safeConfig));
  };

  const updateHistory = (newConfig: CpiConfig) => {
    setConfigHistory(prev => {
      const addToSet = (arr: string[] = [], item: string) => {
        if (!item) return arr;
        const newArr = [item, ...arr.filter(a => a !== item)];
        return newArr.slice(0, 10);
      };

      const newHistory = {
        urls: addToSet(prev.urls, newConfig.url),
        tokenUrls: addToSet(prev.tokenUrls, newConfig.tokenUrl),
        usernames: addToSet(prev.usernames, newConfig.username),
        iflowIds: addToSet(prev.iflowIds, newConfig.iflowId),
      };
      localStorage.setItem('sap-cpi-history', JSON.stringify(newHistory));
      return newHistory;
    });
  };

  const parseServiceKey = () => {
    if (!serviceKeyJson.trim()) return;

    try {
      const parsed = JSON.parse(serviceKeyJson);
      const oauth = parsed.oauth || parsed;

      let newUrl = oauth.url || cpiConfig.url;
      if (newUrl && !newUrl.includes('/api/v1')) {
        newUrl = newUrl.replace(/\/$/, '') + '/api/v1';
      }

      setCpiConfig(prev => ({
        ...prev,
        url: newUrl,
        tokenUrl: oauth.tokenurl || prev.tokenUrl,
        username: oauth.clientid || prev.username,
        password: oauth.clientsecret || prev.password,
      }));
      setServiceKeyJson('');
      setNotice({
        tone: 'success',
        title: 'Service key parsed',
        message: 'The CPI connection fields were filled from the service key. Review them before downloading the artifact.',
      });
    } catch (e) {
      setNotice({
        tone: 'error',
        title: 'Invalid service key',
        message: 'The pasted service key is not valid JSON. Check the format and try again.',
      });
    }
  };

  const handleFileUpload = async (uploadedFile: File | Blob, fileName: string, source: 'local' | 'api' = 'local') => {
    if (!fileName.toLowerCase().endsWith('.zip')) {
      setNotice({
        tone: 'warning',
        title: 'ZIP file required',
        message: 'Select an exported SAP CPI iFlow ZIP file before continuing.',
      });
      return;
    }

    setIsApiLoading(false);
    try {
      const zip = new JSZip();
      const loadedZip = await zip.loadAsync(uploadedFile);
      const scriptToStepMap: Record<string, string[]> = {};

      const iflwFiles = Object.values(loadedZip.files).filter(
        f => !f.dir && f.name.startsWith('src/main/resources/scenarioflows/integrationflow/') && f.name.endsWith('.iflw')
      );

      for (const iflw of iflwFiles) {
        const xmlContent = await iflw.async('string');
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlContent, 'application/xml');
        const allElements = xmlDoc.getElementsByTagName('*');

        for (let i = 0; i < allElements.length; i++) {
          const el = allElements[i];
          let scriptPath = '';

          if (el.localName === 'value' || el.tagName.toLowerCase() === 'value' || el.tagName.endsWith(':value')) {
            const valText = el.textContent?.trim() || '';
            if (valText.endsWith('.groovy') || valText.endsWith('.js')) {
              scriptPath = valText;
            }
          }

          if (scriptPath) {
            const scriptFile = scriptPath.split('/').pop() || '';
            let current: HTMLElement | Element | null = el.parentElement;
            let stepName = '';

            while (current) {
              const tagName = (current.localName || current.tagName).toLowerCase();
              if (tagName.includes('process') || tagName.includes('collaboration') || tagName.includes('participant')) {
                break;
              }
              if (current.hasAttribute('name')) {
                stepName = current.getAttribute('name') || '';
                if (stepName) break;
              }
              current = current.parentElement;
            }

            if (stepName && scriptFile) {
              if (!scriptToStepMap[scriptFile]) scriptToStepMap[scriptFile] = [];
              if (!scriptToStepMap[scriptFile].includes(stepName)) {
                scriptToStepMap[scriptFile].push(stepName);
              }
            }
          }
        }
      }

      const scriptFiles: ScriptFile[] = [];
      loadedZip.forEach((relativePath, zipEntry) => {
        if (!zipEntry.dir && relativePath.startsWith('src/main/resources/script/')) {
          const parts = relativePath.split('/');
          const originalName = parts[parts.length - 1];
          scriptFiles.push({
            originalPath: relativePath,
            originalName,
            newName: originalName,
            zipObject: zipEntry,
            stepNames: scriptToStepMap[originalName] || [],
          });
        }
      });

      const definitions = Object.values(loadedZip.files).filter(
        f => !f.dir && (
          (f.name.startsWith('src/main/resources/scenarioflows/integrationflow/') && f.name.endsWith('.iflw')) ||
          f.name.endsWith('.mmap') ||
          f.name.endsWith('.xslt') ||
          f.name.endsWith('.edmx') ||
          f.name.endsWith('.prop') ||
          f.name.endsWith('.xml')
        )
      );

      const defTexts: Record<string, string> = {};
      for (const def of definitions) {
        defTexts[def.name] = await def.async('string');
      }

      const candidateResources = Object.values(loadedZip.files).filter(
        f => !f.dir &&
          f.name.startsWith('src/main/resources/') &&
          !f.name.startsWith('src/main/resources/scenarioflows/') &&
          f.name !== 'src/main/resources/parameters.prop'
      );

      const unused: UnusedResource[] = [];
      candidateResources.forEach(res => {
        const parts = res.name.split('/');
        const shortName = parts[parts.length - 1];
        if (!shortName) return;

        const isUsed = Object.entries(defTexts).some(([defName, text]) => defName !== res.name && text.includes(shortName));
        if (!isUsed) {
          unused.push({ name: shortName, path: res.name });
        }
      });

      setFile(uploadedFile as File);
      setIFlowName(fileName);
      setZipInstance(loadedZip);
      setScripts(scriptFiles);
      setUnusedResources(unused);
      setLoadedFromApi(source === 'api');
      setIsApiDeployed(false);
      setNotice({
        tone: 'success',
        title: source === 'api' ? 'iFlow downloaded' : 'Artifact uploaded',
        message: `${fileName} is ready. Found ${scriptFiles.length} script${scriptFiles.length === 1 ? '' : 's'} and ${unused.length} unused resource${unused.length === 1 ? '' : 's'}.`,
      });
    } catch (error) {
      console.error('Error reading zip file:', error);
      setNotice({
        tone: 'error',
        title: 'Could not read artifact',
        message: 'Make sure the selected file is a valid SAP CPI iFlow ZIP export.',
      });
      resetState();
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0], e.dataTransfer.files[0].name);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileUpload(e.target.files[0], e.target.files[0].name);
    }
  };

  const fetchFromApi = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setFormSubmitted(true);

    if (hasApiErrors) {
      setNotice({
        tone: 'warning',
        title: 'Check CPI details',
        message: 'Fix the highlighted connection fields before downloading the iFlow artifact.',
      });
      return;
    }

    saveConfigToStorage(cpiConfig);
    updateHistory(cpiConfig);
    setIsApiLoading(true);
    try {
      const response = await fetch('/api/cpi/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cpiUrl: cpiConfig.url.trim(),
          tokenUrl: cpiConfig.tokenUrl.trim(),
          username: cpiConfig.username.trim(),
          password: cpiConfig.password,
          iflowId: cpiConfig.iflowId.trim(),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMsg = `Server error ${response.status}: ${errorText.substring(0, 100)}`;
        try {
          const errorData = JSON.parse(errorText);
          errorMsg = errorData.error || errorMsg;
        } catch (e) {}
        throw new Error(errorMsg);
      }

      const blob = await response.blob();
      await handleFileUpload(blob, `${cpiConfig.iflowId.trim()}.zip`, 'api');
    } catch (error: any) {
      console.error(error);
      setNotice({
        tone: 'error',
        title: 'CPI download failed',
        message: error.message,
      });
      setIsApiLoading(false);
    }
  };

  const updateNewName = (index: number, newName: string) => {
    const updated = [...scripts];
    updated[index].newName = newName;
    setScripts(updated);
  };

  const resetState = () => {
    setFile(null);
    setIFlowName('');
    setScripts([]);
    setZipInstance(null);
    setUnusedResources(null);
    setLoadedFromApi(false);
    setIsApiDeployed(false);
    setFormSubmitted(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const processAction = async (action: 'download' | 'deploy') => {
    if (!zipInstance || scripts.length === 0) return;

    if (hasScriptWarnings) {
      setNotice({
        tone: 'warning',
        title: 'Fix script names',
        message: 'Resolve the script name warnings before generating or deploying the updated artifact.',
      });
      return;
    }

    const scriptRenames = scripts
      .map(script => ({ ...script, newName: script.newName.trim() }))
      .filter(script => script.originalName !== script.newName);

    if (scriptRenames.length === 0) {
      setNotice({
        tone: 'warning',
        title: 'No script changes',
        message: 'Rename at least one script before downloading or deploying.',
      });
      return;
    }

    setIsProcessing(true);
    try {
      const newZip = new JSZip();
      const allPaths = Object.keys(zipInstance.files);

      for (const path of allPaths) {
        const fileEntry = zipInstance.files[path];
        if (fileEntry.dir) continue;

        const matchingScript = scriptRenames.find(s => s.originalPath === path);
        if (matchingScript) {
          const newPath = path.replace(matchingScript.originalName, matchingScript.newName);
          const content = await fileEntry.async('uint8array');
          newZip.file(newPath, content);
          continue;
        }

        if (path.startsWith('src/main/resources/scenarioflows/integrationflow/') && path.endsWith('.iflw')) {
          let xmlContent = await fileEntry.async('string');
          scriptRenames.forEach(renameInfo => {
            const regex = new RegExp(`\\b${escapeRegExp(renameInfo.originalName)}\\b`, 'g');
            xmlContent = xmlContent.replace(regex, renameInfo.newName);
          });
          newZip.file(path, xmlContent);
          continue;
        }

        if (path.endsWith('.prop') || path.endsWith('.xml') || path.endsWith('.mf')) {
          let textContent = await fileEntry.async('string');
          scriptRenames.forEach(renameInfo => {
            const regex = new RegExp(`\\b${escapeRegExp(renameInfo.originalName)}\\b`, 'g');
            textContent = textContent.replace(regex, renameInfo.newName);
          });
          newZip.file(path, textContent);
          continue;
        }

        const content = await fileEntry.async('uint8array');
        newZip.file(path, content);
      }

      if (action === 'download') {
        const generatedBlob = await newZip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        const downloadName = iFlowName.replace('.zip', '') + '_modified.zip';
        saveAs(generatedBlob, downloadName);
        setNotice({
          tone: 'success',
          title: 'Modified ZIP ready',
          message: `${downloadName} was generated with ${scriptRenames.length} renamed script${scriptRenames.length === 1 ? '' : 's'}.`,
        });
      } else if (action === 'deploy') {
        saveConfigToStorage(cpiConfig);
        updateHistory(cpiConfig);
        const base64Zip = await newZip.generateAsync({ type: 'base64', compression: 'DEFLATE' });

        const response = await fetch('/api/cpi/upload', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cpiUrl: cpiConfig.url.trim(),
            tokenUrl: cpiConfig.tokenUrl.trim(),
            username: cpiConfig.username.trim(),
            password: cpiConfig.password,
            iflowId: cpiConfig.iflowId.trim(),
            zipData: base64Zip,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          let errorMsg = `Server error ${response.status}: ${errorText.substring(0, 100)}`;
          try {
            const errorData = JSON.parse(errorText);
            errorMsg = errorData.error || errorMsg;
          } catch (e) {}
          throw new Error(errorMsg);
        }

        setIsApiDeployed(true);
        setNotice({
          tone: 'success',
          title: 'iFlow deployed',
          message: 'The updated artifact was uploaded to SAP CPI successfully.',
        });
      }
    } catch (error: any) {
      console.error('Error processing zip:', error);
      setNotice({
        tone: 'error',
        title: 'Processing failed',
        message: error.message,
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const escapeRegExp = (string: string) => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  const fieldError = (field: keyof CpiConfig) => {
    if (field === 'url' || field === 'tokenUrl') {
      return cpiConfig[field].trim() || formSubmitted ? apiErrors[field] : undefined;
    }
    return formSubmitted ? apiErrors[field] : undefined;
  };

  const inputClassName = (error?: string) => cn(
    'w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-neutral-900 shadow-sm transition',
    'placeholder:text-neutral-400 focus:outline-none focus:ring-2',
    error
      ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-100'
      : 'border-neutral-200 focus:border-teal-600 focus:ring-teal-100'
  );

  const renderFieldError = (error?: string) => error ? (
    <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-rose-600">
      <AlertTriangle className="h-3.5 w-3.5" />
      {error}
    </p>
  ) : null;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f5f7f5] text-neutral-950 font-sans selection:bg-teal-100 selection:text-teal-900">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-28 top-16 h-72 w-96 rotate-[-18deg] rounded-lg bg-white/80 shadow-sm" />
        <div className="absolute left-[38%] top-20 h-48 w-48 rotate-[12deg] rounded-lg bg-teal-50/80" />
        <div className="absolute right-[-8rem] top-8 h-80 w-[34rem] rotate-[18deg] rounded-lg bg-white/90 shadow-sm" />
        <div className="absolute bottom-[-8rem] left-[8%] h-64 w-[32rem] rotate-[10deg] rounded-lg bg-white/75 shadow-sm" />
      </div>

      <header className="relative border-b border-white/80 bg-white/75 px-5 py-5 backdrop-blur sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-neutral-950 text-white shadow-sm">
              <CloudCog className="h-6 w-6" strokeWidth={2} />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">SAP CPI Flow Renamer</h1>
              <p className="text-sm font-medium text-neutral-500">Rename scripts, validate references, and review unused resources.</p>
            </div>
          </div>
          {file && (
            <button
              onClick={resetState}
              className="inline-flex items-center justify-center rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 shadow-sm transition hover:border-neutral-300 hover:bg-neutral-50"
            >
              Start Over
            </button>
          )}
        </div>
      </header>

      <main className="relative mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:py-10">
        <AnimatePresence mode="wait">
          {!file ? (
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]"
            >
              <section className="rounded-lg border border-white bg-white/90 p-5 shadow-sm sm:p-7">
                <div className="mb-6 flex w-full rounded-lg border border-neutral-200 bg-neutral-100 p-1">
                  <button
                    onClick={() => setActiveTab('api')}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition',
                      activeTab === 'api' ? 'bg-white text-neutral-950 shadow-sm' : 'text-neutral-500 hover:text-neutral-800'
                    )}
                  >
                    <Server className="h-4 w-4" />
                    Connect to CPI
                  </button>
                  <button
                    onClick={() => setActiveTab('upload')}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition',
                      activeTab === 'upload' ? 'bg-white text-neutral-950 shadow-sm' : 'text-neutral-500 hover:text-neutral-800'
                    )}
                  >
                    <FileArchive className="h-4 w-4" />
                    Upload Local ZIP
                  </button>
                </div>

                {activeTab === 'api' ? (
                  <form onSubmit={fetchFromApi} className="space-y-5">
                    <div className="flex items-start gap-3 border-b border-neutral-100 pb-5">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
                        <Settings className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="text-lg font-semibold">SAP BTP Service Key Credentials</h2>
                        <p className="mt-1 text-sm text-neutral-500">Paste a service key or enter the CPI API details manually.</p>
                      </div>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-semibold text-neutral-700">Auto-fill from Service Key</label>
                      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                        <textarea
                          value={serviceKeyJson}
                          onChange={e => setServiceKeyJson(e.target.value)}
                          className="min-h-24 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-mono leading-relaxed text-neutral-900 shadow-sm outline-none transition placeholder:text-neutral-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
                          placeholder='{"oauth": { "clientid": "...", "clientsecret": "...", "url": "...", "tokenurl": "..." }}'
                        />
                        <button
                          type="button"
                          onClick={parseServiceKey}
                          className="rounded-lg border border-neutral-200 bg-neutral-950 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-800 sm:self-start"
                        >
                          Auto Fill
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-sm font-semibold text-neutral-700">API URL</label>
                      <div className="relative">
                        <Server className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-neutral-400" />
                        <input
                          name="cpiUrl"
                          list="cpiUrlHistory"
                          autoComplete="url"
                          type="url"
                          value={cpiConfig.url}
                          onChange={e => setCpiConfig(prev => ({ ...prev, url: e.target.value }))}
                          className={cn(inputClassName(fieldError('url')), 'pl-10')}
                          placeholder="https://...hana.ondemand.com/api/v1"
                        />
                        <datalist id="cpiUrlHistory">
                          {configHistory.urls?.map((h, i) => <option key={i} value={h} />)}
                        </datalist>
                      </div>
                      {renderFieldError(fieldError('url'))}
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-sm font-semibold text-neutral-700">Token URL</label>
                        <div className="relative">
                          <CloudCog className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-neutral-400" />
                          <input
                            name="tokenUrl"
                            list="tokenUrlHistory"
                            autoComplete="url"
                            type="url"
                            value={cpiConfig.tokenUrl}
                            onChange={e => setCpiConfig(prev => ({ ...prev, tokenUrl: e.target.value }))}
                            className={cn(inputClassName(fieldError('tokenUrl')), 'pl-10')}
                            placeholder="https://.../oauth/token"
                          />
                          <datalist id="tokenUrlHistory">
                            {configHistory.tokenUrls?.map((h, i) => <option key={i} value={h} />)}
                          </datalist>
                        </div>
                        {renderFieldError(fieldError('tokenUrl'))}
                      </div>
                      <div>
                        <label className="mb-1.5 block text-sm font-semibold text-neutral-700">Client ID</label>
                        <div className="relative">
                          <User className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-neutral-400" />
                          <input
                            name="username"
                            list="usernameHistory"
                            autoComplete="username"
                            type="text"
                            value={cpiConfig.username}
                            onChange={e => setCpiConfig(prev => ({ ...prev, username: e.target.value }))}
                            className={cn(inputClassName(fieldError('username')), 'pl-10')}
                            placeholder="Client ID"
                          />
                          <datalist id="usernameHistory">
                            {configHistory.usernames?.map((h, i) => <option key={i} value={h} />)}
                          </datalist>
                        </div>
                        {renderFieldError(fieldError('username'))}
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-sm font-semibold text-neutral-700">Client Secret</label>
                        <div className="relative">
                          <Lock className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-neutral-400" />
                          <input
                            name="password"
                            autoComplete="current-password"
                            type="password"
                            value={cpiConfig.password}
                            onChange={e => setCpiConfig(prev => ({ ...prev, password: e.target.value }))}
                            className={cn(inputClassName(fieldError('password')), 'pl-10')}
                            placeholder="Client Secret"
                          />
                        </div>
                        {renderFieldError(fieldError('password'))}
                      </div>
                      <div>
                        <label className="mb-1.5 block text-sm font-semibold text-neutral-700">iFlow ID</label>
                        <input
                          name="iflowId"
                          list="iflowIdHistory"
                          autoComplete="on"
                          type="text"
                          value={cpiConfig.iflowId}
                          onChange={e => setCpiConfig(prev => ({ ...prev, iflowId: e.target.value }))}
                          className={cn(inputClassName(fieldError('iflowId')), 'font-mono')}
                          placeholder="e.g. EmployeeSyncFlow"
                        />
                        <datalist id="iflowIdHistory">
                          {configHistory.iflowIds?.map((h, i) => <option key={i} value={h} />)}
                        </datalist>
                        {renderFieldError(fieldError('iflowId'))}
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={isApiLoading}
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-neutral-950 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
                    >
                      {isApiLoading ? (
                        <>
                          <RefreshCw className="h-4 w-4 animate-spin" />
                          Connecting to SAP CPI...
                        </>
                      ) : (
                        <>
                          <CloudCog className="h-4 w-4" />
                          Download Sandbox Artifact
                        </>
                      )}
                    </button>
                  </form>
                ) : (
                  <div
                    onDrop={handleDrop}
                    onDragOver={e => {
                      e.preventDefault();
                      setIsDragOver(true);
                    }}
                    onDragLeave={() => setIsDragOver(false)}
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      'flex min-h-[25rem] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition sm:p-12',
                      isDragOver ? 'border-teal-500 bg-teal-50' : 'border-neutral-200 bg-white hover:border-teal-400 hover:bg-teal-50/40'
                    )}
                  >
                    <div className={cn(
                      'mb-5 flex h-16 w-16 items-center justify-center rounded-lg transition',
                      isDragOver ? 'bg-teal-100 text-teal-700' : 'bg-neutral-100 text-neutral-500'
                    )}>
                      <UploadCloud className="h-8 w-8" />
                    </div>
                    <h2 className="text-2xl font-semibold tracking-tight">Upload iFlow ZIP</h2>
                    <p className="mt-3 max-w-md text-sm leading-6 text-neutral-500">
                      Drop an exported SAP CPI integration flow ZIP here. The app will scan scripts, step references, and unused resources before you rename anything.
                    </p>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      accept=".zip"
                      className="hidden"
                    />
                    <button className="mt-6 rounded-lg border border-neutral-200 bg-white px-5 py-2.5 text-sm font-semibold text-neutral-800 shadow-sm transition hover:border-neutral-300 hover:bg-neutral-50">
                      Select ZIP File
                    </button>
                  </div>
                )}
              </section>

              <aside className="rounded-lg border border-white bg-white/90 p-5 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="font-semibold">Ready Checks</h2>
                    <p className="text-sm text-neutral-500">What the app validates before output.</p>
                  </div>
                </div>
                <div className="mt-6 space-y-4 text-sm">
                  {[
                    'Accepts ZIP artifacts only',
                    'Warns on empty script names',
                    'Blocks duplicated script names',
                    'Checks .groovy and .js extensions',
                    'Shows unused resource analysis separately',
                  ].map(item => (
                    <div key={item} className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-teal-700" />
                      <span className="text-neutral-700">{item}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-7 rounded-lg border border-teal-100 bg-teal-50 px-4 py-3 text-sm text-teal-900">
                  Credentials are sent only when API mode is used. Client secrets are not saved in persistent local storage.
                </div>
              </aside>
            </motion.div>
          ) : (
            <motion.div
              key="editor"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <section className="flex flex-col gap-4 rounded-lg border border-white bg-white/90 p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm font-semibold text-neutral-700 shadow-sm">
                      {loadedFromApi ? <CloudCog className="h-4 w-4 text-teal-700" /> : <FileArchive className="h-4 w-4 text-neutral-500" />}
                      {loadedFromApi ? `iFlow: ${cpiConfig.iflowId}` : iFlowName}
                    </span>
                    <span className="rounded-lg bg-neutral-100 px-3 py-1.5 text-sm font-semibold text-neutral-600">
                      {scripts.length} script{scripts.length !== 1 && 's'}
                    </span>
                    <span className={cn(
                      'rounded-lg px-3 py-1.5 text-sm font-semibold',
                      hasScriptWarnings ? 'bg-amber-100 text-amber-800' : 'bg-teal-100 text-teal-800'
                    )}>
                      {hasScriptWarnings ? 'Warnings need review' : 'Names look valid'}
                    </span>
                  </div>
                </div>
                <div className="text-sm text-neutral-500">
                  {unusedResources?.length ?? 0} unused resource{(unusedResources?.length ?? 0) === 1 ? '' : 's'} detected
                </div>
              </section>

              <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
                <section className="rounded-lg border border-white bg-white/90 shadow-sm">
                  <div className="flex flex-col gap-2 border-b border-neutral-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="font-semibold">Script Rename Workspace</h2>
                      <p className="mt-1 text-sm text-neutral-500">Edit script names and keep references synchronized in the generated artifact.</p>
                    </div>
                    {hasScriptWarnings && (
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Fix warnings
                      </span>
                    )}
                  </div>

                  {scripts.length === 0 ? (
                    <div className="px-6 py-14 text-center">
                      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                        <FileCode2 className="h-6 w-6" />
                      </div>
                      <h3 className="text-lg font-semibold">No scripts found</h3>
                      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-neutral-500">
                        The selected artifact does not contain scripts in <code>src/main/resources/script/</code>.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="hidden grid-cols-12 gap-4 border-b border-neutral-100 bg-neutral-50 px-5 py-3 text-xs font-semibold uppercase text-neutral-500 md:grid">
                        <div className="col-span-5">Original script and step</div>
                        <div className="col-span-1" />
                        <div className="col-span-6">New script name</div>
                      </div>

                      <div className="divide-y divide-neutral-100">
                        {scripts.map((script, idx) => {
                          const warnings = scriptWarnings[idx];
                          return (
                            <div key={script.originalPath} className="grid gap-4 px-5 py-4 transition hover:bg-neutral-50 md:grid-cols-12 md:items-start">
                              <div className="md:col-span-5">
                                <div className="flex min-w-0 items-center gap-3">
                                  <FileCode2 className="h-4 w-4 shrink-0 text-neutral-400" />
                                  <span className="truncate font-mono text-sm font-semibold text-neutral-800" title={script.originalName}>
                                    {script.originalName}
                                  </span>
                                </div>
                                {script.stepNames.length > 0 ? (
                                  <div className="mt-2 flex flex-wrap gap-1.5 pl-7">
                                    {script.stepNames.map(stepName => (
                                      <span key={stepName} className="max-w-[14rem] truncate rounded-md border border-teal-100 bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-800" title={`Step: ${stepName}`}>
                                        {stepName}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="mt-2 pl-7 text-xs text-neutral-400">No step reference detected</p>
                                )}
                              </div>

                              <div className="hidden justify-center md:col-span-1 md:flex">
                                <ArrowRight className="mt-2 h-4 w-4 text-neutral-300" />
                              </div>

                              <div className="md:col-span-6">
                                <input
                                  type="text"
                                  value={script.newName}
                                  onChange={e => updateNewName(idx, e.target.value)}
                                  onFocus={e => {
                                    const dotIndex = e.target.value.lastIndexOf('.');
                                    if (dotIndex > 0) {
                                      e.target.setSelectionRange(0, dotIndex);
                                    }
                                  }}
                                  className={cn(
                                    'w-full rounded-lg border px-3 py-2.5 font-mono text-sm shadow-sm outline-none transition focus:ring-2',
                                    warnings.length > 0
                                      ? 'border-amber-300 bg-amber-50 text-amber-950 focus:border-amber-500 focus:ring-amber-100'
                                      : script.newName !== script.originalName
                                        ? 'border-teal-200 bg-teal-50 text-teal-950 focus:border-teal-600 focus:ring-teal-100'
                                        : 'border-neutral-200 bg-white text-neutral-800 focus:border-teal-600 focus:ring-teal-100'
                                  )}
                                  placeholder="Enter new name..."
                                />
                                {warnings.length > 0 && (
                                  <div className="mt-2 space-y-1">
                                    {warnings.map(warning => (
                                      <p key={warning} className="flex items-center gap-1.5 text-xs font-semibold text-amber-700">
                                        <AlertTriangle className="h-3.5 w-3.5" />
                                        {warning}
                                      </p>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="flex flex-col gap-3 border-t border-neutral-100 bg-neutral-50 px-5 py-4 sm:flex-row sm:justify-end">
                        <button
                          onClick={() => processAction('download')}
                          disabled={!canProcessScripts}
                          className={cn(
                            'inline-flex items-center justify-center gap-2 rounded-lg border px-5 py-2.5 text-sm font-semibold shadow-sm transition',
                            canProcessScripts
                              ? 'border-neutral-200 bg-white text-neutral-800 hover:border-neutral-300 hover:bg-neutral-50'
                              : 'cursor-not-allowed border-neutral-200 bg-white text-neutral-400'
                          )}
                        >
                          <Download className="h-4 w-4" />
                          Download ZIP
                        </button>
                        {loadedFromApi && (
                          <button
                            onClick={() => processAction('deploy')}
                            disabled={!canProcessScripts || isApiDeployed}
                            className={cn(
                              'inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold shadow-sm transition',
                              canProcessScripts && !isApiDeployed
                                ? 'bg-neutral-950 text-white hover:bg-neutral-800'
                                : 'cursor-not-allowed bg-neutral-300 text-white'
                            )}
                          >
                            {isProcessing ? (
                              <>
                                <RefreshCw className="h-4 w-4 animate-spin" />
                                Deploying...
                              </>
                            ) : isApiDeployed ? (
                              <>
                                <CheckCircle2 className="h-4 w-4" />
                                Deployed
                              </>
                            ) : (
                              <>
                                <CloudCog className="h-4 w-4" />
                                Deploy to CPI
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </section>

                <section className="rounded-lg border border-white bg-white/90 shadow-sm">
                  <div className="border-b border-neutral-100 px-5 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h2 className="font-semibold">Unused Resources</h2>
                        <p className="mt-1 text-sm text-neutral-500">Separate scan results for cleanup review.</p>
                      </div>
                      <span className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800">
                        {unusedResources?.length ?? 0} Found
                      </span>
                    </div>
                  </div>

                  {!unusedResources ? (
                    <div className="px-5 py-8 text-sm text-neutral-500">Upload an artifact to start the resource scan.</div>
                  ) : unusedResources.length === 0 ? (
                    <div className="px-5 py-8 text-center">
                      <CheckCircle2 className="mx-auto h-8 w-8 text-teal-700" />
                      <p className="mt-3 text-sm font-semibold text-neutral-700">All scanned resources appear to be used.</p>
                    </div>
                  ) : (
                    <div className="max-h-[34rem] divide-y divide-neutral-100 overflow-y-auto">
                      {unusedResources.map(res => (
                        <div key={res.path} className="px-5 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-neutral-800" title={res.name}>{res.name}</p>
                              <p className="mt-1 break-all font-mono text-xs text-neutral-400">{res.path}</p>
                            </div>
                            <span className="shrink-0 rounded-md border border-amber-100 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                              Unused
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {notice && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/30 px-4 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              className="w-full max-w-md rounded-lg border border-white bg-white p-5 shadow-xl"
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
            >
              <div className="flex items-start gap-3">
                <div className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                  notice.tone === 'success' && 'bg-teal-100 text-teal-700',
                  notice.tone === 'warning' && 'bg-amber-100 text-amber-700',
                  notice.tone === 'error' && 'bg-rose-100 text-rose-700'
                )}>
                  {notice.tone === 'success' ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-semibold text-neutral-950">{notice.title}</h2>
                  <p className="mt-1 text-sm leading-6 text-neutral-600">{notice.message}</p>
                </div>
                <button
                  onClick={() => setNotice(null)}
                  className="rounded-lg p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
                  aria-label="Close notice"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="mt-5 flex justify-end">
                <button
                  onClick={() => setNotice(null)}
                  className="rounded-lg bg-neutral-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-800"
                >
                  Continue
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
