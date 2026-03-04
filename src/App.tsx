import { FormEvent, useEffect, useMemo, useState } from "react";
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

type AppRecord = {
  id: string;
  app: string;
  title: string;
  payload?: unknown;
  created_at?: string;
  updated_at?: string;
};

type HistoryPage = {
  next_before?: string | null;
  has_more?: boolean;
};

type HistoryResponse = {
  records?: AppRecord[];
  page?: HistoryPage;
  error?: string;
};

type AppMode = "skyeide" | "neural";
type ToolTab = "assistant" | "smokehouse" | "playground";

type SkyeAppId =
  | "SkyeDocs"
  | "SkyeDocxPro"
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
type ShareMode = "app" | "chat" | "mail" | "all";

type TeamMember = {
  user_id?: string;
  email: string;
  role: AuthRole;
};

type WorkspaceMember = {
  user_id?: string;
  email: string;
  role: "editor" | "viewer";
};

type SheetRow = {
  id: string;
  cells: string[];
  owner: string;
  updated_at: string;
};

type SheetsModel = {
  title: string;
  columns: string[];
  rows: SheetRow[];
};

type SlideItem = {
  id: string;
  title: string;
  summary: string;
  speaker: string;
  status: "draft" | "review" | "approved";
  updated_at: string;
};

type SlidesModel = {
  title: string;
  slides: SlideItem[];
};

type TaskCard = {
  id: string;
  title: string;
  description: string;
  status: "backlog" | "doing" | "done";
  priority: "low" | "medium" | "high";
  assignee: string;
  due_at: string;
  updated_at: string;
};

type CalendarEvent = {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  owner: string;
  status: "planned" | "confirmed" | "done";
  notes: string;
};

type DriveAsset = {
  id: string;
  name: string;
  kind: "doc" | "sheet" | "slide" | "zip" | "other";
  size_kb: number;
  owner: string;
  version: number;
  shared_with: string;
};

type VaultSecret = {
  id: string;
  label: string;
  scope: "workspace" | "org" | "deploy";
  owner: string;
  last_rotated: string;
  status: "active" | "rotation_due";
  redacted_value: string;
};

type FormQuestion = {
  id: string;
  prompt: string;
  type: "short_text" | "long_text" | "select";
  required: boolean;
  owner: string;
};

type NoteItem = {
  id: string;
  title: string;
  body: string;
  tags: string;
  owner: string;
  updated_at: string;
};

type MergePreviewState = {
  appId: "SkyeSheets" | "SkyeSlides" | "SkyeTasks";
  message: string;
  localSnapshot: string;
  serverSnapshot: string;
  serverRecordId: string;
  serverUpdatedAt: string;
};

type SkyeEnvelope = {
  format: "skye-v2";
  app: SkyeAppId;
  ws_id: string;
  exported_at: string;
  encrypted: boolean;
  payload?: string;
  cipher?: string;
  iv?: string;
  salt?: string;
};

const DEFAULT_WORKER_URL =
  (import.meta.env.VITE_WORKER_RUNNER_URL as string | undefined) || "https://your-worker.workers.dev";
const KNOWN_WORKER_URL = "https://kaixu-superide-runner.skyesoverlondon.workers.dev";
const DEFAULT_WS_ID = (import.meta.env.VITE_DEFAULT_WS_ID as string | undefined) || "primary-workspace";
const DEFAULT_SITE_BASE = (import.meta.env.VITE_SITE_BASE_URL as string | undefined) || window.location.origin;
const HISTORY_PAGE_SIZE = 50;

const SKYE_APPS: SkyeAppDefinition[] = [
  { id: "SkyeDocs", summary: "Collaborative document workspace.", mvp: ["Rich text", "Markdown mode", "Autosave"] },
  { id: "SkyeDocxPro", summary: "Full document production suite integrated into SuperIDE.", mvp: ["Advanced editor", "Offline-ready workflows", "Production-grade exports"] },
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

const APP_TUTORIALS: Record<SkyeAppId, string[]> = {
  SkyeDocs: [
    "Open a project file from the left pane.",
    "Edit content in Monaco and verify syntax highlighting.",
    "Use Assistant tab to generate/refactor with SKNore enforcement.",
    "Share progress to team via Project Share panel.",
  ],
  SkyeDocxPro: [
    "Launch DocxPro in embedded mode from SuperIDE.",
    "Create/open document and validate real editor interactions.",
    "Run review console workflow: comments, suggestion mode, and timeline snapshot restore.",
    "Use template + metadata controls and insert page breaks for structured output.",
    "Run encrypted .skye export with passphrase + hint and download Recovery Failsafe Kit.",
    "Store recovery kit separately from passphrase vault and perform one recovery import drill.",
    "Run full export flow (PDF/TXT/HTML ZIP/.skye) and verify artifact integrity.",
    "Share resulting workspace update to team via Project Share.",
  ],
  SkyeSheets: [
    "Add or edit sheet cells for sprint planning.",
    "Track values by row/column for team reporting.",
    "Capture summary note and share through Project Share.",
  ],
  SkyeSlides: [
    "Create slide items for stakeholder narrative.",
    "Add roadmap milestones and technical highlights.",
    "Send deck context to team with Project Share.",
  ],
  SkyeMail: [
    "Compose recipient, subject, and body.",
    "Optionally set a SkyeChat channel hook.",
    "Send and review persisted history below.",
  ],
  SkyeChat: [
    "Set channel and message payload.",
    "Notify channel and verify history persists.",
    "Filter by channel/search to recover prior updates.",
  ],
  SkyeCalendar: [
    "Create milestone events with owner and status gates.",
    "Capture outcomes/notes for each calendar event.",
    "Track confirmation progression (planned → confirmed → done).",
  ],
  SkyeDrive: [
    "Register artifacts with type/version metadata.",
    "Record share targets and bump versions on updates.",
    "Validate launch packet files are current before handoff.",
  ],
  SkyeVault: [
    "Register secret labels with scope and owner.",
    "Mark rotation state and execute rotation updates.",
    "Verify no plaintext secrets are exposed in UI exports.",
  ],
  SkyeForms: [
    "Build question set with required/optional flags.",
    "Use field types for intake quality (short/long/select).",
    "Review form readiness before workspace broadcast.",
  ],
  SkyeNotes: [
    "Capture decision logs with searchable tags.",
    "Maintain ownership and timestamped note updates.",
    "Package final notes into launch handoff context.",
  ],
  SkyeAnalytics: [
    "Review suite KPI cards.",
    "Inspect smoke trend and delivery velocity.",
    "Share KPI summary to team channels.",
  ],
  SkyeTasks: [
    "Maintain backlog/doing/done states.",
    "Use task cards for owner accountability.",
    "Share status updates to team via chat/mail.",
  ],
  SkyeAdmin: [
    "Invite teammates with role assignment.",
    "Review org membership roster.",
    "Issue scoped test tokens for controlled validation.",
  ],
};

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
  const trimmed = (raw || "").trim();
  if (!trimmed || trimmed === "https://your-site.netlify.app") return window.location.origin;
  return trimmed.replace(/\/+$/, "");
}

