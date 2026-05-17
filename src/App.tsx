import React, { useState, useRef } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { 
  UploadCloud, 
  FileCode2, 
  ArrowRight, 
  Download, 
  RefreshCw, 
  Info,
  FileArchive,
  CloudCog,
  Server,
  Lock,
  User,
  Settings
} from 'lucide-react';
import { cn } from './lib/utils';
import { motion, AnimatePresence } from 'motion/react';

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
  username: string; // Used for clientId
  password?: string; // Used for clientSecret
  iflowId: string;
};

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [iFlowName, setIFlowName] = useState<string>('');
  const [scripts, setScripts] = useState<ScriptFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [zipInstance, setZipInstance] = useState<JSZip | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [activeTab, setActiveTab] = useState<'upload' | 'api'>('upload');
  const [serviceKeyJson, setServiceKeyJson] = useState("");

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
    } catch (e) {
      alert('Invalid Service Key JSON. Please check the format.');
    }
  };

  const [cpiConfig, setCpiConfig] = useState<CpiConfig>(() => {
    // Try to recover full config from session storage first
    const sessionSaved = sessionStorage.getItem('sap-cpi-config');
    if (sessionSaved) {
      try {
        return JSON.parse(sessionSaved);
      } catch (e) {}
    }
    
    // Fallback to local storage (which won't have the password)
    const localSaved = localStorage.getItem('sap-cpi-config');
    if (localSaved) {
      try {
        const parsed = JSON.parse(localSaved);
        // Ensure password is never restored from localStorage just in case it was saved before the security update
        return { ...parsed, password: '' };
      } catch (e) {}
    }
    return { url: '', tokenUrl: '', username: '', password: '', iflowId: '' };
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

  const saveConfigToStorage = (config: CpiConfig) => {
    // Save full config to session storage (cleared when tab closes)
    sessionStorage.setItem('sap-cpi-config', JSON.stringify(config));
    
    // Save non-sensitive data to local storage for convenience across sessions
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

  const [isApiLoading, setIsApiLoading] = useState(false);
  const [isApiDeployed, setIsApiDeployed] = useState(false);
  const [loadedFromApi, setLoadedFromApi] = useState(false);

  const handleFileUpload = async (uploadedFile: File | Blob, fileName: string) => {
    setFile(uploadedFile as File);
    setIFlowName(fileName);
    setIsApiLoading(false);
    try {
      const zip = new JSZip();
      const loadedZip = await zip.loadAsync(uploadedFile);
      setZipInstance(loadedZip);

      const scriptToStepMap: Record<string, string[]> = {};

      // Find and parse .iflw files to map scripts to step names
      const iflwFiles = Object.values(loadedZip.files).filter(
        f => !f.dir && f.name.startsWith('src/main/resources/scenarioflows/integrationflow/') && f.name.endsWith('.iflw')
      );

      for (const iflw of iflwFiles) {
        const xmlContent = await iflw.async('string');
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlContent, "application/xml");
        
        // Find all tags that might be <key> or <value>
        // Instead of relying strictly on the <key> text matching 'script', let's also look for any <value> containing a .groovy or .js filename.
        const allElements = xmlDoc.getElementsByTagName("*");
        for (let i = 0; i < allElements.length; i++) {
          const el = allElements[i];
          
          let scriptPath = "";
          
          if (el.localName === "value" || el.tagName.toLowerCase() === "value" || el.tagName.endsWith(":value")) {
             const valText = el.textContent?.trim() || "";
             if (valText.endsWith(".groovy") || valText.endsWith(".js")) {
                 scriptPath = valText;
             }
          }
          
          if (scriptPath) {
            const scriptFile = scriptPath.split('/').pop() || "";
            
            let current: HTMLElement | Element | null = el.parentElement;
            let stepName = "";
            
            // Walk up the DOM tree and find the nearest parent with a "name" attribute that isn't a process/collaboration
            while (current) {
              const tagName = (current.localName || current.tagName).toLowerCase();
              if (tagName.includes("process") || tagName.includes("collaboration") || tagName.includes("participant")) {
                break;
              }
              if (current.hasAttribute("name")) {
                stepName = current.getAttribute("name") || "";
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

      setScripts(scriptFiles);
    } catch (error) {
      console.error('Error reading zip file:', error);
      alert('Failed to read the ZIP file. Please ensure it is a valid SAP CPI iFlow export.');
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

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileUpload(e.target.files[0], e.target.files[0].name);
    }
  };

  const fetchFromApi = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!cpiConfig.url || !cpiConfig.username || !cpiConfig.password || !cpiConfig.iflowId) {
      alert("Please fill in all API credentials.");
      return;
    }
    
    saveConfigToStorage(cpiConfig);
    updateHistory(cpiConfig);
    setIsApiLoading(true);
    try {
      const response = await fetch('/api/cpi/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          cpiUrl: cpiConfig.url,
          tokenUrl: cpiConfig.tokenUrl,
          username: cpiConfig.username,
          password: cpiConfig.password,
          iflowId: cpiConfig.iflowId
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        let errorMsg = `Server error ${response.status}: ${errorText.substring(0, 100)}`;
        try {
          const errorData = JSON.parse(errorText);
          errorMsg = errorData.error || errorMsg;
        } catch (e) {
          // ignore
        }
        throw new Error(errorMsg);
      }
      
      const blob = await response.blob();
      setLoadedFromApi(true);
      await handleFileUpload(blob, `${cpiConfig.iflowId}.zip`);
    } catch (error: any) {
      console.error(error);
      alert(error.message);
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
    setLoadedFromApi(false);
    setIsApiDeployed(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const processAction = async (action: 'download' | 'deploy') => {
    if (!zipInstance || scripts.length === 0) return;
    setIsProcessing(true);

    try {
      const newZip = new JSZip();

      // We need to keep track of renamed scripts mapping
      const scriptRenames = scripts.filter(s => s.originalName !== s.newName && s.newName.trim() !== '');

      if (scriptRenames.length === 0) {
        alert("No scripts were renamed.");
        setIsProcessing(false);
        return;
      }

      // Re-create the ZIP
      const allPaths = Object.keys(zipInstance.files);
      
      for (const path of allPaths) {
        const fileEntry = zipInstance.files[path];
        if (fileEntry.dir) continue;

        // Check if it's one of the renamed scripts
        const matchingScript = scriptRenames.find(s => s.originalPath === path);
        if (matchingScript) {
          const newPath = path.replace(matchingScript.originalName, matchingScript.newName);
          const content = await fileEntry.async('uint8array');
          newZip.file(newPath, content);
          continue;
        }

        // Check if it's the .iflw configuration file
        if (path.startsWith('src/main/resources/scenarioflows/integrationflow/') && path.endsWith('.iflw')) {
          let xmlContent = await fileEntry.async('string');
          scriptRenames.forEach(renameInfo => {
            const regex = new RegExp(`\\b${escapeRegExp(renameInfo.originalName)}\\b`, 'g');
            xmlContent = xmlContent.replace(regex, renameInfo.newName);
          });
          newZip.file(path, xmlContent);
          continue;
        }

        // Check if it's other configuration files
        if (path.endsWith('.prop') || path.endsWith('.xml') || path.endsWith('.mf')) {
           let textContent = await fileEntry.async('string');
           scriptRenames.forEach(renameInfo => {
             const regex = new RegExp(`\\b${escapeRegExp(renameInfo.originalName)}\\b`, 'g');
             textContent = textContent.replace(regex, renameInfo.newName);
           });
           newZip.file(path, textContent);
           continue;
        }

        // Otherwise copy as-is
        const content = await fileEntry.async('uint8array');
        newZip.file(path, content);
      }

      if (action === 'download') {
        const generatedBlob = await newZip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        const downloadName = iFlowName.replace('.zip', '') + '_modified.zip';
        saveAs(generatedBlob, downloadName);
      } else if (action === 'deploy') {
        saveConfigToStorage(cpiConfig);
        updateHistory(cpiConfig);
        const base64Zip = await newZip.generateAsync({ type: 'base64', compression: 'DEFLATE' });
        
        const response = await fetch('/api/cpi/upload', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            cpiUrl: cpiConfig.url,
            tokenUrl: cpiConfig.tokenUrl,
            username: cpiConfig.username,
            password: cpiConfig.password,
            iflowId: cpiConfig.iflowId,
            zipData: base64Zip
          })
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          let errorMsg = `Server error ${response.status}: ${errorText.substring(0, 100)}`;
          try {
            const errorData = JSON.parse(errorText);
            errorMsg = errorData.error || errorMsg;
          } catch (e) {
            // ignore
          }
          throw new Error(errorMsg);
        }
        
        setIsApiDeployed(true);
        alert("iFlow successfully updated in SAP CPI.");
      }

    } catch (error: any) {
      console.error('Error processing zip:', error);
      alert('An error occurred: ' + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const escapeRegExp = (string: string) => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans selection:bg-indigo-100 selection:text-indigo-900">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 py-6 px-6 sm:px-8">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-lg">
              <CloudCog className="w-6 h-6 text-white" strokeWidth={2} />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-neutral-900">SAP CPI Flow Renamer</h1>
              <p className="text-sm text-neutral-500 font-medium">Bulk rename your iFlow scripts directly via API or ZIP</p>
            </div>
          </div>
          {file && (
            <button
              onClick={resetState}
              className="text-sm px-4 py-2 text-neutral-600 hover:text-neutral-900 bg-neutral-100 hover:bg-neutral-200 rounded-md font-medium transition-colors"
            >
              Start Over
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-6 sm:px-8 py-12">
        <AnimatePresence mode="wait">
          {!file ? (
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="mt-4"
            >
              
              <div className="flex bg-neutral-100/80 p-1.5 rounded-xl border border-neutral-200 max-w-sm mx-auto mb-10 w-full">
                <button 
                  onClick={() => setActiveTab('api')}
                  className={cn(
                    "flex-1 px-4 py-2 text-sm font-medium rounded-lg flex items-center justify-center gap-2 transition-all",
                    activeTab === 'api' ? "bg-white shadow-sm text-indigo-700" : "text-neutral-500 hover:text-neutral-700"
                  )}
                >
                  <Server className="w-4 h-4" />
                  Connect to CPI
                </button>
                <button 
                  onClick={() => setActiveTab('upload')}
                  className={cn(
                    "flex-1 px-4 py-2 text-sm font-medium rounded-lg flex items-center justify-center gap-2 transition-all",
                    activeTab === 'upload' ? "bg-white shadow-sm text-indigo-700" : "text-neutral-500 hover:text-neutral-700"
                  )}
                >
                  <FileArchive className="w-4 h-4" />
                  Upload Local ZIP
                </button>
              </div>

              {activeTab === 'api' ? (
                <div className="bg-white border border-neutral-200 rounded-xl p-8 shadow-sm max-w-2xl mx-auto">
                   <div className="mb-6 flex items-center gap-3 border-b border-neutral-100 pb-4">
                     <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                       <Settings className="w-5 h-5" />
                     </div>
                     <div>
                       <h3 className="text-lg font-semibold text-neutral-900">SAP BTP Service Key Credentials</h3>
                       <p className="text-sm text-neutral-500">Provide the credentials from your Process Integration Runtime (api plan) service key.</p>
                     </div>
                   </div>

                   <form onSubmit={fetchFromApi} className="space-y-4">
                     <div className="bg-neutral-50 p-4 rounded-lg border border-neutral-200 mb-6">
                       <label className="block text-sm font-medium text-neutral-700 mb-2">Auto-fill from Service Key (Optional)</label>
                       <div className="flex gap-2">
                         <textarea
                           value={serviceKeyJson}
                           onChange={e => setServiceKeyJson(e.target.value)}
                           className="flex-1 px-3 py-2 text-sm border border-neutral-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono h-[4.5rem] resize-y leading-relaxed"
                           placeholder='{"oauth": { "clientid": "...", "clientsecret": "...", "url": "...", "tokenurl": "..." }}'
                         />
                         <button
                           type="button"
                           onClick={parseServiceKey}
                           className="bg-white text-indigo-600 px-4 rounded-lg text-sm font-medium border border-neutral-300 hover:bg-neutral-50 hover:text-indigo-700 transition shadow-sm whitespace-nowrap"
                         >
                           Auto Fill
                         </button>
                       </div>
                     </div>

                     <div>
                       <label className="block text-sm font-medium text-neutral-700 mb-1">API URL (<code className="text-xs">url</code>)</label>
                       <div className="relative">
                         <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-neutral-400">
                           <Server className="w-4 h-4" />
                         </div>
                         <input 
                           name="cpiUrl"
                           list="cpiUrlHistory"
                           autoComplete="url"
                           type="url"
                           value={cpiConfig.url}
                           onChange={e => setCpiConfig(prev => ({ ...prev, url: e.target.value }))}
                           className="pl-10 w-full px-3 py-2 text-sm border border-neutral-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" 
                           placeholder="https://...hana.ondemand.com/api/v1" 
                         />
                         <datalist id="cpiUrlHistory">
                           {configHistory.urls?.map((h, i) => <option key={i} value={h} />)}
                         </datalist>
                       </div>
                     </div>

                     <div className="grid grid-cols-2 gap-4">
                       <div>
                         <label className="block text-sm font-medium text-neutral-700 mb-1">Token URL (<code className="text-xs">tokenurl</code>)</label>
                         <div className="relative">
                           <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-neutral-400">
                             <CloudCog className="w-4 h-4" />
                           </div>
                           <input 
                             name="tokenUrl"
                             list="tokenUrlHistory"
                             autoComplete="url"
                             type="url"
                             value={cpiConfig.tokenUrl}
                             onChange={e => setCpiConfig(prev => ({ ...prev, tokenUrl: e.target.value }))}
                             className="pl-10 w-full px-3 py-2 text-sm border border-neutral-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                             placeholder="https://...authentication.eu10.hana.ondemand.com/oauth/token"
                           />
                           <datalist id="tokenUrlHistory">
                             {configHistory.tokenUrls?.map((h, i) => <option key={i} value={h} />)}
                           </datalist>
                         </div>
                       </div>
                       <div>
                         <label className="block text-sm font-medium text-neutral-700 mb-1">Client ID (<code className="text-xs">clientid</code>)</label>
                         <div className="relative">
                           <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-neutral-400">
                             <User className="w-4 h-4" />
                           </div>
                           <input 
                             name="username"
                             list="usernameHistory"
                             autoComplete="username"
                             type="text"
                             value={cpiConfig.username}
                             onChange={e => setCpiConfig(prev => ({ ...prev, username: e.target.value }))}
                             className="pl-10 w-full px-3 py-2 text-sm border border-neutral-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" 
                             placeholder="Client ID" 
                           />
                           <datalist id="usernameHistory">
                             {configHistory.usernames?.map((h, i) => <option key={i} value={h} />)}
                           </datalist>
                         </div>
                       </div>
                     </div>

                     <div className="grid grid-cols-2 gap-4">
                       <div>
                         <label className="block text-sm font-medium text-neutral-700 mb-1">Client Secret (<code className="text-xs">clientsecret</code>)</label>
                         <div className="relative">
                           <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-neutral-400">
                             <Lock className="w-4 h-4" />
                           </div>
                           <input 
                             name="password"
                             autoComplete="current-password"
                             type="password"
                             value={cpiConfig.password}
                             onChange={e => setCpiConfig(prev => ({ ...prev, password: e.target.value }))}
                             className="pl-10 w-full px-3 py-2 text-sm border border-neutral-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                             placeholder="Client Secret"
                           />
                         </div>
                       </div>
                       <div>
                         <label className="block text-sm font-medium text-neutral-700 mb-1">iFlow ID</label>
                         <input 
                           name="iflowId"
                           list="iflowIdHistory"
                           autoComplete="on"
                           type="text"
                           value={cpiConfig.iflowId}
                           onChange={e => setCpiConfig(prev => ({ ...prev, iflowId: e.target.value }))}
                           className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono" 
                           placeholder="e.g. EmployeeSyncFlow" 
                         />
                         <datalist id="iflowIdHistory">
                           {configHistory.iflowIds?.map((h, i) => <option key={i} value={h} />)}
                         </datalist>
                       </div>
                     </div>

                     <div className="mt-8">
                       <button
                         type="submit"
                         disabled={isApiLoading || !cpiConfig.url || !cpiConfig.username || !cpiConfig.iflowId}
                         className="w-full bg-indigo-600 text-white font-medium py-2.5 rounded-lg text-sm shadow-sm hover:bg-indigo-700 transition flex items-center justify-center gap-2 disabled:bg-neutral-300 disabled:cursor-not-allowed"
                       >
                         {isApiLoading ? (
                           <><RefreshCw className="w-4 h-4 animate-spin" /> Connecting to SAP CPI...</>
                         ) : (
                           <><CloudCog className="w-4 h-4" /> Download Sandbox Artifact</>
                         )}
                       </button>
                     </div>
                   </form>
                </div>
              ) : (
                <div 
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    "border-2 border-dashed rounded-xl p-16 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-200 ease-in-out",
                    isDragOver 
                      ? "border-indigo-500 bg-indigo-50" 
                      : "border-neutral-300 bg-white hover:border-indigo-400 hover:bg-indigo-50/50"
                  )}
                >
                  <div className={cn(
                    "p-4 rounded-full mb-4 transition-colors",
                    isDragOver ? "bg-indigo-100 text-indigo-600" : "bg-neutral-100 text-neutral-500"
                  )}>
                    <UploadCloud className="w-8 h-8" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">Upload iFlow ZIP Locally</h3>
                  <p className="text-neutral-500 text-sm max-w-sm mb-6">
                    Drag and drop your exported SAP CPI integration flow ZIP file here, or click to browse.
                  </p>
                  
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept=".zip"
                    className="hidden"
                  />
                  
                  <button className="bg-white border border-neutral-300 shadow-sm px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-neutral-50 transition-colors">
                    Select File
                  </button>
                </div>
              )}

              <div className="mt-8 bg-blue-50 border border-blue-100 rounded-lg p-5 flex gap-4 text-blue-800 items-start">
                <Info className="w-5 h-5 shrink-0 mt-0.5 text-blue-600" />
                <div className="text-sm">
                  <strong className="font-semibold block mb-1">How it works</strong>
                  This tool safely renames scripts within SAP CPI iFlows. By using the API, it modifies the package directly via your Node.js backend. If you upload a local ZIP, all operations are purely browser-based. References in the <code>.iflw</code> BPMN and parameter XMLs are updated synchronously.
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="editor"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6"
            >
              <div className="flex items-center gap-4 mb-8">
                <div className="bg-white px-4 py-2 border border-neutral-200 rounded-lg shadow-sm text-sm font-medium text-neutral-700 flex items-center gap-2">
                  {loadedFromApi ? <CloudCog className="w-4 h-4 text-indigo-500" /> : <FileArchive className="w-4 h-4 text-neutral-400" />}
                  {loadedFromApi ? `iFlow: ${cpiConfig.iflowId}` : iFlowName}
                </div>
                <div className="text-sm text-neutral-500">
                  {scripts.length} script{scripts.length !== 1 && 's'} found
                </div>
              </div>

              {scripts.length === 0 ? (
                <div className="bg-white border border-neutral-200 rounded-xl p-12 text-center shadow-sm">
                  <div className="inline-flex p-3 bg-orange-100 text-orange-600 rounded-full mb-4">
                    <FileCode2 className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-semibold text-neutral-900 mb-2">No scripts found</h3>
                  <p className="text-neutral-500 text-sm max-w-sm mx-auto mb-6">
                    We inspected the selected artifact but couldn't find any scripts in the standard <code>src/main/resources/script/</code> directory.
                  </p>
                  <button 
                    onClick={resetState}
                    className="text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
                  >
                    Select a different integration flow
                  </button>
                </div>
              ) : (
                <div className="bg-white border border-neutral-200 rounded-xl shadow-sm overflow-hidden">
                  <div className="grid grid-cols-12 gap-4 px-6 py-4 bg-neutral-50 border-b border-neutral-200 text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                    <div className="col-span-5">Original Script Name & Pallet</div>
                    <div className="col-span-2 flex justify-center"></div>
                    <div className="col-span-5">New Script Name</div>
                  </div>
                  
                  <div className="divide-y divide-neutral-100">
                    {scripts.map((script, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-4 px-6 py-4 items-center group hover:bg-neutral-50/50 transition-colors">
                        <div className="col-span-5 flex flex-col justify-center">
                          <div className="flex items-center gap-3">
                            <FileCode2 className="w-4 h-4 text-neutral-400 shrink-0" />
                            <span className="font-mono text-sm text-neutral-700 truncate" title={script.originalName}>
                              {script.originalName}
                            </span>
                          </div>
                          {script.stepNames.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5 pl-7">
                              {script.stepNames.map((stepName, i) => (
                                <span key={i} className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-100 truncate max-w-[200px]" title={`Pallet Name: ${stepName}`}>
                                  {stepName}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        
                        <div className="col-span-2 flex justify-center">
                          <ArrowRight className="w-4 h-4 text-neutral-300 group-hover:text-neutral-400" />
                        </div>
                        
                        <div className="col-span-5">
                          <input
                            type="text"
                            value={script.newName}
                            onChange={(e) => updateNewName(idx, e.target.value)}
                            onFocus={(e) => {
                              const dotIndex = e.target.value.lastIndexOf('.');
                              if (dotIndex > 0) {
                                e.target.setSelectionRange(0, dotIndex);
                              }
                            }}
                            className={cn(
                              "w-full px-3 py-2 text-sm font-mono border rounded-md transition-colors",
                              "focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500",
                              script.newName !== script.originalName 
                                ? "bg-indigo-50 border-indigo-200 text-indigo-800" 
                                : "bg-white border-neutral-200 text-neutral-800"
                            )}
                            placeholder="Enter new name..."
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  <div className="px-6 py-5 bg-neutral-50 border-t border-neutral-200 flex justify-end gap-3">
                    <button
                      onClick={() => processAction('download')}
                      disabled={isProcessing || scripts.every(s => s.originalName === s.newName)}
                      className={cn(
                        "inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-white border border-neutral-300 shadow-sm transition-all",
                        isProcessing || scripts.every(s => s.originalName === s.newName)
                          ? "text-neutral-400 cursor-not-allowed"
                          : "text-neutral-700 hover:bg-neutral-50 hover:text-neutral-900"
                      )}
                    >
                      <Download className="w-4 h-4" />
                      Download ZIP Locally
                    </button>
                    {loadedFromApi && (
                      <button
                        onClick={() => processAction('deploy')}
                        disabled={isProcessing || scripts.every(s => s.originalName === s.newName) || isApiDeployed}
                        className={cn(
                          "inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold shadow-sm transition-all",
                          isProcessing || scripts.every(s => s.originalName === s.newName) || isApiDeployed
                            ? "bg-neutral-300 text-white cursor-not-allowed"
                            : "bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow"
                        )}
                      >
                        {isProcessing ? (
                          <>
                            <RefreshCw className="w-4 h-4 animate-spin" />
                            Deploying...
                          </>
                        ) : isApiDeployed ? (
                          <>Deploy Successful (No new changes)</>
                        ) : (
                          <>
                            <CloudCog className="w-4 h-4" />
                            Deploy to CPI Directly
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
};

