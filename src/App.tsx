import { Dispatch, FormEvent, SetStateAction, useEffect, useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import { filterSknoreFiles, isSknoreProtected, normalizeSknorePatterns } from "./sknore/policy";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: string;
};

type WorkspaceFile = {
  path: string;
  content: string;
};

type HealthPayload = {
  ok?: boolean;
  name?: string;
};

type GeneratePayload = {
  text?: string;
  error?: string;
};

type AppMode = "skyeide" | "neural";
type ToolTab = "assistant" | "smokehouse" | "playground";

type SkyeAppId =
  | "SkyeDocs"
  | "SkyeSheets"
  | "SkyeSlides"
  | "SkyeMail"
  | "SkyeChat"
  | "SkyeCalendar"
  | "SkyeDrive"
  | "SkyeVault"
  | "SkyeForms"
  | "SkyeNotes"
  | "SkyeAnalytics"
  | "SkyeTasks"
  | "SkyeAdmin";

type SkyeAppDefinition = {
  id: SkyeAppId;
  summary: string;
  mvp: string[];
};

type AuthRole = "owner" | "admin" | "member" | "viewer";

type SmokeResult = {
  name: string;
  method: string;
  url: string;
  status: number;
  ok: boolean;
  summary: string;
};

type SmokeRun = {
  id: string;
  at: string;
  source: "manual" | "auto";
  results: SmokeResult[];
  prev_hash: string;
  hash: string;
};

type Timeframe = "all" | "today" | "7d" | "30d" | "custom";

const DEFAULT_WORKER_URL =
  (import.meta.env.VITE_WORKER_RUNNER_URL as string | undefined) || "https://your-worker.workers.dev";
const DEFAULT_WS_ID = (import.meta.env.VITE_DEFAULT_WS_ID as string | undefined) || "primary-workspace";
const DEFAULT_SITE_BASE = (import.meta.env.VITE_SITE_BASE_URL as string | undefined) || window.location.origin;

const SKYE_APPS: SkyeAppDefinition[] = [
  { id: "SkyeDocs", summary: "Collaborative document workspace.", mvp: ["Rich text", "Markdown mode", "Autosave"] },
  { id: "SkyeSheets", summary: "Grid and formula workbook app.", mvp: ["Editable grid", "Formula parser", "CSV import/export"] },
  { id: "SkyeSlides", summary: "Deck builder and presenter mode.", mvp: ["Slide list", "Template blocks", "Presenter view"] },
  { id: "SkyeMail", summary: "Inbox and compose workflows.", mvp: ["Inbox list", "Read thread", "Compose/send"] },
  { id: "SkyeChat", summary: "Channels, threads, team messages.", mvp: ["Channel rooms", "Thread replies", "File attachments"] },
  { id: "SkyeCalendar", summary: "Scheduling and event planning.", mvp: ["Month/week views", "Create/edit events", "Reminders"] },
  { id: "SkyeDrive", summary: "Workspace file storage and sharing.", mvp: ["Upload", "Version history", "Share links"] },
  { id: "SkyeVault", summary: "Secure credentials and secrets.", mvp: ["Encrypted entries", "Scoped sharing", "Audit log"] },
  { id: "SkyeForms", summary: "Forms and response collection.", mvp: ["Form builder", "Response table", "Publish link"] },
  { id: "SkyeNotes", summary: "Notebooks and quick capture.", mvp: ["Notebook tree", "Tags", "Search"] },
  { id: "SkyeAnalytics", summary: "Usage and KPI dashboards.", mvp: ["KPI cards", "Trend charts", "Export CSV"] },
  { id: "SkyeTasks", summary: "Kanban and assignment tracking.", mvp: ["Board columns", "Assignees", "Due dates"] },
  { id: "SkyeAdmin", summary: "Org roles and integration controls.", mvp: ["User roles", "SSO/integrations", "Audit console"] },
];