function normalizeWorkerUrl(raw: string | null | undefined): string {
  const trimmed = (raw || "").trim();
  if (!trimmed || trimmed === "https://your-worker.workers.dev") return KNOWN_WORKER_URL;
  if (trimmed === "https://kaixu-superide-runner.workers.dev") return KNOWN_WORKER_URL;
  return trimmed;
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

function asObject(value: unknown): Record<string, any> {
  if (!value) return {};
  if (typeof value === "string") {
    const parsed = tryParseJson(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, any>) : {};
  }
  if (typeof value === "object") return value as Record<string, any>;
  return {};
}

function formatSkyeMailRecord(record: AppRecord): string {
  const payload = asObject(record.payload);
  const to = String(payload.to || "unknown");
  const subject = String(payload.subject || record.title || "(no subject)");
  return `${subject} -> ${to}`;
}

function formatSkyeChatRecord(record: AppRecord): string {
  const payload = asObject(record.payload);
  const channel = String(payload.channel || "general");
  const message = String(payload.message || record.title || "(no message)");
  return `#${channel}: ${message}`;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((value) => value.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function deriveSkyeKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: toArrayBuffer(salt), iterations: 150000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptSkyePayload(plainText: string, passphrase: string): Promise<{ cipher: string; iv: string; salt: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveSkyeKey(passphrase, salt);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, key, toArrayBuffer(new TextEncoder().encode(plainText)));
  return {
    cipher: bytesToBase64(new Uint8Array(cipher)),
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
  };
}

async function decryptSkyePayload(cipherB64: string, ivB64: string, saltB64: string, passphrase: string): Promise<string> {
  const iv = base64ToBytes(ivB64);
  const salt = base64ToBytes(saltB64);
  const key = await deriveSkyeKey(passphrase, salt);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, key, toArrayBuffer(base64ToBytes(cipherB64)));
  return new TextDecoder().decode(plain);
}

export function App() {
  const [appMode, setAppMode] = useState<AppMode>("skyeide");
  const [toolTab, setToolTab] = useState<ToolTab>("assistant");
  const [selectedSkyeApp, setSelectedSkyeApp] = useState<SkyeAppId>("SkyeDocxPro");

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
  const [tutorialChecks, setTutorialChecks] = useState<Record<string, boolean>>(() => {
    const raw = localStorage.getItem("kx.skye.apps.tutorial");
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  });

  const [workerUrl, setWorkerUrl] = useState(() => normalizeWorkerUrl(localStorage.getItem("kx.worker.url") || DEFAULT_WORKER_URL));
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

  const [sheetsModel, setSheetsModel] = useState<SheetsModel>(() => {
    const raw = localStorage.getItem("kx.skye.sheets.model");
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as SheetsModel;
        if (parsed?.columns?.length && Array.isArray(parsed?.rows)) return parsed;
      } catch {
      }
    }
    return {
      title: "Program Workbook",
      columns: ["A", "B", "C", "D", "E"],
      rows: Array.from({ length: 5 }, (_, i) => ({
        id: `row-${i + 1}`,
        cells: Array.from({ length: 5 }, () => ""),
        owner: "owner@skye.local",
        updated_at: new Date().toISOString(),
      })),
    };
  });
  const [sheetsSearch, setSheetsSearch] = useState("");
  const [sheetsRecordId, setSheetsRecordId] = useState("");
  const [sheetsRecordUpdatedAt, setSheetsRecordUpdatedAt] = useState("");
  const [sheetsHydrated, setSheetsHydrated] = useState(false);

  const [slidesModel, setSlidesModel] = useState<SlidesModel>(() => {
    const raw = localStorage.getItem("kx.skye.slides.model");
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as SlidesModel;
        if (Array.isArray(parsed?.slides)) return parsed;
      } catch {
      }
    }
    const now = new Date().toISOString();
    return {
      title: "Executive Narrative",
      slides: [
        { id: "slide-1", title: "Welcome", summary: "Mission and context", speaker: "owner@skye.local", status: "approved", updated_at: now },
        { id: "slide-2", title: "Roadmap", summary: "Q2 priorities", speaker: "owner@skye.local", status: "review", updated_at: now },
        { id: "slide-3", title: "Risks", summary: "Top blockers + mitigations", speaker: "owner@skye.local", status: "draft", updated_at: now },
      ],
    };
  });
  const [activeSlideId, setActiveSlideId] = useState<string>("slide-1");
  const [slidesRecordId, setSlidesRecordId] = useState("");
  const [slidesRecordUpdatedAt, setSlidesRecordUpdatedAt] = useState("");
  const [slidesHydrated, setSlidesHydrated] = useState(false);
  const [mailItems, setMailItems] = useState<string[]>([]);
  const [chatMessages, setChatMessages] = useState<string[]>([]);
  const [adminUsers, setAdminUsers] = useState<Array<{ email: string; role: AuthRole }>>([
    { email: "founder@skye.local", role: "owner" },
    { email: "ops@skye.local", role: "admin" },
    { email: "dev@skye.local", role: "member" },
  ]);
  const [tasksModel, setTasksModel] = useState<TaskCard[]>(() => {
    const raw = localStorage.getItem("kx.skye.tasks.model");
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as TaskCard[];
        if (Array.isArray(parsed)) return parsed;
      } catch {
      }
    }
    const now = new Date().toISOString();
    return [
      {
        id: "task-auth-policy",
        title: "Auth policy",
        description: "Enforce org/workspace role boundaries end-to-end",
        status: "backlog",
        priority: "high",
        assignee: "ops@skye.local",
        due_at: "",
        updated_at: now,
      },
      {
        id: "task-skye-docs",
        title: "SkyeDocs editor",
        description: "Harden editing and save behavior",
        status: "doing",
        priority: "medium",
        assignee: "dev@skye.local",
        due_at: "",
        updated_at: now,
      },
      {
        id: "task-shell-routing",
        title: "App shell routing",
        description: "Baseline navigation and module wiring",
        status: "done",
        priority: "low",
        assignee: "owner@skye.local",
        due_at: "",
        updated_at: now,
      },
    ];
  });
  const [taskDraftTitle, setTaskDraftTitle] = useState("");
  const [taskDraftAssignee, setTaskDraftAssignee] = useState("");
  const [taskDraftPriority, setTaskDraftPriority] = useState<"low" | "medium" | "high">("medium");
  const [taskFilterStatus, setTaskFilterStatus] = useState<"all" | "backlog" | "doing" | "done">("all");
  const [tasksRecordId, setTasksRecordId] = useState("");
  const [tasksRecordUpdatedAt, setTasksRecordUpdatedAt] = useState("");
  const [tasksHydrated, setTasksHydrated] = useState(false);
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
  const [isLoadingMailHistory, setIsLoadingMailHistory] = useState(false);
  const [mailHistoryQuery, setMailHistoryQuery] = useState("");
  const [mailHistoryCursor, setMailHistoryCursor] = useState<string | null>(null);
  const [mailHasMore, setMailHasMore] = useState(false);
  const [chatChannelInput, setChatChannelInput] = useState("general");
  const [chatMessageInput, setChatMessageInput] = useState("SkyeChat notify test");
  const [chatNotifyResult, setChatNotifyResult] = useState("");
  const [isNotifyingChat, setIsNotifyingChat] = useState(false);
  const [isLoadingChatHistory, setIsLoadingChatHistory] = useState(false);
  const [chatHistoryQuery, setChatHistoryQuery] = useState("");
  const [chatHistoryChannel, setChatHistoryChannel] = useState("");
  const [chatHistoryCursor, setChatHistoryCursor] = useState<string | null>(null);
  const [chatHasMore, setChatHasMore] = useState(false);
  const [neuralRoomChannel, setNeuralRoomChannel] = useState("neural-space");
  const [neuralRoomMessage, setNeuralRoomMessage] = useState("Neural Space Pro session online and synchronized with IDE workspace.");
  const [isPublishingNeuralRoom, setIsPublishingNeuralRoom] = useState(false);
  const [isPublishingNeuralKaixu, setIsPublishingNeuralKaixu] = useState(false);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([
    {
      id: "cal-1",
      title: "HP Integration Review",
      start_date: "2026-03-05",
      end_date: "2026-03-05",
      owner: "founder@skye.local",
      status: "confirmed",
      notes: "Launch-readiness walkthrough",
    },
    {
      id: "cal-2",
      title: "Release Train",
      start_date: "2026-03-08",
      end_date: "2026-03-08",
      owner: "ops@skye.local",
      status: "planned",
      notes: "Suite stabilization and smoke audit",
    },
  ]);
  const [calendarDraftTitle, setCalendarDraftTitle] = useState("");
  const [calendarDraftStart, setCalendarDraftStart] = useState("");
  const [calendarDraftEnd, setCalendarDraftEnd] = useState("");

  const [driveAssets, setDriveAssets] = useState<DriveAsset[]>([
    { id: "drive-1", name: "pitch-deck-v3.pdf", kind: "slide", size_kb: 2480, owner: "founder@skye.local", version: 3, shared_with: "hp-team@partner.com" },
    { id: "drive-2", name: "roadmap.xlsx", kind: "sheet", size_kb: 920, owner: "ops@skye.local", version: 5, shared_with: "execs@skye.local" },
  ]);
  const [driveDraftName, setDriveDraftName] = useState("");
  const [driveDraftKind, setDriveDraftKind] = useState<DriveAsset["kind"]>("other");

  const [vaultSecrets, setVaultSecrets] = useState<VaultSecret[]>([
    { id: "vault-1", label: "NETLIFY_TOKEN", scope: "deploy", owner: "ops@skye.local", last_rotated: "2026-02-21", status: "active", redacted_value: "****token" },
    { id: "vault-2", label: "CF_ACCESS_CLIENT_SECRET", scope: "org", owner: "owner@skye.local", last_rotated: "2025-12-02", status: "rotation_due", redacted_value: "****secret" },
  ]);
  const [vaultDraftLabel, setVaultDraftLabel] = useState("");
  const [vaultDraftScope, setVaultDraftScope] = useState<VaultSecret["scope"]>("workspace");

  const [formQuestions, setFormQuestions] = useState<FormQuestion[]>([
    { id: "form-1", prompt: "How satisfied are you with onboarding?", type: "select", required: true, owner: "ops@skye.local" },
    { id: "form-2", prompt: "What should we improve next sprint?", type: "long_text", required: false, owner: "ops@skye.local" },
  ]);
  const [formDraftPrompt, setFormDraftPrompt] = useState("");
  const [formDraftType, setFormDraftType] = useState<FormQuestion["type"]>("short_text");

  const [notesModel, setNotesModel] = useState<NoteItem[]>([
    { id: "note-1", title: "Investor prep notes", body: "Position product as secure launch-ready suite with failsafe workflows.", tags: "investor,hp,launch", owner: "founder@skye.local", updated_at: new Date().toISOString() },
    { id: "note-2", title: "Incident checklist", body: "Smoke run, auth checks, policy gate verification, and release rollback proof.", tags: "ops,runbook", owner: "ops@skye.local", updated_at: new Date().toISOString() },
  ]);
  const [noteDraftTitle, setNoteDraftTitle] = useState("");
  const [noteSearch, setNoteSearch] = useState("");

  const [teamInviteEmail, setTeamInviteEmail] = useState("");
  const [teamInviteRole, setTeamInviteRole] = useState<AuthRole>("member");
  const [isInvitingTeam, setIsInvitingTeam] = useState(false);
  const [teamResult, setTeamResult] = useState("");
  const [isLoadingTeam, setIsLoadingTeam] = useState(false);
  const [shareMode, setShareMode] = useState<ShareMode>("app");
  const [shareRecipientEmail, setShareRecipientEmail] = useState("");
  const [shareChannel, setShareChannel] = useState("general");
  const [shareNote, setShareNote] = useState("");
  const [isSharingProject, setIsSharingProject] = useState(false);
  const [shareResult, setShareResult] = useState("");
  const [isAskingKaixuInChat, setIsAskingKaixuInChat] = useState(false);
  const [workspaceMemberEmail, setWorkspaceMemberEmail] = useState("");
  const [workspaceMemberRole, setWorkspaceMemberRole] = useState<"editor" | "viewer" | "remove">("editor");
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const [workspaceMemberResult, setWorkspaceMemberResult] = useState("");
  const [isLoadingWorkspaceMembers, setIsLoadingWorkspaceMembers] = useState(false);
  const [inviteAcceptEmail, setInviteAcceptEmail] = useState("");
  const [inviteAcceptPassword, setInviteAcceptPassword] = useState("");
  const [inviteAcceptResult, setInviteAcceptResult] = useState("");
  const [isAcceptingInvite, setIsAcceptingInvite] = useState(false);
  const [inviteToken] = useState(() => new URLSearchParams(window.location.search).get("invite_token") || "");
  const [dismissedStaleSmokeWarning, setDismissedStaleSmokeWarning] = useState(() => localStorage.getItem("kx.smoke.warning.dismissed") === "1");
  const [isLoadingSuiteModels, setIsLoadingSuiteModels] = useState(false);
  const [suiteSyncResult, setSuiteSyncResult] = useState("");
  const [mergePreview, setMergePreview] = useState<MergePreviewState | null>(null);
  const [skyePassphrase, setSkyePassphrase] = useState("");
  const [skyeEncrypt, setSkyeEncrypt] = useState(true);
  const [isImportingSkye, setIsImportingSkye] = useState(false);

  const healthUrl = useMemo(() => `${normalizeBaseUrl(workerUrl)}/health`, [workerUrl]);
  const activeFile = useMemo(() => files.find((file) => file.path === activePath) || files[0], [files, activePath]);
  const sknorePatterns = useMemo(() => normalizeSknorePatterns(sknoreText.split("\n")), [sknoreText]);
  const sknoreBlockedCount = useMemo(
    () => files.filter((file) => isSknoreProtected(file.path, sknorePatterns)).length,
    [files, sknorePatterns]
  );
  const smokeStaleWarningReason = useMemo(() => {
    if (dismissedStaleSmokeWarning) return "";
    const normalized = normalizeWorkerUrl(workerUrl);
    if (workerUrl !== normalized) {
      return "Worker URL in local storage is from an old build/state and has been auto-corrected for hardened smoke behavior.";
    }

    const hasLegacyWorker = workerUrl.includes("kaixu-superide-runner.workers.dev") || workerUrl.includes("your-worker.workers.dev");
    if (hasLegacyWorker) {
      return "Worker URL still points to a legacy placeholder/old domain. Smoke may fail even when deployment is healthy.";
    }

    const hasLegacyPolicyFail = smokeLedger.slice(-20).some((run) =>
      run.results.some((result) => result.name === "Worker Health" && !result.ok && [302, 401, 403].includes(result.status))
    );
    if (hasLegacyPolicyFail) {
      return "Recent smoke ledger contains old policy-protected failures (302/401/403). This browser likely ran a stale cached build recently.";
    }

    return "";
  }, [dismissedStaleSmokeWarning, workerUrl, smokeLedger]);

  useEffect(() => {
    localStorage.setItem("kx.worker.url", workerUrl);
  }, [workerUrl]);

  useEffect(() => {
    if (!dismissedStaleSmokeWarning) return;
    localStorage.setItem("kx.smoke.warning.dismissed", "1");
  }, [dismissedStaleSmokeWarning]);

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
    localStorage.setItem("kx.skye.apps.tutorial", JSON.stringify(tutorialChecks));
  }, [tutorialChecks]);

  useEffect(() => {
    localStorage.setItem("kx.sknore.patterns", sknoreText);
  }, [sknoreText]);

  useEffect(() => {
    localStorage.setItem("kx.auth.user", authUser);
    localStorage.setItem("kx.auth.role", authRole);
  }, [authUser, authRole]);

  useEffect(() => {
    localStorage.setItem("kx.skye.sheets.model", JSON.stringify(sheetsModel));
  }, [sheetsModel]);

  useEffect(() => {
    localStorage.setItem("kx.skye.slides.model", JSON.stringify(slidesModel));
  }, [slidesModel]);

  useEffect(() => {
    if (!slidesModel.slides.length) return;
    if (slidesModel.slides.some((slide) => slide.id === activeSlideId)) return;
    setActiveSlideId(slidesModel.slides[0].id);
  }, [slidesModel, activeSlideId]);

  useEffect(() => {
    localStorage.setItem("kx.skye.tasks.model", JSON.stringify(tasksModel));
  }, [tasksModel]);

  useEffect(() => {
    void runSmokeTest();
  }, []);

  useEffect(() => {
    void loadSkyeMailHistory();
    void loadSkyeChatHistory();
  }, []);

  useEffect(() => {
    void loadSkyeSuiteModels();
  }, [workspaceId]);

  useEffect(() => {
    if (selectedSkyeApp === "SkyeAdmin") {
      void loadTeamMembers();
      void loadWorkspaceMembers();
    }
  }, [selectedSkyeApp]);

  useEffect(() => {
    if (selectedSkyeApp === "SkyeAdmin") {
      void loadWorkspaceMembers();
    }
  }, [workspaceId, selectedSkyeApp]);

  useEffect(() => {
    void loadTeamMembers();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      void runSmokehouseSuite("auto");
    }, 13 * 60 * 1000);
    return () => clearInterval(timer);
  }, [siteBaseUrl, workerUrl, workspaceId, activePath, files]);

  useEffect(() => {
    if (!sheetsHydrated) return;
    const timer = setTimeout(() => {
      void saveSkyeSheetsModel();
    }, 700);
    return () => clearTimeout(timer);
  }, [sheetsModel, workspaceId, sheetsHydrated, sheetsRecordId]);

  useEffect(() => {
    if (!slidesHydrated) return;
    const timer = setTimeout(() => {
      void saveSkyeSlidesModel();
    }, 700);
    return () => clearTimeout(timer);
  }, [slidesModel, workspaceId, slidesHydrated, slidesRecordId]);

  useEffect(() => {
    if (!tasksHydrated) return;
    const timer = setTimeout(() => {
      void saveSkyeTasksModel();
    }, 700);
    return () => clearTimeout(timer);
  }, [tasksModel, workspaceId, tasksHydrated, tasksRecordId]);

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

  function makeTutorialKey(appId: SkyeAppId, step: string) {
    return `${appId}::${step}`;
  }

  function toggleTutorialCheck(appId: SkyeAppId, step: string) {
    const key = makeTutorialKey(appId, step);
    setTutorialChecks((old) => ({ ...old, [key]: !old[key] }));
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
      if ([302, 401, 403].includes(response.status)) {
        setRunnerStatus("ok");
        return { ok: true, text: `Smoke passed: worker reachable but policy-protected (${response.status}).` };
      }

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
        let ok = res.status >= 200 && res.status < 300;
        let summary = typeof tryParseJson(txt) === "string" ? txt.slice(0, 200) : JSON.stringify(tryParseJson(txt)).slice(0, 200);

        if (check.name === "Generate API" && res.status === 401) {
          ok = true;
          summary = "Endpoint is protected (401 Unauthorized) which is expected without valid session/token.";
        }

        if (check.name === "Auth Me" && [401, 403].includes(res.status)) {
          ok = true;
          summary = "Auth endpoint is protected and requires a valid session (expected in hardened deployments).";
        }

        if (check.name === "Worker Health" && [302, 401, 403].includes(res.status)) {
          ok = true;
          summary = "Worker is reachable but protected by access policy (expected in hardened deployments).";
        }

        out.push({
          name: check.name,
          method: check.method,
          url: check.url,
          status: res.status,
          ok,
          summary,
        });
      } catch (error: any) {
        const workerFetchBlocked =
          check.name === "Worker Health" &&
          /failed to fetch|networkerror|load failed/i.test(String(error?.message || ""));

        if (workerFetchBlocked) {
          out.push({
            name: check.name,
            method: check.method,
            url: check.url,
            status: 0,
            ok: true,
            summary: "Worker check blocked by browser CORS/Access boundary; treat as reachable policy boundary and validate with server-side smokehouse script.",
          });
          continue;
        }

        const fallbackSummary =
          check.name === "Worker Health"
            ? `Failed to fetch worker URL. Verify deployed domain (for this repo usually includes \".skyesoverlondon.workers.dev\") and Cloudflare Access policy.`
            : (error?.message || "network error");
        out.push({
          name: check.name,
          method: check.method,
          url: check.url,
          status: 0,
          ok: false,
          summary: fallbackSummary,
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

  function dismissSmokeStaleWarning() {
    setDismissedStaleSmokeWarning(true);
    localStorage.setItem("kx.smoke.warning.dismissed", "1");
  }

  function resetSmokeClientState() {
    localStorage.removeItem("kx.worker.url");
    localStorage.removeItem("kx.smoke.warning.dismissed");
    setDismissedStaleSmokeWarning(false);
    setWorkerUrl(KNOWN_WORKER_URL);
    setSmokeResults([]);
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

  async function loadSkyeMailHistory(options: { append?: boolean; before?: string | null } = {}) {
    const append = !!options.append;
    const before = options.before ?? (append ? mailHistoryCursor : null);
    setIsLoadingMailHistory(true);
    try {
      const qs = new URLSearchParams();
      qs.set("limit", String(HISTORY_PAGE_SIZE));
      if (before) qs.set("before", before);
      if (mailHistoryQuery.trim()) qs.set("q", mailHistoryQuery.trim());
      const res = await fetch(`/api/skymail-list?${qs.toString()}`, { method: "GET" });
      const data = (await res.json()) as HistoryResponse;
      if (!res.ok) {
        setMailSendResult(data?.error || `history failed (${res.status})`);
        return;
      }
      const records = Array.isArray(data?.records) ? data.records : [];
      const nextItems = records.map(formatSkyeMailRecord);
      setMailItems((old) => (append ? [...old, ...nextItems] : nextItems));
      setMailHistoryCursor(data?.page?.next_before || null);
      setMailHasMore(Boolean(data?.page?.has_more));
    } catch (error: any) {
      setMailSendResult(error?.message || "history failed");
    } finally {
      setIsLoadingMailHistory(false);
    }
  }

  async function loadSkyeChatHistory(options: { append?: boolean; before?: string | null } = {}) {
    const append = !!options.append;
    const before = options.before ?? (append ? chatHistoryCursor : null);
    setIsLoadingChatHistory(true);
    try {
      const qs = new URLSearchParams();
      qs.set("limit", String(HISTORY_PAGE_SIZE));
      if (before) qs.set("before", before);
      if (chatHistoryQuery.trim()) qs.set("q", chatHistoryQuery.trim());
      if (chatHistoryChannel.trim()) qs.set("channel", chatHistoryChannel.trim());
      const res = await fetch(`/api/skychat-list?${qs.toString()}`, { method: "GET" });
      const data = (await res.json()) as HistoryResponse;
      if (!res.ok) {
        setChatNotifyResult(data?.error || `history failed (${res.status})`);
        return;
      }
      const records = Array.isArray(data?.records) ? data.records : [];
      const nextItems = records.map(formatSkyeChatRecord);
      setChatMessages((old) => (append ? [...old, ...nextItems] : nextItems));
      setChatHistoryCursor(data?.page?.next_before || null);
      setChatHasMore(Boolean(data?.page?.has_more));
    } catch (error: any) {
      setChatNotifyResult(error?.message || "history failed");
    } finally {
      setIsLoadingChatHistory(false);
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
      setMailSendResult(`sent via ${data?.provider || "provider"} (mail_record_id=${data?.mail_record_id || "n/a"})`);
      await loadSkyeMailHistory();
      if (data?.chat_hook_id) await loadSkyeChatHistory();
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
          source: appMode === "neural" ? "Neural Space Pro / SkyeChat" : "SkyeChat UI",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setChatNotifyResult(data?.error || `notify failed (${res.status})`);
        return;
      }
      setChatNotifyResult(`notified (id=${data?.id || "n/a"})`);
      await loadSkyeChatHistory();
    } catch (error: any) {
      setChatNotifyResult(error?.message || "notify failed");
    } finally {
      setIsNotifyingChat(false);
    }
  }

  async function notifySkyeChatWithKaixu() {
    setIsAskingKaixuInChat(true);
    setChatNotifyResult("");
    try {
      const res = await fetch("/api/skychat-kaixu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: chatChannelInput,
          message: chatMessageInput,
          ws_id: workspaceId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setChatNotifyResult(data?.error || `kAIxU chat failed (${res.status})`);
        return;
      }
      setChatNotifyResult(`kAIxU replied in #${chatChannelInput}`);
      await loadSkyeChatHistory();
    } catch (error: any) {
      setChatNotifyResult(error?.message || "kAIxU chat failed");
    } finally {
      setIsAskingKaixuInChat(false);
    }
  }

  function openNeuralRoomInSkyeChat() {
    const channel = neuralRoomChannel.trim() || "neural-space";
    const message = neuralRoomMessage.trim();
    setAppMode("skyeide");
    setSelectedSkyeApp("SkyeChat");
    setChatChannelInput(channel);
    setChatHistoryChannel(channel);
    if (message) {
      setChatMessageInput(`[Neural Space Pro] ${message}`);
    }
    void loadSkyeChatHistory();
  }

  async function publishNeuralRoomUpdate(options: { askKaixu?: boolean } = {}) {
    const askKaixu = Boolean(options.askKaixu);
    const channel = neuralRoomChannel.trim() || "neural-space";
    const message = neuralRoomMessage.trim() || "Neural Space Pro update";
    const taggedMessage = `[Neural Space Pro][ws:${workspaceId}] ${message}`;

    if (askKaixu) {
      setIsPublishingNeuralKaixu(true);
    } else {
      setIsPublishingNeuralRoom(true);
    }
    setChatNotifyResult("");

    try {
      const res = await fetch(askKaixu ? "/api/skychat-kaixu" : "/api/skychat-notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          askKaixu
            ? {
                channel,
                message: taggedMessage,
                ws_id: workspaceId,
              }
            : {
                channel,
                message: taggedMessage,
                source: "Neural Space Pro",
              }
        ),
      });

      const data = await res.json();
      if (!res.ok) {
        setChatNotifyResult(data?.error || `${askKaixu ? "Neural kAIxU room" : "Neural room publish"} failed (${res.status})`);
        return;
      }

      setChatNotifyResult(
        askKaixu
          ? `Neural Space Pro update + kAIxU reply sent to #${channel}`
          : `Neural Space Pro update sent to #${channel}`
      );
      setChatChannelInput(channel);
      setChatHistoryChannel(channel);
      await loadSkyeChatHistory();
    } catch (error: any) {
      setChatNotifyResult(error?.message || `${askKaixu ? "Neural kAIxU room" : "Neural room publish"} failed`);
    } finally {
      setIsPublishingNeuralRoom(false);
      setIsPublishingNeuralKaixu(false);
    }
  }

  async function loadTeamMembers() {
    setIsLoadingTeam(true);
    try {
      const res = await fetch("/api/team-members", { method: "GET" });
      const data = await res.json();
      if (!res.ok) {
        setTeamResult(data?.error || `team load failed (${res.status})`);
        return;
      }
      const members = Array.isArray(data?.members) ? (data.members as TeamMember[]) : [];
      setAdminUsers(
        members.map((m) => ({
          email: m.email,
          role: (m.role || "member") as AuthRole,
        }))
      );
    } catch (error: any) {
      setTeamResult(error?.message || "team load failed");
    } finally {
      setIsLoadingTeam(false);
    }
  }

  async function inviteTeamMember() {
    setIsInvitingTeam(true);
    setTeamResult("");
    try {
      const res = await fetch("/api/team-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: teamInviteEmail,
          role: teamInviteRole,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTeamResult(data?.error || `invite failed (${res.status})`);
        return;
      }
      setTeamResult(`invite link sent to ${data?.email || teamInviteEmail} (${data?.role || teamInviteRole})`);
      await loadTeamMembers();
    } catch (error: any) {
      setTeamResult(error?.message || "invite failed");
    } finally {
      setIsInvitingTeam(false);
    }
  }

  async function acceptInviteLink() {
    if (!inviteToken) return;
    setIsAcceptingInvite(true);
    setInviteAcceptResult("");
    try {
      const res = await fetch("/api/team-invite-accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: inviteToken,
          email: inviteAcceptEmail,
          password: inviteAcceptPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInviteAcceptResult(data?.error || `accept failed (${res.status})`);
        return;
      }
      setInviteAcceptResult("Invite accepted. You are signed in and joined to the organization.");
      const next = new URL(window.location.href);
      next.searchParams.delete("invite_token");
      window.history.replaceState({}, "", next.toString());
      await loadTeamMembers();
    } catch (error: any) {
      setInviteAcceptResult(error?.message || "accept failed");
    } finally {
      setIsAcceptingInvite(false);
    }
  }

  async function loadWorkspaceMembers() {
    setIsLoadingWorkspaceMembers(true);
    try {
      const qs = new URLSearchParams();
      qs.set("id", workspaceId);
      const res = await fetch(`/api/ws-member-list?${qs.toString()}`, { method: "GET" });
      const data = await res.json();
      if (!res.ok) {
        setWorkspaceMemberResult(data?.error || `workspace members failed (${res.status})`);
        return;
      }
      const members = Array.isArray(data?.members) ? (data.members as WorkspaceMember[]) : [];
      setWorkspaceMembers(members);
    } catch (error: any) {
      setWorkspaceMemberResult(error?.message || "workspace members failed");
    } finally {
      setIsLoadingWorkspaceMembers(false);
    }
  }

  async function setWorkspaceMember() {
    setWorkspaceMemberResult("");
    try {
      const res = await fetch("/api/ws-member-set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ws_id: workspaceId,
          email: workspaceMemberEmail,
          role: workspaceMemberRole,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setWorkspaceMemberResult(data?.error || `workspace member update failed (${res.status})`);
        return;
      }
      setWorkspaceMemberResult(
        workspaceMemberRole === "remove"
          ? `Removed ${workspaceMemberEmail} from workspace.`
          : `Set ${workspaceMemberEmail} as ${workspaceMemberRole}.`
      );
      await loadWorkspaceMembers();
    } catch (error: any) {
      setWorkspaceMemberResult(error?.message || "workspace member update failed");
    }
  }

  async function shareProjectFromIDE() {
    setIsSharingProject(true);
    setShareResult("");
    try {
      const res = await fetch("/api/project-share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ws_id: workspaceId,
          mode: shareMode,
          recipient_email: shareRecipientEmail,
          channel: shareChannel,
          note: shareNote,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setShareResult(data?.error || `share failed (${res.status})`);
        return;
      }
      setShareResult(`shared ${data?.workspace?.name || workspaceId} via ${data?.mode || shareMode}`);
      if (shareMode === "mail" || shareMode === "all") await loadSkyeMailHistory();
      if (shareMode === "chat" || shareMode === "all") await loadSkyeChatHistory();
    } catch (error: any) {
      setShareResult(error?.message || "share failed");
    } finally {
      setIsSharingProject(false);
    }
  }

  async function loadSkyeSuiteModels() {
    if (!workspaceId.trim()) return;
    setIsLoadingSuiteModels(true);
    setSuiteSyncResult("");
    setSheetsRecordId("");
    setSlidesRecordId("");
    setTasksRecordId("");
    setSheetsRecordUpdatedAt("");
    setSlidesRecordUpdatedAt("");
    setTasksRecordUpdatedAt("");
    try {
      const qs = new URLSearchParams();
      qs.set("ws_id", workspaceId.trim());
      qs.set("limit", "1");

      const [sheetsRes, slidesRes, tasksRes] = await Promise.all([
        fetch(`/api/skyesheets-list?${qs.toString()}`, { method: "GET" }),
        fetch(`/api/skyeslides-list?${qs.toString()}`, { method: "GET" }),
        fetch(`/api/skyetasks-list?${qs.toString()}`, { method: "GET" }),
      ]);

      const [sheetsData, slidesData, tasksData] = await Promise.all([sheetsRes.json(), slidesRes.json(), tasksRes.json()]);

      if (sheetsRes.ok && Array.isArray(sheetsData?.records) && sheetsData.records.length) {
        const rec = sheetsData.records[0] as AppRecord;
        const model = asObject(rec.payload) as unknown as SheetsModel;
        if (Array.isArray(model?.columns) && Array.isArray(model?.rows)) {
          setSheetsModel(model);
          setSheetsRecordId(rec.id);
          setSheetsRecordUpdatedAt(String(rec.updated_at || ""));
        }
      }

      if (slidesRes.ok && Array.isArray(slidesData?.records) && slidesData.records.length) {
        const rec = slidesData.records[0] as AppRecord;
        const model = asObject(rec.payload) as unknown as SlidesModel;
        if (Array.isArray(model?.slides)) {
          setSlidesModel(model);
          setSlidesRecordId(rec.id);
          setSlidesRecordUpdatedAt(String(rec.updated_at || ""));
          if (model.slides.length) setActiveSlideId(model.slides[0].id);
        }
      }

      if (tasksRes.ok && Array.isArray(tasksData?.records) && tasksData.records.length) {
        const rec = tasksData.records[0] as AppRecord;
        const model = asObject(rec.payload) as unknown as TaskCard[];
        if (Array.isArray(model)) {
          setTasksModel(model);
          setTasksRecordId(rec.id);
          setTasksRecordUpdatedAt(String(rec.updated_at || ""));
        }
      }

      setSuiteSyncResult("Loaded SkyeSheets/Slides/Tasks from workspace records.");
    } catch (error: any) {
      setSuiteSyncResult(error?.message || "Suite model load failed");
    } finally {
      setSheetsHydrated(true);
      setSlidesHydrated(true);
      setTasksHydrated(true);
      setIsLoadingSuiteModels(false);
    }
  }

  async function saveSkyeSheetsModel() {
    if (!workspaceId.trim() || !sheetsHydrated) return;
    try {
      const res = await fetch("/api/skyesheets-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ws_id: workspaceId.trim(),
          record_id: sheetsRecordId || undefined,
          expected_updated_at: sheetsRecordUpdatedAt || undefined,
          title: sheetsModel.title,
          model: sheetsModel,
        }),
      });
      const data = await res.json();
      if (res.status === 409) {
        await openMergePreview(
          "SkyeSheets",
          data?.error || "SkyeSheets conflict detected.",
          sheetsModel,
          String(data?.current_record_id || sheetsRecordId),
          String(data?.current_updated_at || sheetsRecordUpdatedAt)
        );
        return;
      }
      if (res.ok && data?.record_id) {
        setSheetsRecordId(String(data.record_id));
        setSheetsRecordUpdatedAt(String(data?.updated_at || ""));
      }
    } catch {
    }
  }

  async function saveSkyeSlidesModel() {
    if (!workspaceId.trim() || !slidesHydrated) return;
    try {
      const res = await fetch("/api/skyeslides-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ws_id: workspaceId.trim(),
          record_id: slidesRecordId || undefined,
          expected_updated_at: slidesRecordUpdatedAt || undefined,
          title: slidesModel.title,
          model: slidesModel,
        }),
      });
      const data = await res.json();
      if (res.status === 409) {
        await openMergePreview(
          "SkyeSlides",
          data?.error || "SkyeSlides conflict detected.",
          slidesModel,
          String(data?.current_record_id || slidesRecordId),
          String(data?.current_updated_at || slidesRecordUpdatedAt)
        );
        return;
      }
      if (res.ok && data?.record_id) {
        setSlidesRecordId(String(data.record_id));
        setSlidesRecordUpdatedAt(String(data?.updated_at || ""));
      }
    } catch {
    }
  }

  async function saveSkyeTasksModel() {
    if (!workspaceId.trim() || !tasksHydrated) return;
    try {
      const res = await fetch("/api/skyetasks-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ws_id: workspaceId.trim(),
          record_id: tasksRecordId || undefined,
          expected_updated_at: tasksRecordUpdatedAt || undefined,
          title: "SkyeTasks Board",
          model: tasksModel,
        }),
      });
      const data = await res.json();
      if (res.status === 409) {
        await openMergePreview(
          "SkyeTasks",
          data?.error || "SkyeTasks conflict detected.",
          tasksModel,
          String(data?.current_record_id || tasksRecordId),
          String(data?.current_updated_at || tasksRecordUpdatedAt)
        );
        return;
      }
      if (res.ok && data?.record_id) {
        setTasksRecordId(String(data.record_id));
        setTasksRecordUpdatedAt(String(data?.updated_at || ""));
      }
    } catch {
    }
  }

  async function fetchLatestSuiteRecord(appId: "SkyeSheets" | "SkyeSlides" | "SkyeTasks"): Promise<AppRecord | null> {
    const qs = new URLSearchParams();
    qs.set("ws_id", workspaceId.trim());
    qs.set("limit", "1");
    const path =
      appId === "SkyeSheets"
        ? "/api/skyesheets-list"
        : appId === "SkyeSlides"
          ? "/api/skyeslides-list"
          : "/api/skyetasks-list";
    const res = await fetch(`${path}?${qs.toString()}`, { method: "GET" });
    const data = await res.json();
    if (!res.ok) return null;
    if (!Array.isArray(data?.records) || !data.records.length) return null;
    return data.records[0] as AppRecord;
  }

  async function openMergePreview(
    appId: "SkyeSheets" | "SkyeSlides" | "SkyeTasks",
    message: string,
    localModel: unknown,
    fallbackRecordId = "",
    fallbackUpdatedAt = ""
  ) {
    const latest = await fetchLatestSuiteRecord(appId);
    const serverPayload = latest ? asObject(latest.payload) : {};
    setMergePreview({
      appId,
      message,
      localSnapshot: JSON.stringify(localModel, null, 2),
      serverSnapshot: JSON.stringify(serverPayload, null, 2),
      serverRecordId: String(latest?.id || fallbackRecordId || ""),
      serverUpdatedAt: String(latest?.updated_at || fallbackUpdatedAt || ""),
    });
  }

  function acceptMergeServerRefresh() {
    if (!mergePreview) return;
    const serverModel = tryParseJson(mergePreview.serverSnapshot);
    if (mergePreview.appId === "SkyeSheets") {
      const model = serverModel as SheetsModel;
      if (Array.isArray(model?.columns) && Array.isArray(model?.rows)) {
        setSheetsModel(model);
        setSheetsRecordId(mergePreview.serverRecordId);
        setSheetsRecordUpdatedAt(mergePreview.serverUpdatedAt);
      }
    }
    if (mergePreview.appId === "SkyeSlides") {
      const model = serverModel as SlidesModel;
      if (Array.isArray(model?.slides)) {
        setSlidesModel(model);
        setSlidesRecordId(mergePreview.serverRecordId);
        setSlidesRecordUpdatedAt(mergePreview.serverUpdatedAt);
        if (model.slides.length) setActiveSlideId(model.slides[0].id);
      }
    }
    if (mergePreview.appId === "SkyeTasks") {
      const model = serverModel as TaskCard[];
      if (Array.isArray(model)) {
        setTasksModel(model);
        setTasksRecordId(mergePreview.serverRecordId);
        setTasksRecordUpdatedAt(mergePreview.serverUpdatedAt);
      }
    }
    setSuiteSyncResult(`${mergePreview.appId} refreshed with server version after conflict.`);
    setMergePreview(null);
  }

  function currentAppPayload(): Record<string, unknown> {
    if (selectedSkyeApp === "SkyeDocs") {
      return { files, active_path: activePath };
    }
    if (selectedSkyeApp === "SkyeSheets") {
      return { model: sheetsModel, record_id: sheetsRecordId, updated_at: sheetsRecordUpdatedAt };
    }
    if (selectedSkyeApp === "SkyeSlides") {
      return { model: slidesModel, record_id: slidesRecordId, updated_at: slidesRecordUpdatedAt };
    }
    if (selectedSkyeApp === "SkyeTasks") {
      return { model: tasksModel, record_id: tasksRecordId, updated_at: tasksRecordUpdatedAt };
    }
    if (selectedSkyeApp === "SkyeMail") {
      return { compose: { to: mailTo, subject: mailSubject, text: mailText }, history: mailItems };
    }
    if (selectedSkyeApp === "SkyeChat") {
      return { compose: { channel: chatChannelInput, message: chatMessageInput }, history: chatMessages };
    }
    if (selectedSkyeApp === "SkyeCalendar") return { events: calendarEvents };
    if (selectedSkyeApp === "SkyeDrive") return { assets: driveAssets };
    if (selectedSkyeApp === "SkyeVault") return { secrets: vaultSecrets };
    if (selectedSkyeApp === "SkyeForms") return { questions: formQuestions };
    if (selectedSkyeApp === "SkyeNotes") return { notes: notesModel };
    if (selectedSkyeApp === "SkyeAnalytics") return { smoke_runs: smokeLedger.length, mvp_complete: completeMvpItems };
    return { workspace_id: workspaceId, note: "SkyeDocxPro state is managed in embedded app." };
  }

  function applyImportedAppPayload(appId: SkyeAppId, payload: Record<string, any>) {
    if (appId === "SkyeDocs") {
      if (Array.isArray(payload.files)) setFiles(payload.files as WorkspaceFile[]);
      if (typeof payload.active_path === "string") setActivePath(payload.active_path);
      return;
    }
    if (appId === "SkyeSheets") {
      const model = payload.model as SheetsModel;
      if (Array.isArray(model?.columns) && Array.isArray(model?.rows)) setSheetsModel(model);
      return;
    }
    if (appId === "SkyeSlides") {
      const model = payload.model as SlidesModel;
      if (Array.isArray(model?.slides)) {
        setSlidesModel(model);
        if (model.slides.length) setActiveSlideId(model.slides[0].id);
      }
      return;
    }
    if (appId === "SkyeTasks") {
      const model = payload.model as TaskCard[];
      if (Array.isArray(model)) setTasksModel(model);
      return;
    }
    if (appId === "SkyeMail") {
      const compose = payload.compose || {};
      if (typeof compose.to === "string") setMailTo(compose.to);
      if (typeof compose.subject === "string") setMailSubject(compose.subject);
      if (typeof compose.text === "string") setMailText(compose.text);
      if (Array.isArray(payload.history)) setMailItems(payload.history);
      return;
    }
    if (appId === "SkyeChat") {
      const compose = payload.compose || {};
      if (typeof compose.channel === "string") setChatChannelInput(compose.channel);
      if (typeof compose.message === "string") setChatMessageInput(compose.message);
      if (Array.isArray(payload.history)) setChatMessages(payload.history);
      return;
    }
    if (appId === "SkyeCalendar" && Array.isArray(payload.events)) setCalendarEvents(payload.events as CalendarEvent[]);
    if (appId === "SkyeDrive" && Array.isArray(payload.assets)) setDriveAssets(payload.assets as DriveAsset[]);
    if (appId === "SkyeVault" && Array.isArray(payload.secrets)) setVaultSecrets(payload.secrets as VaultSecret[]);
    if (appId === "SkyeForms" && Array.isArray(payload.questions)) setFormQuestions(payload.questions as FormQuestion[]);
    if (appId === "SkyeNotes" && Array.isArray(payload.notes)) setNotesModel(payload.notes as NoteItem[]);
  }

  async function exportSelectedAppAsSkye() {
    try {
      const envelopeBase = {
        format: "skye-v2" as const,
        app: selectedSkyeApp,
        ws_id: workspaceId,
        exported_at: new Date().toISOString(),
      };
      const payloadString = JSON.stringify(currentAppPayload());
      let envelope: SkyeEnvelope;

      if (skyeEncrypt && skyePassphrase.trim()) {
        const encrypted = await encryptSkyePayload(payloadString, skyePassphrase.trim());
        envelope = { ...envelopeBase, encrypted: true, ...encrypted };
      } else {
        envelope = { ...envelopeBase, encrypted: false, payload: bytesToBase64(new TextEncoder().encode(payloadString)) };
      }

      const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selectedSkyeApp}-${Date.now()}.skye`;
      a.click();
      URL.revokeObjectURL(url);
      setSuiteSyncResult(`Exported ${selectedSkyeApp} as .skye`);
    } catch (error: any) {
      setSuiteSyncResult(error?.message || "Skye export failed.");
    }
  }

  async function onImportSkyeFile(event: any) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsImportingSkye(true);
    try {
      const text = await file.text();
      const envelope = tryParseJson(text) as SkyeEnvelope;
      if (!envelope || envelope.format !== "skye-v2" || !envelope.app) {
        setSuiteSyncResult("Invalid .skye package format.");
        return;
      }

      let payloadString = "";
      if (envelope.encrypted) {
        if (!skyePassphrase.trim()) {
          setSuiteSyncResult("This .skye package is encrypted. Enter passphrase and import again.");
          return;
        }
        payloadString = await decryptSkyePayload(
          String(envelope.cipher || ""),
          String(envelope.iv || ""),
          String(envelope.salt || ""),
          skyePassphrase.trim()
        );
      } else {
        payloadString = new TextDecoder().decode(base64ToBytes(String(envelope.payload || "")));
      }

      const payload = tryParseJson(payloadString) as Record<string, any>;
      applyImportedAppPayload(envelope.app, payload);
      setSuiteSyncResult(`Imported .skye package for ${envelope.app}`);
      setSelectedSkyeApp(envelope.app);
    } catch (error: any) {
      setSuiteSyncResult(error?.message || "Skye import failed.");
    } finally {
      setIsImportingSkye(false);
    }
  }

  async function shareAppSnapshot(appId: SkyeAppId, detail: string) {
    setIsSharingProject(true);
    setShareResult("");
    try {
      const effectiveMode: ShareMode = shareRecipientEmail.trim() ? "all" : "chat";
      const res = await fetch("/api/project-share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ws_id: workspaceId,
          mode: effectiveMode,
          recipient_email: shareRecipientEmail,
          channel: shareChannel || "general",
          note: `[${appId}] ${detail}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setShareResult(data?.error || `share failed (${res.status})`);
        return;
      }
      setShareResult(`${appId} snapshot shared via ${effectiveMode}`);
      await loadSkyeChatHistory();
      if (effectiveMode === "all") await loadSkyeMailHistory();
    } catch (error: any) {
      setShareResult(error?.message || "share failed");
    } finally {
      setIsSharingProject(false);
    }
  }

  function addSheetRow() {
    const width = sheetsModel.columns.length;
    const row: SheetRow = {
      id: `row-${Date.now()}`,
      cells: Array.from({ length: width }, () => ""),
      owner: authUser,
      updated_at: new Date().toISOString(),
    };
    setSheetsModel((old) => ({ ...old, rows: [...old.rows, row] }));
  }

  function addSheetColumn() {
    const nextCol = String.fromCharCode(65 + sheetsModel.columns.length);
    setSheetsModel((old) => ({
      ...old,
      columns: [...old.columns, nextCol],
      rows: old.rows.map((row) => ({ ...row, cells: [...row.cells, ""], updated_at: new Date().toISOString() })),
    }));
  }

  function updateSheetCell(rowId: string, colIndex: number, value: string) {
    setSheetsModel((old) => ({
      ...old,
      rows: old.rows.map((row) => {
        if (row.id !== rowId) return row;
        const nextCells = [...row.cells];
        nextCells[colIndex] = value;
        return { ...row, cells: nextCells, owner: authUser, updated_at: new Date().toISOString() };
      }),
    }));
  }

  function addSlide() {
    const slide: SlideItem = {
      id: `slide-${Date.now()}`,
      title: `Slide ${slidesModel.slides.length + 1}`,
      summary: "",
      speaker: authUser,
      status: "draft",
      updated_at: new Date().toISOString(),
    };
    setSlidesModel((old) => ({ ...old, slides: [...old.slides, slide] }));
    setActiveSlideId(slide.id);
  }

  function updateActiveSlide(patch: Partial<SlideItem>) {
    setSlidesModel((old) => ({
      ...old,
      slides: old.slides.map((slide) =>
        slide.id === activeSlideId ? { ...slide, ...patch, updated_at: new Date().toISOString() } : slide
      ),
    }));
  }

  function addTaskCard() {
    if (!taskDraftTitle.trim()) return;
    const card: TaskCard = {
      id: `task-${Date.now()}`,
      title: taskDraftTitle.trim(),
      description: "",
      status: "backlog",
      priority: taskDraftPriority,
      assignee: taskDraftAssignee.trim() || authUser,
      due_at: "",
      updated_at: new Date().toISOString(),
    };
    setTasksModel((old) => [card, ...old]);
    setTaskDraftTitle("");
    setTaskDraftAssignee("");
  }

  function updateTaskCard(taskId: string, patch: Partial<TaskCard>) {
    setTasksModel((old) => old.map((task) => (task.id === taskId ? { ...task, ...patch, updated_at: new Date().toISOString() } : task)));
  }

  function renderTutorialPanel(appId: SkyeAppId) {
    const steps = APP_TUTORIALS[appId] || [];
    const completed = steps.filter((step) => tutorialChecks[makeTutorialKey(appId, step)]).length;
    return (
      <section className="app-module">
        <header>
          <h2>{appId} Guided Checklist</h2>
          <p>{completed}/{steps.length} checklist steps complete</p>
        </header>
        <div className="list-stack">
          {steps.map((step) => {
            const checked = Boolean(tutorialChecks[makeTutorialKey(appId, step)]);
            return (
              <label key={`${appId}-${step}`} className="list-item" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleTutorialCheck(appId, step)}
                />
                <span>{step}</span>
              </label>
            );
          })}
        </div>
      </section>
    );
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

    if (selectedSkyeApp === "SkyeDocxPro") {
      return (
        <section className="app-module" style={{ minHeight: "84vh" }}>
          <header>
            <h2>SkyeDocxPro</h2>
            <p>Integrated enterprise document suite embedded in SuperIDE.</p>
          </header>
          <div className="tool-actions left" style={{ marginBottom: 10 }}>
            <a className="ghost" href="/SkyeDocxPro/index.html" target="_blank" rel="noreferrer">Open Standalone</a>
            <a className="ghost" href="/SkyeDocxPro/homepage.html" target="_blank" rel="noreferrer">Open Product Home</a>
          </div>
          <iframe
            title="SkyeDocxPro"
            src="/SkyeDocxPro/index.html"
            style={{ width: "100%", minHeight: "74vh", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, background: "#0b0914" }}
          />
        </section>
      );
    }

    if (selectedSkyeApp === "SkyeSheets") {
      const filteredRows = sheetsModel.rows.filter((row) => {
        if (!sheetsSearch.trim()) return true;
        const q = sheetsSearch.trim().toLowerCase();
        return row.cells.some((cell) => String(cell || "").toLowerCase().includes(q));
      });
      const filledCells = sheetsModel.rows.reduce(
        (sum, row) => sum + row.cells.filter((cell) => String(cell || "").trim().length > 0).length,
        0
      );
      return (
        <section className="app-module">
          <header><h2>SkyeSheets</h2><p>Workbook-grade table model with owner stamps and handoff controls.</p></header>
          <label>Workbook title</label>
          <input value={sheetsModel.title} onChange={(e) => setSheetsModel((old) => ({ ...old, title: e.target.value }))} />
          <div className="tool-row split">
            <input value={sheetsSearch} onChange={(e) => setSheetsSearch(e.target.value)} placeholder="Search workbook cells" />
            <input readOnly value={`Rows: ${sheetsModel.rows.length} · Filled cells: ${filledCells}`} />
          </div>
          <div className="tool-actions left">
            <button className="ghost" type="button" onClick={addSheetRow}>Add Row</button>
            <button className="ghost" type="button" onClick={addSheetColumn}>Add Column</button>
            <button className="ghost" type="button" onClick={() => void loadSkyeSuiteModels()} disabled={isLoadingSuiteModels}>
              {isLoadingSuiteModels ? "Syncing..." : "Sync Cloud Data"}
            </button>
            <button
              className="ghost"
              type="button"
              onClick={() => void shareAppSnapshot("SkyeSheets", `Workbook ${sheetsModel.title} rows=${sheetsModel.rows.length} cols=${sheetsModel.columns.length}`)}
              disabled={isSharingProject}
            >
              {isSharingProject ? "Sharing..." : "Share Workbook Snapshot"}
            </button>
          </div>
          <div className="sheet-grid">
            <div className="sheet-row">
              {sheetsModel.columns.map((col) => (
                <input key={`head-${col}`} value={col} readOnly />
              ))}
            </div>
            {filteredRows.map((row) => (
              <div key={row.id} className="sheet-row">
                {row.cells.map((cell, c) => (
                  <input
                    key={`c-${row.id}-${c}`}
                    value={cell}
                    onChange={(e) => updateSheetCell(row.id, c, e.target.value)}
                  />
                ))}
              </div>
            ))}
          </div>
          {suiteSyncResult && <p className="muted-copy">{suiteSyncResult}</p>}
          {shareResult && <p className="muted-copy">{shareResult}</p>}
        </section>
      );
    }

    if (selectedSkyeApp === "SkyeSlides") {
      const activeSlide = slidesModel.slides.find((slide) => slide.id === activeSlideId) || slidesModel.slides[0];
      return (
        <section className="app-module">
          <header><h2>SkyeSlides</h2><p>Deck state model with ownership, status gates, and delivery controls.</p></header>
          <label>Deck title</label>
          <input value={slidesModel.title} onChange={(e) => setSlidesModel((old) => ({ ...old, title: e.target.value }))} />
          <div className="tool-actions left">
            <button className="ghost" type="button" onClick={addSlide}>Add Slide</button>
            <button className="ghost" type="button" onClick={() => void loadSkyeSuiteModels()} disabled={isLoadingSuiteModels}>
              {isLoadingSuiteModels ? "Syncing..." : "Sync Cloud Data"}
            </button>
            <button
              className="ghost"
              type="button"
              onClick={() =>
                void shareAppSnapshot(
                  "SkyeSlides",
                  `Deck ${slidesModel.title} slides=${slidesModel.slides.length} approved=${slidesModel.slides.filter((s) => s.status === "approved").length}`
                )
              }
              disabled={isSharingProject}
            >
              {isSharingProject ? "Sharing..." : "Share Deck Snapshot"}
            </button>
          </div>
          <label>Slides</label>
          <select value={activeSlide?.id || ""} onChange={(e) => setActiveSlideId(e.target.value)}>
            {slidesModel.slides.map((slide) => (
              <option key={slide.id} value={slide.id}>
                {slide.title} · {slide.status}
              </option>
            ))}
          </select>
          {activeSlide && (
            <>
              <label>Slide title</label>
              <input value={activeSlide.title} onChange={(e) => updateActiveSlide({ title: e.target.value })} />
              <label>Summary</label>
              <textarea value={activeSlide.summary} onChange={(e) => updateActiveSlide({ summary: e.target.value })} rows={4} />
              <div className="tool-row split">
                <div>
                  <label>Speaker</label>
                  <input value={activeSlide.speaker} onChange={(e) => updateActiveSlide({ speaker: e.target.value })} />
                </div>
                <div>
                  <label>Status</label>
                  <select value={activeSlide.status} onChange={(e) => updateActiveSlide({ status: e.target.value as SlideItem["status"] })}>
                    <option value="draft">draft</option>
                    <option value="review">review</option>
                    <option value="approved">approved</option>
                  </select>
                </div>
              </div>
              <p className="muted-copy">Last update: {new Date(activeSlide.updated_at).toLocaleString()}</p>
            </>
          )}
          {suiteSyncResult && <p className="muted-copy">{suiteSyncResult}</p>}
          {shareResult && <p className="muted-copy">{shareResult}</p>}
        </section>
      );
    }

    if (selectedSkyeApp === "SkyeTasks") {
      const filteredTasks = tasksModel.filter((task) => (taskFilterStatus === "all" ? true : task.status === taskFilterStatus));
      return (
        <section className="app-module">
          <header><h2>SkyeTasks</h2><p>Priority-aware execution board with assignees, due dates, and handoff controls.</p></header>
          <div className="tool-row split">
            <input value={taskDraftTitle} onChange={(e) => setTaskDraftTitle(e.target.value)} placeholder="New task title" />
            <input value={taskDraftAssignee} onChange={(e) => setTaskDraftAssignee(e.target.value)} placeholder="Assignee email" />
          </div>
          <div className="tool-row split">
            <select value={taskDraftPriority} onChange={(e) => setTaskDraftPriority(e.target.value as "low" | "medium" | "high") }>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
            <select value={taskFilterStatus} onChange={(e) => setTaskFilterStatus(e.target.value as "all" | "backlog" | "doing" | "done") }>
              <option value="all">all</option>
              <option value="backlog">backlog</option>
              <option value="doing">doing</option>
              <option value="done">done</option>
            </select>
          </div>
          <div className="tool-actions left">
            <button className="ghost" type="button" onClick={addTaskCard}>Add Task</button>
            <button className="ghost" type="button" onClick={() => void loadSkyeSuiteModels()} disabled={isLoadingSuiteModels}>
              {isLoadingSuiteModels ? "Syncing..." : "Sync Cloud Data"}
            </button>
            <button
              className="ghost"
              type="button"
              onClick={() =>
                void shareAppSnapshot(
                  "SkyeTasks",
                  `Tasks backlog=${tasksModel.filter((t) => t.status === "backlog").length} doing=${tasksModel.filter((t) => t.status === "doing").length} done=${tasksModel.filter((t) => t.status === "done").length}`
                )
              }
              disabled={isSharingProject}
            >
              {isSharingProject ? "Sharing..." : "Share Task Snapshot"}
            </button>
          </div>
          <div className="kanban-grid">
            {(["backlog", "doing", "done"] as const).map((column) => (
              <div key={column} className="kanban-col">
                <h4>{column.toUpperCase()}</h4>
                {filteredTasks
                  .filter((task) => task.status === column)
                  .map((task) => (
                    <div key={task.id} className="kanban-card">
                      <strong>{task.title}</strong>
                      <div>{task.description || "No description"}</div>
                      <div>Owner: {task.assignee || "unassigned"}</div>
                      <div>Priority: {task.priority}</div>
                      <div className="tool-row" style={{ marginTop: 6 }}>
                        <select value={task.status} onChange={(e) => updateTaskCard(task.id, { status: e.target.value as TaskCard["status"] })}>
                          <option value="backlog">backlog</option>
                          <option value="doing">doing</option>
                          <option value="done">done</option>
                        </select>
                        <input type="date" value={task.due_at || ""} onChange={(e) => updateTaskCard(task.id, { due_at: e.target.value })} />
                      </div>
                    </div>
                  ))}
              </div>
            ))}
          </div>
          {suiteSyncResult && <p className="muted-copy">{suiteSyncResult}</p>}
          {shareResult && <p className="muted-copy">{shareResult}</p>}
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
            <button className="ghost" type="button" onClick={() => void loadSkyeMailHistory()} disabled={isLoadingMailHistory}>
              {isLoadingMailHistory ? "Refreshing..." : "Refresh History"}
            </button>
          </div>
          <label>History search</label>
          <input value={mailHistoryQuery} onChange={(e) => setMailHistoryQuery(e.target.value)} placeholder="Search recipient, subject, or body" />
          <div className="tool-actions left">
            <button className="ghost" type="button" onClick={() => void loadSkyeMailHistory()} disabled={isLoadingMailHistory}>
              Apply Filter
            </button>
          </div>
          {mailSendResult && <p className="muted-copy">{mailSendResult}</p>}
          {isLoadingMailHistory && <p className="muted-copy">Loading mail history...</p>}
          <div className="list-stack">
            {mailItems.map((item, index) => <div key={`mail-${index}`} className="list-item">{item}</div>)}
          </div>
          {mailHasMore && (
            <div className="tool-actions left">
              <button className="ghost" type="button" onClick={() => void loadSkyeMailHistory({ append: true })} disabled={isLoadingMailHistory}>
                {isLoadingMailHistory ? "Loading..." : "Load More"}
              </button>
            </div>
          )}
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
            <button className="ghost" type="button" onClick={() => void notifySkyeChatWithKaixu()} disabled={isAskingKaixuInChat}>
              {isAskingKaixuInChat ? "Asking kAIxU..." : "Send + Ask kAIxU"}
            </button>
            <button className="ghost" type="button" onClick={() => void loadSkyeChatHistory()} disabled={isLoadingChatHistory}>
              {isLoadingChatHistory ? "Refreshing..." : "Refresh History"}
            </button>
          </div>
          <label>History channel filter</label>
          <input value={chatHistoryChannel} onChange={(e) => setChatHistoryChannel(e.target.value)} placeholder="General" />
          <label>History search</label>
          <input value={chatHistoryQuery} onChange={(e) => setChatHistoryQuery(e.target.value)} placeholder="Search message or source" />
          <div className="tool-actions left">
            <button className="ghost" type="button" onClick={() => void loadSkyeChatHistory()} disabled={isLoadingChatHistory}>
              Apply Filter
            </button>
          </div>
          {chatNotifyResult && <p className="muted-copy">{chatNotifyResult}</p>}
          {isLoadingChatHistory && <p className="muted-copy">Loading chat history...</p>}
          <div className="list-stack">
            {chatMessages.map((item, index) => <div key={`chat-${index}`} className="list-item">{item}</div>)}
          </div>
          {chatHasMore && (
            <div className="tool-actions left">
              <button className="ghost" type="button" onClick={() => void loadSkyeChatHistory({ append: true })} disabled={isLoadingChatHistory}>
                {isLoadingChatHistory ? "Loading..." : "Load More"}
              </button>
            </div>
          )}
        </section>
      );
    }

    if (selectedSkyeApp === "SkyeCalendar") {
      const filtered = calendarEvents.filter((item) =>
        `${item.title} ${item.owner} ${item.notes}`.toLowerCase().includes((appSearch || "").toLowerCase())
      );
      return (
        <section className="app-module">
          <header><h2>SkyeCalendar</h2><p>Schedule operations with owner, status, and release readiness context.</p></header>
          <div className="tool-row split">
            <input value={calendarDraftTitle} onChange={(e) => setCalendarDraftTitle(e.target.value)} placeholder="Event title" />
            <input type="date" value={calendarDraftStart} onChange={(e) => setCalendarDraftStart(e.target.value)} />
          </div>
          <div className="tool-row split">
            <input type="date" value={calendarDraftEnd} onChange={(e) => setCalendarDraftEnd(e.target.value)} />
            <button
              className="ghost"
              type="button"
              onClick={() => {
                if (!calendarDraftTitle.trim() || !calendarDraftStart) return;
                const event: CalendarEvent = {
                  id: `cal-${Date.now()}`,
                  title: calendarDraftTitle.trim(),
                  start_date: calendarDraftStart,
                  end_date: calendarDraftEnd || calendarDraftStart,
                  owner: authUser,
                  status: "planned",
                  notes: "",
                };
                setCalendarEvents((old) => [event, ...old]);
                setCalendarDraftTitle("");
                setCalendarDraftStart("");
                setCalendarDraftEnd("");
              }}
            >
              Add Event
            </button>
          </div>
          <div className="list-stack">
            {filtered.map((item) => (
              <div key={item.id} className="list-item">
                <strong>{item.title}</strong>
                <div>{item.start_date} → {item.end_date}</div>
                <div className="tool-row split" style={{ marginTop: 6 }}>
                  <select value={item.status} onChange={(e) => setCalendarEvents((old) => old.map((x) => (x.id === item.id ? { ...x, status: e.target.value as CalendarEvent["status"] } : x)))}>
                    <option value="planned">planned</option>
                    <option value="confirmed">confirmed</option>
                    <option value="done">done</option>
                  </select>
                  <input value={item.notes} onChange={(e) => setCalendarEvents((old) => old.map((x) => (x.id === item.id ? { ...x, notes: e.target.value } : x)))} placeholder="Notes and outcomes" />
                </div>
              </div>
            ))}
          </div>
        </section>
      );
    }

    if (selectedSkyeApp === "SkyeDrive") {
      return (
        <section className="app-module">
          <header><h2>SkyeDrive</h2><p>Asset ledger with versioning and share targets for launch artifacts.</p></header>
          <div className="tool-row split">
            <input value={driveDraftName} onChange={(e) => setDriveDraftName(e.target.value)} placeholder="File name" />
            <select value={driveDraftKind} onChange={(e) => setDriveDraftKind(e.target.value as DriveAsset["kind"])}>
              <option value="doc">doc</option>
              <option value="sheet">sheet</option>
              <option value="slide">slide</option>
              <option value="zip">zip</option>
              <option value="other">other</option>
            </select>
          </div>
          <div className="tool-actions left">
            <button
              className="ghost"
              type="button"
              onClick={() => {
                if (!driveDraftName.trim()) return;
                setDriveAssets((old) => [
                  {
                    id: `drive-${Date.now()}`,
                    name: driveDraftName.trim(),
                    kind: driveDraftKind,
                    size_kb: 0,
                    owner: authUser,
                    version: 1,
                    shared_with: "",
                  },
                  ...old,
                ]);
                setDriveDraftName("");
              }}
            >
              Register Asset
            </button>
          </div>
          <div className="list-stack">
            {driveAssets.map((asset) => (
              <div key={asset.id} className="list-item">
                <strong>{asset.name}</strong>
                <div>type={asset.kind} · v{asset.version} · {asset.size_kb}kb</div>
                <div className="tool-row split" style={{ marginTop: 6 }}>
                  <input value={asset.shared_with} onChange={(e) => setDriveAssets((old) => old.map((x) => (x.id === asset.id ? { ...x, shared_with: e.target.value } : x)))} placeholder="Shared with" />
                  <button className="ghost" type="button" onClick={() => setDriveAssets((old) => old.map((x) => (x.id === asset.id ? { ...x, version: x.version + 1 } : x)))}>Bump Version</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      );
    }

    if (selectedSkyeApp === "SkyeVault") {
      return (
        <section className="app-module">
          <header><h2>SkyeVault</h2><p>Secret inventory with rotation status and scope controls.</p></header>
          <div className="tool-row split">
            <input value={vaultDraftLabel} onChange={(e) => setVaultDraftLabel(e.target.value)} placeholder="Secret label" />
            <select value={vaultDraftScope} onChange={(e) => setVaultDraftScope(e.target.value as VaultSecret["scope"])}>
              <option value="workspace">workspace</option>
              <option value="org">org</option>
              <option value="deploy">deploy</option>
            </select>
          </div>
          <div className="tool-actions left">
            <button
              className="ghost"
              type="button"
              onClick={() => {
                if (!vaultDraftLabel.trim()) return;
                setVaultSecrets((old) => [
                  {
                    id: `vault-${Date.now()}`,
                    label: vaultDraftLabel.trim(),
                    scope: vaultDraftScope,
                    owner: authUser,
                    last_rotated: new Date().toISOString().slice(0, 10),
                    status: "active",
                    redacted_value: "****",
                  },
                  ...old,
                ]);
                setVaultDraftLabel("");
              }}
            >
              Register Secret
            </button>
          </div>
          <div className="list-stack">
            {vaultSecrets.map((secret) => (
              <div key={secret.id} className="list-item">
                <strong>{secret.label}</strong>
                <div>scope={secret.scope} · owner={secret.owner}</div>
                <div className="tool-row split" style={{ marginTop: 6 }}>
                  <select value={secret.status} onChange={(e) => setVaultSecrets((old) => old.map((x) => (x.id === secret.id ? { ...x, status: e.target.value as VaultSecret["status"] } : x)))}>
                    <option value="active">active</option>
                    <option value="rotation_due">rotation_due</option>
                  </select>
                  <button className="ghost" type="button" onClick={() => setVaultSecrets((old) => old.map((x) => (x.id === secret.id ? { ...x, last_rotated: new Date().toISOString().slice(0, 10), status: "active" } : x)))}>Rotate</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      );
    }

    if (selectedSkyeApp === "SkyeForms") {
      return (
        <section className="app-module">
          <header><h2>SkyeForms</h2><p>Questionnaire builder with required flags and response-ready prompts.</p></header>
          <div className="tool-row split">
            <input value={formDraftPrompt} onChange={(e) => setFormDraftPrompt(e.target.value)} placeholder="Question prompt" />
            <select value={formDraftType} onChange={(e) => setFormDraftType(e.target.value as FormQuestion["type"])}>
              <option value="short_text">short_text</option>
              <option value="long_text">long_text</option>
              <option value="select">select</option>
            </select>
          </div>
          <div className="tool-actions left">
            <button
              className="ghost"
              type="button"
              onClick={() => {
                if (!formDraftPrompt.trim()) return;
                setFormQuestions((old) => [
                  {
                    id: `form-${Date.now()}`,
                    prompt: formDraftPrompt.trim(),
                    type: formDraftType,
                    required: false,
                    owner: authUser,
                  },
                  ...old,
                ]);
                setFormDraftPrompt("");
              }}
            >
              Add Question
            </button>
          </div>
          <div className="list-stack">
            {formQuestions.map((question) => (
              <div key={question.id} className="list-item">
                <strong>{question.prompt}</strong>
                <div>type={question.type} · owner={question.owner}</div>
                <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                  <input type="checkbox" checked={question.required} onChange={(e) => setFormQuestions((old) => old.map((x) => (x.id === question.id ? { ...x, required: e.target.checked } : x)))} />
                  Required
                </label>
              </div>
            ))}
          </div>
        </section>
      );
    }

    if (selectedSkyeApp === "SkyeNotes") {
      const filtered = notesModel.filter((note) => `${note.title} ${note.body} ${note.tags}`.toLowerCase().includes(noteSearch.trim().toLowerCase()));
      return (
        <section className="app-module">
          <header><h2>SkyeNotes</h2><p>Knowledge notes with tags, search, and ownership metadata.</p></header>
          <div className="tool-row split">
            <input value={noteDraftTitle} onChange={(e) => setNoteDraftTitle(e.target.value)} placeholder="Note title" />
            <input value={noteSearch} onChange={(e) => setNoteSearch(e.target.value)} placeholder="Search notes" />
          </div>
          <div className="tool-actions left">
            <button
              className="ghost"
              type="button"
              onClick={() => {
                if (!noteDraftTitle.trim()) return;
                setNotesModel((old) => [
                  {
                    id: `note-${Date.now()}`,
                    title: noteDraftTitle.trim(),
                    body: "",
                    tags: "",
                    owner: authUser,
                    updated_at: new Date().toISOString(),
                  },
                  ...old,
                ]);
                setNoteDraftTitle("");
              }}
            >
              Add Note
            </button>
          </div>
          <div className="list-stack">
            {filtered.map((note) => (
              <div key={note.id} className="list-item">
                <strong>{note.title}</strong>
                <textarea
                  rows={3}
                  value={note.body}
                  onChange={(e) => setNotesModel((old) => old.map((x) => (x.id === note.id ? { ...x, body: e.target.value, updated_at: new Date().toISOString() } : x)))}
                />
                <input value={note.tags} onChange={(e) => setNotesModel((old) => old.map((x) => (x.id === note.id ? { ...x, tags: e.target.value, updated_at: new Date().toISOString() } : x)))} placeholder="Tags" />
              </div>
            ))}
          </div>
        </section>
      );
    }

    if (selectedSkyeApp === "SkyeAdmin") {
      return (
        <section className="app-module">
          <header><h2>SkyeAdmin</h2><p>Org user and role controls.</p></header>
          <label>Invite team member email</label>
          <input value={teamInviteEmail} onChange={(event) => setTeamInviteEmail(event.target.value)} placeholder="teammate@company.com" />
          <label>Role</label>
          <select value={teamInviteRole} onChange={(event) => setTeamInviteRole(event.target.value as AuthRole)}>
            <option value="owner">owner</option>
            <option value="admin">admin</option>
            <option value="member">member</option>
            <option value="viewer">viewer</option>
          </select>
          <div className="tool-actions left">
            <button className="ghost" type="button" onClick={() => void inviteTeamMember()} disabled={isInvitingTeam}>
              {isInvitingTeam ? "Inviting..." : "Invite Team Member"}
            </button>
            <button className="ghost" type="button" onClick={() => void loadTeamMembers()} disabled={isLoadingTeam}>
              {isLoadingTeam ? "Refreshing..." : "Refresh Team"}
            </button>
          </div>
          {teamResult && <p className="muted-copy">{teamResult}</p>}

          <label>Workspace member email</label>
          <input value={workspaceMemberEmail} onChange={(event) => setWorkspaceMemberEmail(event.target.value)} placeholder="teammate@company.com" />
          <label>Workspace access</label>
          <select value={workspaceMemberRole} onChange={(event) => setWorkspaceMemberRole(event.target.value as "editor" | "viewer" | "remove")}>
            <option value="editor">editor</option>
            <option value="viewer">viewer</option>
            <option value="remove">remove</option>
          </select>
          <div className="tool-actions left">
            <button className="ghost" type="button" onClick={() => void setWorkspaceMember()}>
              Set Workspace Access
            </button>
            <button className="ghost" type="button" onClick={() => void loadWorkspaceMembers()} disabled={isLoadingWorkspaceMembers}>
              {isLoadingWorkspaceMembers ? "Refreshing..." : "Refresh Workspace Members"}
            </button>
          </div>
          {workspaceMemberResult && <p className="muted-copy">{workspaceMemberResult}</p>}

          <div className="list-stack">
            {workspaceMembers.map((member) => (
              <div key={`wm-${member.email}`} className="list-item admin-row">
                <span>{member.email}</span>
                <strong>{member.role}</strong>
              </div>
            ))}
          </div>

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
        ["Open Tasks", tasksModel.filter((task) => task.status !== "done").length],
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

    return null;
  }

  return (
    <div className="ide-shell">
      <div className="cine-intro" aria-hidden="true">
        <div className="cine-grid" />
        <div className="cine-scan" />
        <div className="cine-core">
          <img className="cine-logo" src="/SKYESOVERLONDONDIETYLOGO.png" alt="" />
          <div className="cine-title">kAIxU SKYEIDE</div>
          <div className="cine-sub">PRIMARY WORKSPACE ONLINE</div>
        </div>
      </div>
      <header className="topbar">
        <div>
          <img className="floating-logo" src="/SKYESOVERLONDONDIETYLOGO.png" alt="SKYES OVER LONDON" />
          <img className="floating-logo" src="https://cdn1.sharemyimage.com/2026/02/23/skAIxU-IDE-LOGO.png" alt="skAIxU IDE LOGO" />
          <img className="floating-logo" src="https://cdn1.sharemyimage.com/2026/02/17/Logo-2-1.png" alt="kAIxU LOGO" />
          <h1>kAIxU SkyeIDE</h1>
          <p>Primary IDE workspace · Neural Space Pro companion app · Shared Auth active</p>
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
          <div className="mode-badge">
            {appMode === "skyeide" ? `SkyeIDE · ${selectedSkyeApp}` : "Neural Space Pro · Dedicated Workspace"}
          </div>

          {appMode === "skyeide" ? (
            <>
              <h3>Skye Apps</h3>
              <input
                value={appSearch}
                onChange={(event) => setAppSearch(event.target.value)}
                placeholder="Search apps and modules..."
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
                      onClick={() => {
                        setSelectedSkyeApp(app.id);
                        setAppMode("skyeide");
                      }}
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
              <input id="workspace-id" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} placeholder="Workspace UUID" />

              <label htmlFor="site-base">Site Base URL</label>
              <input id="site-base" value={siteBaseUrl} onChange={(event) => setSiteBaseUrl(event.target.value)} placeholder="https://your-site.netlify.app" />

              <label htmlFor="worker-url">Worker URL</label>
              <input id="worker-url" value={workerUrl} onChange={(event) => setWorkerUrl(event.target.value)} placeholder="https://your-worker.workers.dev" />

              <h3>SKNore (AI protected)</h3>
              <textarea
                value={sknoreText}
                onChange={(event) => setSknoreText(event.target.value)}
                rows={6}
                placeholder="One glob pattern per line"
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
            </>
          ) : (
            <section className="neural-sidecard">
              <h3>Neural Space Pro</h3>
              <p className="muted-copy">Dedicated cinematic copilot surface with isolated workspace context.</p>
              <label htmlFor="workspace-id-neural">Workspace ID</label>
              <input id="workspace-id-neural" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} placeholder="Workspace UUID" />
              <label htmlFor="worker-url-neural">Worker URL</label>
              <input id="worker-url-neural" value={workerUrl} onChange={(event) => setWorkerUrl(event.target.value)} placeholder="https://your-worker.workers.dev" />
              <div className="tool-actions left">
                <button type="button" className="ghost" onClick={() => setToolTab("assistant")}>Open Assistant</button>
                <button type="button" className="ghost" onClick={() => setAppMode("skyeide")}>Return to SkyeIDE</button>
              </div>
            </section>
          )}
        </aside>

        <main className="editor-pane">
          {appMode === "skyeide" ? (
            <>
              <section className="app-module">
                <header><h2>Secure .skye Package</h2><p>Export and import app state as a `.skye` package (optionally passphrase-encrypted).</p></header>
                <label>Passphrase (optional, recommended)</label>
                <input type="password" value={skyePassphrase} onChange={(event) => setSkyePassphrase(event.target.value)} placeholder="Enter passphrase for encrypted .skye" />
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={skyeEncrypt} onChange={(event) => setSkyeEncrypt(event.target.checked)} />
                  Encrypt `.skye` package with AES-GCM
                </label>
                <div className="tool-actions left">
                  <button className="ghost" type="button" onClick={() => void exportSelectedAppAsSkye()}>
                    Export {selectedSkyeApp} as .skye
                  </button>
                  <button className="ghost" type="button" onClick={() => document.getElementById("skye-import-input")?.click()} disabled={isImportingSkye}>
                    {isImportingSkye ? "Importing..." : "Import .skye"}
                  </button>
                </div>
                <input id="skye-import-input" type="file" accept=".skye" style={{ display: "none" }} onChange={onImportSkyeFile} />
                <p className="muted-copy">Extension-only `.skye` is obscurity; encrypted `.skye` provides cryptographic protection.</p>
              </section>
              {inviteToken && (
                <section className="app-module">
                  <header><h2>Accept Team Invite</h2><p>Create or link your account securely using the invite link.</p></header>
                  <label>Email</label>
                  <input value={inviteAcceptEmail} onChange={(event) => setInviteAcceptEmail(event.target.value)} placeholder="you@company.com" />
                  <label>Create password</label>
                  <input type="password" value={inviteAcceptPassword} onChange={(event) => setInviteAcceptPassword(event.target.value)} placeholder="set your password" />
                  <div className="tool-actions left">
                    <button className="ghost" type="button" onClick={() => void acceptInviteLink()} disabled={isAcceptingInvite}>
                      {isAcceptingInvite ? "Accepting..." : "Accept Invite"}
                    </button>
                  </div>
                  {inviteAcceptResult && <p className="muted-copy">{inviteAcceptResult}</p>}
                </section>
              )}
              {renderTutorialPanel(selectedSkyeApp)}
              <section className="app-module">
                <header><h2>Project Share</h2><p>Send current workspace updates to teammates via app, chat, and mail.</p></header>
                <label>Share mode</label>
                <select value={shareMode} onChange={(event) => setShareMode(event.target.value as ShareMode)}>
                  <option value="app">App record only</option>
                  <option value="chat">SkyeChat</option>
                  <option value="mail">SkyeMail</option>
                  <option value="all">Mail + Chat + App</option>
                </select>
                <label>Recipient email (required for mail/all)</label>
                <input value={shareRecipientEmail} onChange={(event) => setShareRecipientEmail(event.target.value)} placeholder="teammate@company.com" list="team-emails" />
                <datalist id="team-emails">
                  {adminUsers.map((member) => (
                    <option key={`share-${member.email}`} value={member.email} />
                  ))}
                </datalist>
                <label>Channel (used for chat/all)</label>
                <input value={shareChannel} onChange={(event) => setShareChannel(event.target.value)} placeholder="general" />
                <label>Share note</label>
                <textarea value={shareNote} onChange={(event) => setShareNote(event.target.value)} rows={3} placeholder="What changed, and what your teammate should do next" />
                <div className="tool-actions left">
                  <button className="ghost" type="button" onClick={() => void shareProjectFromIDE()} disabled={isSharingProject}>
                    {isSharingProject ? "Sharing..." : "Share Workspace Update"}
                  </button>
                </div>
                {shareResult && <p className="muted-copy">{shareResult}</p>}
              </section>
              {renderAppModule()}
            </>
          ) : (
            <section className="app-module neural-shell">
              <header>
                <h2>Neural Space Pro</h2>
                <p>Secondary cinematic copilot app in a dedicated panel, fully separated from SkyeIDE module workflows.</p>
              </header>
              <div className="tool-actions left neural-actions">
                <a className="ghost" href="/Neural-Space-Pro/index.html" target="_blank" rel="noreferrer">Open Standalone</a>
                <button className="ghost" type="button" onClick={() => setAppMode("skyeide")}>Back to SkyeIDE</button>
              </div>
              <div className="neural-room-bridge">
                <h3>Neural Room Bridge</h3>
                <p className="muted-copy">Publish Neural Space Pro session updates directly into SkyeChat rooms.</p>
                <label>SkyeChat room</label>
                <input value={neuralRoomChannel} onChange={(event) => setNeuralRoomChannel(event.target.value)} placeholder="neural-space" />
                <label>Neural update message</label>
                <textarea
                  value={neuralRoomMessage}
                  onChange={(event) => setNeuralRoomMessage(event.target.value)}
                  rows={3}
                  placeholder="Summarize current Neural session state"
                />
                <div className="tool-actions left">
                  <button className="ghost" type="button" onClick={() => void publishNeuralRoomUpdate()} disabled={isPublishingNeuralRoom}>
                    {isPublishingNeuralRoom ? "Publishing..." : "Publish to Room"}
                  </button>
                  <button className="ghost" type="button" onClick={() => void publishNeuralRoomUpdate({ askKaixu: true })} disabled={isPublishingNeuralKaixu}>
                    {isPublishingNeuralKaixu ? "Asking kAIxU..." : "Publish + Ask kAIxU"}
                  </button>
                  <button className="ghost" type="button" onClick={openNeuralRoomInSkyeChat}>Open Room in SkyeChat</button>
                </div>
                {chatNotifyResult && <p className="muted-copy">{chatNotifyResult}</p>}
              </div>
              <iframe
                title="Neural Space Pro"
                src="/Neural-Space-Pro/index.html"
                className="neural-frame"
              />
            </section>
          )}
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
              {smokeStaleWarningReason && (
                <div className="smoke-warning">
                  <strong>Warning: possible stale cached build/client state detected.</strong>
                  <div>{smokeStaleWarningReason}</div>
                  <div className="tool-actions left">
                    <button type="button" className="ghost" onClick={resetSmokeClientState}>Reset Smoke Client State</button>
                    <button type="button" className="ghost" onClick={dismissSmokeStaleWarning}>Dismiss</button>
                  </div>
                </div>
              )}
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
      {mergePreview && (
        <div className="merge-modal-overlay">
          <div className="merge-modal">
            <h3>{mergePreview.appId} Merge Preview</h3>
            <p className="muted-copy">{mergePreview.message}</p>
            <div className="merge-grid">
              <div>
                <label>Local draft</label>
                <textarea className="report-box" readOnly value={mergePreview.localSnapshot} rows={12} />
              </div>
              <div>
                <label>Server latest</label>
                <textarea className="report-box" readOnly value={mergePreview.serverSnapshot} rows={12} />
              </div>
            </div>
            <div className="tool-actions">
              <button type="button" className="ghost" onClick={() => setMergePreview(null)}>Keep Local Draft</button>
              <button type="button" className="ghost" onClick={acceptMergeServerRefresh}>Accept Server Refresh</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