const DEFAULT_FILES: WorkspaceFile[] = [
  {
    path: "src/main.tsx",
    content:
      "import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport { App } from './App';\n\ncreateRoot(document.getElementById('root')!).render(<App />);\n",
  },
  {
    path: "src/App.tsx",
    content: "export function App() {\n  return <div>kAIxU SkyeIDE</div>;\n}\n",
  },
  {
    path: "README.md",
    content: "# kAIxU SkyeIDE\n\nPrimary app: SkyeIDE\nSecondary app: Neural Space Pro\n",
  },
];

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function tryParseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function App() {
  const [appMode, setAppMode] = useState<AppMode>("skyeide");
  const [toolTab, setToolTab] = useState<ToolTab>("assistant");
  const [selectedSkyeApp, setSelectedSkyeApp] = useState<SkyeAppId>("SkyeDocs");

  const [mvpChecks, setMvpChecks] = useState<Record<string, boolean>>(() => {
    const raw = localStorage.getItem("kx.skye.apps.mvp");
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  });

  const [workerUrl, setWorkerUrl] = useState(() => localStorage.getItem("kx.worker.url") || DEFAULT_WORKER_URL);
  const [siteBaseUrl, setSiteBaseUrl] = useState(() => localStorage.getItem("kx.site.base") || DEFAULT_SITE_BASE);
  const [workspaceId, setWorkspaceId] = useState(() => localStorage.getItem("kx.workspace.id") || DEFAULT_WS_ID);

  const [files, setFiles] = useState<WorkspaceFile[]>(() => {
    const raw = localStorage.getItem("kx.workspace.files");
    if (!raw) return DEFAULT_FILES;
    try {
      const parsed = JSON.parse(raw) as WorkspaceFile[];
      return parsed?.length ? parsed : DEFAULT_FILES;
    } catch {
      return DEFAULT_FILES;
    }
  });
  const [activePath, setActivePath] = useState(() => localStorage.getItem("kx.workspace.activePath") || DEFAULT_FILES[0].path);

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      id: makeId(),
      role: "assistant",
      text: "SkyeIDE is live. Neural Space Pro is integrated as the secondary copilot surface.",
      at: new Date().toISOString(),
    },
  ]);

  const [isSending, setIsSending] = useState(false);
  const [isSmokeChecking, setIsSmokeChecking] = useState(false);
  const [runnerStatus, setRunnerStatus] = useState<"unknown" | "ok" | "fail">("unknown");
  const [smokeResults, setSmokeResults] = useState<SmokeResult[]>([]);
  const [smokeLedger, setSmokeLedger] = useState<SmokeRun[]>(() => {
    const raw = localStorage.getItem("kx.smoke.ledger");
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as SmokeRun[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [timeframe, setTimeframe] = useState<Timeframe>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [playMethod, setPlayMethod] = useState("POST");
  const [playUrl, setPlayUrl] = useState(() => `${DEFAULT_SITE_BASE}/api/kaixu-generate`);
  const [playHeaders, setPlayHeaders] = useState('{\n  "Content-Type": "application/json"\n}');
  const [playBody, setPlayBody] = useState(
    '{\n  "ws_id": "primary-workspace",\n  "prompt": "smoke from playground",\n  "activePath": "src/App.tsx",\n  "files": []\n}'
  );
  const [playResponse, setPlayResponse] = useState("");
  const [playStatus, setPlayStatus] = useState<number | null>(null);
  const [playLoading, setPlayLoading] = useState(false);

  const [appSearch, setAppSearch] = useState("");
  const [authUser, setAuthUser] = useState(() => localStorage.getItem("kx.auth.user") || "founder@skye.local");
  const [authRole, setAuthRole] = useState<AuthRole>(() => (localStorage.getItem("kx.auth.role") as AuthRole) || "owner");

  const [sheetCells, setSheetCells] = useState<string[][]>(() =>
    Array.from({ length: 6 }, (_, row) => Array.from({ length: 5 }, (_, col) => (row === 0 ? `${String.fromCharCode(65 + col)}` : "")))
  );
  const [slides, setSlides] = useState<string[]>(["Welcome", "Roadmap", "Close"]);
  const [mailItems, setMailItems] = useState<string[]>(["Q1 plan update", "Security review notes"]);
  const [chatMessages, setChatMessages] = useState<string[]>(["#general: shipping Skye suite", "#eng: smoke is clean"]);
  const [calendarEvents, setCalendarEvents] = useState<string[]>(["Demo 2026-03-05", "Release train 2026-03-08"]);
  const [driveFiles, setDriveFiles] = useState<string[]>(["pitch-deck-v3.pdf", "roadmap.xlsx"]);
  const [vaultEntries, setVaultEntries] = useState<string[]>(["NETLIFY_TOKEN", "CF_ACCESS_CLIENT_SECRET"]);
  const [formQuestions, setFormQuestions] = useState<string[]>(["How satisfied are you?", "What should we improve?"]);
  const [notes, setNotes] = useState<string[]>(["Investor prep notes", "Incident checklist"]);
  const [adminUsers, setAdminUsers] = useState<Array<{ email: string; role: AuthRole }>>([
    { email: "founder@skye.local", role: "owner" },
    { email: "ops@skye.local", role: "admin" },
    { email: "dev@skye.local", role: "member" },
  ]);
  const [tasksBoard, setTasksBoard] = useState<Record<string, string[]>>({
    backlog: ["Auth policy", "Data schema"],
    doing: ["SkyeDocs editor"],
    done: ["App shell routing"],
  });
  const [testerToken, setTesterToken] = useState("");
  const [testerTokenMeta, setTesterTokenMeta] = useState("");
  const [isIssuingTesterToken, setIsIssuingTesterToken] = useState(false);
  const [sknoreText, setSknoreText] = useState(() => localStorage.getItem("kx.sknore.patterns") || ".env\n.env.*\nsecrets/**\n**/*.pem\n**/*.key");
  const [mailTo, setMailTo] = useState("qa@skye.local");
  const [mailSubject, setMailSubject] = useState("SkyeMail test");
  const [mailText, setMailText] = useState("Hello from SkyeMail.");
  const [mailChannelHook, setMailChannelHook] = useState("general");
  const [mailSendResult, setMailSendResult] = useState("");
  const [isSendingMail, setIsSendingMail] = useState(false);
  const [chatChannelInput, setChatChannelInput] = useState("general");
  const [chatMessageInput, setChatMessageInput] = useState("SkyeChat notify test");
  const [chatNotifyResult, setChatNotifyResult] = useState("");
  const [isNotifyingChat, setIsNotifyingChat] = useState(false);

  const healthUrl = useMemo(() => `${normalizeBaseUrl(workerUrl)}/health`, [workerUrl]);
  const activeFile = useMemo(() => files.find((file) => file.path === activePath) || files[0], [files, activePath]);
  const sknorePatterns = useMemo(() => normalizeSknorePatterns(sknoreText.split("\n")), [sknoreText]);
  const sknoreBlockedCount = useMemo(
    () => files.filter((file) => isSknoreProtected(file.path, sknorePatterns)).length,
    [files, sknorePatterns]
  );

  useEffect(() => {
    localStorage.setItem("kx.worker.url", workerUrl);
  }, [workerUrl]);

  useEffect(() => {
    localStorage.setItem("kx.site.base", siteBaseUrl);
  }, [siteBaseUrl]);

  useEffect(() => {
    localStorage.setItem("kx.workspace.id", workspaceId);
  }, [workspaceId]);

  useEffect(() => {
    localStorage.setItem("kx.workspace.files", JSON.stringify(files));
  }, [files]);

  useEffect(() => {
    localStorage.setItem("kx.workspace.activePath", activePath);
  }, [activePath]);

  useEffect(() => {
    localStorage.setItem("kx.smoke.ledger", JSON.stringify(smokeLedger));
  }, [smokeLedger]);

  useEffect(() => {
    localStorage.setItem("kx.skye.apps.mvp", JSON.stringify(mvpChecks));
  }, [mvpChecks]);

  useEffect(() => {
    localStorage.setItem("kx.sknore.patterns", sknoreText);
  }, [sknoreText]);

  useEffect(() => {
    localStorage.setItem("kx.auth.user", authUser);
    localStorage.setItem("kx.auth.role", authRole);
  }, [authUser, authRole]);

  useEffect(() => {
    void runSmokeTest();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      void runSmokehouseSuite("auto");
    }, 13 * 60 * 1000);
    return () => clearInterval(timer);
  }, [siteBaseUrl, workerUrl, workspaceId, activePath, files]);

  function updateActiveFileContent(content: string) {
    setFiles((old) => old.map((file) => (file.path === activeFile.path ? { ...file, content } : file)));
  }

  function makeMvpKey(appId: SkyeAppId, item: string) {
    return `${appId}::${item}`;
  }

  function toggleMvpCheck(appId: SkyeAppId, item: string) {
    const key = makeMvpKey(appId, item);
    setMvpChecks((old) => ({ ...old, [key]: !old[key] }));
  }

  const selectedAppDefinition = useMemo(
    () => SKYE_APPS.find((app) => app.id === selectedSkyeApp) || SKYE_APPS[0],
    [selectedSkyeApp]
  );

  const filteredApps = useMemo(() => {
    const q = appSearch.trim().toLowerCase();
    if (!q) return SKYE_APPS;
    return SKYE_APPS.filter((app) => {
      if (app.id.toLowerCase().includes(q)) return true;
      if (app.summary.toLowerCase().includes(q)) return true;
      return app.mvp.some((item) => item.toLowerCase().includes(q));
    });
  }, [appSearch]);

  const totalMvpItems = useMemo(() => SKYE_APPS.reduce((sum, app) => sum + app.mvp.length, 0), []);
  const completeMvpItems = useMemo(
    () => SKYE_APPS.flatMap((app) => app.mvp.map((item) => mvpChecks[makeMvpKey(app.id, item)])).filter(Boolean).length,
    [mvpChecks]
  );

  async function runSmokeTest() {
    setIsSmokeChecking(true);
    try {
      const response = await fetch(healthUrl, { method: "GET" });
      const data = (await response.json()) as HealthPayload;
      if (!response.ok || !data?.ok) {
        setRunnerStatus("fail");
        return { ok: false, text: `Smoke failed (${response.status}).` };
      }
      setRunnerStatus("ok");
      return { ok: true, text: `Smoke passed: ${data.name || "runner"}.` };
    } catch (error: any) {
      setRunnerStatus("fail");
      return { ok: false, text: `Smoke failed: ${error?.message || "network error"}` };
    } finally {
      setIsSmokeChecking(false);
    }
  }

  async function runGenerate(prompt: string) {
    const active = activeFile?.path || "/src/App.tsx";
    if (isSknoreProtected(active, sknorePatterns)) {
      return {
        ok: false,
        text: `SKNore policy blocks AI access to ${active}. Switch to a non-protected file or update SKNore patterns.`,
      };
    }

    const safeFiles = filterSknoreFiles(files, sknorePatterns);
    try {
      const response = await fetch("/api/kaixu-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ws_id: workspaceId || DEFAULT_WS_ID,
          activePath: active,
          files: safeFiles,
          prompt,
        }),
      });
      const data = (await response.json()) as GeneratePayload;
      if (!response.ok) {
        return { ok: false, text: data?.error || `AI call failed (${response.status}).` };
      }
      return { ok: true, text: data?.text || "No model response returned." };
    } catch (error: any) {
      return { ok: false, text: `AI call failed: ${error?.message || "network error"}` };
    }
  }

  async function appendSmokeRun(source: "manual" | "auto", results: SmokeResult[]) {
    const prevHash = smokeLedger.length ? smokeLedger[smokeLedger.length - 1].hash : "GENESIS";
    const at = new Date().toISOString();
    const hashInput = `${prevHash}\n${at}\n${source}\n${JSON.stringify(results)}`;
    const hash = await sha256Hex(hashInput);
    const run: SmokeRun = {
      id: makeId(),
      at,
      source,
      results,
      prev_hash: prevHash,
      hash,
    };
    setSmokeLedger((old) => [...old, run]);
  }

  function getFilteredLedgerRuns(): SmokeRun[] {
    const now = new Date();
    if (timeframe === "all") return smokeLedger;
    if (timeframe === "today") {
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      return smokeLedger.filter((run) => new Date(run.at).getTime() >= dayStart);
    }
    if (timeframe === "7d") {
      const cutoff = now.getTime() - 7 * 24 * 60 * 60 * 1000;
      return smokeLedger.filter((run) => new Date(run.at).getTime() >= cutoff);
    }
    if (timeframe === "30d") {
      const cutoff = now.getTime() - 30 * 24 * 60 * 60 * 1000;
      return smokeLedger.filter((run) => new Date(run.at).getTime() >= cutoff);
    }
    const fromTs = customFrom ? new Date(`${customFrom}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
    const toTs = customTo ? new Date(`${customTo}T23:59:59`).getTime() : Number.POSITIVE_INFINITY;
    return smokeLedger.filter((run) => {
      const t = new Date(run.at).getTime();
      return t >= fromTs && t <= toTs;
    });
  }

  function exportSmokeLedger(all = true) {
    const selected = all ? smokeLedger : getFilteredLedgerRuns();
    const payload = {
      exported_at: new Date().toISOString(),
      mode: all ? "all" : timeframe,
      count: selected.length,
      runs: selected,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `smoke-ledger-${all ? "all" : timeframe}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function runSmokehouseSuite(source: "manual" | "auto" = "manual") {
    setIsSmokeChecking(true);
    const base = normalizeBaseUrl(siteBaseUrl);
    const safeFiles = filterSknoreFiles(files, sknorePatterns);

    const checks = [
      {
        name: "Site Root",
        method: "GET",
        url: `${base}/`,
        body: undefined as any,
      },
      {
        name: "Worker Health",
        method: "GET",
        url: healthUrl,
        body: undefined as any,
      },
      {
        name: "Generate API",
        method: "POST",
        url: `${base}/api/kaixu-generate`,
        body: {
          ws_id: workspaceId || DEFAULT_WS_ID,
          activePath: activeFile?.path || "src/App.tsx",
          files: safeFiles,
          prompt: "smokehouse ping",
        },
      },
      {
        name: "Auth Me",
        method: "GET",
        url: `${base}/api/auth-me`,
        body: undefined as any,
      },
    ];

    const out: SmokeResult[] = [];

    for (const app of SKYE_APPS) {
      const appReady = app.mvp.length > 0;
      out.push({
        name: `App MVP ${app.id}`,
        method: "LOCAL",
        url: `app://${app.id}`,
        status: appReady ? 200 : 500,
        ok: appReady,
        summary: appReady ? `MVP checklist loaded (${app.mvp.length} items)` : "missing MVP metadata",
      });
    }

    for (const check of checks) {
      try {
        const res = await fetch(check.url, {
          method: check.method,
          headers: check.body ? { "Content-Type": "application/json" } : undefined,
          body: check.body ? JSON.stringify(check.body) : undefined,
        });
        const txt = await res.text();
        out.push({
          name: check.name,
          method: check.method,
          url: check.url,
          status: res.status,
          ok: res.status >= 200 && res.status < 300,
          summary: typeof tryParseJson(txt) === "string" ? txt.slice(0, 200) : JSON.stringify(tryParseJson(txt)).slice(0, 200),
        });
      } catch (error: any) {
        out.push({
          name: check.name,
          method: check.method,
          url: check.url,
          status: 0,
          ok: false,
          summary: error?.message || "network error",
        });
      }
    }

    setSmokeResults(out);
    setIsSmokeChecking(false);
    await appendSmokeRun(source, out);

    const health = out.find((item) => item.name === "Worker Health");
    if (health?.ok) setRunnerStatus("ok");
    else if (health) setRunnerStatus("fail");
  }

  function buildSmokeReport() {
    if (!smokeResults.length) return "Run smoke suite first.";
    const lines = [
      `# Smokehouse Report`,
      `Generated: ${new Date().toISOString()}`,
      `App Mode: ${appMode}`,
      `Site Base: ${siteBaseUrl}`,
      `Worker URL: ${workerUrl}`,
      ``,
    ];
    for (const r of smokeResults) {
      lines.push(`- [${r.ok ? "PASS" : "FAIL"}] ${r.name} :: ${r.method} ${r.url} -> ${r.status}`);
      lines.push(`  - Summary: ${r.summary}`);
    }
    return lines.join("\n");
  }

  async function onApiPlaygroundSend(event: FormEvent) {
    event.preventDefault();
    setPlayLoading(true);
    setPlayResponse("");
    setPlayStatus(null);

    try {
      const headers = tryParseJson(playHeaders);
      const reqInit: RequestInit = {
        method: playMethod,
        headers: typeof headers === "object" ? headers : { "Content-Type": "application/json" },
      };
      if (!["GET", "HEAD"].includes(playMethod.toUpperCase()) && playBody.trim()) {
        reqInit.body = playBody;
      }

      const res = await fetch(playUrl, reqInit);
      const text = await res.text();
      setPlayStatus(res.status);
      setPlayResponse(text || "<empty response>");
    } catch (error: any) {
      setPlayStatus(0);
      setPlayResponse(error?.message || "request failed");
    } finally {
      setPlayLoading(false);
    }
  }

  async function onManualSmoke() {
    const result = await runSmokeTest();
    setMessages((old) => [
      ...old,
      {
        id: makeId(),
        role: "assistant",
        text: result.text,
        at: new Date().toISOString(),
      },
    ]);
  }

  async function onSend(event: FormEvent) {
    event.preventDefault();
    const prompt = input.trim();
    if (!prompt || isSending) return;

    setIsSending(true);
    setMessages((old) => [
      ...old,
      {
        id: makeId(),
        role: "user",
        text: prompt,
        at: new Date().toISOString(),
      },
    ]);
    setInput("");

    if (runnerStatus === "unknown") {
      await runSmokeTest();
    }

    const ai = await runGenerate(prompt);

    setMessages((old) => [
      ...old,
      {
        id: makeId(),
        role: "assistant",
        text: [
          `Mode: ${appMode === "skyeide" ? "SkyeIDE (Primary)" : "Neural Space Pro (Secondary)"}`,
          `Worker: ${runnerStatus.toUpperCase()}`,
          `AI: ${ai.text}`,
        ].join("\n\n"),
        at: new Date().toISOString(),
      },
    ]);

    setIsSending(false);
  }

  async function issueTesterToken() {
    setIsIssuingTesterToken(true);
    setTesterToken("");
    setTesterTokenMeta("");
    try {
      const res = await fetch("/api/token-issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          count: 1,
          ttl_preset: "test_2m",
          label_prefix: "tester",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTesterTokenMeta(data?.error || `Issue failed (${res.status})`);
        return;
      }
      const issued = data?.issued?.[0];
      setTesterToken(issued?.token || "");
      setTesterTokenMeta(
        `locked_email=${issued?.locked_email || "<none>"} · starts_at=${issued?.starts_at || "n/a"} · expires_at=${issued?.expires_at || "n/a"}`
      );
    } catch (error: any) {
      setTesterTokenMeta(error?.message || "Issue failed.");
    } finally {
      setIsIssuingTesterToken(false);
    }
  }

  async function sendSkyeMail() {
    setIsSendingMail(true);
    setMailSendResult("");
    try {
      const res = await fetch("/api/skymail-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: mailTo,
          subject: mailSubject,
          text: mailText,
          channel: mailChannelHook,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMailSendResult(data?.error || `send failed (${res.status})`);
        return;
      }
      setMailItems((old) => [`${mailSubject} -> ${mailTo}`, ...old]);
      setMailSendResult(`sent via ${data?.provider || "provider"} (mail_record_id=${data?.mail_record_id || "n/a"})`);
      if (data?.chat_hook_id) {
        setChatMessages((old) => [`#${mailChannelHook}: Mail delivered -> ${mailSubject}`, ...old]);
      }
    } catch (error: any) {
      setMailSendResult(error?.message || "send failed");
    } finally {
      setIsSendingMail(false);
    }
  }

  async function notifySkyeChat() {
    setIsNotifyingChat(true);
    setChatNotifyResult("");
    try {
      const res = await fetch("/api/skychat-notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: chatChannelInput,
          message: chatMessageInput,
          source: "SkyeChat UI",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setChatNotifyResult(data?.error || `notify failed (${res.status})`);
        return;
      }
      setChatMessages((old) => [`#${chatChannelInput}: ${chatMessageInput}`, ...old]);
      setChatNotifyResult(`notified (id=${data?.id || "n/a"})`);
    } catch (error: any) {
      setChatNotifyResult(error?.message || "notify failed");
    } finally {
      setIsNotifyingChat(false);
    }
  }

  function renderAppModule() {
    if (selectedSkyeApp === "SkyeDocs") {
      return (
        <>
          <div className="editor-head">{activeFile?.path || "No file"}</div>
          <Editor
            height="100%"
            theme="vs-dark"
            path={activeFile?.path}
            value={activeFile?.content || ""}
            onChange={(value) => updateActiveFileContent(value || "")}
            options={{ minimap: { enabled: false }, fontSize: 13, wordWrap: "on", automaticLayout: true }}
          />
        </>
      );
    }

    if (selectedSkyeApp === "SkyeSheets") {
      return (
        <section className="app-module">
          <header><h2>SkyeSheets</h2><p>Editable grid MVP.</p></header>
          <div className="sheet-grid">
            {sheetCells.map((row, r) => (
              <div key={`r-${r}`} className="sheet-row">
                {row.map((cell, c) => (
                  <input
                    key={`c-${r}-${c}`}
                    value={cell}
                    onChange={(e) => {
                      const next = sheetCells.map((x) => [...x]);
                      next[r][c] = e.target.value;
                      setSheetCells(next);
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </section>
      );
    }

    if (selectedSkyeApp === "SkyeTasks") {
      return (
        <section className="app-module">
          <header><h2>SkyeTasks</h2><p>Kanban MVP with three columns.</p></header>
          <div className="kanban-grid">
            {Object.entries(tasksBoard).map(([column, items]) => (
              <div key={column} className="kanban-col">
                <h4>{column.toUpperCase()}</h4>
                {items.map((item, i) => <div key={`${column}-${i}`} className="kanban-card">{item}</div>)}
              </div>
            ))}
          </div>
        </section>
      );
    }

    if (selectedSkyeApp === "SkyeMail") {
      return (
        <section className="app-module">
          <header><h2>SkyeMail</h2><p>Live provider-backed send flow (Resend adapter).</p></header>
          <label>To</label>
          <input value={mailTo} onChange={(e) => setMailTo(e.target.value)} />
          <label>Subject</label>
          <input value={mailSubject} onChange={(e) => setMailSubject(e.target.value)} />
          <label>Body</label>
          <textarea value={mailText} onChange={(e) => setMailText(e.target.value)} rows={6} />
          <label>SkyeChat hook channel (optional)</label>
          <input value={mailChannelHook} onChange={(e) => setMailChannelHook(e.target.value)} />
          <div className="tool-actions left">
            <button className="ghost" type="button" onClick={() => void sendSkyeMail()} disabled={isSendingMail}>
              {isSendingMail ? "Sending..." : "Send Mail"}
            </button>
          </div>
          {mailSendResult && <p className="muted-copy">{mailSendResult}</p>}
          <div className="list-stack">
            {mailItems.map((item, index) => <div key={`mail-${index}`} className="list-item">{item}</div>)}
          </div>
        </section>
      );
    }

    if (selectedSkyeApp === "SkyeChat") {
      return (
        <section className="app-module">
          <header><h2>SkyeChat</h2><p>Notification feed with backend persistence.</p></header>
          <label>Channel</label>
          <input value={chatChannelInput} onChange={(e) => setChatChannelInput(e.target.value)} />
          <label>Message</label>
          <textarea value={chatMessageInput} onChange={(e) => setChatMessageInput(e.target.value)} rows={4} />
          <div className="tool-actions left">
            <button className="ghost" type="button" onClick={() => void notifySkyeChat()} disabled={isNotifyingChat}>
              {isNotifyingChat ? "Notifying..." : "Notify Channel"}
            </button>
          </div>
          {chatNotifyResult && <p className="muted-copy">{chatNotifyResult}</p>}
          <div className="list-stack">
            {chatMessages.map((item, index) => <div key={`chat-${index}`} className="list-item">{item}</div>)}
          </div>
        </section>
      );
    }

    const listMap: Record<Exclude<SkyeAppId, "SkyeDocs" | "SkyeSheets" | "SkyeTasks" | "SkyeAdmin" | "SkyeAnalytics" | "SkyeMail" | "SkyeChat">, [string[], Dispatch<SetStateAction<string[]>>, string]> = {
      SkyeSlides: [slides, setSlides, "New slide"],
      SkyeCalendar: [calendarEvents, setCalendarEvents, "New event"],
      SkyeDrive: [driveFiles, setDriveFiles, "New file"],
      SkyeVault: [vaultEntries, setVaultEntries, "New secret key"],
      SkyeForms: [formQuestions, setFormQuestions, "New question"],
      SkyeNotes: [notes, setNotes, "New note"],
    };

    if (selectedSkyeApp === "SkyeAdmin") {
      return (
        <section className="app-module">
          <header><h2>SkyeAdmin</h2><p>Org user and role controls.</p></header>
          <div className="list-stack">
            {adminUsers.map((user) => (
              <div key={user.email} className="list-item admin-row">
                <span>{user.email}</span>
                <select
                  value={user.role}
                  onChange={(event) => {
                    setAdminUsers((old) => old.map((x) => (x.email === user.email ? { ...x, role: event.target.value as AuthRole } : x)));
                  }}
                >
                  <option value="owner">owner</option>
                  <option value="admin">admin</option>
                  <option value="member">member</option>
                  <option value="viewer">viewer</option>
                </select>
              </div>
            ))}
          </div>
          <div className="tool-actions left">
            <button className="ghost" type="button" onClick={() => void issueTesterToken()} disabled={isIssuingTesterToken}>
              {isIssuingTesterToken ? "Issuing..." : "Issue 2-Min Tester Token"}
            </button>
          </div>
          {testerTokenMeta && <p className="muted-copy">{testerTokenMeta}</p>}
          <label>Tester token (shown once, save it now)</label>
          <textarea className="report-box" readOnly value={testerToken} rows={4} />
        </section>
      );
    }

    if (selectedSkyeApp === "SkyeAnalytics") {
      const kpis = [
        ["Total App Modules", SKYE_APPS.length],
        ["MVP Items Complete", completeMvpItems],
        ["Smoke Runs", smokeLedger.length],
        ["Open Tasks", tasksBoard.backlog.length + tasksBoard.doing.length],
      ];
      return (
        <section className="app-module">
          <header><h2>SkyeAnalytics</h2><p>Suite KPI dashboard.</p></header>
          <div className="kpi-grid">
            {kpis.map(([label, value]) => (
              <article key={label} className="kpi-card">
                <div>{label}</div>
                <strong>{value}</strong>
              </article>
            ))}
          </div>
        </section>
      );
    }

    const listEntry = listMap[selectedSkyeApp as keyof typeof listMap];
    if (!listEntry) return null;
    const [items, setItems, placeholder] = listEntry;

    return (
      <section className="app-module">
        <header>
          <h2>{selectedAppDefinition.id}</h2>
          <p>{selectedAppDefinition.summary}</p>
        </header>
        <div className="list-stack">
          {items.map((item, index) => <div key={`${selectedSkyeApp}-${index}`} className="list-item">{item}</div>)}
        </div>
        <button
          className="ghost"
          type="button"
          onClick={() => setItems((old) => [...old, `${placeholder} ${old.length + 1}`])}
        >
          Add Item
        </button>
      </section>
    );
  }

  return (
    <div className="ide-shell">
      <header className="topbar">
        <div>
          <h1>kAIxU SkyeIDE</h1>
          <p>Primary IDE surface · Neural Space Pro secondary app · Shared Auth active</p>
        </div>
        <div className="topbar-right">
          <input className="auth-user" value={authUser} onChange={(event) => setAuthUser(event.target.value)} aria-label="auth user" />
          <select value={authRole} onChange={(event) => setAuthRole(event.target.value as AuthRole)}>
            <option value="owner">owner</option>
            <option value="admin">admin</option>
            <option value="member">member</option>
            <option value="viewer">viewer</option>
          </select>
          <div className={`status-dot ${runnerStatus}`}>
            Worker {runnerStatus === "ok" ? "Healthy" : runnerStatus === "fail" ? "Offline" : "Unknown"}
          </div>
          <button className="ghost" type="button" onClick={onManualSmoke} disabled={isSmokeChecking}>
            {isSmokeChecking ? "Checking..." : "Smoke Test"}
          </button>
        </div>
      </header>

      <div className="workspace-body">
        <aside className="file-pane">
          <div className="mode-switch">
            <button type="button" className={`switch-btn ${appMode === "skyeide" ? "active" : ""}`} onClick={() => setAppMode("skyeide")}>SkyeIDE</button>
            <button type="button" className={`switch-btn ${appMode === "neural" ? "active" : ""}`} onClick={() => setAppMode("neural")}>Neural Space Pro</button>
          </div>

          <h3>Skye Apps</h3>
          <input
            value={appSearch}
            onChange={(event) => setAppSearch(event.target.value)}
            placeholder="Search apps, modules..."
            aria-label="search apps"
          />
          <div className="app-list">
            {filteredApps.map((app) => {
              const done = app.mvp.filter((item) => mvpChecks[makeMvpKey(app.id, item)]).length;
              return (
                <button
                  key={app.id}
                  type="button"
                  className={`app-item ${selectedSkyeApp === app.id ? "active" : ""}`}
                  onClick={() => setSelectedSkyeApp(app.id)}
                >
                  <span>{app.id}</span>
                  <small>{done}/{app.mvp.length}</small>
                </button>
              );
            })}
          </div>

          <div className="suite-progress">
            Suite MVP Progress: {completeMvpItems}/{totalMvpItems}
          </div>

          <label htmlFor="workspace-id">Workspace ID</label>
          <input id="workspace-id" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} placeholder="workspace uuid" />

          <label htmlFor="site-base">Site Base URL</label>
          <input id="site-base" value={siteBaseUrl} onChange={(event) => setSiteBaseUrl(event.target.value)} placeholder="https://your-site.netlify.app" />

          <label htmlFor="worker-url">Worker URL</label>
          <input id="worker-url" value={workerUrl} onChange={(event) => setWorkerUrl(event.target.value)} placeholder="https://your-worker.workers.dev" />

          <h3>SKNore (AI protected)</h3>
          <textarea
            value={sknoreText}
            onChange={(event) => setSknoreText(event.target.value)}
            rows={6}
            placeholder="one glob pattern per line"
          />
          <div className="suite-progress">Protected files: {sknoreBlockedCount}</div>

          <h3>Files</h3>
          <div className="file-list">
            {files.map((file) => (
              <button key={file.path} type="button" className={`file-item ${file.path === activePath ? "active" : ""}`} onClick={() => setActivePath(file.path)}>
                {file.path}
              </button>
            ))}
          </div>
        </aside>

        <main className="editor-pane">
          {renderAppModule()}
        </main>

        <aside className="chat-pane">
          <header>
            <div className="tool-tabs">
              <button type="button" className={`tool-tab ${toolTab === "assistant" ? "active" : ""}`} onClick={() => setToolTab("assistant")}>Assistant</button>
              <button type="button" className={`tool-tab ${toolTab === "smokehouse" ? "active" : ""}`} onClick={() => setToolTab("smokehouse")}>Smokehouse</button>
              <button type="button" className={`tool-tab ${toolTab === "playground" ? "active" : ""}`} onClick={() => setToolTab("playground")}>API Playground</button>
            </div>
            <span>{healthUrl}</span>
          </header>

          {toolTab === "assistant" && (
            <>
              <section className="messages">
                {messages.map((message) => (
                  <article key={message.id} className={`bubble ${message.role}`}>
                    <div className="meta">{message.role === "assistant" ? "kAIxU" : "You"}</div>
                    <p>{message.text}</p>
                  </article>
                ))}
              </section>

              <form className="composer" onSubmit={onSend}>
                <textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask for code help, refactors, deployments, or debugging..." rows={3} />
                <button type="submit" disabled={isSending || !input.trim()}>Send</button>
              </form>
            </>
          )}

          {toolTab === "smokehouse" && (
            <div className="tool-panel">
              <div className="tool-actions">
                <button type="button" className="ghost" onClick={() => void runSmokehouseSuite("manual")} disabled={isSmokeChecking}>
                  {isSmokeChecking ? "Running..." : "Run Full Smoke"}
                </button>
              </div>
              <p className="muted-copy">Auto smoke runs every 13 minutes (append-only ledger).</p>
              <div className="smoke-list">
                {smokeResults.length === 0 && <p className="muted-copy">No smoke results yet.</p>}
                {smokeResults.map((result) => (
                  <div key={`${result.name}-${result.url}`} className={`smoke-item ${result.ok ? "pass" : "fail"}`}>
                    <strong>{result.ok ? "PASS" : "FAIL"}</strong> {result.name}
                    <div>{result.method} {result.url}</div>
                    <div>Status: {result.status}</div>
                    <div>{result.summary}</div>
                  </div>
                ))}
              </div>
              <div className="tool-row">
                <label>Export timeframe</label>
                <select value={timeframe} onChange={(event) => setTimeframe(event.target.value as Timeframe)}>
                  <option value="all">All</option>
                  <option value="today">Today</option>
                  <option value="7d">Last 7 days</option>
                  <option value="30d">Last 30 days</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              {timeframe === "custom" && (
                <div className="tool-row split">
                  <input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} />
                  <input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} />
                </div>
              )}
              <div className="tool-actions left">
                <button type="button" className="ghost" onClick={() => exportSmokeLedger(true)}>Export All Ledger</button>
                <button type="button" className="ghost" onClick={() => exportSmokeLedger(false)}>Export Filtered</button>
              </div>
              <div className="ledger-meta">
                Ledger runs: {smokeLedger.length} · Filtered: {getFilteredLedgerRuns().length}
              </div>
              <label>Smoke report</label>
              <textarea className="report-box" readOnly value={buildSmokeReport()} rows={10} />
            </div>
          )}

          {toolTab === "playground" && (
            <form className="tool-panel" onSubmit={onApiPlaygroundSend}>
              <label>Method</label>
              <select value={playMethod} onChange={(event) => setPlayMethod(event.target.value)}>
                <option>GET</option>
                <option>POST</option>
                <option>PUT</option>
                <option>PATCH</option>
                <option>DELETE</option>
              </select>

              <label>URL</label>
              <input value={playUrl} onChange={(event) => setPlayUrl(event.target.value)} />

              <label>Headers (JSON)</label>
              <textarea value={playHeaders} onChange={(event) => setPlayHeaders(event.target.value)} rows={5} />

              <label>Body</label>
              <textarea value={playBody} onChange={(event) => setPlayBody(event.target.value)} rows={7} />

              <div className="tool-actions">
                <button type="submit" disabled={playLoading}>{playLoading ? "Sending..." : "Send Request"}</button>
              </div>

              <label>Response {playStatus !== null ? `(status ${playStatus})` : ""}</label>
              <textarea className="report-box" readOnly value={playResponse} rows={10} />
            </form>
          )}
        </aside>
      </div>
    </div>
  );
}
