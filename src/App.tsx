import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { redactDiagnosticsValue } from "./redaction";
import { filterSknoreFiles, isSknoreProtected, normalizeSknorePatterns } from "./sknore/policy";
import { buildFilePreviewDocument, getPreviewHealthState, resolvePreviewUrl } from "./lib/providers/previewProvider";
import {
  fetchWorkspaceFile,
  fetchWorkspaceFiles,
  fetchWorkspaceTree,
  persistWorkspaceFiles,
  serializeWorkspaceFiles,
} from "./lib/providers/workspaceFileProvider";
import { saveDriveAssetFiles } from "./lib/driveAssetStore";

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

type IdeDiagnostic = {
  id: string;
  level: "info" | "warn" | "error";
  message: string;
  at: string;
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
  | "SkyDex4.6"
  | "SkyeDocxPro"
  | "SkyeBlog"
  | "AE-Flow"
  | "GoogleBusinessProfileRescuePlatform"
  | "SovereignVariables"
  | "SkyeBookx"
  | "SkyePlatinum"
  | "REACT2HTML"
  | "SKYEMAIL-GEN"
  | "Skye-ID"
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
  | "SkyeAdmin"
  | "kAIxU-Vision"
  | "kAixu-Nexus"
  | "kAIxU-Codex"
  | "kAIxu-Atmos"
  | "kAIxu-Quest"
  | "kAIxu-Forge"
  | "kAIxu-Atlas"
  | "kAixU-Chronos"
  | "kAIxu-Bestiary"
  | "kAIxu-Mythos"
  | "kAIxU-Faction"
  | "kAIxU-PrimeCommand"
  | "API-Playground"
  | "Smokehouse-Standalone";

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

type AppProofRun = {
  id: string;
  at: string;
  appId: SkyeAppId;
  smoke_failures: number;
  runner_status: "unknown" | "ok" | "fail" | "boundary";
  auth_status: "unknown" | "ok" | "token" | "unauthorized";
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
  relative_path?: string;
  mime_type?: string;
  source_app?: string;
  saved_at?: string;
};

type CommandFeedTone = "ok" | "fail" | "boundary" | "info";

type CommandFeedAction =
  | {
      kind: "show-file-list";
      title: string;
      description?: string;
      paths: string[];
    }
  | {
      kind: "focus-contractor";
      submissionId?: string;
      filter?: string;
    }
  | {
      kind: "open-sovereign-variables";
      focus?: "inbox" | "auth" | "import";
      importKey?: string;
    };

type CommandFeedItem = {
  id: string;
  source: string;
  detail: string;
  tone: CommandFeedTone;
  at: string;
  appId?: SkyeAppId | "SkyeMail" | "SkyeChat" | "SkyeDrive";
  action?: CommandFeedAction;
  badge?: string;
};

type CommandFeedInspector = {
  title: string;
  description?: string;
  paths: string[];
};

type SovereignVariablesInboxEntry = {
  id: string;
  title: string;
  source: string;
  content: string;
  created_at: string;
  project_name?: string;
  environment_name?: string;
};

type DroppedDriveFile = {
  file: File;
  relativePath: string;
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

type ResizeKind = "sidebar" | "rightpanel" | "ide-split";
type WorkspaceStageApp = SkyeAppId | "Neural-Space-Pro";
type DockApp = "SkyeMail" | "SkyeChat" | "SkyeCalendar" | "SovereignVariables" | "SkyeDrive";
type OnboardingAssistMode = "undecided" | "guided" | "later" | "self-serve";
type WorkbenchStarterPresetId = "builder" | "operator" | "publisher";

type WorkbenchStarterPreset = {
  id: WorkbenchStarterPresetId;
  label: string;
  description: string;
  focusApp: SkyeAppId;
  top: WorkspaceStageApp;
  middle: WorkspaceStageApp;
  bottom: WorkspaceStageApp;
  leftMiddle: DockApp;
  leftDock: DockApp;
  rightTop: DockApp;
  rightMiddle: DockApp;
  rightBottom: DockApp;
  rail: "explorer" | "search" | "git" | "run" | "extensions";
};

type AppDrawerGroup = {
  id: string;
  label: string;
  description: string;
  apps: SkyeAppId[];
};

type MailRuntimeStatus = {
  configured: boolean;
  active_provider: string | null;
  from: string | null;
  sender_source?: string | null;
  error?: string;
};

type IntegrationRuntimeStatus = {
  github: {
    connected: boolean;
    repo: string | null;
    owner: string | null;
    branch: string | null;
    installation_id?: number | null;
    updated_at?: string | null;
  };
  netlify: {
    connected: boolean;
    site_id: string | null;
    site_name: string | null;
    updated_at?: string | null;
  };
  error?: string;
};

type SuiteIntentStatus = "requested" | "queued" | "completed" | "failed";

type SuiteIntentRecord = {
  name: string;
  version: "suite-intent-v1";
  status: SuiteIntentStatus;
  summary?: string | null;
};

type SuiteIntentContext = {
  workspace_id: string;
  file_ids?: string[];
  thread_id?: string | null;
  channel_id?: string | null;
  mission_id?: string | null;
  draft_id?: string | null;
  case_id?: string | null;
  asset_ids?: string[];
};

type SuiteEventRecord = {
  id: string;
  occurred_at: string;
  source_app: string;
  target_app: string | null;
  summary: string;
  detail: string;
  correlation_id?: string | null;
  idempotency_key?: string | null;
  intent: SuiteIntentRecord;
  context: SuiteIntentContext;
  payload?: Record<string, unknown>;
};

type SovereignEvent = {
  id: string;
  occurred_at: string;
  ws_id?: string | null;
  mission_id?: string | null;
  event_type: string;
  event_family?: string | null;
  source_app?: string | null;
  source_route?: string | null;
  actor?: string | null;
  subject_kind?: string | null;
  subject_id?: string | null;
  severity?: "info" | "warning" | "error" | "critical" | null;
  correlation_id?: string | null;
  summary?: string | null;
  payload?: unknown;
};

type TimelineEntry = {
  id: string;
  at: string;
  ws_id?: string | null;
  mission_id?: string | null;
  event_id?: string | null;
  entry_type: string;
  source_app?: string | null;
  actor?: string | null;
  subject_kind?: string | null;
  subject_id?: string | null;
  title: string;
  summary?: string | null;
  visibility?: string | null;
  detail?: unknown;
};

type MissionRecord = {
  id: string;
  ws_id?: string | null;
  title: string;
  status: "draft" | "active" | "blocked" | "completed" | "archived";
  priority: "low" | "medium" | "high" | "critical";
  goals_json?: string[];
  linked_apps_json?: string[];
  variables_json?: unknown;
  entitlement_snapshot?: unknown;
  collaborator_count?: number;
  asset_count?: number;
  created_at?: string;
  updated_at?: string;
};

type MissionCollaboratorRole = "owner" | "collaborator" | "viewer";

type ContractorSubmissionFile = {
  id: string;
  filename?: string | null;
  content_type?: string | null;
  bytes?: number | null;
  created_at?: string | null;
};

type ContractorSubmissionRecord = {
  id: string;
  ws_id?: string | null;
  mission_id?: string | null;
  full_name: string;
  business_name?: string | null;
  email: string;
  phone?: string | null;
  coverage?: string | null;
  availability?: string | null;
  lanes?: string[];
  service_summary?: string | null;
  proof_link?: string | null;
  entity_type?: string | null;
  licenses?: string | null;
  status: "new" | "reviewing" | "approved" | "on_hold" | "rejected";
  admin_notes?: string | null;
  tags?: string[];
  verified?: boolean;
  dispatched?: boolean;
  last_contacted_at?: string | null;
  event_id?: string | null;
  created_at?: string;
  updated_at?: string;
  files?: ContractorSubmissionFile[];
};

type TokenInventoryItem = {
  id: string;
  label: string;
  prefix: string;
  locked_email: string | null;
  scopes_json?: string[];
  status: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
};

type OrgSeatSummary = {
  org_id: string;
  org_name: string;
  plan_tier: "base" | "scaling" | "executive" | "corporate" | "enterprise";
  seat_limit: number | null;
  active_members: number;
  pending_invites: number;
  seats_reserved: number;
  seats_available: number | null;
  allow_personal_key_override: boolean;
};

type OrgWorkspaceSummary = {
  id: string;
  name: string;
  created_at?: string | null;
  updated_at?: string | null;
};

type OrgKeyTokenSummary = {
  id: string;
  label: string;
  prefix: string;
  locked_email: string | null;
  scopes: string[];
  status: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
};

type OrgKeyAssignmentSummary = {
  user_id: string;
  email: string;
  assigned_token: OrgKeyTokenSummary | null;
  personal_token: OrgKeyTokenSummary | null;
  effective_token: OrgKeyTokenSummary | null;
  effective_source: "personal" | "assigned" | "org_default" | "none";
};

type OrgKeyPolicySummary = {
  org_id: string;
  allow_personal_key_override: boolean;
  default_token: OrgKeyTokenSummary | null;
  assignments: OrgKeyAssignmentSummary[];
};

type OnboardingEmailDraft = {
  email: string;
  prefix: string;
  domain: string;
  source: string;
  updatedAt: string;
};

type OnboardingIdentityDraft = {
  name: string;
  idNumber: string;
  source: string;
  updatedAt: string;
};

type LegacySkyeEnvelope = {
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

type SkyeEncryptedBlock = {
  cipher: string;
  iv: string;
  salt: string;
};

type SkyeSecureEnvelope = {
  format: "skye-secure-v1";
  encrypted: true;
  alg: "AES-256-GCM";
  kdf: "PBKDF2-SHA256";
  iterations: 150000;
  app: SkyeAppId;
  ws_id: string;
  exported_at: string;
  hint?: string;
  payload: {
    primary: SkyeEncryptedBlock;
  };
};

const DEFAULT_WORKER_URL =
  (import.meta.env.VITE_WORKER_RUNNER_URL as string | undefined) || "https://your-worker.workers.dev";
const KNOWN_WORKER_URL = "https://kaixu-superide-runner.skyesoverlondon.workers.dev";
const DEFAULT_WS_ID = (import.meta.env.VITE_DEFAULT_WS_ID as string | undefined) || "primary-workspace";
const DEFAULT_SITE_BASE = (import.meta.env.VITE_SITE_BASE_URL as string | undefined) || window.location.origin;
const HISTORY_PAGE_SIZE = 50;
const ONBOARDING_EMAIL_DRAFT_KEY = "kx.onboarding.emailDraft";
const ONBOARDING_ID_DRAFT_KEY = "kx.onboarding.idDraft";
const ONBOARDING_ASSIST_MODE_KEY = "kx.onboarding.assistMode";
const ONBOARDING_WORKSPACE_EMAIL_KEY = "kx.onboarding.workspaceEmail";
const AUTH_ORG_NAME_KEY = "kx.auth.orgName";
const AUTH_CENTER_POPUP_NAME = "skye-auth-center";
const AUTH_CENTER_AUTO_OPENED_SESSION_KEY = "kx.authCenter.autoOpened";
const APP_BRIDGE_EVENT_KEY = "kx.app.bridge";
const DRIVE_DROP_LATEST_KEY = "kx.drive.drop.latest";
const COMMAND_FEED_KEY = "kx.command.feed";
const SOVEREIGN_VARIABLES_INBOX_KEY = "sovereign.variables.inbox.v1";
const AUTH_HAS_PIN_KEY = "kx.auth.hasPin";
const AUTH_PIN_UNLOCKED_AT_KEY = "kx.auth.pinUnlockedAt";

const SKYE_APPS: SkyeAppDefinition[] = [
  { id: "SkyeDocs", summary: "Collaborative document workspace.", mvp: ["Rich text", "Markdown mode", "Autosave"] },
  { id: "SkyDex4.6", summary: "Secure codex IDE surface wired to workspace, gateway, GitHub, and Netlify flows.", mvp: ["Workspace editing", "Gateway prompt lane", "Push + deploy controls"] },
  { id: "SkyeDocxPro", summary: "Full document production suite integrated into SuperIDE.", mvp: ["Advanced editor", "Offline-ready workflows", "Production-grade exports"] },
  { id: "SkyeBlog", summary: "AI-first blog studio with direct community publishing flows.", mvp: ["AI draft generation", "Editorial workspace", "Push to chat/mail"] },
  { id: "AE-Flow", summary: "Embedded CRM platform with operator workflows and cross-app command routing.", mvp: ["CRM shell", "Workspace context", "Command network handoff"] },
  { id: "GoogleBusinessProfileRescuePlatform", summary: "Business rescue platform capsule for case diagnostics and reinstatement ops.", mvp: ["Platform launchpad", "Workspace sync", "Rescue handoff"] },
  { id: "SovereignVariables", summary: "Secure environment variable vault with portable exports.", mvp: ["Project/env management", "Encrypted .skye export", "Push to chat/mail"] },
  { id: "SkyeBookx", summary: "AI-native authoring and publishing surface.", mvp: ["Chapter drafting", "AI rewrite", "Compile preview"] },
  { id: "SkyePlatinum", summary: "Executive command hub with kAIxU analysis.", mvp: ["Client registry", "Ledger ops", "AI directives"] },
  { id: "REACT2HTML", summary: "Convert React snippets into standalone HTML outputs.", mvp: ["kAIxU conversion", "Live preview", "Copy output"] },
  { id: "SKYEMAIL-GEN", summary: "Generate branded SKYEMAIL identities and exports.", mvp: ["Email generator", "Persistence", "PDF export"] },
  { id: "Skye-ID", summary: "Generate and archive identity cards with export workflows.", mvp: ["ID generator", "IndexedDB archive", "CSV/PDF export"] },
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
  { id: "kAIxU-Vision", summary: "Visual concept studio with gateway-only AI scene drafting.", mvp: ["Vision ideation", "Gateway generation", "Poster export"] },
  { id: "kAixu-Nexus", summary: "SOLE project minting command surface via kAIxU gateway.", mvp: ["Prompt minting", "Inspection logs", "Asset export"] },
  { id: "kAIxU-Codex", summary: "World-building codex editor using secured gateway inference.", mvp: ["Entry authoring", "Lore generation", "PDF export"] },
  { id: "kAIxu-Atmos", summary: "Atmospheric script and playback workstation with gateway text synthesis.", mvp: ["Script drafting", "Ambient pass", "Playback preview"] },
  { id: "kAIxu-Quest", summary: "Quest blueprint generator routed through gate-safe AI flows.", mvp: ["Quest generation", "Lore expansion", "Visual poster"] },
  { id: "kAIxu-Forge", summary: "Item blueprint forge with gateway-only creative assist.", mvp: ["Item generation", "Spec expansion", "Visual poster"] },
  { id: "kAIxu-Atlas", summary: "Cartography workstation with secure world map generation.", mvp: ["Location design", "Geo expansion", "Atlas export"] },
  { id: "kAixU-Chronos", summary: "Historical timeline authoring with gated AI expansion.", mvp: ["Event generation", "Timeline expansion", "Chronicle export"] },
  { id: "kAIxu-Bestiary", summary: "Creature dossier creator secured through gateway-only calls.", mvp: ["Lifeform generation", "Trait expansion", "Visual poster"] },
  { id: "kAIxu-Mythos", summary: "Mythology and pantheon design surface with gate-routed intelligence.", mvp: ["Deity generation", "Lore expansion", "Visual poster"] },
  { id: "kAIxU-Faction", summary: "Faction intelligence desk with secure policy-compliant AI ops.", mvp: ["Faction generation", "Intel expansion", "Sigil poster"] },
  { id: "kAIxU-PrimeCommand", summary: "Franchise command bible with gateway-only strategic drafting.", mvp: ["Node generation", "Strategy expansion", "Key art poster"] },
  { id: "API-Playground", summary: "Standalone API test bench with hash-chained persistent logs.", mvp: ["Custom payloads", "Request replay", "Hash ledger export"] },
  { id: "Smokehouse-Standalone", summary: "Standalone smoke runner with tamper-evident run history.", mvp: ["Contract checks", "Hash chain", "Runbook export"] },
];

const SKYE_APP_ID_SET = new Set<string>(SKYE_APPS.map((app) => app.id));

const PLATFORM_INTRO_PILLARS = [
  {
    title: "Full Email Service",
    detail:
      "SkyeMail + SKYEMAIL-GEN + Skye-ID provide mailbox operations, identity generation, thread workflows, and enterprise-ready communication rails in one stack.",
  },
  {
    title: "Community Chatroom Platform",
    detail:
      "SkyeChat supports channel rooms, threaded replies, and cross-app publishing so product teams can run community conversations with Reddit-style discussion flow.",
  },
  {
    title: "Google DocX-Class Workspace",
    detail:
      "SkyeDocxPro and SkyeDocs combine advanced editing, offline-safe workflows, and production exports to operate as a full document platform replacement.",
  },
  {
    title: "CRM Platform System",
    detail:
      "AE-Flow sits inside the deck as a full CRM platform with workspace-aware routing into chat, mail, neural, and admin lanes.",
  },
  {
    title: "Business Rescue Platform",
    detail:
      "Google Business Profile Rescue Platform is staged as a dedicated recovery system for diagnostics, evidence prep, and reinstatement execution inside SuperIDE.",
  },
];

const APP_SURFACE_PATHS: Partial<Record<SkyeAppId, string>> = {
  SkyeDocs: "/SkyeDocs/index.html",
  "SkyDex4.6": "/SkyDex4.6/index.html",
  SkyeDocxPro: "/SkyeDocxPro/index.html",
  SkyeBlog: "/SkyeBlog/index.html",
  "AE-Flow": "/AE-Flow/index.html",
  GoogleBusinessProfileRescuePlatform: "/GoogleBusinessProfileRescuePlatform/index.html",
  SovereignVariables: "/SovereignVariables/index.html",
  SkyeBookx: "/SkyeBookx/index.html",
  SkyePlatinum: "/SkyePlatinum/index.html",
  "REACT2HTML": "/REACT2HTML/index.html",
  "SKYEMAIL-GEN": "/SKYEMAIL-GEN/index.html",
  "Skye-ID": "/Skye-ID/index.html",
  SkyeSheets: "/SkyeSheets/index.html",
  SkyeSlides: "/SkyeSlides/index.html",
  SkyeMail: "/SkyeMail/index.html",
  SkyeChat: "/SkyeChat/index.html",
  SkyeCalendar: "/SkyeCalendar/index.html",
  SkyeDrive: "/SkyeDrive/index.html",
  SkyeVault: "/SkyeVault/index.html",
  SkyeForms: "/SkyeForms/index.html",
  SkyeNotes: "/SkyeNotes/index.html",
  SkyeAnalytics: "/SkyeAnalytics/index.html",
  SkyeTasks: "/SkyeTasks/index.html",
  SkyeAdmin: "/SkyeAdmin/index.html",
  "kAIxU-Vision": "/kAIxU-Vision/index.html",
  "kAixu-Nexus": "/kAixu-Nexus/index.html",
  "kAIxU-Codex": "/kAIxU-Codex/index.html",
  "kAIxu-Atmos": "/kAIxu-Atmos/index.html",
  "kAIxu-Quest": "/kAIxu-Quest/index.html",
  "kAIxu-Forge": "/kAIxu-Forge/index.html",
  "kAIxu-Atlas": "/kAIxu-Atlas/index.html",
  "kAixU-Chronos": "/kAixU-Chronos/index.html",
  "kAIxu-Bestiary": "/kAIxu-Bestiary/index.html",
  "kAIxu-Mythos": "/kAIxu-Mythos/index.html",
  "kAIxU-Faction": "/kAIxU-Faction/index.html",
  "kAIxU-PrimeCommand": "/kAIxU-PrimeCommand/index.html",
  "API-Playground": "/API-Playground/index.html",
  "Smokehouse-Standalone": "/Smokehouse/index.html",
};

function buildAppSurfaceUrl(appId: SkyeAppId, wsId: string): string | null {
  const basePath = APP_SURFACE_PATHS[appId];
  if (!basePath) return null;
  const qs = new URLSearchParams();
  qs.set("embed", "1");
  qs.set("ws_id", wsId || DEFAULT_WS_ID);
  const query = qs.toString();
  return query ? `${basePath}?${query}` : basePath;
}

function buildStandaloneAppUrl(appId: SkyeAppId, wsId: string): string | null {
  const basePath = APP_SURFACE_PATHS[appId];
  if (!basePath) return null;
  const qs = new URLSearchParams();
  qs.set("ws_id", wsId || DEFAULT_WS_ID);
  const query = qs.toString();
  return query ? `${basePath}?${query}` : basePath;
}

const APP_TUTORIALS: Record<SkyeAppId, string[]> = {
  SkyeDocs: [
    "Open a project file from the left pane.",
    "Edit content in Monaco and verify syntax highlighting.",
    "Use Assistant tab to generate/refactor with SKNore enforcement.",
    "Share progress to team via Project Share panel.",
  ],
  "SkyDex4.6": [
    "Load the current workspace snapshot directly from the secure workspace API.",
    "Edit files in the embedded editor and save the full snapshot before release actions.",
    "Use the kAIxU prompt deck for gateway-routed generation, then connect GitHub or Netlify from the right rail as needed.",
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
  SkyeBlog: [
    "Open SkyeBlog in embedded mode from SuperIDE.",
    "Generate a draft from a blank canvas using AI assist.",
    "Edit and export the post as .skye / HTML / PDF artifacts.",
    "Push the post directly into SkyeChat community or admin board.",
    "Send campaign-ready summary to SkyeMail recipients.",
  ],
  "AE-Flow": [
    "Open AE-Flow inside SuperIDE and confirm the active workspace ID is already populated before touching any CRM lane.",
    "Verify the shared kAIxU key is already present so the operator does not need to paste credentials again.",
    "Create or open a real CRM workflow, then route a follow-up into SkyeChat or SkyeMail from the same workspace context.",
    "Move the next action into Neural Space Pro for reasoning, then return to AE-Flow and confirm the handoff stayed visible.",
    "Finish by validating the embedded platform still preserves AE-Flow branding and feels like the original product, not a stripped iframe.",
  ],
  GoogleBusinessProfileRescuePlatform: [
    "Open the GBP Rescue platform capsule and confirm it loads as a real working lane, not just a static launch card.",
    "Review the active rescue workflow, workspace context, and kAIxU readiness before starting any reinstatement action.",
    "Use the platform to push a real next step into SkyeChat, SkyeMail, or Neural Space Pro so the rescue path is visibly connected.",
    "Open AE-Flow or ContractorNetwork when the rescue case needs sales, ops, or field follow-up and confirm the context carries over.",
    "Treat the rescue platform as part of the operating system: capture outcome, share follow-up, and return to the suite with no dead end.",
  ],
  SovereignVariables: [
    "Create a project and at least one environment.",
    "Add/edit variable keys and secure notes.",
    "Export as .env, JSON, and encrypted .skye package.",
    "Push selected environment output to SkyeChat and SkyeMail.",
  ],
  SkyeBookx: [
    "Open SkyeBookx and verify workspace context.",
    "Run one kAIxU rewrite action through gateway.",
    "Compile preview and export manuscript artifact.",
  ],
  SkyePlatinum: [
    "Open command dashboard and verify org data sync.",
    "Run kAIxU fiscal directive generation via gateway.",
    "Capture action directives and validate ledger updates.",
  ],
  "REACT2HTML": [
    "Paste React component code into the input panel.",
    "Run conversion through kAIxU backend only.",
    "Validate preview and copy final HTML output.",
  ],
  "SKYEMAIL-GEN": [
    "Generate custom or random SKYEMAIL identities.",
    "Store high-value addresses to persistent list.",
    "Export TXT or PDF artifacts for handoff workflows.",
  ],
  "Skye-ID": [
    "Generate identity record pairs (name + identifier).",
    "Review IndexedDB history and export CSV snapshots.",
    "Export branded PDF for operations delivery.",
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
    "Issue scoped test keys for controlled validation.",
  ],
  "kAIxU-Vision": [
    "Open Vision and confirm gateway route controls are active.",
    "Generate one scene text output through /api/kaixu-generate.",
    "Render a visual poster and export your session artifact.",
  ],
  "kAixu-Nexus": [
    "Load an architecture prompt and mint output through gateway.",
    "Review inspection logs for pass/fail staging.",
    "Export minted asset and verify local history persistence.",
  ],
  "kAIxU-Codex": [
    "Create a codex entry and run lore expansion.",
    "Generate a gateway visual poster for the active entry.",
    "Compile preview and export PDF packet.",
  ],
  "kAIxu-Atmos": [
    "Draft an audio log script with gateway text synthesis.",
    "Run ambient augmentation for the active log.",
    "Play output in browser and export PDF archive.",
  ],
  "kAIxu-Quest": [
    "Generate a quest seed from scratch.",
    "Expand mission lore through gateway inference.",
    "Render poster output and include in exported packet.",
  ],
  "kAIxu-Forge": [
    "Generate a new item blueprint.",
    "Expand engineering details through gateway calls.",
    "Render poster visual and export the handbook.",
  ],
  "kAIxu-Atlas": [
    "Create a location map seed.",
    "Expand geography notes through gateway synthesis.",
    "Render visual poster and export atlas PDF.",
  ],
  "kAixU-Chronos": [
    "Create a historical event seed.",
    "Expand historical records through gateway inference.",
    "Render timeline poster and export chronicle PDF.",
  ],
  "kAIxu-Bestiary": [
    "Generate a creature dossier seed.",
    "Expand traits and habitat records through gateway.",
    "Render poster visual and export bestiary packet.",
  ],
  "kAIxu-Mythos": [
    "Generate a deity profile seed.",
    "Expand scripture and lore through gateway synthesis.",
    "Render divine poster and export mythology packet.",
  ],
  "kAIxU-Faction": [
    "Generate a faction dossier seed.",
    "Expand strategic intel through gateway generation.",
    "Render sigil poster and export intelligence packet.",
  ],
  "kAIxU-PrimeCommand": [
    "Generate a franchise node seed.",
    "Expand strategic directives through gateway inference.",
    "Render key-art poster and export prime bible.",
  ],
  "API-Playground": [
    "Load seeded /api/kaixu-generate payload in the form.",
    "Send requests and verify response with status timings.",
    "Review hash-chain ledger integrity and export log file.",
  ],
  "Smokehouse-Standalone": [
    "Run contract smoke checks against base URL.",
    "Review pass/fail summary and per-check latency.",
    "Validate chain integrity and export smoke ledger.",
  ],
};

const FEATURED_APP_IDS: SkyeAppId[] = ["SkyDex4.6", "SkyeBookx", "REACT2HTML", "SKYEMAIL-GEN", "Skye-ID", "SkyePlatinum"];

const APP_DRAWER_GROUPS: AppDrawerGroup[] = [
  {
    id: "build",
    label: "Build + IDE",
    description: "Editor, deploy, preview, testing, and secure environment control surfaces.",
    apps: ["SkyDex4.6", "REACT2HTML", "API-Playground", "Smokehouse-Standalone", "SovereignVariables", "SkyeDrive", "SkyeVault"],
  },
  {
    id: "workspace",
    label: "Workspace + Content",
    description: "Documents, publishing, books, forms, notes, sheets, and slide workflows.",
    apps: ["SkyeDocs", "SkyeDocxPro", "SkyeBlog", "SkyeBookx", "SkyeSheets", "SkyeSlides", "SkyeForms", "SkyeNotes"],
  },
  {
    id: "platforms",
    label: "Platform Systems",
    description: "Full platform systems embedded in the command deck and linked to the shared workspace command network.",
    apps: ["AE-Flow", "GoogleBusinessProfileRescuePlatform"],
  },
  {
    id: "communications",
    label: "Communications + Identity",
    description: "Mail, chat, calendar, identity generation, and team administration.",
    apps: ["SKYEMAIL-GEN", "Skye-ID", "SkyeMail", "SkyeChat", "SkyeCalendar", "SkyeAdmin"],
  },
  {
    id: "operations",
    label: "Operations + Executive",
    description: "Analytics, task execution, command surfaces, and org-wide operating views.",
    apps: ["SkyeAnalytics", "SkyeTasks", "SkyePlatinum"],
  },
  {
    id: "codex",
    label: "kAIxU Creative + Codex",
    description: "Worldbuilding, vision, atlas, lore, and secure creative generation surfaces.",
    apps: ["kAIxU-Vision", "kAixu-Nexus", "kAIxU-Codex", "kAIxu-Atmos", "kAIxu-Quest", "kAIxu-Forge", "kAIxu-Atlas", "kAixU-Chronos", "kAIxu-Bestiary", "kAIxu-Mythos", "kAIxU-Faction", "kAIxU-PrimeCommand"],
  },
];

const WORKBENCH_STARTER_PRESETS: WorkbenchStarterPreset[] = [
  {
    id: "builder",
    label: "Builder",
    description: "Code, inspect, test, and ship with the secure generation and deploy lane already staged.",
    focusApp: "SkyDex4.6",
    top: "SkyDex4.6",
    middle: "Neural-Space-Pro",
    bottom: "API-Playground",
    leftMiddle: "SkyeDrive",
    leftDock: "SkyeMail",
    rightTop: "SovereignVariables",
    rightMiddle: "SkyeCalendar",
    rightBottom: "SkyeChat",
    rail: "git",
  },
  {
    id: "operator",
    label: "Operator",
    description: "Open the status-and-execution layout for tasks, analytics, calendar coordination, and team handoff.",
    focusApp: "SkyeAnalytics",
    top: "SkyeAnalytics",
    middle: "SkyeTasks",
    bottom: "SkyeCalendar",
    leftMiddle: "SkyeDrive",
    leftDock: "SkyeMail",
    rightTop: "SovereignVariables",
    rightMiddle: "SkyeCalendar",
    rightBottom: "SkyeChat",
    rail: "run",
  },
  {
    id: "publisher",
    label: "Publisher",
    description: "Stage writing, editing, distribution, and conversation surfaces for content and launch work.",
    focusApp: "SkyeBlog",
    top: "SkyeBlog",
    middle: "SkyeDocxPro",
    bottom: "SkyeBookx",
    leftMiddle: "SkyeDrive",
    leftDock: "SkyeMail",
    rightTop: "SovereignVariables",
    rightMiddle: "SkyeCalendar",
    rightBottom: "SkyeChat",
    rail: "explorer",
  },
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

function fileExt(path: string): string {
  const name = String(path || "");
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
}

function buildPreviewDocument(file: WorkspaceFile | undefined): string | null {
  if (!file) return null;
  const ext = fileExt(file.path);
  if (["html", "htm", "svg"].includes(ext)) return file.content;
  if (ext === "md") {
    const baseHref = typeof window !== "undefined" ? `${window.location.origin}/` : "/";
    const escaped = file.content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${baseHref}"><title>Preview</title><style>body{margin:0;padding:16px;background:#0b0914;color:#f7f7ff;font-family:ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;line-height:1.45}</style></head><body>${escaped}</body></html>`;
  }
  return null;
}

function buildDefaultWorkspaceSurfaces(seed: string): Record<SkyeAppId, string> {
  return Object.fromEntries(SKYE_APPS.map((app) => [app.id, seed])) as Record<SkyeAppId, string>;
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

function inferCommandTone(text: string): CommandFeedTone {
  const lowered = String(text || "").toLowerCase();
  if (/fail|error|missing|required|invalid|unauthorized|blocked|unable|offline|denied/.test(lowered)) return "fail";
  if (/boundary|queued|sync|processing|loading|minting|requesting/.test(lowered)) return "boundary";
  if (/sent|loaded|saved|linked|ready|complete|accepted|imported|exported|shared|published|registered|queued/.test(lowered)) return "ok";
  return "info";
}

function parseEnvTemplateLines(text: string): Array<{ key: string; value: string }> {
  const lines = String(text || "").split(/\r?\n/);
  const items: Array<{ key: string; value: string }> = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const match = normalized.match(/^([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.+)$/);
    if (!match) continue;
    const key = match[1].trim();
    const value = match[2].trim();
    if (!key || !value) continue;
    items.push({ key, value });
  }

  return items;
}

function formatEnvTemplateValue(value: string): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) return '""';
  if (/\s|,|#/.test(trimmed) || /["']/.test(trimmed)) return JSON.stringify(trimmed);
  return trimmed;
}

function buildEnvTemplateContent(entries: Array<{ key: string; value: string | null | undefined }>): string {
  return entries
    .map(({ key, value }) => ({ key: String(key || "").trim(), value: String(value || "").trim() }))
    .filter((entry) => entry.key && entry.value)
    .map((entry) => `${entry.key}=${formatEnvTemplateValue(entry.value)}`)
    .join("\n");
}

function readSovereignVariablesInbox(): SovereignVariablesInboxEntry[] {
  try {
    const raw = localStorage.getItem(SOVEREIGN_VARIABLES_INBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SovereignVariablesInboxEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function queueSovereignVariablesInboxEntry(entry: Omit<SovereignVariablesInboxEntry, "id" | "created_at">) {
  const nextEntry: SovereignVariablesInboxEntry = {
    id: makeId(),
    created_at: new Date().toISOString(),
    ...entry,
  };
  const next = [nextEntry, ...readSovereignVariablesInbox()].slice(0, 20);
  localStorage.setItem(SOVEREIGN_VARIABLES_INBOX_KEY, JSON.stringify(next));
  return nextEntry;
}

function inferDriveAssetKind(name: string, mimeType: string): DriveAsset["kind"] {
  const lowerName = name.toLowerCase();
  const lowerMime = mimeType.toLowerCase();
  if (lowerName.endsWith(".zip") || lowerName.endsWith(".skye") || lowerMime.includes("zip") || lowerMime.includes("compressed")) return "zip";
  if (lowerName.endsWith(".sheet") || lowerName.endsWith(".csv") || lowerName.endsWith(".xlsx") || lowerMime.includes("spreadsheet") || lowerMime.includes("csv")) return "sheet";
  if (lowerName.endsWith(".ppt") || lowerName.endsWith(".pptx") || lowerName.endsWith(".key") || lowerName.endsWith(".pdf")) return "slide";
  if (lowerName.endsWith(".md") || lowerName.endsWith(".txt") || lowerName.endsWith(".doc") || lowerName.endsWith(".docx") || lowerName.endsWith(".html") || lowerName.endsWith(".ts") || lowerName.endsWith(".tsx") || lowerName.endsWith(".js") || lowerName.endsWith(".jsx") || lowerName.endsWith(".json") || lowerName.endsWith(".css") || lowerName.endsWith(".sql")) return "doc";
  return "other";
}

function sanitizeDroppedPath(path: string): string {
  const cleaned = String(path || "").replace(/^\/+/, "").trim();
  return cleaned || `dropped/${Date.now()}`;
}

function isWorkspaceImportableFile(file: File, relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  if (file.size > 1024 * 1024 * 2) return false;
  if (file.type.startsWith("text/")) return true;
  return /\.(ts|tsx|js|jsx|json|css|html|md|txt|sql|yml|yaml|xml|svg)$/i.test(lower);
}

function formatSkyeMailRecord(record: AppRecord): string {
  const payload = asObject(record.payload);
  const direction = String(payload.direction || (record.app === "SkyeMailInbound" ? "inbound" : "outbound")).toLowerCase();
  const mailbox = String(payload.mailbox || "").trim();
  const to = String(payload.to || "unknown");
  const from = String(payload.from || "unknown");
  const subject = String(payload.subject || record.title || "(no subject)");
  if (direction === "inbound") {
    return mailbox ? `[INBOX ${mailbox}] ${from} -> ${subject}` : `[INBOX] ${from} -> ${subject}`;
  }
  return mailbox ? `[SENT ${mailbox}] ${subject} -> ${to}` : `${subject} -> ${to}`;
}

function formatSkyeChatRecord(record: AppRecord): string {
  const payload = asObject(record.payload);
  const channel = String(payload.channel || "general");
  const message = String(payload.message || record.title || "(no message)");
  const source = String(payload.source || "").trim();
  return source ? `#${channel} [${source}]: ${message}` : `#${channel}: ${message}`;
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

function encodeSecureSkyeEnvelope(envelope: SkyeSecureEnvelope): Blob {
  const marker = new TextEncoder().encode("SKYESEC1");
  const payload = new TextEncoder().encode(JSON.stringify(envelope));
  return new Blob([marker, new Uint8Array([0]), payload], { type: "application/octet-stream" });
}

function isValidEncryptedBlock(block: any): block is SkyeEncryptedBlock {
  return Boolean(
    block &&
      typeof block.cipher === "string" &&
      typeof block.iv === "string" &&
      typeof block.salt === "string" &&
      block.cipher.length > 0 &&
      block.iv.length > 0 &&
      block.salt.length > 0
  );
}

function isSecureSkyeEnvelope(value: any): value is SkyeSecureEnvelope {
  if (!value || typeof value !== "object") return false;
  if (value.format !== "skye-secure-v1") return false;
  if (value.encrypted !== true) return false;
  if (value.alg !== "AES-256-GCM") return false;
  if (value.kdf !== "PBKDF2-SHA256") return false;
  if (Number(value.iterations) !== 150000) return false;
  if (!value.app) return false;
  if (!value.payload || !isValidEncryptedBlock(value.payload.primary)) return false;
  return true;
}

async function tryReadSecureSkyeEnvelope(file: any): Promise<SkyeSecureEnvelope | null> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const marker = new TextEncoder().encode("SKYESEC1");
    const hasMarker =
      bytes.length > marker.length + 1 &&
      marker.every((value, index) => bytes[index] === value) &&
      bytes[marker.length] === 0;
    if (!hasMarker) return null;
    const raw = new TextDecoder().decode(bytes.slice(marker.length + 1));
    const parsed = tryParseJson(raw);
    if (!isSecureSkyeEnvelope(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function App() {
  const initialParams = new URLSearchParams(window.location.search);
  const initialApp = String(initialParams.get("app") || "").trim() as SkyeAppId;
  const initialMode = String(initialParams.get("mode") || "").trim() as AppMode;

  const [appMode, setAppMode] = useState<AppMode>("skyeide");
  const [toolTab, setToolTab] = useState<ToolTab>("assistant");
  const [selectedSkyeApp, setSelectedSkyeApp] = useState<SkyeAppId>(
    SKYE_APPS.some((app) => app.id === initialApp) ? initialApp : "SkyeDocs"
  );

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
  const [workspaceSurfaces, setWorkspaceSurfaces] = useState<Record<SkyeAppId, string>>(() => {
    const seed = localStorage.getItem("kx.workspace.id") || DEFAULT_WS_ID;
    const raw = localStorage.getItem("kx.workspace.surfaces");
    const base = buildDefaultWorkspaceSurfaces(seed);
    if (!raw) return base;
    try {
      const parsed = JSON.parse(raw) as Partial<Record<SkyeAppId, string>>;
      for (const app of SKYE_APPS) {
        const val = String(parsed[app.id] || "").trim();
        if (val) base[app.id] = val;
      }
      return base;
    } catch {
      return base;
    }
  });
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");
  const [previewPane, setPreviewPane] = useState<"split" | "code" | "preview">("split");
  const [ideRailTab, setIdeRailTab] = useState<"explorer" | "search" | "git" | "run" | "extensions">("explorer");
  const [ideFileSearch, setIdeFileSearch] = useState("");
  const [workspaceSidebarWidth, setWorkspaceSidebarWidth] = useState(() => {
    const raw = Number(localStorage.getItem("kx.layout.sidebar.width"));
    if (!Number.isFinite(raw)) return 420;
    return Math.min(640, Math.max(300, raw));
  });
  const [workspaceRightPanelWidth, setWorkspaceRightPanelWidth] = useState(() => {
    const raw = Number(localStorage.getItem("kx.layout.rightpanel.width"));
    if (!Number.isFinite(raw)) return 420;
    return Math.min(620, Math.max(300, raw));
  });
  const [leftMiddleDockApp, setLeftMiddleDockApp] = useState<DockApp>(() => {
    const raw = String(localStorage.getItem("kx.layout.left.middle.app") || "").trim();
    return raw === "SkyeMail" || raw === "SkyeChat" || raw === "SkyeCalendar" || raw === "SovereignVariables" || raw === "SkyeDrive" ? raw : "SkyeDrive";
  });
  const [leftBottomDockApp, setLeftBottomDockApp] = useState<DockApp>(() => {
    const raw = String(localStorage.getItem("kx.layout.left.bottom.app") || "").trim();
    return raw === "SkyeMail" || raw === "SkyeChat" || raw === "SkyeCalendar" || raw === "SovereignVariables" || raw === "SkyeDrive" ? raw : "SkyeMail";
  });
  const [rightTopDockApp, setRightTopDockApp] = useState<DockApp>(() => {
    const raw = String(localStorage.getItem("kx.layout.right.top.app") || "").trim();
    return raw === "SkyeMail" || raw === "SkyeChat" || raw === "SkyeCalendar" || raw === "SovereignVariables" || raw === "SkyeDrive" ? raw : "SovereignVariables";
  });
  const [rightMiddleDockApp, setRightMiddleDockApp] = useState<DockApp>(() => {
    const raw = String(localStorage.getItem("kx.layout.right.middle.app") || "").trim();
    return raw === "SkyeMail" || raw === "SkyeChat" || raw === "SkyeCalendar" || raw === "SovereignVariables" || raw === "SkyeDrive" ? raw : "SkyeCalendar";
  });
  const [rightBottomDockApp, setRightBottomDockApp] = useState<DockApp>(() => {
    const raw = String(localStorage.getItem("kx.layout.right.bottom.app") || "").trim();
    return raw === "SkyeMail" || raw === "SkyeChat" || raw === "SkyeCalendar" || raw === "SovereignVariables" || raw === "SkyeDrive" ? raw : "SkyeChat";
  });
  const [ideSplitRatio, setIdeSplitRatio] = useState(() => {
    const raw = Number(localStorage.getItem("kx.layout.ide.split"));
    if (!Number.isFinite(raw)) return 56;
    return Math.min(75, Math.max(25, raw));
  });
  const [assistantAuthStatus, setAssistantAuthStatus] = useState<"unknown" | "ok" | "token" | "unauthorized">("unknown");
  const [topWorkspaceApp, setTopWorkspaceApp] = useState<WorkspaceStageApp>(() => {
    const raw = String(localStorage.getItem("kx.workspace.stack.top") || "").trim();
    if (raw === "Neural-Space-Pro") return raw;
    if (SKYE_APPS.some((app) => app.id === raw)) return raw as SkyeAppId;
    return "SkyeDocxPro";
  });
  const [middleWorkspaceApp, setMiddleWorkspaceApp] = useState<WorkspaceStageApp>(() => {
    const raw = String(localStorage.getItem("kx.workspace.stack.middle") || "").trim();
    if (raw === "Neural-Space-Pro") return raw;
    if (SKYE_APPS.some((app) => app.id === raw)) return raw as SkyeAppId;
    return "Neural-Space-Pro";
  });
  const [bottomWorkspaceApp, setBottomWorkspaceApp] = useState<WorkspaceStageApp>(() => {
    const raw = String(localStorage.getItem("kx.workspace.stack.bottom") || "").trim();
    if (raw === "Neural-Space-Pro") return raw;
    if (SKYE_APPS.some((app) => app.id === raw)) return raw as SkyeAppId;
    return "SkyeBookx";
  });
  const [showHomePanels, setShowHomePanels] = useState(() => localStorage.getItem("kx.layout.home.visible") === "1");
  const [showWorkspaceStack, setShowWorkspaceStack] = useState(() => localStorage.getItem("kx.workspace.stack.visible") === "1");
  const [showExecutionSettings, setShowExecutionSettings] = useState(() => localStorage.getItem("kx.layout.pipeline.visible") === "1");
  const layoutStateVersion = "2026-03-09-home-collapse";

  const resizeStateRef = useRef<{
    kind: ResizeKind;
    pointerId: number | null;
    startX: number;
    startY: number;
    sidebarWidth: number;
    rightPanelWidth: number;
    ideSplitRatio: number;
  } | null>(null);
  const ideSplitRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const currentVersion = localStorage.getItem("kx.layout.version");
    if (currentVersion === layoutStateVersion) return;
    localStorage.setItem("kx.layout.version", layoutStateVersion);
    localStorage.setItem("kx.layout.home.visible", "0");
    localStorage.setItem("kx.workspace.stack.visible", "0");
    localStorage.setItem("kx.layout.pipeline.visible", "0");
    setShowHomePanels(false);
    setShowWorkspaceStack(false);
    setShowExecutionSettings(false);
  }, [layoutStateVersion]);

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
  const [runnerStatus, setRunnerStatus] = useState<"unknown" | "ok" | "fail" | "boundary">("unknown");
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
  const [recoveryEmail, setRecoveryEmail] = useState(() => localStorage.getItem("kx.auth.recoveryEmail") || "");
  const [authRole, setAuthRole] = useState<AuthRole>(() => (localStorage.getItem("kx.auth.role") as AuthRole) || "owner");
  const [authPassword, setAuthPassword] = useState("");
  const [authOrgName, setAuthOrgName] = useState(() => localStorage.getItem(AUTH_ORG_NAME_KEY) || "Skye Workspace");
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [authResult, setAuthResult] = useState("");
  const [isEnsuringOnboardingKey, setIsEnsuringOnboardingKey] = useState(false);
  const [resetToken, setResetToken] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [isResetSubmitting, setIsResetSubmitting] = useState(false);
  const [onboardingAssistMode, setOnboardingAssistMode] = useState<OnboardingAssistMode>(() => {
    const raw = String(localStorage.getItem(ONBOARDING_ASSIST_MODE_KEY) || "").trim();
    if (raw === "guided" || raw === "later" || raw === "self-serve") return raw;
    return "undecided";
  });
  const [showOnboardingPrompt, setShowOnboardingPrompt] = useState(() => {
    const mode = String(localStorage.getItem(ONBOARDING_ASSIST_MODE_KEY) || "").trim();
    const hasInvite = Boolean(new URLSearchParams(window.location.search).get("invite_token"));
    return !hasInvite && !mode;
  });
  const [showOnboardingGuide, setShowOnboardingGuide] = useState(() => {
    const raw = String(localStorage.getItem(ONBOARDING_ASSIST_MODE_KEY) || "").trim();
    return raw === "guided";
  });
  const [onboardingEmailDraft, setOnboardingEmailDraft] = useState<OnboardingEmailDraft | null>(null);
  const [onboardingIdentityDraft, setOnboardingIdentityDraft] = useState<OnboardingIdentityDraft | null>(null);
  const [authSeededFromGenerators, setAuthSeededFromGenerators] = useState(false);
  const [workspaceMailboxEmail, setWorkspaceMailboxEmail] = useState(() => localStorage.getItem(ONBOARDING_WORKSPACE_EMAIL_KEY) || "");

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
  const [orgSeatSummary, setOrgSeatSummary] = useState<OrgSeatSummary | null>(null);
  const [primaryWorkspace, setPrimaryWorkspace] = useState<OrgWorkspaceSummary | null>(null);
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
  const [apiAccessToken, setApiAccessToken] = useState(() => localStorage.getItem("kx.api.accessToken") || "");
  const [apiTokenEmail, setApiTokenEmail] = useState(() => localStorage.getItem("kx.api.tokenEmail") || "");
  const [hasSessionPin, setHasSessionPin] = useState(() => localStorage.getItem(AUTH_HAS_PIN_KEY) === "1");
  const [pinUnlockedAt, setPinUnlockedAt] = useState(() => localStorage.getItem(AUTH_PIN_UNLOCKED_AT_KEY) || "");
  const [authPinDraft, setAuthPinDraft] = useState("");
  const [authPinConfirmDraft, setAuthPinConfirmDraft] = useState("");
  const [authPinUnlockDraft, setAuthPinUnlockDraft] = useState("");
  const [pinOpsResult, setPinOpsResult] = useState("");
  const [isSavingAuthPin, setIsSavingAuthPin] = useState(false);
  const [isUnlockingAuthPin, setIsUnlockingAuthPin] = useState(false);
  const [tokenLabelPrefix, setTokenLabelPrefix] = useState("ide-key");
  const [tokenTtlPreset, setTokenTtlPreset] = useState("day");
  const [tokenInventory, setTokenInventory] = useState<TokenInventoryItem[]>([]);
  const [orgKeyPolicy, setOrgKeyPolicy] = useState<OrgKeyPolicySummary | null>(null);
  const [isLoadingOrgKeyPolicy, setIsLoadingOrgKeyPolicy] = useState(false);
  const [isRunningOrgKeyAction, setIsRunningOrgKeyAction] = useState(false);
  const [orgKeyActionResult, setOrgKeyActionResult] = useState("");
  const [orgKeyIssuedToken, setOrgKeyIssuedToken] = useState("");
  const [orgKeyIssuedMeta, setOrgKeyIssuedMeta] = useState("");
  const [orgDefaultKeyLabelPrefix, setOrgDefaultKeyLabelPrefix] = useState("org-default");
  const [orgDefaultKeyTtlPreset, setOrgDefaultKeyTtlPreset] = useState("quarter");
  const [assignedKeyEmail, setAssignedKeyEmail] = useState("");
  const [assignedKeyLabelPrefix, setAssignedKeyLabelPrefix] = useState("member-assigned");
  const [assignedKeyTtlPreset, setAssignedKeyTtlPreset] = useState("quarter");
  const authCenterWindowRef = useRef<Window | null>(null);
  const [authCenterLaunchBlocked, setAuthCenterLaunchBlocked] = useState(false);
  const [isLoadingTokenInventory, setIsLoadingTokenInventory] = useState(false);
  const [tokenOpsResult, setTokenOpsResult] = useState("");
  const [revokingTokenId, setRevokingTokenId] = useState("");
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
  const [calendarViewMonth, setCalendarViewMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [calendarHydrated, setCalendarHydrated] = useState(false);

  const [driveAssets, setDriveAssets] = useState<DriveAsset[]>([
    { id: "drive-1", name: "pitch-deck-v3.pdf", kind: "slide", size_kb: 2480, owner: "founder@skye.local", version: 3, shared_with: "hp-team@partner.com" },
    { id: "drive-2", name: "roadmap.xlsx", kind: "sheet", size_kb: 920, owner: "ops@skye.local", version: 5, shared_with: "execs@skye.local" },
  ]);
  const [driveDraftName, setDriveDraftName] = useState("");
  const [driveDraftKind, setDriveDraftKind] = useState<DriveAsset["kind"]>("other");
  const [driveHydrated, setDriveHydrated] = useState(false);
  const [commandFeed, setCommandFeed] = useState<CommandFeedItem[]>(() => {
    const raw = localStorage.getItem(COMMAND_FEED_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as CommandFeedItem[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [commandFeedInspector, setCommandFeedInspector] = useState<CommandFeedInspector | null>(null);
  const [isGlobalDropActive, setIsGlobalDropActive] = useState(false);
  const dropDepthRef = useRef(0);
  const actionFeedSeenRef = useRef<Record<string, string>>({});
  const sovereignFeedSeenRef = useRef<Record<string, string>>({});
  const sovereignVariablesBootstrapSeenRef = useRef<Record<string, string>>({});
  const contractorQueueSeenRef = useRef("");

  const [vaultSecrets, setVaultSecrets] = useState<VaultSecret[]>([
    { id: "vault-1", label: "NETLIFY_TOKEN", scope: "deploy", owner: "ops@skye.local", last_rotated: "2026-02-21", status: "active", redacted_value: "****token" },
    { id: "vault-2", label: "CF_ACCESS_CLIENT_SECRET", scope: "org", owner: "owner@skye.local", last_rotated: "2025-12-02", status: "rotation_due", redacted_value: "****secret" },
  ]);
  const [vaultDraftLabel, setVaultDraftLabel] = useState("");
  const [vaultDraftScope, setVaultDraftScope] = useState<VaultSecret["scope"]>("workspace");
  const [vaultHydrated, setVaultHydrated] = useState(false);

  const [formQuestions, setFormQuestions] = useState<FormQuestion[]>([
    { id: "form-1", prompt: "How satisfied are you with onboarding?", type: "select", required: true, owner: "ops@skye.local" },
    { id: "form-2", prompt: "What should we improve next sprint?", type: "long_text", required: false, owner: "ops@skye.local" },
  ]);
  const [formDraftPrompt, setFormDraftPrompt] = useState("");
  const [formDraftType, setFormDraftType] = useState<FormQuestion["type"]>("short_text");
  const [formsHydrated, setFormsHydrated] = useState(false);

  const [notesModel, setNotesModel] = useState<NoteItem[]>([
    { id: "note-1", title: "Investor prep notes", body: "Position product as secure launch-ready suite with failsafe workflows.", tags: "investor,hp,launch", owner: "founder@skye.local", updated_at: new Date().toISOString() },
    { id: "note-2", title: "Incident checklist", body: "Smoke run, auth checks, policy gate verification, and release rollback proof.", tags: "ops,runbook", owner: "ops@skye.local", updated_at: new Date().toISOString() },
  ]);
  const [noteDraftTitle, setNoteDraftTitle] = useState("");
  const [noteSearch, setNoteSearch] = useState("");
  const [notesHydrated, setNotesHydrated] = useState(false);

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
  const [showTutorialPanel, setShowTutorialPanel] = useState(false);
  const [dismissedSpotlightByApp, setDismissedSpotlightByApp] = useState<Record<string, boolean>>(() => {
    const raw = localStorage.getItem("kx.skye.spotlight.dismissed");
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  });
  const [newFilePath, setNewFilePath] = useState("src/new-file.ts");
  const [ideCommitMessage, setIdeCommitMessage] = useState("SuperIDE workspace update");
  const [ideOpsResult, setIdeOpsResult] = useState("");
  const [previewRuntimeMode, setPreviewRuntimeMode] = useState<"quick" | "project">("quick");
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(() => localStorage.getItem("kx.workspace.autosave") !== "0");
  const [workspaceSavedHash, setWorkspaceSavedHash] = useState("");
  const [workspaceRevision, setWorkspaceRevision] = useState("");
  const [workspaceUnloadedPaths, setWorkspaceUnloadedPaths] = useState<string[]>([]);
  const [workspaceConflict, setWorkspaceConflict] = useState<{ detectedAt: string; serverHash: string; message: string } | null>(null);
  const [ideDiagnostics, setIdeDiagnostics] = useState<IdeDiagnostic[]>([]);
  const [isSavingWorkspace, setIsSavingWorkspace] = useState(false);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false);
  const [isGitPushing, setIsGitPushing] = useState(false);
  const [isDeployingWorkspace, setIsDeployingWorkspace] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState("");
  const [appProofRuns, setAppProofRuns] = useState<AppProofRun[]>([]);
  const [mailRuntimeStatus, setMailRuntimeStatus] = useState<MailRuntimeStatus | null>(null);
  const [integrationRuntimeStatus, setIntegrationRuntimeStatus] = useState<IntegrationRuntimeStatus | null>(null);
  const [isPlatformStatusLoading, setIsPlatformStatusLoading] = useState(false);
  const [sovereignEvents, setSovereignEvents] = useState<SovereignEvent[]>([]);
  const [isSovereignEventsLoading, setIsSovereignEventsLoading] = useState(false);
  const [suiteEvents, setSuiteEvents] = useState<SuiteEventRecord[]>([]);
  const [isSuiteEventsLoading, setIsSuiteEventsLoading] = useState(false);
  const [timelineEntries, setTimelineEntries] = useState<TimelineEntry[]>([]);
  const [isTimelineLoading, setIsTimelineLoading] = useState(false);
  const [missions, setMissions] = useState<MissionRecord[]>([]);
  const [isMissionsLoading, setIsMissionsLoading] = useState(false);
  const [missionDraftTitle, setMissionDraftTitle] = useState("");
  const [missionDraftGoal, setMissionDraftGoal] = useState("");
  const [missionDraftPriority, setMissionDraftPriority] = useState<MissionRecord["priority"]>("medium");
  const [selectedMissionId, setSelectedMissionId] = useState("");
  const [missionEditTitle, setMissionEditTitle] = useState("");
  const [missionEditGoal, setMissionEditGoal] = useState("");
  const [missionEditPriority, setMissionEditPriority] = useState<MissionRecord["priority"]>("medium");
  const [missionEditStatus, setMissionEditStatus] = useState<MissionRecord["status"]>("active");
  const [missionCollaboratorEmail, setMissionCollaboratorEmail] = useState("");
  const [missionCollaboratorRole, setMissionCollaboratorRole] = useState<MissionCollaboratorRole>("collaborator");
  const [missionAssetSourceApp, setMissionAssetSourceApp] = useState("");
  const [missionAssetKind, setMissionAssetKind] = useState("workspace_file");
  const [missionAssetId, setMissionAssetId] = useState("");
  const [missionAssetTitle, setMissionAssetTitle] = useState("");
  const [missionResult, setMissionResult] = useState("");
  const [isCreatingMission, setIsCreatingMission] = useState(false);
  const [isUpdatingMission, setIsUpdatingMission] = useState(false);
  const [isAttachingMissionCollaborator, setIsAttachingMissionCollaborator] = useState(false);
  const [isAttachingMissionAsset, setIsAttachingMissionAsset] = useState(false);
  const [contractorAdminPassword, setContractorAdminPassword] = useState("");
  const [contractorAdminToken, setContractorAdminToken] = useState(() => localStorage.getItem("sol_admin_token") || "");
  const [contractorStatusFilter, setContractorStatusFilter] = useState("");
  const [contractorSearch, setContractorSearch] = useState("");
  const [contractorSubmissions, setContractorSubmissions] = useState<ContractorSubmissionRecord[]>([]);
  const [isContractorLoading, setIsContractorLoading] = useState(false);
  const [isContractorLoggingIn, setIsContractorLoggingIn] = useState(false);
  const [selectedContractorSubmissionId, setSelectedContractorSubmissionId] = useState("");
  const [contractorAdminNotes, setContractorAdminNotes] = useState("");
  const [contractorAdminTags, setContractorAdminTags] = useState("");
  const [contractorAdminStatus, setContractorAdminStatus] = useState<ContractorSubmissionRecord["status"]>("reviewing");
  const [contractorAdminResult, setContractorAdminResult] = useState("");
  const [isContractorSaving, setIsContractorSaving] = useState(false);
  const [isContractorExporting, setIsContractorExporting] = useState(false);
  const [adminBoardKey, setAdminBoardKey] = useState("");
  const [adminBoardUnlocked, setAdminBoardUnlocked] = useState(() => sessionStorage.getItem("kx.admin.board.unlocked") === "1");
  const [adminBoardResult, setAdminBoardResult] = useState("");
  const [isAdminBoardVerifying, setIsAdminBoardVerifying] = useState(false);

  useEffect(() => {
    if (initialMode === "neural") {
      setAppMode("neural");
    }
  }, [initialMode]);

  useEffect(() => {
    if (adminBoardUnlocked) sessionStorage.setItem("kx.admin.board.unlocked", "1");
    else sessionStorage.removeItem("kx.admin.board.unlocked");
  }, [adminBoardUnlocked]);

  useEffect(() => {
    function onShellHotkey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setCommandPaletteOpen(false);
        setCommandPaletteQuery("");
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen((old) => {
          if (old) setCommandPaletteQuery("");
          return !old;
        });
        return;
      }

      if (!(event.altKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        setShowTutorialPanel((old) => !old);
      }
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        resetSelectedAppDemoState();
      }
      if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        setToolTab("smokehouse");
      }
    }

    window.addEventListener("keydown", onShellHotkey);
    return () => window.removeEventListener("keydown", onShellHotkey);
  }, [selectedSkyeApp]);

  const [previewFrameError, setPreviewFrameError] = useState("");
  const [previewReloadToken, setPreviewReloadToken] = useState(0);
  const healthUrl = useMemo(() => `${normalizeBaseUrl(workerUrl)}/health`, [workerUrl]);
  const activeFile = useMemo(() => files.find((file) => file.path === activePath) || files[0], [files, activePath]);
  const workspaceCurrentHash = useMemo(() => serializeWorkspaceFiles(files), [files]);
  const workspaceDirty = useMemo(() => workspaceSavedHash !== "" && workspaceCurrentHash !== workspaceSavedHash, [workspaceCurrentHash, workspaceSavedHash]);
  const ideVisibleFiles = useMemo(() => {
    const q = ideFileSearch.trim().toLowerCase();
    if (!q) return files;
    return files.filter((file) => file.path.toLowerCase().includes(q));
  }, [files, ideFileSearch]);
  const previewDocument = useMemo(
    () => buildFilePreviewDocument(activeFile, typeof window !== "undefined" ? window.location.origin : ""),
    [activeFile]
  );
  const livePreviewUrl = useMemo(() => buildAppSurfaceUrl(selectedSkyeApp, workspaceId), [selectedSkyeApp, workspaceId]);
  const fallbackPreviewUrl = useMemo(() => buildAppSurfaceUrl("SkyeDocs", workspaceId), [workspaceId]);
  const resolvedPreviewUrl = useMemo(
    () => resolvePreviewUrl(livePreviewUrl, fallbackPreviewUrl, "/SkyeDocs/index.html"),
    [livePreviewUrl, fallbackPreviewUrl]
  );
  const effectivePreviewDocument = useMemo(
    () => (previewRuntimeMode === "quick" ? previewDocument : null),
    [previewRuntimeMode, previewDocument]
  );
  const effectivePreviewUrl = useMemo(
    () => (previewRuntimeMode === "project" ? resolvedPreviewUrl : resolvedPreviewUrl),
    [previewRuntimeMode, resolvedPreviewUrl]
  );
  const previewHealth = useMemo(
    () => getPreviewHealthState(effectivePreviewDocument, effectivePreviewUrl, previewFrameError),
    [effectivePreviewDocument, effectivePreviewUrl, previewFrameError]
  );
  const selectedMission = useMemo(
    () => missions.find((mission) => mission.id === selectedMissionId) || null,
    [missions, selectedMissionId]
  );
  const selectedContractorSubmission = useMemo(
    () => contractorSubmissions.find((submission) => submission.id === selectedContractorSubmissionId) || null,
    [contractorSubmissions, selectedContractorSubmissionId]
  );
  const sknorePatterns = useMemo(() => normalizeSknorePatterns(sknoreText.split("\n")), [sknoreText]);
  const sknoreBlockedFiles = useMemo(
    () => files.filter((file) => isSknoreProtected(file.path, sknorePatterns)).map((file) => file.path),
    [files, sknorePatterns]
  );
  const sknoreBlockedCount = useMemo(
    () => files.filter((file) => isSknoreProtected(file.path, sknorePatterns)).length,
    [files, sknorePatterns]
  );
  const contractorNewCount = useMemo(
    () => contractorSubmissions.filter((submission) => submission.status === "new").length,
    [contractorSubmissions]
  );
  const contractorPendingCount = useMemo(
    () => contractorSubmissions.filter((submission) => submission.status === "new" || submission.status === "reviewing").length,
    [contractorSubmissions]
  );
  const contractorMiniRailItems = useMemo(() => {
    return sovereignEvents
      .filter((event) => isContractorSovereignEvent(event))
      .slice(0, 4)
      .map((event) => {
        const payload = asObject(event.payload);
        const matchingSubmission = contractorSubmissions.find((submission) => submission.id === event.subject_id);
        const statusValue = String(
          matchingSubmission?.status || payload.status || (event.event_type === "contractor.submission.received" ? "new" : "reviewing")
        ).toLowerCase();
        const label =
          String(matchingSubmission?.full_name || payload.full_name || "").trim() ||
          String(event.summary || event.subject_id || "Contractor intake").replace(/^Contractor (intake received|submission updated):\s*/i, "");
        const detailParts = [
          String(matchingSubmission?.email || payload.email || "").trim(),
          String(matchingSubmission?.coverage || payload.coverage || "").trim(),
        ].filter(Boolean);
        const tone: CommandFeedTone =
          statusValue === "rejected"
            ? "fail"
            : statusValue === "approved"
              ? "ok"
              : statusValue === "new" || statusValue === "reviewing" || statusValue === "on_hold"
                ? "boundary"
                : getSovereignEventTone(event);

        return {
          id: event.id,
          name: label,
          status: statusValue,
          detail: detailParts.join(" · ") || String(event.event_type || "contractor").replace(/^contractor\./, ""),
          tone,
          submissionId: matchingSubmission?.id || event.subject_id || undefined,
        };
      });
  }, [sovereignEvents, contractorSubmissions]);
  const contractorEventCount = useMemo(
    () => sovereignEvents.filter((event) => {
      const family = String(event.event_family || "").toLowerCase();
      const source = String(event.source_app || "").toLowerCase();
      const subject = String(event.subject_kind || "").toLowerCase();
      return family === "contractor" || source === "contractornetwork" || subject === "contractor_submission";
    }).length,
    [sovereignEvents]
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
    localStorage.setItem("kx.layout.sidebar.width", String(Math.round(workspaceSidebarWidth)));
  }, [workspaceSidebarWidth]);

  useEffect(() => {
    localStorage.setItem("kx.layout.rightpanel.width", String(Math.round(workspaceRightPanelWidth)));
  }, [workspaceRightPanelWidth]);

  useEffect(() => {
    localStorage.setItem("kx.layout.left.middle.app", leftMiddleDockApp);
  }, [leftMiddleDockApp]);

  useEffect(() => {
    localStorage.setItem("kx.layout.left.bottom.app", leftBottomDockApp);
  }, [leftBottomDockApp]);

  useEffect(() => {
    localStorage.setItem("kx.layout.right.top.app", rightTopDockApp);
  }, [rightTopDockApp]);

  useEffect(() => {
    localStorage.setItem("kx.layout.right.middle.app", rightMiddleDockApp);
  }, [rightMiddleDockApp]);

  useEffect(() => {
    localStorage.setItem("kx.layout.right.bottom.app", rightBottomDockApp);
  }, [rightBottomDockApp]);

  useEffect(() => {
    localStorage.setItem("kx.layout.ide.split", String(Math.round(ideSplitRatio)));
  }, [ideSplitRatio]);

  useEffect(() => {
    localStorage.setItem("kx.workspace.stack.top", topWorkspaceApp);
  }, [topWorkspaceApp]);

  useEffect(() => {
    localStorage.setItem("kx.workspace.stack.middle", middleWorkspaceApp);
  }, [middleWorkspaceApp]);

  useEffect(() => {
    localStorage.setItem("kx.workspace.stack.bottom", bottomWorkspaceApp);
  }, [bottomWorkspaceApp]);

  useEffect(() => {
    localStorage.setItem("kx.layout.home.visible", showHomePanels ? "1" : "0");
  }, [showHomePanels]);

  useEffect(() => {
    localStorage.setItem("kx.workspace.stack.visible", showWorkspaceStack ? "1" : "0");
  }, [showWorkspaceStack]);

  useEffect(() => {
    localStorage.setItem("kx.layout.pipeline.visible", showExecutionSettings ? "1" : "0");
  }, [showExecutionSettings]);

  useEffect(() => {
    localStorage.setItem("kx.workspace.id", workspaceId);
  }, [workspaceId]);

  useEffect(() => {
    localStorage.setItem("kx.workspace.surfaces", JSON.stringify(workspaceSurfaces));
  }, [workspaceSurfaces]);

  useEffect(() => {
    const appWorkspace = String(workspaceSurfaces[selectedSkyeApp] || "").trim();
    if (appWorkspace && appWorkspace !== workspaceId) {
      setWorkspaceId(appWorkspace);
    }
  }, [selectedSkyeApp, workspaceSurfaces]);

  useEffect(() => {
    const next = workspaceId.trim();
    if (!next) return;
    setWorkspaceSurfaces((old) => {
      if (old[selectedSkyeApp] === next) return old;
      return { ...old, [selectedSkyeApp]: next };
    });
  }, [workspaceId, selectedSkyeApp]);

  useEffect(() => {
    localStorage.setItem("kx.workspace.files", JSON.stringify(files));
  }, [files]);

  useEffect(() => {
    localStorage.setItem("kx.workspace.activePath", activePath);
  }, [activePath]);

  useEffect(() => {
    localStorage.setItem(COMMAND_FEED_KEY, JSON.stringify(commandFeed));
  }, [commandFeed]);

  useEffect(() => {
    localStorage.setItem("kx.workspace.autosave", autoSaveEnabled ? "1" : "0");
  }, [autoSaveEnabled]);

  useEffect(() => {
    if (!workspaceSavedHash) setWorkspaceSavedHash(workspaceCurrentHash);
  }, [workspaceCurrentHash, workspaceSavedHash]);

  useEffect(() => {
    if (!autoSaveEnabled || !workspaceDirty || !workspaceId.trim() || isSavingWorkspace) return;
    const timer = setTimeout(() => {
      void saveWorkspaceNow();
    }, 1200);
    return () => clearTimeout(timer);
  }, [autoSaveEnabled, workspaceDirty, workspaceId, isSavingWorkspace, files]);

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
    localStorage.setItem("kx.skye.spotlight.dismissed", JSON.stringify(dismissedSpotlightByApp));
  }, [dismissedSpotlightByApp]);

  useEffect(() => {
    if (contractorAdminToken.trim()) localStorage.setItem("sol_admin_token", contractorAdminToken.trim());
    else localStorage.removeItem("sol_admin_token");
  }, [contractorAdminToken]);

  function pushIdeDiagnostic(level: "info" | "warn" | "error", message: string) {
    const entry: IdeDiagnostic = {
      id: makeId(),
      level,
      message,
      at: new Date().toISOString(),
    };
    setIdeDiagnostics((old) => [entry, ...old].slice(0, 12));
  }

  function stageSovereignVariablesSuggestion(options: {
    title: string;
    source: string;
    content: string;
    detail: string;
    projectName?: string;
    environmentName?: string;
    tone?: CommandFeedTone;
    badge?: string;
  }) {
    const content = String(options.content || "").trim();
    if (!content) return null;
    const lines = parseEnvTemplateLines(content);
    if (!lines.length) return null;

    const inboxEntry = queueSovereignVariablesInboxEntry({
      title: options.title,
      source: options.source,
      content,
      project_name: options.projectName,
      environment_name: options.environmentName,
    });

    pushCommandFeed(
      "SovereignVariables",
      options.detail,
      options.tone || "info",
      "SovereignVariables",
      {
        kind: "open-sovereign-variables",
        focus: "inbox",
        importKey: inboxEntry.id,
      },
      options.badge || `${lines.length} vars`
    );

    return inboxEntry;
  }

  function maybeStageWorkspaceBootstrapEnv(triggerPath?: string) {
    const normalizedWorkspaceId = workspaceId.trim();
    if (!normalizedWorkspaceId) return;
    if (sovereignVariablesBootstrapSeenRef.current[normalizedWorkspaceId]) return;

    const content = buildEnvTemplateContent([
      { key: "KX_WORKSPACE_ID", value: normalizedWorkspaceId },
      { key: "KX_ACTIVE_APP", value: selectedSkyeApp },
      { key: "KX_SITE_BASE", value: siteBaseUrl.trim() },
      { key: "KX_WORKER_URL", value: workerUrl.trim() },
      { key: "KX_PRIMARY_EMAIL", value: authUser.trim().toLowerCase() },
    ]);

    const staged = stageSovereignVariablesSuggestion({
      title: `${selectedSkyeApp} workspace bootstrap`,
      source: "Project Bootstrap",
      content,
      detail: triggerPath
        ? `Project bootstrap detected in ${normalizedWorkspaceId}. SovereignVariables can stage the env baseline for ${triggerPath}.`
        : `Project bootstrap detected in ${normalizedWorkspaceId}. SovereignVariables can stage the env baseline now.`,
      projectName: normalizedWorkspaceId,
      environmentName: "Workspace Bootstrap",
      tone: "info",
    });

    if (staged) sovereignVariablesBootstrapSeenRef.current[normalizedWorkspaceId] = staged.id;
  }

  function isWorkerBoundarySummary(summary: string | null | undefined) {
    return /boundary|cors|access policy|browser/i.test(String(summary || ""));
  }

  function getSovereignEventTone(event: SovereignEvent): CommandFeedTone {
    if (event.severity === "critical" || event.severity === "error") return "fail";
    if (event.severity === "warning") return "boundary";
    return "ok";
  }

  function getSovereignEventAppId(event: SovereignEvent): SkyeAppId | "SkyeMail" | "SkyeChat" | "SkyeDrive" | null {
    const value = String(event.source_app || "").trim();
    if (!value || !SKYE_APP_ID_SET.has(value)) return null;
    return value as SkyeAppId;
  }

  function isContractorSovereignEvent(event: SovereignEvent) {
    const family = String(event.event_family || "").toLowerCase();
    const source = String(event.source_app || "").toLowerCase();
    const subject = String(event.subject_kind || "").toLowerCase();
    return family === "contractor" || source === "contractornetwork" || subject === "contractor_submission";
  }

  function syncSovereignEventAlerts(items: SovereignEvent[]) {
    const nextIds = items.map((item) => item.id);
    if (!Object.keys(sovereignFeedSeenRef.current).length) {
      sovereignFeedSeenRef.current = Object.fromEntries(nextIds.map((id) => [id, id]));
      return;
    }

    const fresh = items.filter((item) => !sovereignFeedSeenRef.current[item.id]);
    if (!fresh.length) return;

    for (const item of fresh) {
      sovereignFeedSeenRef.current[item.id] = item.id;
    }

    const freshContractor = fresh.filter((item) => isContractorSovereignEvent(item));
    if (!freshContractor.length) return;

    const latest = freshContractor[0];
    const intakeCount = freshContractor.filter((item) => item.event_type === "contractor.submission.received").length;

    pushCommandFeed(
      "ContractorNetwork",
      intakeCount
        ? `Contractor intake detected on the sovereign rail: ${intakeCount} new submission${intakeCount === 1 ? "" : "s"} landed.`
        : `ContractorNetwork activity detected on the sovereign rail: ${freshContractor.length} new event${freshContractor.length === 1 ? "" : "s"}.`,
      intakeCount ? "boundary" : getSovereignEventTone(latest),
      undefined,
      {
        kind: "focus-contractor",
        submissionId: latest.subject_id || undefined,
        filter: intakeCount ? "reviewing" : undefined,
      },
      intakeCount ? `${intakeCount} intake` : `${freshContractor.length} events`
    );
  }

  function summarizeContractorQueue(items: ContractorSubmissionRecord[]) {
    if (!items.length) return null;
    const latest = items[0];
    const nextPending = items.filter((submission) => submission.status === "new" || submission.status === "reviewing").length;
    const nextNew = items.filter((submission) => submission.status === "new").length;
    return {
      latest,
      pending: nextPending,
      queued: nextNew,
      badge: `${nextPending} pending`,
      detail: nextNew
        ? `ContractorNetwork queue updated: ${nextNew} new and ${nextPending} awaiting review. Latest intake: ${latest.full_name}.`
        : `ContractorNetwork queue synced: ${nextPending} submission${nextPending === 1 ? "" : "s"} awaiting review. Latest intake: ${latest.full_name}.`,
      tone: nextNew ? ("boundary" as const) : ("ok" as const),
    };
  }

  function focusSovereignVariables(action?: Extract<CommandFeedAction, { kind: "open-sovereign-variables" }>) {
    setAppMode("skyeide");
    setSelectedSkyeApp("SovereignVariables");
    setRightTopDockApp("SovereignVariables");
    if (action?.focus === "inbox" || action?.importKey) {
      const inbox = readSovereignVariablesInbox();
      const entry = action.importKey ? inbox.find((item) => item.id === action.importKey) || inbox[0] : inbox[0];
      if (entry) {
        setCommandFeedInspector({
          title: "SovereignVariables intake ready",
          description: `${entry.title} from ${entry.source} is queued for import when you open SovereignVariables.`,
          paths: parseEnvTemplateLines(entry.content).map((item) => `${item.key}=${item.value}`),
        });
      }
    }
  }

  function handleCommandFeedEntryClick(entry: CommandFeedItem) {
    if (entry.action?.kind === "show-file-list") {
      setAppMode("skyeide");
      setSelectedSkyeApp("SkyDex4.6");
      setCommandFeedInspector({
        title: entry.action.title,
        description: entry.action.description,
        paths: entry.action.paths,
      });
      return;
    }

    if (entry.action?.kind === "focus-contractor") {
      if (entry.action.filter) setContractorStatusFilter(entry.action.filter);
      if (entry.action.submissionId) setSelectedContractorSubmissionId(entry.action.submissionId);
      if (contractorAdminToken.trim()) {
        void loadContractorSubmissions({ status: entry.action.filter || contractorStatusFilter, q: contractorSearch });
      }
      setCommandFeedInspector(null);
      return;
    }

    if (entry.action?.kind === "open-sovereign-variables") {
      focusSovereignVariables(entry.action);
      return;
    }

    setCommandFeedInspector(null);
    if (entry.appId === "SkyeMail" || entry.appId === "SkyeChat" || entry.appId === "SkyeDrive") {
      routeCrossAppFocus(entry.appId);
    } else if (entry.appId) {
      setAppMode("skyeide");
      setSelectedSkyeApp(entry.appId);
    }
  }

  async function loadSovereignEvents() {
    if (!hasActiveAuthSession) {
      setSovereignEvents([]);
      return;
    }

    setIsSovereignEventsLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set("limit", "6");
      if (workspaceId.trim()) qs.set("ws_id", workspaceId.trim());
      const res = await fetch(`/api/sovereign-events?${qs.toString()}`, { credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Event feed failed (${res.status}).`);
      const items = Array.isArray(data?.items) ? (data.items as SovereignEvent[]) : [];
      setSovereignEvents(items);
      syncSovereignEventAlerts(items);
    } catch {
      setSovereignEvents([]);
    } finally {
      setIsSovereignEventsLoading(false);
    }
  }

  async function loadSuiteEvents() {
    if (!hasActiveAuthSession) {
      setSuiteEvents([]);
      return;
    }

    setIsSuiteEventsLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set("limit", "24");
      if (workspaceId.trim()) qs.set("ws_id", workspaceId.trim());
      const res = await fetch(`/api/suite-events?${qs.toString()}`, { credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Suite event feed failed (${res.status}).`);
      setSuiteEvents(Array.isArray(data?.items) ? (data.items as SuiteEventRecord[]) : []);
    } catch {
      setSuiteEvents([]);
    } finally {
      setIsSuiteEventsLoading(false);
    }
  }

  async function loadTimelineEntries() {
    if (!hasActiveAuthSession) {
      setTimelineEntries([]);
      return;
    }

    setIsTimelineLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set("limit", "6");
      if (workspaceId.trim()) qs.set("ws_id", workspaceId.trim());
      const res = await fetch(`/api/timeline-feed?${qs.toString()}`, { credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Timeline feed failed (${res.status}).`);
      setTimelineEntries(Array.isArray(data?.items) ? (data.items as TimelineEntry[]) : []);
    } catch {
      setTimelineEntries([]);
    } finally {
      setIsTimelineLoading(false);
    }
  }

  async function loadMissionRecords() {
    if (!hasActiveAuthSession) {
      setMissions([]);
      return;
    }

    setIsMissionsLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set("limit", "6");
      if (workspaceId.trim()) qs.set("ws_id", workspaceId.trim());
      const res = await fetch(`/api/missions?${qs.toString()}`, { credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Mission query failed (${res.status}).`);
      setMissions(Array.isArray(data?.items) ? (data.items as MissionRecord[]) : []);
    } catch {
      setMissions([]);
    } finally {
      setIsMissionsLoading(false);
    }
  }

  async function createMissionRecord() {
    const title = missionDraftTitle.trim();
    const goal = missionDraftGoal.trim();
    if (!title) {
      setMissionResult("Mission title is required.");
      return;
    }

    setIsCreatingMission(true);
    setMissionResult("");
    try {
      const linkedApps = selectedSkyeApp ? [selectedSkyeApp] : [];
      const res = await fetch("/api/missions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ws_id: workspaceId.trim() || undefined,
          title,
          priority: missionDraftPriority,
          goals: goal ? [goal] : [],
          linked_apps: linkedApps,
          note: `Created from main shell while focused on ${selectedSkyeApp}.`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Mission create failed (${res.status}).`);

      setMissionDraftTitle("");
      setMissionDraftGoal("");
      setMissionDraftPriority("medium");
      setMissionResult(`Mission created: ${data?.title || title}`);
      pushCommandFeed("Mission", `Mission created: ${data?.title || title}`, "ok", "SkyeTasks");
      void Promise.all([loadMissionRecords(), loadTimelineEntries(), loadSovereignEvents()]);
    } catch (error: any) {
      setMissionResult(error?.message || "Mission create failed.");
    } finally {
      setIsCreatingMission(false);
    }
  }

  useEffect(() => {
    if (!missions.length) {
      setSelectedMissionId("");
      return;
    }
    if (!selectedMissionId || !missions.some((mission) => mission.id === selectedMissionId)) {
      const firstMission = missions[0];
      setSelectedMissionId(firstMission.id);
      setMissionEditTitle(firstMission.title);
      setMissionEditGoal(Array.isArray(firstMission.goals_json) ? firstMission.goals_json[0] || "" : "");
      setMissionEditPriority(firstMission.priority);
      setMissionEditStatus(firstMission.status);
    }
  }, [missions, selectedMissionId]);

  useEffect(() => {
    if (!selectedMission) return;
    setMissionEditTitle(selectedMission.title);
    setMissionEditGoal(Array.isArray(selectedMission.goals_json) ? selectedMission.goals_json[0] || "" : "");
    setMissionEditPriority(selectedMission.priority);
    setMissionEditStatus(selectedMission.status);
    setMissionAssetSourceApp(selectedSkyeApp || "SkyeTasks");
    setMissionAssetKind(activeFile?.path ? "workspace_file" : "workspace_record");
    setMissionAssetId(activeFile?.path || `${selectedSkyeApp}:${workspaceId || "org-scope"}`);
    setMissionAssetTitle(activeFile?.path || `${selectedSkyeApp} asset`);
  }, [selectedMission, selectedSkyeApp, activeFile, workspaceId]);

  async function updateMissionRecord() {
    if (!selectedMission) {
      setMissionResult("Select a mission to update.");
      return;
    }

    const nextTitle = missionEditTitle.trim();
    const nextGoal = missionEditGoal.trim();
    if (!nextTitle) {
      setMissionResult("Mission title is required.");
      return;
    }

    setIsUpdatingMission(true);
    setMissionResult("");
    try {
      const linkedApps = Array.isArray(selectedMission.linked_apps_json) && selectedMission.linked_apps_json.length
        ? selectedMission.linked_apps_json
        : selectedSkyeApp
          ? [selectedSkyeApp]
          : [];
      const res = await fetch("/api/mission-update", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mission_id: selectedMission.id,
          title: nextTitle,
          status: missionEditStatus,
          priority: missionEditPriority,
          goals: nextGoal ? [nextGoal] : [],
          linked_apps: linkedApps,
          note: `Updated from main shell while focused on ${selectedSkyeApp}.`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Mission update failed (${res.status}).`);
      setMissionResult(`Mission updated: ${data?.item?.title || nextTitle}`);
      pushCommandFeed("Mission", `Mission updated: ${data?.item?.title || nextTitle}`, "ok", "SkyeTasks");
      void Promise.all([loadMissionRecords(), loadTimelineEntries(), loadSovereignEvents()]);
    } catch (error: any) {
      setMissionResult(error?.message || "Mission update failed.");
    } finally {
      setIsUpdatingMission(false);
    }
  }

  async function attachMissionCollaborator() {
    if (!selectedMission) {
      setMissionResult("Select a mission before attaching a collaborator.");
      return;
    }

    const email = missionCollaboratorEmail.trim().toLowerCase();
    if (!email) {
      setMissionResult("Collaborator email is required.");
      return;
    }

    setIsAttachingMissionCollaborator(true);
    setMissionResult("");
    try {
      const res = await fetch("/api/mission-collaborator", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mission_id: selectedMission.id,
          email,
          role: missionCollaboratorRole,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Collaborator attach failed (${res.status}).`);
      setMissionCollaboratorEmail("");
      setMissionResult(`Collaborator attached: ${data?.item?.email || email}`);
      pushCommandFeed("Mission", `Collaborator attached: ${data?.item?.email || email}`, "ok", "SkyeTasks");
      void Promise.all([loadMissionRecords(), loadTimelineEntries(), loadSovereignEvents()]);
    } catch (error: any) {
      setMissionResult(error?.message || "Collaborator attach failed.");
    } finally {
      setIsAttachingMissionCollaborator(false);
    }
  }

  async function attachMissionAsset() {
    if (!selectedMission) {
      setMissionResult("Select a mission before attaching an asset.");
      return;
    }

    const assetIdValue = missionAssetId.trim();
    if (!assetIdValue) {
      setMissionResult("Asset id is required.");
      return;
    }

    setIsAttachingMissionAsset(true);
    setMissionResult("");
    try {
      const res = await fetch("/api/mission-asset-attach", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mission_id: selectedMission.id,
          source_app: missionAssetSourceApp.trim() || selectedSkyeApp || undefined,
          asset_kind: missionAssetKind.trim(),
          asset_id: assetIdValue,
          title: missionAssetTitle.trim() || undefined,
          detail: {
            active_path: activeFile?.path || null,
            workspace_id: workspaceId || null,
            selected_app: selectedSkyeApp,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Asset attach failed (${res.status}).`);
      setMissionResult(`Asset attached: ${data?.item?.title || assetIdValue}`);
      pushCommandFeed("Mission", `Asset attached: ${data?.item?.title || assetIdValue}`, "ok", "SkyeTasks");
      void Promise.all([loadMissionRecords(), loadTimelineEntries(), loadSovereignEvents()]);
    } catch (error: any) {
      setMissionResult(error?.message || "Asset attach failed.");
    } finally {
      setIsAttachingMissionAsset(false);
    }
  }

  function contractorAdminHeaders(extraHeaders: Record<string, string> = {}) {
    const token = contractorAdminToken.trim();
    return token ? { ...extraHeaders, Authorization: `Bearer ${token}` } : extraHeaders;
  }

  async function loadContractorSubmissions(options: { status?: string; q?: string } = {}) {
    if (!contractorAdminToken.trim()) {
      setContractorSubmissions([]);
      return;
    }

    setIsContractorLoading(true);
    setContractorAdminResult("");
    try {
      const qs = new URLSearchParams();
      qs.set("limit", "12");
      const nextStatus = String(options.status ?? contractorStatusFilter).trim();
      const nextSearch = String(options.q ?? contractorSearch).trim();
      if (nextStatus) qs.set("status", nextStatus);
      if (nextSearch) qs.set("q", nextSearch);
      const res = await fetch(`/api/admin/submissions?${qs.toString()}`, {
        headers: contractorAdminHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Contractor submission query failed (${res.status}).`);
      const items = Array.isArray(data?.items) ? (data.items as ContractorSubmissionRecord[]) : [];
      setContractorSubmissions(items);
      if (items.length && !items.some((submission) => submission.id === selectedContractorSubmissionId)) {
        setSelectedContractorSubmissionId(items[0].id);
      }
      if (!items.length) {
        setSelectedContractorSubmissionId("");
      }
    } catch (error: any) {
      setContractorSubmissions([]);
      setContractorAdminResult(error?.message || "Contractor submission query failed.");
    } finally {
      setIsContractorLoading(false);
    }
  }

  async function loginContractorAdmin() {
    const password = contractorAdminPassword.trim();
    if (!password) {
      setContractorAdminResult("Admin password is required.");
      return;
    }

    setIsContractorLoggingIn(true);
    setContractorAdminResult("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Contractor admin login failed (${res.status}).`);
      setContractorAdminToken(String(data?.token || ""));
      setContractorAdminPassword("");
      setContractorAdminResult("ContractorNetwork admin authenticated.");
      void loadContractorSubmissions();
    } catch (error: any) {
      setContractorAdminResult(error?.message || "Contractor admin login failed.");
    } finally {
      setIsContractorLoggingIn(false);
    }
  }

  function logoutContractorAdmin() {
    setContractorAdminToken("");
    setContractorSubmissions([]);
    setSelectedContractorSubmissionId("");
    setContractorAdminNotes("");
    setContractorAdminTags("");
    setContractorAdminStatus("reviewing");
    setContractorAdminResult("ContractorNetwork admin logged out.");
  }

  async function verifyAdminBoardKey() {
    const key = adminBoardKey.trim();
    if (!key) {
      setAdminBoardResult("ADMIN_KEY is required.");
      return;
    }
    setIsAdminBoardVerifying(true);
    setAdminBoardResult("");
    try {
      const res = await fetch("/api/admin-key-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok !== true) throw new Error(data?.error || `Admin key verification failed (${res.status}).`);
      setAdminBoardUnlocked(true);
      setAdminBoardKey("");
      setAdminBoardResult("Admin board unlocked.");
    } catch (error: any) {
      setAdminBoardUnlocked(false);
      setAdminBoardResult(error?.message || "Admin key verification failed.");
    } finally {
      setIsAdminBoardVerifying(false);
    }
  }

  function lockAdminBoard() {
    setAdminBoardUnlocked(false);
    setAdminBoardKey("");
    setAdminBoardResult("Admin board locked.");
  }

  async function copyAdminBoardText(value: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(value);
      setAdminBoardResult(successMessage);
    } catch (error: any) {
      setAdminBoardResult(error?.message || "Clipboard copy failed.");
    }
  }

  useEffect(() => {
    if (!selectedContractorSubmission) return;
    setContractorAdminNotes(selectedContractorSubmission.admin_notes || "");
    setContractorAdminTags((selectedContractorSubmission.tags || []).join(", "));
    setContractorAdminStatus(selectedContractorSubmission.status || "reviewing");
  }, [selectedContractorSubmission]);

  useEffect(() => {
    if (!contractorAdminToken.trim()) {
      contractorQueueSeenRef.current = "";
      return;
    }
    if (contractorStatusFilter.trim() || contractorSearch.trim()) return;

    void loadContractorSubmissions({ status: "", q: "" });
    const timer = window.setInterval(() => {
      void loadContractorSubmissions({ status: "", q: "" });
    }, 20000);

    return () => window.clearInterval(timer);
  }, [contractorAdminToken, contractorStatusFilter, contractorSearch]);

  useEffect(() => {
    if (!contractorAdminToken.trim()) return;
    if (contractorStatusFilter.trim() || contractorSearch.trim()) return;
    const summary = summarizeContractorQueue(contractorSubmissions);
    if (!summary) return;

    const snapshot = contractorSubmissions.map((submission) => `${submission.id}:${submission.status}:${submission.updated_at || submission.created_at || ""}`).join("|");
    if (contractorQueueSeenRef.current === snapshot) return;
    contractorQueueSeenRef.current = snapshot;

    pushCommandFeed(
      "ContractorNetwork",
      summary.detail,
      summary.tone,
      undefined,
      {
        kind: "focus-contractor",
        submissionId: summary.latest.id,
        filter: summary.queued ? "new" : summary.pending ? "reviewing" : undefined,
      },
      summary.badge
    );
  }, [contractorAdminToken, contractorStatusFilter, contractorSearch, contractorSubmissions]);

  async function saveContractorSubmission() {
    if (!selectedContractorSubmission) {
      setContractorAdminResult("Select a submission to update.");
      return;
    }

    setIsContractorSaving(true);
    setContractorAdminResult("");
    try {
      const tags = contractorAdminTags
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 20);
      const res = await fetch(`/api/admin/submission/${encodeURIComponent(selectedContractorSubmission.id)}`, {
        method: "PATCH",
        headers: contractorAdminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          admin_notes: contractorAdminNotes,
          tags,
          status: contractorAdminStatus,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Contractor submission save failed (${res.status}).`);
      setContractorAdminResult(`Submission updated: ${selectedContractorSubmission.full_name}`);
      pushCommandFeed("ContractorNetwork", `Submission updated: ${selectedContractorSubmission.full_name}`, "ok", undefined);
      void Promise.all([loadContractorSubmissions(), loadTimelineEntries(), loadSovereignEvents()]);
    } catch (error: any) {
      setContractorAdminResult(error?.message || "Contractor submission save failed.");
    } finally {
      setIsContractorSaving(false);
    }
  }

  async function exportContractorSubmissions() {
    if (!contractorAdminToken.trim()) {
      setContractorAdminResult("ContractorNetwork admin login is required.");
      return;
    }

    setIsContractorExporting(true);
    setContractorAdminResult("");
    try {
      const res = await fetch("/api/admin/export", {
        headers: contractorAdminHeaders(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Contractor export failed (${res.status}).`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "skyes-contractors-submissions.csv";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setContractorAdminResult("Contractor submission export ready.");
      pushCommandFeed("ContractorNetwork", "Contractor submission export ready.", "ok", undefined, {
        kind: "focus-contractor",
      }, `${contractorPendingCount} pending`);
    } catch (error: any) {
      setContractorAdminResult(error?.message || "Contractor export failed.");
    } finally {
      setIsContractorExporting(false);
    }
  }

  function pushCommandFeed(
    source: string,
    detail: string,
    tone: CommandFeedTone = inferCommandTone(detail),
    appId?: SkyeAppId | "SkyeMail" | "SkyeChat" | "SkyeDrive",
    action?: CommandFeedAction,
    badge?: string
  ) {
    const nextItem: CommandFeedItem = {
      id: makeId(),
      source,
      detail,
      tone,
      appId,
      at: new Date().toISOString(),
      action,
      badge,
    };
    setCommandFeed((old) => {
      if (old[0] && old[0].source === source && old[0].detail === detail) return old;
      return [nextItem, ...old].slice(0, 24);
    });
  }

  function emitAppBridge(payload: Record<string, any>) {
    const envelope = { type: APP_BRIDGE_EVENT_KEY, payload };
    const serialized = JSON.stringify(envelope);
    localStorage.setItem(APP_BRIDGE_EVENT_KEY, serialized);
    window.postMessage(envelope, window.location.origin);
    handleAppBridgePayload(payload);
  }

  async function readDroppedEntry(entry: any): Promise<DroppedDriveFile[]> {
    if (!entry) return [];

    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => {
        entry.file(resolve, reject);
      });
      const relativePath = sanitizeDroppedPath(entry.fullPath || file.name);
      return [{ file, relativePath }];
    }

    if (!entry.isDirectory || typeof entry.createReader !== "function") return [];
    const reader = entry.createReader();
    const entries: any[] = [];

    while (true) {
      const batch = await new Promise<any[]>((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });
      if (!batch.length) break;
      entries.push(...batch);
    }

    const nested = await Promise.all(entries.map((child) => readDroppedEntry(child)));
    return nested.flat();
  }

  async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<DroppedDriveFile[]> {
    const items = Array.from(dataTransfer.items || []);
    const entryItems = items
      .map((item) => {
        const maybeEntry = (item as DataTransferItem & { webkitGetAsEntry?: () => any }).webkitGetAsEntry?.();
        return maybeEntry || null;
      })
      .filter(Boolean);

    if (entryItems.length) {
      const nested = await Promise.all(entryItems.map((entry) => readDroppedEntry(entry)));
      return nested.flat();
    }

    return Array.from(dataTransfer.files || []).map((file) => ({
      file,
      relativePath: sanitizeDroppedPath((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name),
    }));
  }

  async function ingestDroppedFiles(droppedFiles: DroppedDriveFile[]) {
    if (!droppedFiles.length) return;

    const savedAt = new Date().toISOString();
    const assets: DriveAsset[] = droppedFiles.map(({ file, relativePath }, index) => ({
      id: `drive-${Date.now()}-${index}`,
      name: file.name,
      kind: inferDriveAssetKind(file.name, file.type),
      size_kb: Math.max(1, Math.round(file.size / 1024)),
      owner: authUser.trim().toLowerCase() || "workspace-user",
      version: 1,
      shared_with: "",
      relative_path: sanitizeDroppedPath(relativePath),
      mime_type: file.type || "application/octet-stream",
      source_app: selectedSkyeApp,
      saved_at: savedAt,
    }));

    setDriveAssets((old) => [...assets, ...old]);
    setLeftMiddleDockApp("SkyeDrive");

    await saveDriveAssetFiles(
      assets.map((asset, index) => ({
        assetId: asset.id,
        name: asset.name,
        type: asset.mime_type || "application/octet-stream",
        size: droppedFiles[index].file.size,
        lastModified: droppedFiles[index].file.lastModified,
        relativePath: asset.relative_path || asset.name,
        blob: droppedFiles[index].file,
        savedAt,
      }))
    );

    const importable = droppedFiles.filter(({ file, relativePath }) => isWorkspaceImportableFile(file, relativePath));
    if (importable.length) {
      const importedFiles = await Promise.all(
        importable.map(async ({ file, relativePath }) => ({
          path: sanitizeDroppedPath(relativePath),
          content: await file.text(),
        }))
      );

      setFiles((old) => {
        const byPath = new Map(old.map((entry) => [entry.path, entry]));
        for (const imported of importedFiles) {
          byPath.set(imported.path, imported);
        }
        return Array.from(byPath.values());
      });
      if (importedFiles[0]?.path) setActivePath(importedFiles[0].path);
    }

    const detail = `Drive captured ${assets.length} dropped asset${assets.length === 1 ? "" : "s"} from ${selectedSkyeApp}.${importable.length ? ` Imported ${importable.length} text/code file${importable.length === 1 ? "" : "s"} into the IDE workspace.` : ""}`;
    localStorage.setItem(DRIVE_DROP_LATEST_KEY, JSON.stringify({ at: savedAt, assets }));
    emitAppBridge({ kind: "drive-assets-added", source: selectedSkyeApp, assets, detail });
    pushCommandFeed("Global Drop", detail, "ok", "SkyeDrive");
  }

  function routeCrossAppFocus(appId: SkyeAppId, options: { channel?: string; note?: string } = {}) {
    setAppMode("skyeide");
    setSelectedSkyeApp(appId);
    if (appId === "SkyeChat") {
      setRightTopDockApp("SkyeChat");
      if (options.channel?.trim()) {
        const channel = options.channel.trim();
        setChatChannelInput(channel);
        setChatHistoryChannel(channel);
      }
      void loadSkyeChatHistory();
    }
    if (appId === "SkyeMail") {
      void loadSkyeMailHistory();
    }
    if (appId === "SkyeDrive") {
      setLeftMiddleDockApp("SkyeDrive");
    }
    if (options.note) pushIdeDiagnostic("info", options.note);
  }

  function triggerSuiteRoute(targetAppId: WorkspaceStageApp, options: { note: string; channel?: string; tone?: CommandFeedTone } = { note: "" }) {
    const note = String(options.note || "").trim();
    if (targetAppId === "Neural-Space-Pro") {
      pushCommandFeed(selectedSkyeApp, `${selectedSkyeApp} routed context into Neural Space Pro.${note ? ` ${note}` : ""}`, options.tone || "info");
      setAppMode("neural");
      if (note) pushIdeDiagnostic("info", note);
      return;
    }
    emitAppBridge({
      kind: "action",
      source: selectedSkyeApp,
      appId: targetAppId,
      tone: options.tone || "info",
      detail: `${selectedSkyeApp} routed context into ${targetAppId}.${note ? ` ${note}` : ""}`,
    });
    emitAppBridge({
      kind: "open-app",
      source: selectedSkyeApp,
      appId: targetAppId,
      channel: options.channel,
      note: note || `Opened from ${selectedSkyeApp}.`,
    });
  }

  function handleAppBridgePayload(payload: any) {
    if (!payload) return;

    if (payload.kind === "suite-intent" && payload.intent) {
      const targetApp = typeof payload.targetApp === "string" ? payload.targetApp : typeof payload.appId === "string" ? payload.appId : undefined;
      const tone = payload.tone || (payload.intent.status === "failed" ? "fail" : payload.intent.status === "completed" ? "ok" : "info");
      setSuiteEvents((old) => {
        const optimistic: SuiteEventRecord = {
          id: `local-${Date.now()}`,
          occurred_at: String(payload.at || new Date().toISOString()),
          source_app: String(payload.source || "Suite"),
          target_app: targetApp || null,
          summary: String(payload.detail || `${payload.source || "Suite"} ${payload.intent.status} ${payload.intent.name}`),
          detail: String(payload.detail || ""),
          intent: payload.intent as SuiteIntentRecord,
          context: (payload.context || { workspace_id: workspaceId }) as SuiteIntentContext,
          payload: (payload.payload || {}) as Record<string, unknown>,
        };
        const duplicate = old.find((item) => item.occurred_at === optimistic.occurred_at && item.source_app === optimistic.source_app && item.target_app === optimistic.target_app && item.intent.name === optimistic.intent.name);
        if (duplicate) return old;
        return [optimistic, ...old].slice(0, 24);
      });
      pushCommandFeed(
        String(payload.source || "Suite"),
        String(payload.detail || `${payload.source || "Suite"} ${payload.intent.status} ${payload.intent.name}`),
        tone,
        targetApp && (SKYE_APP_ID_SET.has(targetApp) || targetApp === "SkyeMail" || targetApp === "SkyeChat" || targetApp === "SkyeDrive") ? targetApp : undefined,
        undefined,
        payload.badge || payload.intent.name
      );
      if (targetApp === "Neural-Space-Pro" && payload.intent.status !== "failed") {
        setAppMode("neural");
      }
      return;
    }

    if (payload.kind === "open-app") {
      if (payload.appId === "Neural-Space-Pro") {
        const noteParts = [payload.source, payload.note].filter(Boolean);
        setAppMode("neural");
        if (noteParts.length) pushIdeDiagnostic("info", noteParts.join(" :: "));
        return;
      }
      const appId = typeof payload.appId === "string" && SKYE_APP_ID_SET.has(payload.appId) ? (payload.appId as SkyeAppId) : null;
      if (!appId) return;
      const noteParts = [payload.source, payload.note].filter(Boolean);
      routeCrossAppFocus(appId, {
        channel: typeof payload.channel === "string" ? payload.channel : "",
        note: noteParts.length ? noteParts.join(" :: ") : undefined,
      });
      return;
    }

    if (payload.kind === "drive-assets-added") {
      setLeftMiddleDockApp("SkyeDrive");
      if (Array.isArray(payload.assets) && payload.assets.length) {
        setDriveAssets((old) => {
          const seen = new Set(old.map((asset) => asset.id));
          const next = [...old];
          for (const asset of payload.assets as DriveAsset[]) {
            if (!seen.has(asset.id)) next.unshift(asset);
          }
          return next;
        });
      }
      if (payload.detail) pushCommandFeed(payload.source || "Drive", String(payload.detail), "ok", "SkyeDrive");
      return;
    }

    if (payload.kind === "action" && payload.detail) {
      pushCommandFeed(String(payload.source || "Action"), String(payload.detail), payload.tone || inferCommandTone(payload.detail), payload.appId);
    }
  }

  useEffect(() => {
    localStorage.setItem("kx.sknore.patterns", sknoreText);
  }, [sknoreText]);

  useEffect(() => {
    localStorage.setItem("kx.auth.user", authUser);
    localStorage.setItem("kx.auth.role", authRole);
  }, [authUser, authRole]);

  useEffect(() => {
    const next = authOrgName.trim();
    if (!next) {
      localStorage.removeItem(AUTH_ORG_NAME_KEY);
      return;
    }
    localStorage.setItem(AUTH_ORG_NAME_KEY, next);
  }, [authOrgName]);

  useEffect(() => {
    const next = recoveryEmail.trim().toLowerCase();
    if (!next) {
      localStorage.removeItem("kx.auth.recoveryEmail");
      return;
    }
    localStorage.setItem("kx.auth.recoveryEmail", next);
  }, [recoveryEmail]);

  useEffect(() => {
    if (onboardingAssistMode === "undecided") {
      localStorage.removeItem(ONBOARDING_ASSIST_MODE_KEY);
      return;
    }
    localStorage.setItem(ONBOARDING_ASSIST_MODE_KEY, onboardingAssistMode);
  }, [onboardingAssistMode]);

  useEffect(() => {
    const next = workspaceMailboxEmail.trim().toLowerCase();
    if (!next) {
      localStorage.removeItem(ONBOARDING_WORKSPACE_EMAIL_KEY);
      return;
    }
    localStorage.setItem(ONBOARDING_WORKSPACE_EMAIL_KEY, next);
  }, [workspaceMailboxEmail]);

  useEffect(() => {
    function readOnboardingDrafts() {
      try {
        const emailRaw = localStorage.getItem(ONBOARDING_EMAIL_DRAFT_KEY);
        if (!emailRaw) {
          setOnboardingEmailDraft(null);
        } else {
          const parsed = JSON.parse(emailRaw) as Partial<OnboardingEmailDraft>;
          if (parsed?.email && parsed?.prefix && parsed?.domain) {
            setOnboardingEmailDraft({
              email: String(parsed.email),
              prefix: String(parsed.prefix),
              domain: String(parsed.domain),
              source: String(parsed.source || "SKYEMAIL-GEN"),
              updatedAt: String(parsed.updatedAt || new Date().toISOString()),
            });
          } else {
            setOnboardingEmailDraft(null);
          }
        }

        const idRaw = localStorage.getItem(ONBOARDING_ID_DRAFT_KEY);
        if (!idRaw) {
          setOnboardingIdentityDraft(null);
        } else {
          const parsed = JSON.parse(idRaw) as Partial<OnboardingIdentityDraft>;
          if (parsed?.name && parsed?.idNumber) {
            setOnboardingIdentityDraft({
              name: String(parsed.name),
              idNumber: String(parsed.idNumber),
              source: String(parsed.source || "Skye-ID"),
              updatedAt: String(parsed.updatedAt || new Date().toISOString()),
            });
          } else {
            setOnboardingIdentityDraft(null);
          }
        }
      } catch {
        setOnboardingEmailDraft(null);
        setOnboardingIdentityDraft(null);
      }
    }

    function onStorage(event: StorageEvent) {
      if (event.key === ONBOARDING_EMAIL_DRAFT_KEY || event.key === ONBOARDING_ID_DRAFT_KEY) {
        readOnboardingDrafts();
      }
    }

    readOnboardingDrafts();
    window.addEventListener("storage", onStorage);
    const poller = setInterval(readOnboardingDrafts, 1500);
    return () => {
      window.removeEventListener("storage", onStorage);
      clearInterval(poller);
    };
  }, []);

  useEffect(() => {
    function syncCrossWindowAuthState() {
      setApiAccessToken(localStorage.getItem("kx.api.accessToken") || "");
      setApiTokenEmail(localStorage.getItem("kx.api.tokenEmail") || "");
      setHasSessionPin(localStorage.getItem(AUTH_HAS_PIN_KEY) === "1");
      setPinUnlockedAt(localStorage.getItem(AUTH_PIN_UNLOCKED_AT_KEY) || "");
      setAuthUser(localStorage.getItem("kx.auth.user") || "founder@skye.local");
      setRecoveryEmail(localStorage.getItem("kx.auth.recoveryEmail") || "");
      setAuthOrgName(localStorage.getItem(AUTH_ORG_NAME_KEY) || "Skye Workspace");
      setWorkspaceMailboxEmail(localStorage.getItem(ONBOARDING_WORKSPACE_EMAIL_KEY) || "");
      const rawRole = localStorage.getItem("kx.auth.role") as AuthRole | null;
      if (rawRole && ["owner", "admin", "member", "viewer"].includes(rawRole)) {
        setAuthRole(rawRole);
      }
    }

    function onStorage(event: StorageEvent) {
      if (!event.key) return;
      if (
        event.key === "kx.api.accessToken" ||
        event.key === "kx.api.tokenEmail" ||
        event.key === AUTH_HAS_PIN_KEY ||
        event.key === AUTH_PIN_UNLOCKED_AT_KEY ||
        event.key === "kx.auth.user" ||
        event.key === "kx.auth.recoveryEmail" ||
        event.key === "kx.auth.role" ||
        event.key === AUTH_ORG_NAME_KEY ||
        event.key === ONBOARDING_WORKSPACE_EMAIL_KEY
      ) {
        syncCrossWindowAuthState();
      }
    }

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    localStorage.setItem("kx.api.accessToken", apiAccessToken);
    localStorage.setItem("kx.api.tokenEmail", apiTokenEmail);
    if (apiAccessToken.trim()) localStorage.setItem("kaixu_api_key", apiAccessToken.trim());
  }, [apiAccessToken, apiTokenEmail]);

  useEffect(() => {
    localStorage.setItem(AUTH_HAS_PIN_KEY, hasSessionPin ? "1" : "0");
  }, [hasSessionPin]);

  useEffect(() => {
    if (pinUnlockedAt) localStorage.setItem(AUTH_PIN_UNLOCKED_AT_KEY, pinUnlockedAt);
    else localStorage.removeItem(AUTH_PIN_UNLOCKED_AT_KEY);
  }, [pinUnlockedAt]);

  useEffect(() => {
    if (!apiTokenEmail.trim()) {
      setApiTokenEmail(authUser.trim().toLowerCase());
    }
  }, [authUser, apiTokenEmail]);

  useEffect(() => {
    if (!inviteToken) return;
    if (inviteAcceptEmail.trim()) return;
    setInviteAcceptEmail(authUser.trim().toLowerCase());
  }, [inviteToken, inviteAcceptEmail, authUser]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const resetEmail = String(params.get("reset_email") || "").trim().toLowerCase();
    const token = String(params.get("reset_token") || "").trim();
    if (resetEmail && !authUser.trim()) setAuthUser(resetEmail);
    if (resetEmail) setAuthUser(resetEmail);
    if (token) setResetToken(token);
  }, []);

  useEffect(() => {
    if (authSeededFromGenerators) return;
    let changed = false;

    if (onboardingEmailDraft?.email) {
      const currentWorkspaceEmail = workspaceMailboxEmail.trim().toLowerCase();
      if (!currentWorkspaceEmail) {
        setWorkspaceMailboxEmail(onboardingEmailDraft.email.toLowerCase());
        changed = true;
      }
    }

    if (onboardingIdentityDraft?.name) {
      const org = authOrgName.trim();
      if (!org || org === "Skye Workspace") {
        setAuthOrgName(`${onboardingIdentityDraft.name} Workspace`);
        changed = true;
      }
    }

    if (changed) setAuthSeededFromGenerators(true);
  }, [onboardingEmailDraft, onboardingIdentityDraft, workspaceMailboxEmail, authOrgName, authSeededFromGenerators]);

  useEffect(() => {
    const hasSession = assistantAuthStatus === "ok" || assistantAuthStatus === "token";
    if (inviteToken || hasSession) {
      setShowOnboardingPrompt(false);
      return;
    }
    if (onboardingAssistMode === "undecided") {
      setShowOnboardingPrompt(true);
    }
  }, [assistantAuthStatus, onboardingAssistMode, inviteToken]);

  const searchParams = new URLSearchParams(window.location.search);
  const isAuthCenterMode = searchParams.get("auth_center") === "1";
  const authCenterGuideRequested = searchParams.get("guide") === "1";
  const hideCinematicIntro = isAuthCenterMode || searchParams.get("no_intro") === "1";

  function buildAuthCenterUrl(options: { guide?: boolean } = {}) {
    const url = new URL(window.location.href);
    url.searchParams.set("auth_center", "1");
    url.searchParams.set("no_intro", "1");
    if (options.guide) url.searchParams.set("guide", "1");
    else url.searchParams.delete("guide");
    return url.toString();
  }

  function openAuthCenterWindow(options: { focus?: boolean; guide?: boolean } = {}) {
    const existing = authCenterWindowRef.current;
    if (existing && !existing.closed) {
      if (options.guide) existing.location.href = buildAuthCenterUrl({ guide: true });
      if (options.focus !== false) existing.focus();
      setAuthCenterLaunchBlocked(false);
      return true;
    }

    const popup = window.open(
      buildAuthCenterUrl({ guide: options.guide }),
      AUTH_CENTER_POPUP_NAME,
      "popup=yes,width=640,height=980,left=48,top=40,resizable=yes,scrollbars=yes"
    );
    authCenterWindowRef.current = popup;
    const opened = Boolean(popup && !popup.closed);
    setAuthCenterLaunchBlocked(!opened);
    if (opened && options.focus !== false) popup?.focus();
    return opened;
  }

  useEffect(() => {
    if (isAuthCenterMode) {
      if (authCenterGuideRequested) {
        setOnboardingAssistMode("guided");
        setShowOnboardingGuide(true);
      }
      setShowOnboardingPrompt(false);
      return;
    }

    const hasSession = assistantAuthStatus === "ok" || assistantAuthStatus === "token";
    if (hasSession && !inviteToken) return;
    if (sessionStorage.getItem(AUTH_CENTER_AUTO_OPENED_SESSION_KEY) === "1") return;

    const timer = window.setTimeout(() => {
      sessionStorage.setItem(AUTH_CENTER_AUTO_OPENED_SESSION_KEY, "1");
      const opened = openAuthCenterWindow({
        focus: true,
        guide: inviteToken ? true : onboardingAssistMode !== "self-serve",
      });
      if (!opened) setShowOnboardingPrompt(true);
    }, 4800);

    return () => window.clearTimeout(timer);
  }, [assistantAuthStatus, inviteToken, onboardingAssistMode, isAuthCenterMode, authCenterGuideRequested]);

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
    void loadOpsWorkspaceModels();
  }, [workspaceId]);

  useEffect(() => {
    if (selectedSkyeApp === "SkyeAdmin") {
      void loadTeamMembers();
      void loadWorkspaceMembers();
      void loadTokenInventory();
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
    void refreshAuthSession();
  }, []);

  useEffect(() => {
    const tracked = [
      { key: "auth", source: "Auth Center", value: authResult, appId: "SkyeAdmin" as const },
      { key: "ide", source: "IDE", value: ideOpsResult, appId: "SkyDex4.6" as const },
      { key: "mail", source: "SkyeMail", value: mailSendResult, appId: "SkyeMail" as const },
      { key: "chat", source: "SkyeChat", value: chatNotifyResult, appId: "SkyeChat" as const },
      { key: "share", source: "Project Share", value: shareResult, appId: selectedSkyeApp },
      { key: "team", source: "Team Admin", value: teamResult, appId: "SkyeAdmin" as const },
      { key: "members", source: "Workspace Access", value: workspaceMemberResult, appId: "SkyeAdmin" as const },
      { key: "invite", source: "Invite Flow", value: inviteAcceptResult, appId: "SkyeAdmin" as const },
      { key: "suite", source: "Suite Sync", value: suiteSyncResult, appId: selectedSkyeApp },
      { key: "tokens", source: "Key Control", value: tokenOpsResult, appId: "SkyeAdmin" as const },
    ];

    for (const item of tracked) {
      const next = item.value.trim();
      if (!next) continue;
      if (item.key === "ide" && next.startsWith("Workspace saved (")) continue;
      if (item.key === "suite" && (/^Exported .* as \.skye$/i.test(next) || /^Exported health snapshot for /i.test(next))) continue;
      if (actionFeedSeenRef.current[item.key] === next) continue;
      actionFeedSeenRef.current[item.key] = next;
      pushCommandFeed(item.source, next, inferCommandTone(next), item.appId);
    }
  }, [authResult, ideOpsResult, mailSendResult, chatNotifyResult, shareResult, teamResult, workspaceMemberResult, inviteAcceptResult, suiteSyncResult, tokenOpsResult, selectedSkyeApp]);

  useEffect(() => {
    document.body.classList.toggle("global-drop-active", isGlobalDropActive);
    return () => document.body.classList.remove("global-drop-active");
  }, [isGlobalDropActive]);

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== APP_BRIDGE_EVENT_KEY || !event.newValue) return;
      try {
        const parsed = JSON.parse(event.newValue) as { type?: string; payload?: unknown };
        if (parsed?.type !== APP_BRIDGE_EVENT_KEY) return;
        handleAppBridgePayload(parsed.payload);
      } catch {
        // Ignore malformed bridge payloads from other tabs.
      }
    }

    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; payload?: unknown } | null;
      if (!data || data.type !== APP_BRIDGE_EVENT_KEY) return;
      handleAppBridgePayload(data.payload);
    }

    window.addEventListener("storage", onStorage);
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("message", onMessage);
    };
  }, []);

  useEffect(() => {
    async function onDrop(event: DragEvent) {
      event.preventDefault();
      event.stopPropagation();
      dropDepthRef.current = 0;
      setIsGlobalDropActive(false);
      if (!event.dataTransfer) return;
      const dropped = await collectDroppedFiles(event.dataTransfer);
      if (!dropped.length) return;
      try {
        await ingestDroppedFiles(dropped);
      } catch (error: any) {
        const message = error?.message || "Global drop ingest failed.";
        pushCommandFeed("Global Drop", message, "fail", "SkyeDrive");
      }
    }

    function onDragEnter(event: DragEvent) {
      if (!event.dataTransfer?.types?.includes("Files")) return;
      event.preventDefault();
      dropDepthRef.current += 1;
      setIsGlobalDropActive(true);
    }

    function onDragOver(event: DragEvent) {
      if (!event.dataTransfer?.types?.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setIsGlobalDropActive(true);
    }

    function onDragLeave(event: DragEvent) {
      if (!event.dataTransfer?.types?.includes("Files")) return;
      event.preventDefault();
      dropDepthRef.current = Math.max(0, dropDepthRef.current - 1);
      if (dropDepthRef.current === 0) setIsGlobalDropActive(false);
    }

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [authUser, selectedSkyeApp, workspaceId, files]);

  useEffect(() => {
    const target = activePath.trim();
    if (!target) return;
    if (!workspaceUnloadedPaths.includes(target)) return;
    void hydrateWorkspaceFile(target);
  }, [activePath, workspaceUnloadedPaths, workspaceId]);

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

  useEffect(() => {
    // Mirror task due dates into calendar so schedule reflects execution board automatically.
    setCalendarEvents((old) => {
      const manual = old.filter((event) => !event.id.startsWith("taskcal-"));
      const generated = tasksModel
        .filter((task) => task.due_at)
        .map((task) => {
          const status: CalendarEvent["status"] = task.status === "done" ? "done" : task.status === "doing" ? "confirmed" : "planned";
          return {
            id: `taskcal-${task.id}`,
            title: `[Task] ${task.title}`,
            start_date: task.due_at,
            end_date: task.due_at,
            owner: task.assignee || authUser,
            status,
            notes: `priority=${task.priority} · source=SkyeTasks`,
          } as CalendarEvent;
        });

      const merged = [...manual, ...generated].sort((a, b) => `${a.start_date}-${a.id}`.localeCompare(`${b.start_date}-${b.id}`));
      const prev = [...old].sort((a, b) => `${a.start_date}-${a.id}`.localeCompare(`${b.start_date}-${b.id}`));
      if (JSON.stringify(prev) === JSON.stringify(merged)) return old;
      return merged;
    });
  }, [tasksModel, authUser]);

  useEffect(() => {
    if (!calendarHydrated) return;
    const timer = setTimeout(() => {
      void saveOpsWorkspaceModel("SkyeCalendar", { events: calendarEvents }, "SkyeCalendar Events");
    }, 700);
    return () => clearTimeout(timer);
  }, [calendarEvents, workspaceId, calendarHydrated]);

  useEffect(() => {
    if (!driveHydrated) return;
    const timer = setTimeout(() => {
      void saveOpsWorkspaceModel("SkyeDrive", { assets: driveAssets }, "SkyeDrive Assets");
    }, 700);
    return () => clearTimeout(timer);
  }, [driveAssets, workspaceId, driveHydrated]);

  useEffect(() => {
    if (!vaultHydrated) return;
    const timer = setTimeout(() => {
      void saveOpsWorkspaceModel("SkyeVault", { secrets: vaultSecrets }, "SkyeVault Secrets");
    }, 700);
    return () => clearTimeout(timer);
  }, [vaultSecrets, workspaceId, vaultHydrated]);

  useEffect(() => {
    if (!formsHydrated) return;
    const timer = setTimeout(() => {
      void saveOpsWorkspaceModel("SkyeForms", { questions: formQuestions }, "SkyeForms Questions");
    }, 700);
    return () => clearTimeout(timer);
  }, [formQuestions, workspaceId, formsHydrated]);

  useEffect(() => {
    if (!notesHydrated) return;
    const timer = setTimeout(() => {
      void saveOpsWorkspaceModel("SkyeNotes", { notes: notesModel }, "SkyeNotes Workspace");
    }, 700);
    return () => clearTimeout(timer);
  }, [notesModel, workspaceId, notesHydrated]);

  function updateActiveFileContent(content: string) {
    setFiles((old) => old.map((file) => (file.path === activeFile.path ? { ...file, content } : file)));
    setWorkspaceUnloadedPaths((old) => old.filter((path) => path !== activeFile.path));
  }

  function addWorkspaceFile() {
    const nextPath = newFilePath.trim().replace(/^\/+/, "");
    if (!nextPath) {
      setIdeOpsResult("File path is required.");
      return;
    }
    if (files.some((file) => file.path === nextPath)) {
      setIdeOpsResult(`File already exists: ${nextPath}`);
      setActivePath(nextPath);
      return;
    }
    const next = { path: nextPath, content: "" };
    setFiles((old) => [...old, next]);
    setActivePath(nextPath);
    setIdeOpsResult(`File created: ${nextPath}`);
    maybeStageWorkspaceBootstrapEnv(nextPath);
  }

  function deleteActiveWorkspaceFile() {
    const target = activeFile?.path;
    if (!target) return;
    if (files.length <= 1) {
      setIdeOpsResult("At least one file must remain in the workspace.");
      return;
    }
    const nextFiles = files.filter((file) => file.path !== target);
    setFiles(nextFiles);
    setWorkspaceUnloadedPaths((old) => old.filter((path) => path !== target));
    setActivePath(nextFiles[0].path);
    setIdeOpsResult(`Deleted file: ${target}`);
  }

  async function hydrateWorkspaceFile(path: string, force = false) {
    const targetPath = String(path || "").trim().replace(/^\/+/, "");
    if (!workspaceId.trim() || !targetPath) return;
    if (!force && !workspaceUnloadedPaths.includes(targetPath)) return;

    try {
      const payload = await fetchWorkspaceFile(workspaceId.trim(), targetPath);
      setFiles((old) => old.map((file) => (file.path === targetPath ? { ...file, content: payload.content } : file)));
      if (payload.revision) setWorkspaceRevision(payload.revision);
      setWorkspaceUnloadedPaths((old) => old.filter((entry) => entry !== targetPath));
    } catch (error: any) {
      pushIdeDiagnostic("warn", `Lazy load failed for ${targetPath}: ${error?.message || "unknown error"}`);
    }
  }

  async function hydrateAllWorkspaceFiles() {
    if (!workspaceId.trim() || !workspaceUnloadedPaths.length) return;
    const pending = [...workspaceUnloadedPaths];
    const loaded = await Promise.all(
      pending.map(async (path) => {
        const file = await fetchWorkspaceFile(workspaceId.trim(), path);
        return file;
      })
    );

    const contentByPath = new Map(loaded.map((file) => [file.path, file.content]));
    setFiles((old) =>
      old.map((file) => (contentByPath.has(file.path) ? { ...file, content: contentByPath.get(file.path) || "" } : file))
    );

    const newestRevision = loaded.map((file) => file.revision).find((value) => Boolean(value));
    if (newestRevision) setWorkspaceRevision(newestRevision);
    setWorkspaceUnloadedPaths([]);
  }

  async function saveWorkspaceNow(force = false) {
    if (!workspaceId.trim()) {
      setIdeOpsResult("Workspace ID is required.");
      return;
    }
    setIsSavingWorkspace(true);
    setIdeOpsResult("");
    try {
      await hydrateAllWorkspaceFiles();
      const serverSnapshot = await fetchWorkspaceFiles(workspaceId.trim());
      const serverFiles = serverSnapshot.files;
      const serverHash = serializeWorkspaceFiles(serverFiles);
      const hasConflict = workspaceSavedHash !== "" && serverHash !== workspaceSavedHash && workspaceDirty;
      if (hasConflict && !force) {
        const message = "Conflict detected: server workspace changed since your last sync. Reload or Force Save.";
        setWorkspaceConflict({ detectedAt: new Date().toISOString(), serverHash, message });
        setIdeOpsResult(message);
        pushIdeDiagnostic("warn", message);
        return;
      }

      const saveResult = await persistWorkspaceFiles(workspaceId.trim(), files, {
        expectedRevision: workspaceRevision || serverSnapshot.revision || "",
        force,
      });
      setWorkspaceSavedHash(serializeWorkspaceFiles(files));
      if (saveResult.revision) setWorkspaceRevision(saveResult.revision);
      setWorkspaceConflict(null);
      setIdeOpsResult(`Workspace saved (${files.length} files).`);
      pushIdeDiagnostic("info", `Workspace saved (${files.length} files).`);
      pushCommandFeed(
        "IDE",
        sknoreBlockedFiles.length
          ? `Workspace saved (${files.length} files). SKNore is shielding ${sknoreBlockedFiles.length} files from AI flows.`
          : `Workspace saved (${files.length} files). SKNore reports no blocked files.`,
        "ok",
        "SkyDex4.6",
        sknoreBlockedFiles.length
          ? {
              kind: "show-file-list",
              title: `SKNore blocked ${sknoreBlockedFiles.length} files`,
              description: "These files remain protected from AI context and command-side generation flows.",
              paths: sknoreBlockedFiles,
            }
          : undefined,
        `${sknoreBlockedFiles.length} protected`
      );
    } catch (error: any) {
      const isConflict = Number(error?.status || 0) === 409;
      if (isConflict) {
        const serverRevision = String(error?.conflict?.current_revision || "");
        const message = "Conflict detected: server revision changed. Reload or Force Save.";
        setWorkspaceConflict({ detectedAt: new Date().toISOString(), serverHash: serverRevision || "unknown", message });
        setIdeOpsResult(message);
        pushIdeDiagnostic("warn", message);
      } else {
        setIdeOpsResult(error?.message || "Workspace save failed.");
        pushIdeDiagnostic("error", error?.message || "Workspace save failed.");
      }
    } finally {
      setIsSavingWorkspace(false);
    }
  }

  async function loadWorkspaceNow() {
    if (!workspaceId.trim()) {
      setIdeOpsResult("Workspace ID is required.");
      return;
    }
    setIsLoadingWorkspace(true);
    setIdeOpsResult("");
    try {
      const tree = await fetchWorkspaceTree(workspaceId.trim());
      if (!tree.files.length) {
        setIdeOpsResult("Workspace loaded (no files found). Keeping current editor state.");
        pushIdeDiagnostic("warn", "Workspace load returned no files.");
        return;
      }

      const skeletonFiles = tree.files.map((file) => ({ path: file.path, content: "" }));
      setFiles(skeletonFiles);
      setWorkspaceUnloadedPaths(tree.files.map((file) => file.path));
      setWorkspaceRevision(tree.revision || "");
      setActivePath(tree.files[0].path);
      await hydrateWorkspaceFile(tree.files[0].path, true);

      const snapshot = await fetchWorkspaceFiles(workspaceId.trim());
      setWorkspaceSavedHash(serializeWorkspaceFiles(snapshot.files));
      setWorkspaceConflict(null);
      setIdeOpsResult(`Workspace loaded (${tree.files.length} files).`);
      pushIdeDiagnostic("info", `Workspace loaded (${tree.files.length} files).`);
    } catch (error: any) {
      setIdeOpsResult(error?.message || "Workspace load failed.");
      pushIdeDiagnostic("error", error?.message || "Workspace load failed.");
    } finally {
      setIsLoadingWorkspace(false);
    }
  }

  async function pushWorkspaceToGitHub() {
    if (!workspaceId.trim()) {
      setIdeOpsResult("Workspace ID is required.");
      return;
    }
    setIsGitPushing(true);
    setIdeOpsResult("");
    try {
      const res = await fetch("/api/github-push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ws_id: workspaceId.trim(),
          message: ideCommitMessage.trim() || "SuperIDE workspace update",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setIdeOpsResult(data?.error || `GitHub push failed (${res.status}).`);
        return;
      }
      setIdeOpsResult(`GitHub push queued: ${data?.commit_sha || "ok"}`);
    } catch (error: any) {
      setIdeOpsResult(error?.message || "GitHub push failed.");
    } finally {
      setIsGitPushing(false);
    }
  }

  async function deployWorkspaceNow() {
    if (!workspaceId.trim()) {
      setIdeOpsResult("Workspace ID is required.");
      return;
    }
    setIsDeployingWorkspace(true);
    setIdeOpsResult("");
    try {
      const res = await fetch("/api/netlify-deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ws_id: workspaceId.trim(),
          title: `SuperIDE deploy ${new Date().toISOString()}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setIdeOpsResult(data?.error || `Netlify deploy failed (${res.status}).`);
        return;
      }
      setIdeOpsResult(`Deploy queued: ${data?.url || data?.deploy_id || "ok"}`);
    } catch (error: any) {
      setIdeOpsResult(error?.message || "Netlify deploy failed.");
    } finally {
      setIsDeployingWorkspace(false);
    }
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
    const featured = new Set(FEATURED_APP_IDS);
    const prioritizeFeatured = (apps: SkyeAppDefinition[]) =>
      [...apps].sort((a, b) => {
        const af = featured.has(a.id) ? 1 : 0;
        const bf = featured.has(b.id) ? 1 : 0;
        return bf - af;
      });

    const q = appSearch.trim().toLowerCase();
    if (!q) return prioritizeFeatured(SKYE_APPS);
    const filtered = SKYE_APPS.filter((app) => {
      if (app.id.toLowerCase().includes(q)) return true;
      if (app.summary.toLowerCase().includes(q)) return true;
      return app.mvp.some((item) => item.toLowerCase().includes(q));
    });
    return prioritizeFeatured(filtered);
  }, [appSearch]);

  const filteredAppGroups = useMemo(() => {
    const filteredIds = new Set(filteredApps.map((app) => app.id));
    return APP_DRAWER_GROUPS.map((group) => ({
      ...group,
      apps: group.apps.filter((appId) => filteredIds.has(appId)),
    })).filter((group) => group.apps.length > 0);
  }, [filteredApps]);

  const totalMvpItems = useMemo(() => SKYE_APPS.reduce((sum, app) => sum + app.mvp.length, 0), []);
  const completeMvpItems = useMemo(
    () => SKYE_APPS.flatMap((app) => app.mvp.map((item) => mvpChecks[makeMvpKey(app.id, item)])).filter(Boolean).length,
    [mvpChecks]
  );
  const smokeFailCount = useMemo(() => smokeResults.filter((result) => !result.ok).length, [smokeResults]);
  const hasApiKeyLoaded = Boolean(apiAccessToken.trim());
  const tokenMisuseState = useMemo<"none" | "missing-token-email" | "invalid-token-email" | "token-email-mismatch">(() => {
    const token = apiAccessToken.trim();
    const email = apiTokenEmail.trim().toLowerCase();
    if (!token) return "none";
    if (!email) return "missing-token-email";
    const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!isValid) return "invalid-token-email";
    const auth = authUser.trim().toLowerCase();
    if (auth && auth !== email) return "token-email-mismatch";
    return "none";
  }, [apiAccessToken, apiTokenEmail, authUser]);
  const linkedWorkspaceMailbox = useMemo(
    () => workspaceMailboxEmail.trim().toLowerCase() || onboardingEmailDraft?.email?.toLowerCase() || "",
    [workspaceMailboxEmail, onboardingEmailDraft]
  );
  const hasActiveAuthSession = assistantAuthStatus === "ok" || assistantAuthStatus === "token";
  const onboardingGuideProgress = useMemo(
    () => [Boolean(recoveryEmail.trim()), Boolean(linkedWorkspaceMailbox), hasActiveAuthSession, Boolean(onboardingIdentityDraft?.name), Boolean(apiAccessToken.trim())].filter(Boolean).length,
    [recoveryEmail, linkedWorkspaceMailbox, hasActiveAuthSession, onboardingIdentityDraft, apiAccessToken]
  );
  const selectedAppHealthSignal = useMemo(() => {
    const latestSmoke = smokeResults.length ? smokeResults[smokeResults.length - 1] : null;
    const appMvpDone = selectedAppDefinition.mvp.filter((item) => mvpChecks[makeMvpKey(selectedSkyeApp, item)]).length;
    const appTutorialDone = (APP_TUTORIALS[selectedSkyeApp] || []).filter((step) => tutorialChecks[makeTutorialKey(selectedSkyeApp, step)]).length;
    const smokeText = latestSmoke ? (latestSmoke.ok ? "smoke=pass" : "smoke=fail") : "smoke=n/a";
    return `mvp=${appMvpDone}/${selectedAppDefinition.mvp.length} · tutorial=${appTutorialDone}/${(APP_TUTORIALS[selectedSkyeApp] || []).length} · ${smokeText} · key=${hasApiKeyLoaded ? "loaded" : "missing"}`;
  }, [selectedSkyeApp, selectedAppDefinition, mvpChecks, tutorialChecks, smokeResults, hasApiKeyLoaded]);
  const failSafeSignals = useMemo(() => {
    const next: string[] = [];
    if (assistantAuthStatus !== "ok") next.push(`auth=${assistantAuthStatus}`);
    if (!hasApiKeyLoaded) next.push("key=missing");
    if (tokenMisuseState !== "none") next.push(`token_misuse=${tokenMisuseState}`);
    if (runnerStatus === "fail") next.push("worker=degraded");
    if (runnerStatus === "boundary") next.push("worker=boundary-blocked");
    if (smokeFailCount > 0) next.push(`smoke_failures=${smokeFailCount}`);
    return next;
  }, [assistantAuthStatus, hasApiKeyLoaded, tokenMisuseState, runnerStatus, smokeFailCount]);
  const showFailSafeBanner = failSafeSignals.length > 0;
  const deployConnectionState = useMemo(() => {
    const githubConnected = Boolean(integrationRuntimeStatus?.github.connected);
    const netlifyConnected = Boolean(integrationRuntimeStatus?.netlify.connected);
    if (githubConnected && netlifyConnected) return { tone: "ok", detail: "GitHub + Netlify linked" } as const;
    if (githubConnected || netlifyConnected) return { tone: "boundary", detail: githubConnected ? "GitHub linked only" : "Netlify linked only" } as const;
    return { tone: "fail", detail: integrationRuntimeStatus?.error || "No deploy links" } as const;
  }, [integrationRuntimeStatus]);
  const policyState = useMemo(() => {
    if (sknorePatterns.length === 0) return { tone: "fail", detail: "No rules loaded" } as const;
    return { tone: "ok", detail: `${sknorePatterns.length} rules · ${sknoreBlockedCount} files protected` } as const;
  }, [sknorePatterns, sknoreBlockedCount]);
  const authInlineState = useMemo(() => {
    const message = authResult.trim();
    if (isAuthSubmitting || isEnsuringOnboardingKey || isResetSubmitting) {
      return { tone: "boundary", label: "Working", detail: "Processing auth request..." } as const;
    }
    if (!message) {
      return hasActiveAuthSession
        ? ({ tone: "ok", label: "Ready", detail: "Session is active." } as const)
        : ({ tone: "fail", label: "Waiting", detail: "No auth result yet." } as const);
    }
    const lowered = message.toLowerCase();
    const isFailure = /fail|missing|required|must|invalid|unauthorized|blocked|unable|no key|no generated|popup blocked/.test(lowered);
    return {
      tone: isFailure ? "fail" : "ok",
      label: isFailure ? "Failed" : "Ready",
      detail: message,
    } as const;
  }, [authResult, hasActiveAuthSession, isAuthSubmitting, isEnsuringOnboardingKey, isResetSubmitting]);
  const suiteRouteSuggestions = useMemo(() => {
    const routingPlaybook: Partial<Record<WorkspaceStageApp, Array<{ appId: WorkspaceStageApp; title: string; detail: string; channel?: string }>>> = {
      SkyeDocs: [
        { appId: "SkyeChat", title: "Push draft into chat", detail: "Open a live discussion lane for the active document.", channel: "editorial-room" },
        { appId: "SkyeMail", title: "Stage a mail follow-up", detail: "Turn the current document into a deliverable for outbound mail." },
        { appId: "SkyeDrive", title: "Capture source assets", detail: "Route attachments and references into the shared drive plane." },
      ],
      "SkyDex4.6": [
        { appId: "SovereignVariables", title: "Sync env pack", detail: "Hand the active workspace into the variable vault for deployment-safe secrets." },
        { appId: "SkyeAnalytics", title: "Open release telemetry", detail: "Verify smoke, policy, and rollout signals against the current workspace." },
        { appId: "Neural-Space-Pro", title: "Open neural copilot room", detail: "Carry the current build context into Neural Space Pro for deeper reasoning." },
      ],
      SkyeDocxPro: [
        { appId: "SkyeChat", title: "Review in chat", detail: "Route the output into a threaded review lane.", channel: "docx-review" },
        { appId: "SkyeMail", title: "Prepare client send", detail: "Move the finished document into outbound messaging." },
        { appId: "SkyeDrive", title: "Archive generated files", detail: "Store exported artifacts in the suite drive plane." },
      ],
      SkyeMail: [
        { appId: "SkyeChat", title: "Open campaign room", detail: "Carry outbound context into a live chat lane.", channel: "mail-ops" },
        { appId: "SkyeAnalytics", title: "Inspect delivery telemetry", detail: "Jump straight from outbound operations into KPI and proof signals." },
        { appId: "SkyeAdmin", title: "Escalate to admin", detail: "Move delivery issues into the protected admin board." },
      ],
      SkyeChat: [
        { appId: "SkyeMail", title: "Convert thread to outbound", detail: "Promote the active channel into a mail-ready follow-up." },
        { appId: "Neural-Space-Pro", title: "Open neural synthesis", detail: "Send the current thread into Neural Space Pro for synthesis and reasoning." },
        { appId: "SkyeAnalytics", title: "Read engagement telemetry", detail: "Switch from conversation to governed suite analytics." },
      ],
      "Neural-Space-Pro": [
        { appId: "SkyDex4.6", title: "Return to build surface", detail: "Move neural output back into the secure IDE workspace." },
        { appId: "SkyeChat", title: "Publish to command room", detail: "Drop the neural result into the active discussion lane.", channel: "neural-room" },
        { appId: "SkyeDrive", title: "Save generated artifacts", detail: "Capture generated files and source packs in the shared asset rail." },
      ],
      "AE-Flow": [
        { appId: "SkyeMail", title: "Open CRM outreach", detail: "Carry CRM context into outbound mail operations." },
        { appId: "SkyeChat", title: "Escalate to ops chat", detail: "Route the active case into the shared command room.", channel: "crm-ops" },
        { appId: "SkyeAdmin", title: "Escalate to admin board", detail: "Bring platform issues into the protected admin surface." },
      ],
      GoogleBusinessProfileRescuePlatform: [
        { appId: "SkyeChat", title: "Open rescue war room", detail: "Send reinstatement context into a live command channel.", channel: "rescue-war-room" },
        { appId: "SkyeMail", title: "Draft client update", detail: "Convert the current rescue state into outbound customer messaging." },
        { appId: "Neural-Space-Pro", title: "Open evidence synthesis", detail: "Move rescue notes into neural reasoning for evidence prep." },
      ],
      SovereignVariables: [
        { appId: "SkyDex4.6", title: "Return to deploy surface", detail: "Take the current env pack back into the secure IDE lane." },
        { appId: "SkyeAdmin", title: "Review protected controls", detail: "Move variable and runtime decisions into admin review." },
        { appId: "SkyeChat", title: "Notify command room", detail: "Post the variable handoff into a governed chat lane.", channel: "release-ops" },
      ],
      SkyeAdmin: [
        { appId: "SkyeAnalytics", title: "Audit suite telemetry", detail: "Jump from admin controls into suite health and proof signals." },
        { appId: "Smokehouse-Standalone", title: "Open smoke operations", detail: "Inspect live smoke and regression evidence from the admin board." },
        { appId: "API-Playground", title: "Inspect API behavior", detail: "Move admin review into direct API validation and contract checks." },
      ],
    };

    const fallback = [
      { appId: "SkyeChat" as SkyeAppId, title: "Open command room", detail: "Carry the current app context into a live chat lane.", channel: "command-deck" },
      { appId: "SkyeDrive" as SkyeAppId, title: "Save to drive plane", detail: "Move current outputs into the shared asset layer." },
      { appId: "SkyeAnalytics" as SkyeAppId, title: "Inspect governed telemetry", detail: "Check whether the current surface is producing usable signals." },
    ];

    return (routingPlaybook[selectedSkyeApp] || fallback).filter((item) => item.appId !== selectedSkyeApp).slice(0, 3);
  }, [selectedSkyeApp]);
  const selectedSuiteIntegrationCard = useMemo(() => {
    const relevant = suiteEvents.filter((item) => item.source_app === selectedSkyeApp || item.target_app === selectedSkyeApp);
    const upstream = new Map<string, { appId: string; intentName: string; count: number }>();
    const downstream = new Map<string, { appId: string; intentName: string; count: number }>();
    let lastSuccessful: SuiteEventRecord | null = null;

    for (const item of relevant) {
      if (item.intent.status === "completed" && (!lastSuccessful || item.occurred_at > lastSuccessful.occurred_at)) {
        lastSuccessful = item;
      }
      if (item.target_app === selectedSkyeApp && item.source_app) {
        const key = `${item.source_app}:${item.intent.name}`;
        const current = upstream.get(key) || { appId: item.source_app, intentName: item.intent.name, count: 0 };
        current.count += 1;
        upstream.set(key, current);
      }
      if (item.source_app === selectedSkyeApp && item.target_app) {
        const key = `${item.target_app}:${item.intent.name}`;
        const current = downstream.get(key) || { appId: item.target_app, intentName: item.intent.name, count: 0 };
        current.count += 1;
        downstream.set(key, current);
      }
    }

    return {
      upstream: Array.from(upstream.values()).sort((a, b) => b.count - a.count).slice(0, 4),
      downstream: Array.from(downstream.values()).sort((a, b) => b.count - a.count).slice(0, 4),
      lastSuccessful,
    };
  }, [selectedSkyeApp, suiteEvents]);
  const suiteNetworkBoard = useMemo(() => {
    const edges = new Map<string, { key: string; source: string; target: string; count: number; detail: string; at: string; tone: CommandFeedTone }>();
    const appCounts = new Map<string, { label: string; count: number; lastAt: string }>();

    const bumpApp = (label: string, at: string) => {
      const nextLabel = String(label || "").trim();
      if (!nextLabel) return;
      const current = appCounts.get(nextLabel);
      appCounts.set(nextLabel, {
        label: nextLabel,
        count: (current?.count || 0) + 1,
        lastAt: current?.lastAt && current.lastAt > at ? current.lastAt : at,
      });
    };

    for (const entry of commandFeed.slice(0, 18)) {
      const source = String(entry.source || "Command Deck").trim() || "Command Deck";
      bumpApp(source, entry.at);
      if (!entry.appId) continue;
      bumpApp(entry.appId, entry.at);
      const key = `${source}=>${entry.appId}`;
      const current = edges.get(key);
      edges.set(key, {
        key,
        source,
        target: entry.appId as SkyeAppId,
        count: (current?.count || 0) + 1,
        detail: String(entry.detail || `${source} handed off to ${entry.appId}`),
        at: current?.at && current.at > entry.at ? current.at : entry.at,
        tone: entry.tone,
      });
    }

    for (const item of suiteEvents.slice(0, 18)) {
      const source = String(item.source_app || "Suite").trim() || "Suite";
      bumpApp(source, item.occurred_at);
      if (item.target_app) bumpApp(item.target_app, item.occurred_at);
      if (!item.target_app) continue;
      const key = `${source}=>${item.target_app}`;
      const current = edges.get(key);
      edges.set(key, {
        key,
        source,
        target: item.target_app,
        count: (current?.count || 0) + 1,
        detail: String(item.detail || item.summary || `${source} handed off to ${item.target_app}`),
        at: current?.at && current.at > item.occurred_at ? current.at : item.occurred_at,
        tone: item.intent.status === "failed" ? "fail" : item.intent.status === "completed" ? "ok" : "info",
      });
    }

    for (const entry of timelineEntries.slice(0, 10)) {
      bumpApp(String(entry.source_app || entry.entry_type || "Timeline"), entry.at);
    }

    for (const event of sovereignEvents.slice(0, 10)) {
      bumpApp(String(event.source_app || event.event_family || "Sovereign"), event.occurred_at);
    }

    const edgeList = Array.from(edges.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.at.localeCompare(a.at);
    }).slice(0, 6);
    const pulse = Array.from(appCounts.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.lastAt.localeCompare(a.lastAt);
    }).slice(0, 6);
    const maxPulse = pulse[0]?.count || 1;
    const liveRailCount = [
      hasActiveAuthSession,
      runnerStatus === "ok",
      Boolean(mailRuntimeStatus?.configured),
      Boolean(integrationRuntimeStatus?.github.connected),
      Boolean(integrationRuntimeStatus?.netlify.connected),
    ].filter(Boolean).length;

    return {
      metrics: [
        { label: "Bridge Events", value: String(commandFeed.length + suiteEvents.length), detail: "Recent in-memory plus persisted handoffs" },
        { label: "Active Apps", value: String(pulse.length), detail: "Apps currently emitting visible suite signals" },
        { label: "Sovereign Signals", value: String(sovereignEvents.length), detail: "Governed events available to the shell" },
        { label: "Healthy Rails", value: `${liveRailCount}/5`, detail: "Auth, worker, mail, GitHub, and Netlify lanes" },
      ],
      edges: edgeList,
      pulse: pulse.map((item) => ({ ...item, width: Math.max(18, Math.round((item.count / maxPulse) * 100)) })),
    };
  }, [commandFeed, hasActiveAuthSession, integrationRuntimeStatus, mailRuntimeStatus, runnerStatus, sovereignEvents, suiteEvents, timelineEntries]);
  const platformStatusItems = useMemo(
    () => [
      {
        label: "Auth",
        tone: hasActiveAuthSession ? "ok" : "fail",
        detail: hasActiveAuthSession ? `Session ${assistantAuthStatus}` : "Needs sign-in",
      },
      {
        label: "Worker",
        tone: runnerStatus === "ok" ? "ok" : runnerStatus === "boundary" ? "boundary" : "fail",
        detail: runnerStatus === "ok" ? "Healthy" : runnerStatus === "boundary" ? "Boundary blocked" : runnerStatus === "fail" ? "Offline" : "Unknown",
      },
      {
        label: "Mail",
        tone: mailRuntimeStatus?.configured ? "ok" : "fail",
        detail: mailRuntimeStatus?.configured ? `${mailRuntimeStatus.active_provider || "configured"} · ${mailRuntimeStatus.from || "sender set"}` : mailRuntimeStatus?.error || "Not configured",
      },
      {
        label: "Deploy",
        tone: deployConnectionState.tone,
        detail: deployConnectionState.detail,
      },
      {
        label: "Policy",
        tone: policyState.tone,
        detail: policyState.detail,
      },
    ],
    [assistantAuthStatus, deployConnectionState, hasActiveAuthSession, mailRuntimeStatus, policyState, runnerStatus]
  );
  const selectedAppMvpCompleted = useMemo(
    () => selectedAppDefinition.mvp.filter((item) => mvpChecks[makeMvpKey(selectedSkyeApp, item)]).length,
    [selectedAppDefinition, selectedSkyeApp, mvpChecks]
  );
  const selectedAppTutorialTotal = (APP_TUTORIALS[selectedSkyeApp] || []).length;
  const selectedAppTutorialCompleted = useMemo(
    () => (APP_TUTORIALS[selectedSkyeApp] || []).filter((step) => tutorialChecks[makeTutorialKey(selectedSkyeApp, step)]).length,
    [selectedSkyeApp, tutorialChecks]
  );
  const selectedAppReadinessScore = useMemo(() => {
    const mvpPct = selectedAppDefinition.mvp.length ? selectedAppMvpCompleted / selectedAppDefinition.mvp.length : 1;
    const tutorialPct = selectedAppTutorialTotal ? selectedAppTutorialCompleted / selectedAppTutorialTotal : 1;
    const smokePct = smokeResults.length ? (smokeResults.length - smokeFailCount) / smokeResults.length : 0;
    const authPct = assistantAuthStatus === "ok" || assistantAuthStatus === "token" ? 1 : 0;
    return Math.round((mvpPct * 0.4 + tutorialPct * 0.2 + smokePct * 0.3 + authPct * 0.1) * 100);
  }, [selectedAppDefinition, selectedAppMvpCompleted, selectedAppTutorialTotal, selectedAppTutorialCompleted, smokeResults, smokeFailCount, assistantAuthStatus]);
  const dependencyStatus = useMemo(
    () => [
      { name: "Gateway Auth", status: assistantAuthStatus === "ok" || assistantAuthStatus === "token" ? "ok" : "attention", detail: assistantAuthStatus },
      { name: "Worker Runner", status: runnerStatus === "ok" ? "ok" : "attention", detail: healthUrl },
      { name: "API Key", status: hasApiKeyLoaded ? "ok" : "attention", detail: hasApiKeyLoaded ? "loaded" : "missing" },
      { name: "Smokehouse", status: smokeFailCount === 0 && smokeResults.length > 0 ? "ok" : "attention", detail: smokeResults.length ? `${smokeResults.length - smokeFailCount}/${smokeResults.length} passing` : "not-run" },
      { name: "Workspace Surface", status: livePreviewUrl ? "ok" : "attention", detail: livePreviewUrl || "no-surface" },
    ],
    [assistantAuthStatus, runnerStatus, healthUrl, hasApiKeyLoaded, smokeFailCount, smokeResults, livePreviewUrl]
  );
  const buildMetadata = useMemo(() => {
    const version = String(import.meta.env.VITE_APP_VERSION || "dev");
    const commit = String(import.meta.env.VITE_GIT_SHA || "local").slice(0, 12);
    const builtAt = String(import.meta.env.VITE_BUILD_TIME || new Date().toISOString());
    const signatureBase = `${version}:${commit}:${workspaceId}:${files.length}:${smokeLedger.length}`;
    const signature = `SIG-${btoa(signatureBase).replace(/=+/g, "").slice(0, 22)}`;
    return { version, commit, builtAt, signature };
  }, [workspaceId, files.length, smokeLedger.length]);

  useEffect(() => {
    let cancelled = false;

    async function refreshPlatformStatusCard() {
      if (!hasActiveAuthSession) {
        setMailRuntimeStatus(null);
        setIntegrationRuntimeStatus(null);
        return;
      }

      setIsPlatformStatusLoading(true);
      try {
        const [mailRes, integrationsRes] = await Promise.all([
          fetch("/api/mail-status", { credentials: "include" }),
          fetch("/api/integrations-status", { credentials: "include" }),
        ]);
        const [mailData, integrationsData] = await Promise.all([mailRes.json(), integrationsRes.json()]);
        if (cancelled) return;

        setMailRuntimeStatus(
          mailRes.ok
            ? {
                configured: Boolean(mailData?.configured),
                active_provider: mailData?.active_provider || null,
                from: mailData?.from || null,
                sender_source: mailData?.sender_source || null,
              }
            : {
                configured: false,
                active_provider: null,
                from: null,
                error: mailData?.error || `Mail status failed (${mailRes.status}).`,
              }
        );

        setIntegrationRuntimeStatus(
          integrationsRes.ok
            ? {
                github: {
                  connected: Boolean(integrationsData?.github?.connected),
                  repo: integrationsData?.github?.repo || null,
                  owner: integrationsData?.github?.owner || null,
                  branch: integrationsData?.github?.branch || null,
                  installation_id: integrationsData?.github?.installation_id || null,
                  updated_at: integrationsData?.github?.updated_at || null,
                },
                netlify: {
                  connected: Boolean(integrationsData?.netlify?.connected),
                  site_id: integrationsData?.netlify?.site_id || null,
                  site_name: integrationsData?.netlify?.site_name || null,
                  updated_at: integrationsData?.netlify?.updated_at || null,
                },
              }
            : {
                github: { connected: false, repo: null, owner: null, branch: null },
                netlify: { connected: false, site_id: null, site_name: null },
                error: integrationsData?.error || `Integration status failed (${integrationsRes.status}).`,
              }
        );
      } catch (error: any) {
        if (cancelled) return;
        const message = error?.message || "Unable to load platform status.";
        setMailRuntimeStatus({ configured: false, active_provider: null, from: null, error: message });
        setIntegrationRuntimeStatus({
          github: { connected: false, repo: null, owner: null, branch: null },
          netlify: { connected: false, site_id: null, site_name: null },
          error: message,
        });
      } finally {
        if (!cancelled) setIsPlatformStatusLoading(false);
      }
    }

    void refreshPlatformStatusCard();
    return () => {
      cancelled = true;
    };
  }, [hasActiveAuthSession]);

  useEffect(() => {
    let cancelled = false;

    async function refreshSovereignEventFeed() {
      if (!hasActiveAuthSession) {
        if (!cancelled) setSovereignEvents([]);
        return;
      }
      await loadSovereignEvents();
    }

    void refreshSovereignEventFeed();
    const timer = window.setInterval(() => {
      void refreshSovereignEventFeed();
    }, 20000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [hasActiveAuthSession, workspaceId]);

  useEffect(() => {
    let cancelled = false;

    async function refreshSuiteEventFeed() {
      if (!hasActiveAuthSession) {
        if (!cancelled) setSuiteEvents([]);
        return;
      }
      await loadSuiteEvents();
    }

    void refreshSuiteEventFeed();
    const timer = window.setInterval(() => {
      void refreshSuiteEventFeed();
    }, 20000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [hasActiveAuthSession, workspaceId]);

  useEffect(() => {
    let cancelled = false;

    async function refreshExecutivePanels() {
      if (!hasActiveAuthSession) {
        if (!cancelled) {
          setTimelineEntries([]);
          setMissions([]);
        }
        return;
      }
      await Promise.all([loadTimelineEntries(), loadMissionRecords()]);
    }

    void refreshExecutivePanels();
    const timer = window.setInterval(() => {
      void refreshExecutivePanels();
    }, 25000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [hasActiveAuthSession, workspaceId]);

  const commandPaletteActions = useMemo(
    () => [
      {
        id: "run-smoke",
        label: "Run Full Smokehouse",
        run: () => {
          setToolTab("smokehouse");
          void runSmokehouseSuite("manual");
        },
      },
      {
        id: "run-proof",
        label: `Run App Proof (${selectedSkyeApp})`,
        run: () => {
          setToolTab("smokehouse");
          void runAppProofFlow(selectedSkyeApp);
        },
      },
      {
        id: "open-standalone",
        label: `Open ${selectedSkyeApp} Standalone`,
        run: () => {
          const url = buildAppSurfaceUrl(selectedSkyeApp, workspaceId);
          if (!url) return;
          window.open(url.replace("embed=1", "embed=0"), "_blank", "noopener,noreferrer");
        },
      },
      {
        id: "export-health",
        label: "Export Health Snapshot",
        run: () => exportAppHealthSnapshot(),
      },
      {
        id: "toggle-tutorial",
        label: showTutorialPanel ? "Hide Tutorial Panel" : "Show Tutorial Panel",
        run: () => setShowTutorialPanel((old) => !old),
      },
      {
        id: "switch-mode",
        label: appMode === "skyeide" ? "Switch to Neural Space Pro" : "Switch to SkyeIDE",
        run: () => setAppMode((old) => (old === "skyeide" ? "neural" : "skyeide")),
      },
    ],
    [selectedSkyeApp, workspaceId, showTutorialPanel, appMode]
  );
  const filteredCommandPaletteActions = useMemo(() => {
    const q = commandPaletteQuery.trim().toLowerCase();
    if (!q) return commandPaletteActions;
    return commandPaletteActions.filter((action) => action.label.toLowerCase().includes(q));
  }, [commandPaletteQuery, commandPaletteActions]);

  function dismissCurrentSpotlight() {
    setDismissedSpotlightByApp((old) => ({ ...old, [selectedSkyeApp]: true }));
  }

  function resetSelectedAppDemoState() {
    if (selectedSkyeApp === "SkyeSheets") setSheetsModel({ title: "SkyeSheets Board", columns: ["A", "B", "C", "D", "E"], rows: [] });
    if (selectedSkyeApp === "SkyeSlides") setSlidesModel({ title: "SkyeSlides Deck", slides: [] });
    if (selectedSkyeApp === "SkyeTasks") setTasksModel([]);
    if (selectedSkyeApp === "SkyeCalendar") setCalendarEvents([]);
    if (selectedSkyeApp === "SkyeDrive") setDriveAssets([]);
    if (selectedSkyeApp === "SkyeVault") setVaultSecrets([]);
    if (selectedSkyeApp === "SkyeForms") setFormQuestions([]);
    if (selectedSkyeApp === "SkyeNotes") setNotesModel([]);
    if (selectedSkyeApp === "SkyeAnalytics") setSmokeResults([]);
    setSuiteSyncResult(`Reset demo state for ${selectedSkyeApp}.`);
  }

  function exportAppHealthSnapshot() {
    const latestSmoke = smokeResults.length ? smokeResults[smokeResults.length - 1] : null;
    const payload = {
      exported_at: new Date().toISOString(),
      app_id: selectedSkyeApp,
      workspace_id: workspaceId,
      auth_status: assistantAuthStatus,
      api_key_loaded: hasApiKeyLoaded,
      runner_status: runnerStatus,
      smoke: {
        total: smokeResults.length,
        failed: smokeFailCount,
        latest: latestSmoke
          ? {
              name: latestSmoke.name,
              ok: latestSmoke.ok,
              status: latestSmoke.status,
              summary: latestSmoke.summary,
            }
          : null,
      },
      app_health_signal: selectedAppHealthSignal,
      fail_safe_signals: failSafeSignals,
      mvp_progress: {
        completed: selectedAppDefinition.mvp.filter((item) => mvpChecks[makeMvpKey(selectedSkyeApp, item)]).length,
        total: selectedAppDefinition.mvp.length,
      },
      tutorial_progress: {
        completed: (APP_TUTORIALS[selectedSkyeApp] || []).filter((step) => tutorialChecks[makeTutorialKey(selectedSkyeApp, step)]).length,
        total: (APP_TUTORIALS[selectedSkyeApp] || []).length,
      },
    };

    const redacted = redactDiagnosticsValue(payload);
    const blob = new Blob([JSON.stringify(redacted, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `${selectedSkyeApp}-health-snapshot-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(href);
    setSuiteSyncResult(`Exported health snapshot for ${selectedSkyeApp}.`);
    pushCommandFeed("Suite Sync", `Health snapshot exported for ${selectedSkyeApp}.`, "ok", selectedSkyeApp);
  }

  async function runSmokeTest() {
    setIsSmokeChecking(true);
    try {
      const response = await fetch(healthUrl, { method: "GET" });
      if ([302, 401, 403].includes(response.status)) {
        setRunnerStatus("ok");
        return { ok: true, status: "ok" as const, text: `Smoke passed: worker reachable but policy-protected (${response.status}).` };
      }

      const data = (await response.json()) as HealthPayload;
      if (!response.ok || !data?.ok) {
        setRunnerStatus("fail");
        return { ok: false, status: "fail" as const, text: `Smoke failed (${response.status}).` };
      }
      setRunnerStatus("ok");
      return { ok: true, status: "ok" as const, text: `Smoke passed: ${data.name || "runner"}.` };
    } catch (error: any) {
      const workerFetchBlocked = /failed to fetch|networkerror|load failed/i.test(String(error?.message || ""));
      if (workerFetchBlocked) {
        setRunnerStatus("boundary");
        return {
          ok: false,
          status: "boundary" as const,
          text: "Smoke attention: worker fetch blocked at browser boundary (CORS/access/policy). Use server-side smoke to confirm runtime reachability.",
        };
      }
      setRunnerStatus("fail");
      return { ok: false, status: "fail" as const, text: `Smoke failed: ${error?.message || "network error"}` };
    } finally {
      setIsSmokeChecking(false);
    }
  }

  function formatGenerateFailure(status: number, data: GeneratePayload | Record<string, unknown> | null | undefined) {
    const meta = (data || {}) as Record<string, unknown>;
    const parts: string[] = [];
    const errorText = typeof meta.error === "string" ? meta.error : "";
    if (errorText) parts.push(errorText);
    if (typeof meta.gateway_status === "number") parts.push(`gateway_status=${meta.gateway_status}`);
    if (typeof meta.gateway_detail === "string" && meta.gateway_detail.trim()) parts.push(`detail=${meta.gateway_detail.trim()}`);
    if (typeof meta.gateway_request_id === "string" && meta.gateway_request_id.trim()) parts.push(`request_id=${meta.gateway_request_id.trim()}`);
    return parts.length ? parts.join(" · ") : `AI call failed (${status}).`;
  }

  async function runGenerate(prompt: string) {
    const authOk = await checkAssistantAuth();
    if (!authOk) {
      return {
        ok: false,
        text: "Unauthorized. Sign in first in this browser session, then run again.",
      };
    }

    const active = activeFile?.path || "/src/App.tsx";
    if (isSknoreProtected(active, sknorePatterns)) {
      return {
        ok: false,
        text: `SKNore policy blocks AI access to ${active}. Switch to a non-protected file or update SKNore patterns.`,
      };
    }

    const safeFiles = filterSknoreFiles(files, sknorePatterns);
    const authHeaders = getAccessAuthHeaders();

    try {
      const response = await fetch("/api/kaixu-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        credentials: "include",
        body: JSON.stringify({
          ws_id: workspaceId || DEFAULT_WS_ID,
          activePath: active,
          files: safeFiles,
          prompt,
        }),
      });
      const data = (await response.json()) as GeneratePayload;
      if (!response.ok) {
        return { ok: false, text: formatGenerateFailure(response.status, data) };
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
    const authHeaders = getAccessAuthHeaders();

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

    for (const check of checks) {
      try {
        const res = await fetch(check.url, {
          method: check.method,
          headers: {
            ...(check.body ? { "Content-Type": "application/json" } : {}),
            ...authHeaders,
          },
          credentials: "include",
          body: check.body ? JSON.stringify(check.body) : undefined,
        });
        const txt = await res.text();
        let ok = res.status >= 200 && res.status < 300;
        let summary = typeof tryParseJson(txt) === "string" ? txt.slice(0, 200) : JSON.stringify(tryParseJson(txt)).slice(0, 200);

        if (check.name === "Site Root" && [301, 302].includes(res.status)) {
          ok = true;
          summary = `Site root redirects (${res.status}) which is acceptable in production edge routing.`;
        }

        if (check.name === "Generate API" && res.status === 401) {
          ok = false;
          summary = "Generate API returned 401. Configure a kAIxU key (or valid session) before treating smoke as pass.";
        }

        if (check.name === "Auth Me" && [401, 403].includes(res.status)) {
          ok = false;
          summary = "Auth session missing/forbidden. Sign in or load a kAIxU key before smoke validation.";
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
            ok: false,
            summary: "Worker check blocked by browser CORS/Access boundary. Browser probe is inconclusive until server-side smoke confirms reachability.",
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
    else if (health && isWorkerBoundarySummary(health.summary)) setRunnerStatus("boundary");
    else if (health) setRunnerStatus("fail");
    return out;
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

  async function runAppProofFlow(appId: SkyeAppId) {
    setSelectedSkyeApp(appId);
    setToolTab("smokehouse");
    const proofUrl = buildAppSurfaceUrl(appId, workspaceId);
    if (proofUrl) {
      window.open(proofUrl.replace("embed=1", "embed=0"), "_blank", "noopener,noreferrer");
    }

    const authOk = await checkAssistantAuth();
    const results = await runSmokehouseSuite("manual");
    const failCount = results.filter((item) => !item.ok).length;
    const worker = results.find((item) => item.name === "Worker Health");
    setAppProofRuns((old) => [
      {
        id: makeId(),
        at: new Date().toISOString(),
        appId,
        smoke_failures: failCount,
        runner_status: worker?.ok ? ("ok" as const) : isWorkerBoundarySummary(worker?.summary) ? ("boundary" as const) : ("fail" as const),
        auth_status: authOk ? (apiAccessToken.trim() ? ("token" as const) : ("ok" as const)) : ("unauthorized" as const),
      },
      ...old,
    ].slice(0, 15));
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

  function getAccessAuthHeaders(): Record<string, string> {
    const token = apiAccessToken.trim();
    if (!token) return {};
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    const lockedEmail = apiTokenEmail.trim().toLowerCase();
    if (lockedEmail) headers["X-Token-Email"] = lockedEmail;
    return headers;
  }

  async function onApiPlaygroundSend(event: FormEvent) {
    event.preventDefault();
    setPlayLoading(true);
    setPlayResponse("");
    setPlayStatus(null);

    try {
      const headers = tryParseJson(playHeaders);
      const baseHeaders: Record<string, string> =
        typeof headers === "object" && headers
          ? { ...(headers as Record<string, string>) }
          : { "Content-Type": "application/json" };
      const authHeaders = getAccessAuthHeaders();
      if (authHeaders.Authorization && !(baseHeaders.Authorization || baseHeaders.authorization)) {
        baseHeaders.Authorization = authHeaders.Authorization;
      }
      if (authHeaders["X-Token-Email"] && !(baseHeaders["X-Token-Email"] || baseHeaders["x-token-email"])) {
        baseHeaders["X-Token-Email"] = authHeaders["X-Token-Email"];
      }
      const reqInit: RequestInit = {
        method: playMethod,
        headers: baseHeaders,
        credentials: "include",
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

    const smoke = runnerStatus === "unknown" ? await runSmokeTest() : null;

    const ai = await runGenerate(prompt);
    const workerState = smoke?.status || runnerStatus;

    if (ai.ok) {
      const envLines = parseEnvTemplateLines(ai.text);
      if (envLines.length >= 2) {
        stageSovereignVariablesSuggestion({
          title: `${selectedSkyeApp} env template`,
          source: "kAIxU Generate",
          content: envLines.map((item) => `${item.key}=${item.value}`).join("\n"),
          projectName: `${selectedSkyeApp} Generated Template`,
          environmentName: "Draft Import",
          detail: `AI generated an env template with ${envLines.length} variables. Click to review or import it.`,
          tone: "ok",
          badge: `${envLines.length} vars`,
        });
      }
    }

    setMessages((old) => [
      ...old,
      {
        id: makeId(),
        role: "assistant",
        text: [
          `Mode: ${appMode === "skyeide" ? "SkyeIDE (Primary)" : "Neural Space Pro (Secondary)"}`,
          `Worker: ${String(workerState).toUpperCase()}`,
          `Auth: ${assistantAuthStatus.toUpperCase()}`,
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
      if (issued?.token) setApiAccessToken(String(issued.token));
      if (issued?.locked_email) setApiTokenEmail(String(issued.locked_email));
      setTesterTokenMeta(
        `locked_email=${issued?.locked_email || "<none>"} · starts_at=${issued?.starts_at || "n/a"} · expires_at=${issued?.expires_at || "n/a"}`
      );
    } catch (error: any) {
      setTesterTokenMeta(error?.message || "Issue failed.");
    } finally {
      setIsIssuingTesterToken(false);
    }
  }

  async function issueAccessToken() {
    setIsIssuingTesterToken(true);
    setTesterToken("");
    setTesterTokenMeta("");
    setTokenOpsResult("");
    try {
      const res = await fetch("/api/token-issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          count: 1,
          ttl_preset: tokenTtlPreset,
          label_prefix: tokenLabelPrefix || "ide-key",
          scopes: ["generate"],
          locked_email: apiTokenEmail.trim().toLowerCase() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTokenOpsResult(data?.error || `Issue failed (${res.status})`);
        return;
      }
      const issued = data?.issued?.[0];
      const token = String(issued?.token || "");
      setTesterToken(token);
      setTesterTokenMeta(
        `locked_email=${issued?.locked_email || "<none>"} · starts_at=${issued?.starts_at || "n/a"} · expires_at=${issued?.expires_at || "n/a"}`
      );
      if (token) setApiAccessToken(token);
      if (issued?.locked_email) setApiTokenEmail(String(issued.locked_email));
      setTokenOpsResult("kAIxU key issued and loaded into the IDE key input.");
      await loadTokenInventory();
    } catch (error: any) {
      setTokenOpsResult(error?.message || "Issue failed.");
    } finally {
      setIsIssuingTesterToken(false);
    }
  }

  async function loadTokenInventory() {
    setIsLoadingTokenInventory(true);
    setTokenOpsResult("");
    try {
      const res = await fetch("/api/token-list", { method: "GET", credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        setTokenOpsResult(data?.error || `Key list failed (${res.status})`);
        return;
      }
      setTokenInventory(Array.isArray(data?.tokens) ? data.tokens : []);
    } catch (error: any) {
      setTokenOpsResult(error?.message || "Key list failed.");
    } finally {
      setIsLoadingTokenInventory(false);
    }
  }

  async function revokeToken(id: string) {
    if (!id) return;
    setRevokingTokenId(id);
    setTokenOpsResult("");
    try {
      const res = await fetch("/api/token-revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTokenOpsResult(data?.error || `Revoke failed (${res.status})`);
        return;
      }
      setTokenOpsResult(`Revoked key ${data?.token?.label || id}`);
      await loadTokenInventory();
    } catch (error: any) {
      setTokenOpsResult(error?.message || "Revoke failed.");
    } finally {
      setRevokingTokenId("");
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
          ws_id: workspaceId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMailSendResult(data?.error || `send failed (${res.status})`);
        return;
      }
      setMailSendResult(`sent to ${mailTo || "recipient"} · mail_record_id=${data?.mail_record_id || "n/a"}${data?.chat_hook_id ? ` · chat_hook_id=${data.chat_hook_id}` : ""}`);
      await loadSkyeMailHistory();
      if (data?.chat_hook_id) await loadSkyeChatHistory();
      emitAppBridge({
        kind: "action",
        source: "SkyeMail",
        appId: "SkyeMail",
        tone: "ok",
        detail: `Mail sent from ${selectedSkyeApp} to ${mailTo || "recipient"}.`,
      });
      if (data?.chat_hook_id) {
        emitAppBridge({
          kind: "open-app",
          source: "SkyeMail",
          appId: "SkyeChat",
          channel: mailChannelHook || "general",
          note: `SkyeMail also posted into #${mailChannelHook || "general"}.`,
        });
      }
      routeCrossAppFocus("SkyeMail", {
        note: `SkyeMail send completed for ${mailSubject || "untitled"}. mail_record_id=${data?.mail_record_id || "n/a"}`,
      });
    } catch (error: any) {
      setMailSendResult(error?.message || "send failed");
    } finally {
      setIsSendingMail(false);
    }
  }

  async function checkAssistantAuth(): Promise<boolean> {
    if (apiAccessToken.trim()) {
      setAssistantAuthStatus("token");
      return true;
    }
    try {
      const res = await fetch("/api/auth-me", { method: "GET", credentials: "include" });
      const ok = res.ok;
      setAssistantAuthStatus(ok ? "ok" : "unauthorized");
      return ok;
    } catch {
      setAssistantAuthStatus("unauthorized");
      return false;
    }
  }

  function applyWorkspaceBootstrap(payload: any) {
    const nextWorkspaceId = String(payload?.workspace?.id || payload?.user?.workspace_id || "").trim();
    if (!nextWorkspaceId) return;
    setWorkspaceId(nextWorkspaceId);
    if (payload?.workspace && typeof payload.workspace === "object") {
      setPrimaryWorkspace(payload.workspace as OrgWorkspaceSummary);
    }
    setWorkspaceSurfaces((old) => {
      const next = { ...old };
      for (const app of SKYE_APPS) {
        const current = String(next[app.id] || "").trim();
        if (!current || current === DEFAULT_WS_ID || current === "primary-workspace") {
          next[app.id] = nextWorkspaceId;
        }
      }
      return next;
    });
    setPlayBody((old) => {
      try {
        const parsed = JSON.parse(old);
        if (!parsed || typeof parsed !== "object") return old;
        if (!parsed.ws_id || parsed.ws_id === DEFAULT_WS_ID || parsed.ws_id === "primary-workspace") {
          parsed.ws_id = nextWorkspaceId;
          return JSON.stringify(parsed, null, 2);
        }
        return old;
      } catch {
        return old.replace(/"ws_id":\s*"primary-workspace"/, `"ws_id": "${nextWorkspaceId}"`);
      }
    });
  }

  function applyOrgDashboardPayload(payload: any) {
    if (payload?.org && typeof payload.org === "object") {
      setOrgSeatSummary(payload.org as OrgSeatSummary);
      if (payload.org.org_name) {
        setAuthOrgName(String(payload.org.org_name));
      }
    }
    if (payload?.workspace && typeof payload.workspace === "object") {
      setPrimaryWorkspace(payload.workspace as OrgWorkspaceSummary);
    }
    applyWorkspaceBootstrap(payload);
  }

  async function refreshAuthSession() {
    try {
      const res = await fetch("/api/auth-me", { method: "GET", credentials: "include" });
      const data = await res.json();
      if (!res.ok || !data?.email) {
        setAssistantAuthStatus("unauthorized");
        return false;
      }

      setAuthUser(String(data.email || authUser));
      setRecoveryEmail(String(data.recovery_email || ""));
      setHasSessionPin(Boolean(data?.has_pin));
      if (data?.role && ["owner", "admin", "member", "viewer"].includes(String(data.role))) {
        setAuthRole(data.role as AuthRole);
      }
      applyOrgDashboardPayload(data);
      setAssistantAuthStatus("ok");
      return data;
    } catch {
      setAssistantAuthStatus("unauthorized");
      return false;
    }
  }

  async function ensureOnboardingKey(options: { force?: boolean; labelPrefix?: string } = {}) {
    const force = options.force === true;
    if (!force && apiAccessToken.trim()) {
      return {
        ok: true,
        reused: true,
        token: apiAccessToken.trim(),
        locked_email: apiTokenEmail.trim().toLowerCase() || authUser.trim().toLowerCase() || null,
      };
    }

    setIsEnsuringOnboardingKey(true);
    try {
      const lockedEmail = authUser.trim().toLowerCase();
      const res = await fetch("/api/token-issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          count: 1,
          ttl_preset: "quarter",
          label_prefix: options.labelPrefix || "onboarding-auto",
          scopes: ["generate"],
          locked_email: lockedEmail || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        return {
          ok: false,
          error: data?.error || `Key issue failed (${res.status}).`,
        };
      }

      const issued = data?.issued?.[0];
      const token = String(issued?.token || "");
      const tokenEmail = String(issued?.locked_email || lockedEmail || "");

      if (!token) {
        return { ok: false, error: "Key issue succeeded but no token was returned." };
      }

      setApiAccessToken(token);
      if (tokenEmail) setApiTokenEmail(tokenEmail);
      setPinUnlockedAt(new Date().toISOString());
      return { ok: true, reused: false, token, locked_email: tokenEmail || null };
    } catch (error: any) {
      return { ok: false, error: error?.message || "Key issue failed." };
    } finally {
      setIsEnsuringOnboardingKey(false);
    }
  }

  async function manualMintOnboardingKey() {
    const ensured = await ensureOnboardingKey({ force: true, labelPrefix: "manual-onboarding" });
    if (!ensured.ok) {
      setAuthResult(`Key mint failed: ${ensured.error}`);
      return;
    }

    const lockedEmail = String(ensured.locked_email || apiTokenEmail.trim().toLowerCase() || authUser.trim().toLowerCase() || "current user");
    setAuthResult(`kAIxU key minted and loaded for ${lockedEmail}. It is populated into the workspace auth state now.`);
  }

  async function saveSessionPin() {
    const pin = authPinDraft.trim();
    const confirmPin = authPinConfirmDraft.trim();
    if (!/^[A-Za-z0-9]{4,12}$/.test(pin)) {
      setPinOpsResult("PIN must be 4-12 letters and numbers only.");
      return;
    }
    if (pin !== confirmPin) {
      setPinOpsResult("PIN confirmation does not match.");
      return;
    }

    setIsSavingAuthPin(true);
    setPinOpsResult("");
    try {
      const res = await fetch("/api/auth-pin-set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ pin, confirm_pin: confirmPin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPinOpsResult(data?.error || `PIN setup failed (${res.status}).`);
        return;
      }
      setHasSessionPin(true);
      setAuthPinDraft("");
      setAuthPinConfirmDraft("");
      setPinOpsResult("Session PIN saved. Future app unlocks can use this PIN instead of reminting visible keys.");
      pushCommandFeed("Auth Center", "Session PIN saved for cross-app unlock.", "ok", "SkyeAdmin");
    } catch (error: any) {
      setPinOpsResult(error?.message || "PIN setup failed.");
    } finally {
      setIsSavingAuthPin(false);
    }
  }

  async function unlockSessionAccess() {
    const pin = authPinUnlockDraft.trim();
    if (!/^[A-Za-z0-9]{4,12}$/.test(pin)) {
      setPinOpsResult("Enter your 4-12 character session PIN to unlock access.");
      return;
    }

    setIsUnlockingAuthPin(true);
    setPinOpsResult("");
    try {
      const res = await fetch("/api/auth-pin-unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ pin, label_prefix: "session-unlock", ttl_preset: "day" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPinOpsResult(data?.error || `Unlock failed (${res.status}).`);
        return;
      }
      const token = String(data?.token || "");
      const lockedEmail = String(data?.locked_email || authUser.trim().toLowerCase());
      if (!token) {
        setPinOpsResult("Unlock succeeded but no token was returned.");
        return;
      }
      setApiAccessToken(token);
      setApiTokenEmail(lockedEmail);
      setPinUnlockedAt(new Date().toISOString());
      setAuthPinUnlockDraft("");
      setAssistantAuthStatus("token");
      setPinOpsResult(`Session unlocked for ${lockedEmail}. Standalone apps on this origin can reuse it immediately.`);
      pushCommandFeed("Auth Center", `Session unlocked for ${lockedEmail}.`, "ok", "SkyeAdmin");
      await loadTokenInventory();
    } catch (error: any) {
      setPinOpsResult(error?.message || "Unlock failed.");
    } finally {
      setIsUnlockingAuthPin(false);
    }
  }

  async function persistOnboardingShowcase(emailForAuth: string, mode: "login" | "signup") {
    const notes: string[] = [];
    if (!onboardingEmailDraft && !onboardingIdentityDraft) return "";
    const workspaceEmail = linkedWorkspaceMailbox;
    const keyLockedEmail = apiTokenEmail.trim().toLowerCase() || emailForAuth;
    const normalizedRecoveryEmail = recoveryEmail.trim().toLowerCase();

    try {
      if (onboardingEmailDraft) {
        const res = await fetch("/api/app-profile-set", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            app: "SKYEMAIL-GEN",
            title: "SKYEMAIL Onboarding Profile",
            profile: {
              generated_email: onboardingEmailDraft.email,
              prefix: onboardingEmailDraft.prefix,
              domain: onboardingEmailDraft.domain,
              source: onboardingEmailDraft.source,
              captured_at: onboardingEmailDraft.updatedAt,
              auth_flow: mode,
              primary_auth_email: emailForAuth,
              recovery_email: normalizedRecoveryEmail,
              reset_contact_email: normalizedRecoveryEmail || emailForAuth,
              key_locked_email: keyLockedEmail,
              workspace_email: workspaceEmail || onboardingEmailDraft.email.toLowerCase(),
              used_for_auth: onboardingEmailDraft.email.toLowerCase() === emailForAuth,
              used_for_workspace: (workspaceEmail || onboardingEmailDraft.email.toLowerCase()) === onboardingEmailDraft.email.toLowerCase(),
            },
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          notes.push(`email profile save failed (${data?.error || res.status})`);
        } else {
          notes.push("email generator profile saved");
        }
      }

      if (onboardingIdentityDraft) {
        const res = await fetch("/api/app-profile-set", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            app: "Skye-ID",
            title: "Skye ID Onboarding Profile",
            profile: {
              full_name: onboardingIdentityDraft.name,
              id_number: onboardingIdentityDraft.idNumber,
              source: onboardingIdentityDraft.source,
              captured_at: onboardingIdentityDraft.updatedAt,
              auth_email: emailForAuth,
              recovery_email: normalizedRecoveryEmail,
              workspace_email: workspaceEmail,
              key_locked_email: keyLockedEmail,
              auth_flow: mode,
            },
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          notes.push(`id profile save failed (${data?.error || res.status})`);
        } else {
          notes.push("id generator profile saved");
        }
      }
    } catch (error: any) {
      notes.push(error?.message || "showcase profile save failed");
    }

    return notes.join("; ");
  }

  function openGeneratorApp(appId: "SKYEMAIL-GEN" | "Skye-ID") {
    setSelectedSkyeApp(appId);
    setShowOnboardingGuide(true);
    const surfaceUrl = buildAppSurfaceUrl(appId, workspaceId);
    if (!surfaceUrl) {
      setAuthResult(`${appId} could not be opened because its standalone surface is missing.`);
      return;
    }
    const popup = window.open(surfaceUrl, `${appId}-onboarding`, "noopener,noreferrer,width=1360,height=900");
    if (!popup) {
      setAuthResult(`Popup blocked while opening ${appId}. Allow popups for this site and try again.`);
      return;
    }
    setAuthResult(`${appId} opened in a standalone window. Generate the profile there and it will flow back here automatically.`);
  }

  function linkGeneratedEmailToWorkspace() {
    if (!onboardingEmailDraft?.email) {
      setAuthResult("No generated email found yet. Open SKYEMAIL-GEN and generate one first.");
      return;
    }
    const workspaceEmail = onboardingEmailDraft.email.toLowerCase();
    setWorkspaceMailboxEmail(workspaceEmail);
    setAuthUser(workspaceEmail);
    setAuthResult(
      `Linked generated SKYEMAIL ${onboardingEmailDraft.email} as the primary login. Password recovery will go to ${recoveryEmail.trim().toLowerCase() || "your backup third-party email once you add it"}.`
    );
  }

  function applyGeneratedIdentityToOrg() {
    if (!onboardingIdentityDraft?.name) {
      setAuthResult("No generated identity found yet. Open Skye-ID and generate one first.");
      return;
    }
    if (!authOrgName.trim() || authOrgName.trim() === "Skye Workspace") {
      setAuthOrgName(`${onboardingIdentityDraft.name} Workspace`);
    }
    setAuthResult(`Linked generated identity (${onboardingIdentityDraft.name}) to onboarding context.`);
  }

  async function requestPasswordReset() {
    const email = recoveryEmail.trim().toLowerCase() || authUser.trim().toLowerCase();
    if (!email) {
      setAuthResult("Enter your SKYEMAIL login or your backup recovery email first, then request a reset link.");
      return;
    }
    setIsResetSubmitting(true);
    try {
      const res = await fetch("/api/auth-password-reset-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAuthResult(data?.error || `Password reset request failed (${res.status}).`);
        return;
      }
      setAuthResult(data?.message || "If that account exists, a reset link has been sent.");
    } catch (error: any) {
      setAuthResult(error?.message || "Password reset request failed.");
    } finally {
      setIsResetSubmitting(false);
    }
  }

  async function confirmPasswordReset() {
    const email = authUser.trim().toLowerCase();
    const token = resetToken.trim();
    const newPassword = resetNewPassword;
    if (!email || !token || !newPassword) {
      setAuthResult("Email, reset token, and new password are required.");
      return;
    }
    if (newPassword.length < 8) {
      setAuthResult("New password must be at least 8 characters.");
      return;
    }
    setIsResetSubmitting(true);
    try {
      const res = await fetch("/api/auth-password-reset-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, token, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAuthResult(data?.error || `Password reset failed (${res.status}).`);
        return;
      }
      setResetNewPassword("");
      setAuthPassword("");
      setAuthResult(data?.message || "Password reset complete. Sign in with your new password.");
    } catch (error: any) {
      setAuthResult(error?.message || "Password reset failed.");
    } finally {
      setIsResetSubmitting(false);
    }
  }

  async function submitAuthFlow(mode: "login" | "signup") {
    const normalizedAuthEmail = authUser.trim().toLowerCase();
    const normalizedRecoveryEmail = recoveryEmail.trim().toLowerCase();
    if (!normalizedAuthEmail || !authPassword.trim()) {
      setAuthResult("Email and password are required.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedAuthEmail)) {
      setAuthResult("Use a valid SKYEMAIL login address for signup or sign in.");
      return;
    }

    if (mode === "signup" && !authOrgName.trim()) {
      setAuthResult("Organization name is required for signup.");
      return;
    }

    if (mode === "signup" && !normalizedRecoveryEmail) {
      setAuthResult("A third-party recovery email is required for signup.");
      return;
    }

    if (mode === "signup" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedRecoveryEmail)) {
      setAuthResult("Enter a valid third-party recovery email for signup.");
      return;
    }

    if (mode === "signup" && normalizedRecoveryEmail === normalizedAuthEmail) {
      setAuthResult("Recovery email must be different from the SKYEMAIL primary login.");
      return;
    }

    setIsAuthSubmitting(true);
    setAuthResult("");
    try {
      const payload: Record<string, unknown> = {
        email: normalizedAuthEmail,
        password: authPassword,
      };
      if (mode === "signup") {
        payload.orgName = authOrgName.trim();
        payload.recoveryEmail = normalizedRecoveryEmail;
      }

      const res = await fetch(mode === "signup" ? "/api/auth-signup" : "/api/auth-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthResult(data?.error || `${mode} failed (${res.status}).`);
        return;
      }

      if (mode === "signup" && data?.kaixu_token?.token) {
        setApiAccessToken(String(data.kaixu_token.token));
        setApiTokenEmail(String(data.kaixu_token.locked_email || normalizedAuthEmail));
        setPinUnlockedAt(new Date().toISOString());
      }
      applyOrgDashboardPayload(data);

      setAuthPassword("");
      const sessionMeta = await refreshAuthSession();

      const hasTokenFromAuth = Boolean(data?.kaixu_token?.token);
      const pinConfigured = Boolean(data?.user?.has_pin || (typeof sessionMeta === "object" && (sessionMeta as any)?.has_pin));
      if (!hasTokenFromAuth && !pinConfigured) {
        const ensured = await ensureOnboardingKey({ labelPrefix: mode === "signup" ? "signup-auto" : "login-auto" });
        if (!ensured.ok) {
          setAuthResult(
            `${mode === "signup" ? "Signup" : "Login"} complete, but key mint failed: ${ensured.error}`
          );
          return;
        }
      } else if (!hasTokenFromAuth && pinConfigured) {
        setPinUnlockedAt("");
      }

      const bootstrappedWorkspaceId = String(data?.workspace?.id || data?.user?.workspace_id || workspaceId).trim();
      const bootstrappedOrgName = String(data?.org?.org_name || authOrgName).trim();
      const profileSync = await persistOnboardingShowcase(normalizedAuthEmail, mode);
      const workspaceSyncNote = linkedWorkspaceMailbox
        ? ` SKYEMAIL primary login linked: ${linkedWorkspaceMailbox}.`
        : " Generate and link your SKYEMAIL primary login next.";
      const recoveryNote = normalizedRecoveryEmail
        ? ` Recovery goes to ${normalizedRecoveryEmail}.`
        : "";

      stageSovereignVariablesSuggestion({
        title: mode === "signup" ? "Auth bootstrap env pack" : "Session restore env pack",
        source: mode === "signup" ? "Auth Center Signup" : "Auth Center Login",
        content: buildEnvTemplateContent([
          { key: "SKYE_PRIMARY_EMAIL", value: normalizedAuthEmail },
          { key: "SKYE_RECOVERY_EMAIL", value: normalizedRecoveryEmail },
          { key: "SKYE_ORG_NAME", value: bootstrappedOrgName },
          { key: "SKYE_WORKSPACE_EMAIL", value: linkedWorkspaceMailbox || normalizedAuthEmail },
          { key: "KX_LOCKED_EMAIL", value: String(data?.kaixu_token?.locked_email || "") || apiTokenEmail.trim().toLowerCase() || normalizedAuthEmail },
          { key: "KX_WORKSPACE_ID", value: bootstrappedWorkspaceId || workspaceId.trim() },
        ]),
        projectName: bootstrappedOrgName || bootstrappedWorkspaceId || workspaceId.trim() || "Auth Center",
        environmentName: mode === "signup" ? "Signup Bootstrap" : "Login Session",
        detail:
          mode === "signup"
            ? "Account is live. SovereignVariables staged a bootstrap env pack for signup, recovery, and workspace wiring."
            : "Session restored. SovereignVariables staged a session env pack for workspace, recovery, and token wiring.",
        tone: "info",
      });

      setAuthResult(
        mode === "signup"
          ? `Signup complete. Session active, key minted, and onboarding is ready.${workspaceSyncNote}${recoveryNote}${profileSync ? ` ${profileSync}.` : ""}`
          : pinConfigured
            ? `Login complete. Session restored. Use your PIN once to unlock kAIxU access across the bench and standalone apps.${workspaceSyncNote}${recoveryNote}${profileSync ? ` ${profileSync}.` : ""}`
            : `Login complete. Session restored and key is active.${workspaceSyncNote}${recoveryNote}${profileSync ? ` ${profileSync}.` : ""}`
      );
    } catch (error: any) {
      setAuthResult(error?.message || `${mode} failed.`);
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  async function logoutAuthSession() {
    setIsAuthSubmitting(true);
    try {
      await fetch("/api/auth-logout", { method: "POST", credentials: "include" });
      setAssistantAuthStatus("unauthorized");
      setAuthPassword("");
      setApiAccessToken("");
      setApiTokenEmail("");
      setPinUnlockedAt("");
      setAuthResult("Signed out of browser session.");
    } catch (error: any) {
      setAuthResult(error?.message || "Logout failed.");
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  function chooseOnboardingAssistMode(mode: OnboardingAssistMode) {
    setOnboardingAssistMode(mode);
    setShowOnboardingPrompt(false);
    if (isAuthCenterMode) {
      setShowOnboardingGuide(mode === "guided");
      return;
    }
    if (mode === "guided") {
      setShowOnboardingGuide(true);
      openAuthCenterWindow({ focus: true, guide: true });
      return;
    }
    setShowOnboardingGuide(false);
    if (mode === "self-serve") openAuthCenterWindow({ focus: true, guide: false });
  }

  function openStandaloneWorkspaceWindow(url: string | null, note?: string) {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
    if (note) pushIdeDiagnostic("info", note);
  }

  function openContractorNetworkSurface(note?: string) {
    window.open(`/ContractorNetwork/index.html?ws_id=${encodeURIComponent(workspaceId)}`, "_blank", "noopener,noreferrer");
    if (note) pushIdeDiagnostic("info", note);
  }

  function openGuidedBusinessSurface(
    target: "AE-Flow" | "GoogleBusinessProfileRescuePlatform" | "ContractorNetwork" | "Neural-Space-Pro",
    note?: string
  ) {
    if (target === "ContractorNetwork") {
      openContractorNetworkSurface(note);
      return;
    }
    if (target === "Neural-Space-Pro") {
      setAppMode("neural");
      if (note) pushIdeDiagnostic("info", note);
      return;
    }
    routeCrossAppFocus(target, { note });
  }

  function buildTutorialGuideCards(appId: SkyeAppId, steps: string[], nextUnchecked: string | undefined, standaloneUrl: string | null) {
    const primaryStep = nextUnchecked || steps[0] || `Open ${appId} and confirm the workspace is ready.`;
    const readyText = hasApiKeyLoaded
      ? "The kAIxU key is already live for this browser origin, so the route can stay inside the suite instead of bouncing out for auth."
      : "The kAIxU key is still missing for this browser origin, so start with Guided Onboarding before expecting a real cross-app handoff.";

    if (appId === "AE-Flow") {
      return [
        {
          title: "Prime the CRM lane",
          detail: steps[0] || primaryStep,
          label: "Open AE-Flow",
          run: () => openGuidedBusinessSurface("AE-Flow", "Guided launch opened AE-Flow with the current workspace context."),
        },
        {
          title: "Work the reasoning handoff",
          detail: nextUnchecked || steps[3] || "Move the active CRM case into Neural Space Pro, then return to AE-Flow and confirm the handoff stayed visible.",
          label: "Open Neural Space Pro",
          run: () => openGuidedBusinessSurface("Neural-Space-Pro", "Guided launch moved the AE-Flow case into Neural Space Pro."),
        },
        {
          title: "Close the field follow-up",
          detail: steps[4] || "Finish the route by pushing the case into ContractorNetwork or another live follow-up lane so AE-Flow does not end as an isolated iframe.",
          label: "Open ContractorNetwork",
          run: () => openGuidedBusinessSurface("ContractorNetwork", "Guided launch opened ContractorNetwork as the next AE-Flow follow-up lane."),
        },
      ];
    }

    if (appId === "GoogleBusinessProfileRescuePlatform") {
      return [
        {
          title: "Open the live rescue capsule",
          detail: steps[0] || primaryStep,
          label: "Open GBP Rescue",
          run: () => openGuidedBusinessSurface("GoogleBusinessProfileRescuePlatform", "Guided launch opened the GBP Rescue platform capsule."),
        },
        {
          title: "Prepare the evidence handoff",
          detail: nextUnchecked || steps[2] || "Push the active rescue state into Neural Space Pro or outbound comms so the operator can work the case, not just view it.",
          label: "Open Neural Space Pro",
          run: () => openGuidedBusinessSurface("Neural-Space-Pro", "Guided launch moved the rescue case into Neural Space Pro for evidence synthesis."),
        },
        {
          title: "Route the next operator",
          detail: steps[3] || "Hand the case into AE-Flow or ContractorNetwork when the rescue path needs sales, ops, or field execution.",
          label: "Open AE-Flow",
          run: () => openGuidedBusinessSurface("AE-Flow", "Guided launch opened AE-Flow as the next GBP Rescue handoff."),
        },
      ];
    }

    return [
      {
        title: "Prepare access",
        detail: readyText,
        label: "Launch Guided Onboarding",
        run: () => openAuthCenterWindow({ focus: true, guide: true }),
      },
      {
        title: "Run the live surface",
        detail: primaryStep,
        label: standaloneUrl ? "Open Standalone" : `Open ${appId}`,
        run: () => {
          if (standaloneUrl) {
            openStandaloneWorkspaceWindow(standaloneUrl, `Guided launch opened ${appId} as a standalone surface.`);
            return;
          }
          routeCrossAppFocus(appId, { note: `Guided launch opened ${appId}.` });
        },
      },
      {
        title: "Finish the suite handoff",
        detail: "Do one real follow-through after the app interaction so the workflow ends in a connected platform route, not a dead-end demo.",
        label: appId === "SkyeDocxPro" || appId === "SkyeBlog" ? "Open AE-Flow" : "Open Neural Space Pro",
        run: () => {
          if (appId === "SkyeDocxPro" || appId === "SkyeBlog") {
            openGuidedBusinessSurface("AE-Flow", `Guided launch opened AE-Flow after ${appId}.`);
            return;
          }
          openGuidedBusinessSurface("Neural-Space-Pro", `Guided launch opened Neural Space Pro after ${appId}.`);
        },
      },
    ];
  }

  async function copyLoadedKey() {
    const token = apiAccessToken.trim();
    if (!token) {
      setAuthResult("No key is loaded yet.");
      return;
    }
    try {
      await navigator.clipboard.writeText(token);
      setAuthResult("kAIxU key copied to clipboard.");
    } catch {
      setAuthResult("Unable to copy automatically. Select the key and copy it manually.");
    }
  }

  function renderAuthCenterContents() {
    return (
      <div className="auth-center-shell">
        <section className="app-module auth-center-card">
          <header className="auth-center-header">
            <div>
              <p className="platform-intro-kicker">Standalone Auth Center</p>
              <h2>Onboarding, identity, admin, and kAIxU access</h2>
              <p>This subscreen carries the login, onboarding, recovery, and key plumbing so the main workspace bench stays clean.</p>
            </div>
            <div className="tool-actions left auth-center-actions">
              <button className="ghost" type="button" onClick={() => chooseOnboardingAssistMode("guided")}>Guided</button>
              <button className="ghost" type="button" onClick={() => chooseOnboardingAssistMode("self-serve")}>Self-Serve</button>
              <button className="ghost" type="button" onClick={() => void refreshAuthSession()} disabled={isAuthSubmitting}>Session Sync</button>
              {!isAuthCenterMode && (
                <button className="ghost" type="button" onClick={() => openAuthCenterWindow({ focus: true, guide: showOnboardingGuide })}>Open Auth Center</button>
              )}
            </div>
          </header>

          <section className="auth-session-feedback auth-key-card">
            <strong>Loaded kAIxU Key</strong>
            <div>This access lane is shared across the main bench and standalone apps. If a session PIN exists, unlock once and the origin reuses the access path until logout.</div>
            <div className="tool-row" style={{ marginTop: 8 }}>
              <label>kAIxU Access Key</label>
              <input value={apiAccessToken.trim() ? `${apiAccessToken.slice(0, 12)}...${apiAccessToken.slice(-6)}` : ""} readOnly placeholder="Key will appear here after mint or unlock" />
            </div>
            <div className="tool-row split" style={{ marginTop: 8 }}>
              <div>
                <label>Locked Email</label>
                <input value={apiTokenEmail} readOnly placeholder="user@company.com" />
              </div>
              <div>
                <label>Assistant Auth</label>
                <input value={assistantAuthStatus} readOnly />
              </div>
            </div>
            <div className="tool-row split" style={{ marginTop: 8 }}>
              <div>
                <label>Session PIN</label>
                <input value={hasSessionPin ? "configured" : "not configured"} readOnly />
              </div>
              <div>
                <label>Last Unlock</label>
                <input value={pinUnlockedAt || "not unlocked yet"} readOnly />
              </div>
            </div>
            <div className="tool-actions left" style={{ marginTop: 8 }}>
              <button className="ghost" type="button" onClick={() => void copyLoadedKey()}>Copy Key</button>
              <button className="ghost" type="button" onClick={() => void checkAssistantAuth()}>Validate Auth Path</button>
              <button className="ghost" type="button" onClick={() => { setApiAccessToken(""); setApiTokenEmail(""); setAssistantAuthStatus("unknown"); }}>Clear Key</button>
            </div>
            <div className="tool-row split" style={{ marginTop: 12 }}>
              <div>
                <label>Set Session PIN</label>
                <input type="password" value={authPinDraft} onChange={(event) => setAuthPinDraft(event.target.value)} placeholder="4-12 letters or numbers" />
              </div>
              <div>
                <label>Confirm PIN</label>
                <input type="password" value={authPinConfirmDraft} onChange={(event) => setAuthPinConfirmDraft(event.target.value)} placeholder="Confirm PIN" />
              </div>
            </div>
            <div className="tool-row split" style={{ marginTop: 8 }}>
              <div>
                <label>Unlock With PIN</label>
                <input type="password" value={authPinUnlockDraft} onChange={(event) => setAuthPinUnlockDraft(event.target.value)} placeholder="Enter PIN once per session" />
              </div>
              <div>
                <label>Cross-App Propagation</label>
                <input value="same-origin localStorage + session cookie" readOnly />
              </div>
            </div>
            <div className="tool-actions left" style={{ marginTop: 8 }}>
              <button className="ghost" type="button" onClick={() => void saveSessionPin()} disabled={isSavingAuthPin || isAuthSubmitting}>
                {isSavingAuthPin ? "Saving PIN..." : "Save Session PIN"}
              </button>
              <button className="ghost" type="button" onClick={() => void unlockSessionAccess()} disabled={isUnlockingAuthPin || isAuthSubmitting}>
                {isUnlockingAuthPin ? "Unlocking..." : "Unlock Session Access"}
              </button>
            </div>
            {pinOpsResult && <p className="muted-copy" style={{ marginTop: 8 }}>{pinOpsResult}</p>}
          </section>

          <section className="auth-session-bar auth-session-bar-standalone">
            <div className="auth-field-shell">
              <label htmlFor="auth-email">SKYEMAIL Login</label>
              <input
                id="auth-email"
                value={authUser}
                onChange={(event) => setAuthUser(event.target.value)}
                placeholder="founder@skyemail.com"
              />
            </div>
            <div className="auth-field-shell">
              <label htmlFor="auth-password">Password</label>
              <input
                id="auth-password"
                type="password"
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                placeholder="********"
              />
            </div>
            <div className="auth-field-shell">
              <label htmlFor="auth-recovery-email">Recovery Email</label>
              <input
                id="auth-recovery-email"
                value={recoveryEmail}
                onChange={(event) => setRecoveryEmail(event.target.value)}
                placeholder="you@gmail.com"
              />
            </div>
            <div className="auth-field-shell">
              <label htmlFor="auth-org">Org (signup)</label>
              <input
                id="auth-org"
                value={authOrgName}
                onChange={(event) => setAuthOrgName(event.target.value)}
                placeholder="Skye Workspace"
              />
            </div>
            <div className="auth-session-actions">
            <button className="ghost" type="button" onClick={() => void submitAuthFlow("login")} disabled={isAuthSubmitting}>
              {isAuthSubmitting ? "Working..." : "Sign In"}
            </button>
            <button className="ghost" type="button" onClick={() => void submitAuthFlow("signup")} disabled={isAuthSubmitting}>
              {isAuthSubmitting ? "Working..." : "Sign Up"}
            </button>
            <button
              className="ghost"
              type="button"
              onClick={() => void manualMintOnboardingKey()}
              disabled={isAuthSubmitting || isEnsuringOnboardingKey}
            >
              {isEnsuringOnboardingKey ? "Minting Key..." : "Mint Key"}
            </button>
            <div className={`auth-inline-status ${authInlineState.tone}`}>
              <strong>{authInlineState.label}</strong>
              <span>{authInlineState.detail}</span>
            </div>
            </div>
            <button className="ghost" type="button" onClick={() => void logoutAuthSession()} disabled={isAuthSubmitting}>
              Sign Out
            </button>
            <span className="telemetry-chip">Revision: {workspaceRevision || "n/a"}</span>
            <span className="telemetry-chip">Workspace: {workspaceId}</span>
          </section>

          <section className="auth-session-feedback">
            <strong>Password Recovery</strong>
            <div>Reset links go to the third-party recovery email. The SKYEMAIL address remains the primary login.</div>
            <div className="tool-actions left" style={{ marginTop: 8 }}>
              <button className="ghost" type="button" onClick={() => void requestPasswordReset()} disabled={isResetSubmitting}>
                {isResetSubmitting ? "Requesting..." : "Send Reset Link"}
              </button>
              <a className="ghost" href={`/recover-account/?reset_email=${encodeURIComponent(authUser.trim().toLowerCase())}`} target="_blank" rel="noreferrer">
                Open Recover Page
              </a>
            </div>
            <div className="tool-row split" style={{ marginTop: 8 }}>
              <div>
                <label>Reset Token</label>
                <input
                  value={resetToken}
                  onChange={(event) => setResetToken(event.target.value)}
                  placeholder="Paste token from email"
                />
              </div>
              <div>
                <label>New Password</label>
                <input
                  type="password"
                  value={resetNewPassword}
                  onChange={(event) => setResetNewPassword(event.target.value)}
                  placeholder="At least 8 characters"
                />
              </div>
            </div>
            <div className="tool-actions left" style={{ marginTop: 8 }}>
              <button className="ghost" type="button" onClick={() => void confirmPasswordReset()} disabled={isResetSubmitting}>
                {isResetSubmitting ? "Resetting..." : "Reset Password"}
              </button>
            </div>
          </section>

          <section className="auth-session-feedback">
            <strong>Generator Onboarding</strong>
            <div>
              SKYEMAIL-GEN draft: {onboardingEmailDraft?.email || "none"}
              {onboardingEmailDraft?.updatedAt ? ` · ${new Date(onboardingEmailDraft.updatedAt).toLocaleString()}` : ""}
            </div>
            <div>Primary SKYEMAIL login: {authUser.trim().toLowerCase() || "none"}</div>
            <div>Backup recovery email: {recoveryEmail.trim().toLowerCase() || "none"}</div>
            <div>
              Skye-ID draft: {onboardingIdentityDraft ? `${onboardingIdentityDraft.name} / ${onboardingIdentityDraft.idNumber}` : "none"}
              {onboardingIdentityDraft?.updatedAt ? ` · ${new Date(onboardingIdentityDraft.updatedAt).toLocaleString()}` : ""}
            </div>
            <div className="tool-actions left" style={{ marginTop: 8 }}>
              <button className="ghost" type="button" onClick={() => openGeneratorApp("SKYEMAIL-GEN")}>Open SKYEMAIL-GEN</button>
              <button className="ghost" type="button" onClick={linkGeneratedEmailToWorkspace}>Use Generated SKYEMAIL</button>
              <button className="ghost" type="button" onClick={() => openGeneratorApp("Skye-ID")}>Open Skye-ID</button>
              <button className="ghost" type="button" onClick={applyGeneratedIdentityToOrg}>Link Generated ID</button>
            </div>
          </section>

          {inviteToken && (
            <section className="auth-session-feedback">
              <strong>Invite Onboarding</strong>
              <div>Complete this here to join the invited organization and mint your onboarding key.</div>
              <div className="tool-row split" style={{ marginTop: 8 }}>
                <div>
                  <label>Invite Email</label>
                  <input value={inviteAcceptEmail} onChange={(event) => setInviteAcceptEmail(event.target.value)} placeholder="you@company.com" />
                </div>
                <div>
                  <label>Create Password</label>
                  <input
                    type="password"
                    value={inviteAcceptPassword}
                    onChange={(event) => setInviteAcceptPassword(event.target.value)}
                    placeholder="At least 8 characters"
                  />
                </div>
              </div>
              <div className="tool-actions left">
                <button className="ghost" type="button" onClick={() => void acceptInviteLink()} disabled={isAcceptingInvite}>
                  {isAcceptingInvite ? "Accepting..." : "Accept Invite"}
                </button>
              </div>
              {inviteAcceptResult && <div>{inviteAcceptResult}</div>}
            </section>
          )}

          <section className="auth-session-feedback">
            <strong>Onboarding Checklist</strong>
            <div>Session: {assistantAuthStatus === "ok" || assistantAuthStatus === "token" ? "ready" : "missing"}</div>
            <div>Key: {apiAccessToken.trim() ? "loaded" : "missing"}</div>
            <div>Primary SKYEMAIL login: {authUser.trim().toLowerCase() || "missing"}</div>
            <div>Backup recovery email: {recoveryEmail.trim().toLowerCase() || "missing"}</div>
            <div>Email lock: {apiTokenEmail.trim().toLowerCase() && apiTokenEmail.trim().toLowerCase() === authUser.trim().toLowerCase() ? "aligned" : "needs alignment"}</div>
          </section>
          {showOnboardingGuide && !inviteToken && renderGuidedOnboardingPanel()}
        </section>
      </div>
    );
  }

  function renderGuidedOnboardingPanel() {
    const launchSequence = [
      {
        title: "Launch AE-Flow",
        detail: "Move directly from onboarding into the CRM platform with the same workspace and key already loaded.",
        label: "Open AE-Flow",
        run: () => openGuidedBusinessSurface("AE-Flow", "Guided onboarding opened AE-Flow with the active workspace context."),
      },
      {
        title: "Open GBP Rescue",
        detail: "Route the operator into the business rescue platform without forcing another setup pass or context re-entry.",
        label: "Open GBP Rescue",
        run: () => openGuidedBusinessSurface("GoogleBusinessProfileRescuePlatform", "Guided onboarding opened the GBP Rescue platform."),
      },
      {
        title: "Open ContractorNetwork",
        detail: "Use the contractor lane for field follow-up once the account, identity, and key are locked to the workspace.",
        label: "Open ContractorNetwork",
        run: () => openGuidedBusinessSurface("ContractorNetwork", "Guided onboarding opened ContractorNetwork for field follow-up."),
      },
      {
        title: "Shift into Neural",
        detail: "When the operator needs reasoning or synthesis, move into Neural Space Pro without losing the suite access path.",
        label: "Open Neural Space Pro",
        run: () => openGuidedBusinessSurface("Neural-Space-Pro", "Guided onboarding opened Neural Space Pro as the next lane."),
      },
    ];

    return (
      <section className="app-module onboarding-guide-panel">
        <header>
          <h2>Workspace Onboarding</h2>
          <p>Use a real email for account recovery and key lock. Generate a separate SKYEMAIL address for the workspace itself.</p>
        </header>

        <div className="onboarding-chip-row">
          <span className={`telemetry-chip ${hasActiveAuthSession ? "active" : ""}`}>Account {hasActiveAuthSession ? "Ready" : "Pending"}</span>
          <span className={`telemetry-chip ${linkedWorkspaceMailbox ? "active" : ""}`}>Workspace Mailbox {linkedWorkspaceMailbox || "Pending"}</span>
          <span className={`telemetry-chip ${onboardingIdentityDraft?.name ? "active" : ""}`}>Identity {onboardingIdentityDraft?.name || "Pending"}</span>
          <span className={`telemetry-chip ${apiAccessToken.trim() ? "active" : ""}`}>kAIxU Key {apiAccessToken.trim() ? "Ready" : "Pending"}</span>
          <span className="telemetry-chip">Progress {onboardingGuideProgress}/5</span>
        </div>

        <div className="onboarding-guide-grid">
          <article className="onboarding-step-card">
            <div className="onboarding-step-index">1</div>
            <h3>Set the backup recovery email</h3>
            <p>Use Gmail, Yahoo, or another third-party email here. This is where backup login help and password reset links are sent if the user forgets their SKYEMAIL login.</p>
            <div className="tool-row">
              <label>Backup Recovery Email</label>
              <input value={recoveryEmail} onChange={(event) => setRecoveryEmail(event.target.value)} placeholder="you@gmail.com" />
            </div>
            <div className="tool-row split">
              <div>
                <label>Password</label>
                <input type="password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder="At least 8 characters" />
              </div>
              <div>
                <label>Organization</label>
                <input value={authOrgName} onChange={(event) => setAuthOrgName(event.target.value)} placeholder="Skye Workspace" />
              </div>
            </div>
          </article>

          <article className="onboarding-step-card">
            <div className="onboarding-step-index">2</div>
            <h3>Generate the SKYEMAIL login</h3>
            <p>Create the actual SKYEMAIL identity the user will log in with. This becomes the primary login and the mailbox inside the workspace.</p>
            <div className="onboarding-summary-grid">
              <div>
                <strong>Backup recovery</strong>
                <span>{recoveryEmail.trim().toLowerCase() || "Not set"}</span>
              </div>
              <div>
                <strong>Primary SKYEMAIL login</strong>
                <span>{linkedWorkspaceMailbox || authUser.trim().toLowerCase() || "Generate in SKYEMAIL-GEN"}</span>
              </div>
            </div>
            <div className="tool-actions left">
              <button className="ghost" type="button" onClick={() => openGeneratorApp("SKYEMAIL-GEN")}>Open SKYEMAIL-GEN</button>
              <button className="ghost" type="button" onClick={linkGeneratedEmailToWorkspace}>Use Generated SKYEMAIL</button>
            </div>
          </article>

          <article className="onboarding-step-card">
            <div className="onboarding-step-index">3</div>
            <h3>Create the account</h3>
            <p>Sign up or sign in with the SKYEMAIL address as the primary login. The third-party email remains backup only.</p>
            <div className="tool-row">
              <label>Primary SKYEMAIL Login</label>
              <input value={authUser} onChange={(event) => setAuthUser(event.target.value)} placeholder="founder@skyemail.com" />
            </div>
            <div className="onboarding-summary-grid">
              <div>
                <strong>Recovery email</strong>
                <span>{recoveryEmail.trim().toLowerCase() || "Set in step 1"}</span>
              </div>
              <div>
                <strong>SKYEMAIL login</strong>
                <span>{authUser.trim().toLowerCase() || "Generate and link in step 2"}</span>
              </div>
            </div>
            <div className="tool-actions left">
              <button className="ghost" type="button" onClick={() => void submitAuthFlow("signup")} disabled={isAuthSubmitting}>
                {isAuthSubmitting ? "Working..." : "Sign Up"}
              </button>
              <button className="ghost" type="button" onClick={() => void submitAuthFlow("login")} disabled={isAuthSubmitting}>
                {isAuthSubmitting ? "Working..." : "Sign In"}
              </button>
            </div>
          </article>

          <article className="onboarding-step-card">
            <div className="onboarding-step-index">4</div>
            <h3>Link identity to the workspace</h3>
            <p>Generate the user identity card and attach it to the workspace so the mailbox, account email, and ID record stay tied together.</p>
            <div className="onboarding-summary-grid">
              <div>
                <strong>Identity draft</strong>
                <span>{onboardingIdentityDraft ? `${onboardingIdentityDraft.name} / ${onboardingIdentityDraft.idNumber}` : "No linked identity yet"}</span>
              </div>
              <div>
                <strong>Workspace name</strong>
                <span>{authOrgName || "Skye Workspace"}</span>
              </div>
            </div>
            <div className="tool-actions left">
              <button className="ghost" type="button" onClick={() => openGeneratorApp("Skye-ID")}>Open Skye-ID</button>
              <button className="ghost" type="button" onClick={applyGeneratedIdentityToOrg}>Link Generated ID</button>
            </div>
          </article>

          <article className="onboarding-step-card">
            <div className="onboarding-step-index">5</div>
            <h3>Finish key and recovery</h3>
            <p>Your kAIxU key should lock to the SKYEMAIL primary login. Password resets and backup recovery go to the third-party recovery email, and every standalone app should reuse the same access path.</p>
            <div className="onboarding-summary-grid">
              <div>
                <strong>Key lock email</strong>
                <span>{apiTokenEmail.trim().toLowerCase() || authUser.trim().toLowerCase() || "Not minted yet"}</span>
              </div>
              <div>
                <strong>Password recovery</strong>
                <span>{recoveryEmail.trim().toLowerCase() || "Set your backup recovery email first"}</span>
              </div>
            </div>
            <div className="tool-actions left">
              <button
                className="ghost"
                type="button"
                onClick={() => void ensureOnboardingKey({ force: true, labelPrefix: "manual-onboarding" })}
                disabled={isAuthSubmitting || isEnsuringOnboardingKey}
              >
                {isEnsuringOnboardingKey ? "Minting Key..." : "Mint Key"}
              </button>
              <button className="ghost" type="button" onClick={() => void requestPasswordReset()} disabled={isResetSubmitting}>
                {isResetSubmitting ? "Requesting..." : "Send Reset Link"}
              </button>
              <button className="ghost" type="button" onClick={() => void refreshAuthSession()} disabled={isAuthSubmitting}>Session Sync</button>
              <a className="ghost" href="https://skyesol.netlify.app/kaixu/requestkaixuapikey" target="_blank" rel="noreferrer">Request kAIxU Key</a>
            </div>
          </article>
        </div>

        <div className="auth-session-feedback onboarding-flow-summary">
          <strong>How this flow works</strong>
          <div>Your generated SKYEMAIL address becomes the primary login and the mailbox inside the workspace.</div>
          <div>Your third-party recovery email is only for backup login help and password reset delivery.</div>
          <div>After auth is live, move directly into AE-Flow, GBP Rescue Platform, ContractorNetwork, or Neural Space Pro without asking the user to re-enter context.</div>
          <div>You can close this and come back any time with the Guided Onboarding button.</div>
          <div className="onboarding-guide-grid" style={{ marginTop: 14 }}>
            {launchSequence.map((card, index) => (
              <article key={card.title} className="onboarding-step-card">
                <div className="onboarding-step-index">{index + 1}</div>
                <h3>{card.title}</h3>
                <p>{card.detail}</p>
                <div className="tool-actions left">
                  <button className="ghost" type="button" onClick={card.run}>{card.label}</button>
                </div>
              </article>
            ))}
          </div>
          <div className="tool-actions left" style={{ marginTop: 8 }}>
            <button className="ghost" type="button" onClick={() => openGuidedBusinessSurface("AE-Flow", "Guided onboarding opened AE-Flow from the summary rail.")}>Open AE-Flow</button>
            <button className="ghost" type="button" onClick={() => openGuidedBusinessSurface("GoogleBusinessProfileRescuePlatform", "Guided onboarding opened GBP Rescue from the summary rail.")}>Open GBP Rescue</button>
            <button className="ghost" type="button" onClick={() => openGuidedBusinessSurface("ContractorNetwork", "Guided onboarding opened ContractorNetwork from the summary rail.")}>Open ContractorNetwork</button>
            <button className="ghost" type="button" onClick={() => chooseOnboardingAssistMode("later")}>Maybe Later</button>
            <button className="ghost" type="button" onClick={() => chooseOnboardingAssistMode("self-serve")}>Use Self-Serve Instead</button>
          </div>
        </div>
      </section>
    );
  }

  function openDetachedPreview() {
    if (effectivePreviewUrl) {
      window.open(effectivePreviewUrl, "_blank", "noopener,noreferrer");
      pushIdeDiagnostic("info", `Opened detached ${previewRuntimeMode} preview.`);
      return;
    }
    if (!effectivePreviewDocument) {
      setIdeOpsResult("Preview unavailable for this file type.");
      pushIdeDiagnostic("warn", "Detached preview unavailable for current context.");
      return;
    }
    const blob = new Blob([effectivePreviewDocument], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    pushIdeDiagnostic("info", "Opened detached in-memory preview document.");
  }

  function retryPreview() {
    setPreviewFrameError("");
    setPreviewReloadToken((old) => old + 1);
    pushIdeDiagnostic("info", `Retry requested for ${previewRuntimeMode} preview.`);
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
          ws_id: workspaceId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setChatNotifyResult(data?.error || `notify failed (${res.status})`);
        return;
      }
      setChatNotifyResult(`published to #${chatChannelInput || "general"} · id=${data?.id || "n/a"}`);
      await loadSkyeChatHistory();
      emitAppBridge({
        kind: "action",
        source: "SkyeChat",
        appId: "SkyeChat",
        tone: "ok",
        detail: `Chat publish landed in #${chatChannelInput || "general"}.`,
      });
      routeCrossAppFocus("SkyeChat", {
        channel: chatChannelInput,
        note: `SkyeChat publish completed for #${chatChannelInput || "general"}. id=${data?.id || "n/a"}`,
      });
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
      emitAppBridge({ kind: "action", source: "kAIxU", appId: "SkyeChat", tone: "ok", detail: `kAIxU responded in #${chatChannelInput}.` });
    } catch (error: any) {
      setChatNotifyResult(error?.message || "kAIxU chat failed");
    } finally {
      setIsAskingKaixuInChat(false);
    }
  }

  function applyNeuralRoomDefaultsToChat() {
    const channel = neuralRoomChannel.trim() || "neural-space";
    const message = neuralRoomMessage.trim();
    setChatChannelInput(channel);
    setChatHistoryChannel(channel);
    if (message) setChatMessageInput(`[Neural Space Pro] ${message}`);
  }

  function openNeuralRoomInSkyeChat() {
    setAppMode("skyeide");
    setSelectedSkyeApp("SkyeChat");
    applyNeuralRoomDefaultsToChat();
    void loadSkyeChatHistory();
  }

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [selectedSkyeApp, appMode]);

  useEffect(() => {
    void checkAssistantAuth();
  }, []);

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
      applyNeuralRoomDefaultsToChat();
      await loadSkyeChatHistory();
      emitAppBridge({
        kind: "action",
        source: "Neural Space Pro",
        appId: "SkyeChat",
        tone: askKaixu ? "boundary" : "ok",
        detail: askKaixu ? `Neural Space Pro triggered kAIxU follow-up in #${channel}.` : `Neural Space Pro published to #${channel}.`,
      });
      routeCrossAppFocus("SkyeChat", {
        channel,
        note: askKaixu
          ? `Neural Space Pro published into #${channel} and requested kAIxU follow-up.`
          : `Neural Space Pro published into #${channel}.`,
      });
    } catch (error: any) {
      setChatNotifyResult(error?.message || `${askKaixu ? "Neural kAIxU room" : "Neural room publish"} failed`);
    } finally {
      setIsPublishingNeuralRoom(false);
      setIsPublishingNeuralKaixu(false);
    }
  }

  async function loadTeamMembers() {
    setIsLoadingTeam(true);
    setTeamResult("");
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
      applyOrgDashboardPayload(data);
    } catch (error: any) {
      setTeamResult(error?.message || "team load failed");
    } finally {
      setIsLoadingTeam(false);
    }
  }

  async function loadOrgKeyPolicy() {
    setIsLoadingOrgKeyPolicy(true);
    setOrgKeyActionResult("");
    try {
      const res = await fetch("/api/org-key-policy", { method: "GET", credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        setOrgKeyActionResult(data?.error || `org key policy failed (${res.status})`);
        return;
      }
      setOrgKeyPolicy((data?.policy && typeof data.policy === "object") ? data.policy as OrgKeyPolicySummary : null);
    } catch (error: any) {
      setOrgKeyActionResult(error?.message || "org key policy failed");
    } finally {
      setIsLoadingOrgKeyPolicy(false);
    }
  }

  async function runOrgKeyPolicyAction(action: string, extra: Record<string, unknown> = {}) {
    setIsRunningOrgKeyAction(true);
    setOrgKeyActionResult("");
    setOrgKeyIssuedToken("");
    setOrgKeyIssuedMeta("");
    try {
      const res = await fetch("/api/org-key-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOrgKeyActionResult(data?.error || `${action} failed (${res.status})`);
        return null;
      }
      if (data?.policy && typeof data.policy === "object") {
        setOrgKeyPolicy(data.policy as OrgKeyPolicySummary);
      }
      if (data?.issued?.token) {
        const lockedEmail = String(data?.issued?.locked_email || "").trim().toLowerCase();
        const token = String(data.issued.token || "");
        setOrgKeyIssuedToken(token);
        setOrgKeyIssuedMeta(`label=${data?.issued?.label || "token"} · locked_email=${lockedEmail || "<none>"} · expires_at=${data?.issued?.expires_at || "n/a"}`);
        if (!lockedEmail || lockedEmail === authUser.trim().toLowerCase()) {
          setApiAccessToken(token);
          setApiTokenEmail(lockedEmail);
          setPinUnlockedAt(new Date().toISOString());
        }
      }
      return data;
    } catch (error: any) {
      setOrgKeyActionResult(error?.message || `${action} failed`);
      return null;
    } finally {
      setIsRunningOrgKeyAction(false);
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

      if (data?.kaixu_token?.token) {
        setApiAccessToken(String(data.kaixu_token.token));
        setApiTokenEmail(String(data.kaixu_token.locked_email || inviteAcceptEmail.trim().toLowerCase()));
        setPinUnlockedAt(new Date().toISOString());
      } else {
        const ensured = await ensureOnboardingKey({ labelPrefix: "invite-auto" });
        if (!ensured.ok) {
          setInviteAcceptResult(`Invite accepted, but key mint failed: ${ensured.error}`);
          return;
        }
      }

      applyOrgDashboardPayload(data);

      setInviteAcceptResult("Invite accepted. You are signed in and joined to the organization.");
      const next = new URL(window.location.href);
      next.searchParams.delete("invite_token");
      window.history.replaceState({}, "", next.toString());
      await refreshAuthSession();
      await loadTeamMembers();
      await loadOrgKeyPolicy();
    } catch (error: any) {
      setInviteAcceptResult(error?.message || "accept failed");
    } finally {
      setIsAcceptingInvite(false);
    }
  }

  useEffect(() => {
    if (selectedSkyeApp !== "SkyeAdmin") return;
    if (!hasActiveAuthSession) return;
    void loadTeamMembers();
    void loadOrgKeyPolicy();
  }, [selectedSkyeApp, hasActiveAuthSession]);

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
      setShareResult(
        `shared ${data?.workspace?.name || workspaceId} via ${data?.mode || shareMode}` +
          `${data?.chat_record_id ? ` · chat_record_id=${data.chat_record_id}` : ""}` +
          `${data?.mail_provider_id ? ` · mail_provider_id=${data.mail_provider_id}` : ""}`
      );
      if (shareMode === "mail" || shareMode === "all") await loadSkyeMailHistory();
      if (shareMode === "chat" || shareMode === "all") await loadSkyeChatHistory();
      if (shareMode === "chat" || shareMode === "all") {
        routeCrossAppFocus("SkyeChat", {
          channel: shareChannel,
          note: `Project share posted to #${shareChannel || "general"}.`,
        });
      } else if (shareMode === "mail") {
        routeCrossAppFocus("SkyeMail", {
          note: `Project share delivered to ${shareRecipientEmail || "recipient"}.`,
        });
      }
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
      if (!skyePassphrase.trim() || skyePassphrase.trim().length < 6) {
        setSuiteSyncResult("Secure .skye export requires a passphrase with at least 6 characters.");
        return;
      }

      const envelopeBase = {
        format: "skye-secure-v1" as const,
        encrypted: true as const,
        alg: "AES-256-GCM" as const,
        kdf: "PBKDF2-SHA256" as const,
        iterations: 150000 as const,
        app: selectedSkyeApp,
        ws_id: workspaceId,
        exported_at: new Date().toISOString(),
      };
      const payloadString = JSON.stringify(currentAppPayload());
      const encrypted = await encryptSkyePayload(payloadString, skyePassphrase.trim());
      const envelope: SkyeSecureEnvelope = {
        ...envelopeBase,
        hint: "",
        payload: {
          primary: encrypted,
        },
      };

      const blob = encodeSecureSkyeEnvelope(envelope);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selectedSkyeApp}-${Date.now()}.skye`;
      a.click();
      URL.revokeObjectURL(url);
      setSuiteSyncResult(`Exported ${selectedSkyeApp} as .skye`);
      pushCommandFeed(
        "Suite Sync",
        sknoreBlockedFiles.length
          ? `Secure .skye exported for ${selectedSkyeApp}. SKNore is still shielding ${sknoreBlockedFiles.length} workspace files from AI flows.`
          : `Secure .skye exported for ${selectedSkyeApp}.`,
        "ok",
        selectedSkyeApp,
        sknoreBlockedFiles.length
          ? {
              kind: "show-file-list",
              title: `SKNore blocked ${sknoreBlockedFiles.length} files`,
              description: "Protected files remain outside AI context even after export.",
              paths: sknoreBlockedFiles,
            }
          : undefined,
        sknoreBlockedFiles.length ? `${sknoreBlockedFiles.length} protected` : "exported"
      );
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
      let payloadString = "";
      const secureEnvelope = await tryReadSecureSkyeEnvelope(file);
      if (secureEnvelope) {
        if (!skyePassphrase.trim()) {
          setSuiteSyncResult("This .skye package is encrypted. Enter passphrase and import again.");
          return;
        }
        payloadString = await decryptSkyePayload(
          String(secureEnvelope.payload.primary.cipher || ""),
          String(secureEnvelope.payload.primary.iv || ""),
          String(secureEnvelope.payload.primary.salt || ""),
          skyePassphrase.trim()
        );
        const payload = tryParseJson(payloadString) as Record<string, any>;
        applyImportedAppPayload(secureEnvelope.app, payload);
        setSuiteSyncResult(`Imported .skye package for ${secureEnvelope.app}`);
        setSelectedSkyeApp(secureEnvelope.app);
      } else {
        const text = await file.text();
        const legacyEnvelope = tryParseJson(text) as LegacySkyeEnvelope;
        if (!legacyEnvelope || legacyEnvelope.format !== "skye-v2" || !legacyEnvelope.app) {
          setSuiteSyncResult("Invalid .skye package format.");
          return;
        }
        if (!legacyEnvelope.encrypted) {
          setSuiteSyncResult("Legacy unencrypted .skye packages are blocked. Export/import secure encrypted .skye only.");
          return;
        }
        if (legacyEnvelope.encrypted) {
          if (!skyePassphrase.trim()) {
            setSuiteSyncResult("This legacy .skye package is encrypted. Enter passphrase and import again.");
            return;
          }
          payloadString = await decryptSkyePayload(
            String(legacyEnvelope.cipher || ""),
            String(legacyEnvelope.iv || ""),
            String(legacyEnvelope.salt || ""),
            skyePassphrase.trim()
          );
        }

        const payload = tryParseJson(payloadString) as Record<string, any>;
        applyImportedAppPayload(legacyEnvelope.app, payload);
        setSuiteSyncResult(`Imported legacy .skye package for ${legacyEnvelope.app}`);
        setSelectedSkyeApp(legacyEnvelope.app);
      }
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
      emitAppBridge({
        kind: "action",
        source: appId,
        appId: effectiveMode === "all" ? "SkyeMail" : "SkyeChat",
        tone: "ok",
        detail: `${appId} shared through ${effectiveMode}.`,
      });
    } catch (error: any) {
      setShareResult(error?.message || "share failed");
    } finally {
      setIsSharingProject(false);
    }
  }

  async function loadOpsWorkspaceModels() {
    if (!workspaceId.trim()) return;
    try {
      const apps = ["SkyeCalendar", "SkyeDrive", "SkyeVault", "SkyeForms", "SkyeNotes"] as const;
      const responses = await Promise.all(
        apps.map((app) => {
          const qs = new URLSearchParams();
          qs.set("ws_id", workspaceId.trim());
          qs.set("app", app);
          qs.set("limit", "1");
          return fetch(`/api/app-record-list?${qs.toString()}`, { method: "GET" });
        })
      );
      const payloads = await Promise.all(responses.map((res) => res.json()));

      const [calendarData, driveData, vaultData, formsData, notesData] = payloads;

      if (responses[0].ok && Array.isArray(calendarData?.records) && calendarData.records.length) {
        const payload = asObject(calendarData.records[0].payload);
        if (Array.isArray(payload.events)) setCalendarEvents(payload.events as CalendarEvent[]);
      }
      if (responses[1].ok && Array.isArray(driveData?.records) && driveData.records.length) {
        const payload = asObject(driveData.records[0].payload);
        if (Array.isArray(payload.assets)) setDriveAssets(payload.assets as DriveAsset[]);
      }
      if (responses[2].ok && Array.isArray(vaultData?.records) && vaultData.records.length) {
        const payload = asObject(vaultData.records[0].payload);
        if (Array.isArray(payload.secrets)) setVaultSecrets(payload.secrets as VaultSecret[]);
      }
      if (responses[3].ok && Array.isArray(formsData?.records) && formsData.records.length) {
        const payload = asObject(formsData.records[0].payload);
        if (Array.isArray(payload.questions)) setFormQuestions(payload.questions as FormQuestion[]);
      }
      if (responses[4].ok && Array.isArray(notesData?.records) && notesData.records.length) {
        const payload = asObject(notesData.records[0].payload);
        if (Array.isArray(payload.notes)) setNotesModel(payload.notes as NoteItem[]);
      }
    } catch {
    } finally {
      setCalendarHydrated(true);
      setDriveHydrated(true);
      setVaultHydrated(true);
      setFormsHydrated(true);
      setNotesHydrated(true);
    }
  }

  async function saveOpsWorkspaceModel(
    app: "SkyeCalendar" | "SkyeDrive" | "SkyeVault" | "SkyeForms" | "SkyeNotes",
    model: Record<string, unknown>,
    title: string
  ) {
    if (!workspaceId.trim()) return;
    try {
      await fetch("/api/app-record-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ws_id: workspaceId.trim(),
          app,
          title,
          model,
        }),
      });
    } catch {
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

  function applyWorkbenchStarter(presetId: WorkbenchStarterPresetId) {
    const preset = WORKBENCH_STARTER_PRESETS.find((entry) => entry.id === presetId);
    if (!preset) return;
    setAppMode("skyeide");
    setSelectedSkyeApp(preset.focusApp);
    setTopWorkspaceApp(preset.top);
    setMiddleWorkspaceApp(preset.middle);
    setBottomWorkspaceApp(preset.bottom);
    setLeftMiddleDockApp(preset.leftMiddle);
    setLeftBottomDockApp(preset.leftDock);
    setRightTopDockApp(preset.rightTop);
    setRightMiddleDockApp(preset.rightMiddle);
    setRightBottomDockApp(preset.rightBottom);
    setIdeRailTab(preset.rail);
  }

  function beginResize(kind: ResizeKind, event: any) {
    const pointerId = typeof event?.pointerId === "number" ? event.pointerId : null;
    const target = event?.currentTarget as HTMLElement | null;
    event?.preventDefault?.();

    const startX = Number(event?.clientX || 0);
    const startY = Number(event?.clientY || 0);
    resizeStateRef.current = {
      kind,
      pointerId,
      startX,
      startY,
      sidebarWidth: workspaceSidebarWidth,
      rightPanelWidth: workspaceRightPanelWidth,
      ideSplitRatio,
    };

    const body = document.body;
    body.classList.add("is-resizing");
    body.setAttribute("data-resize-kind", kind);
    target?.classList.add("is-active");

    if (target && pointerId !== null && typeof target.setPointerCapture === "function") {
      try {
        target.setPointerCapture(pointerId);
      } catch {
        // Ignore capture failures and keep global listeners as fallback.
      }
    }

    const handleMove = (moveEvent: PointerEvent) => {
      const state = resizeStateRef.current;
      if (!state) return;
      if (state.pointerId !== null && moveEvent.pointerId !== state.pointerId) return;
      moveEvent.preventDefault();

      if (state.kind === "sidebar") {
        const delta = moveEvent.clientX - state.startX;
        const max = Math.max(460, Math.floor(window.innerWidth * 0.62));
        const next = Math.min(max, Math.max(300, state.sidebarWidth + delta));
        setWorkspaceSidebarWidth(next);
        return;
      }

      if (state.kind === "rightpanel") {
        const delta = state.startX - moveEvent.clientX;
        const max = Math.max(420, Math.floor(window.innerWidth * 0.45));
        const next = Math.min(max, Math.max(300, state.rightPanelWidth + delta));
        setWorkspaceRightPanelWidth(next);
        return;
      }

      const splitWidth = ideSplitRef.current?.getBoundingClientRect().width || 0;
      if (splitWidth <= 0) return;
      const delta = moveEvent.clientX - state.startX;
      const ratioDelta = (delta / splitWidth) * 100;
      const next = Math.min(75, Math.max(25, state.ideSplitRatio + ratioDelta));
      setIdeSplitRatio(next);
    };

    let cleanedUp = false;
    const handleUp = (upEvent?: PointerEvent | Event) => {
      const state = resizeStateRef.current;
      const activePointerId = state?.pointerId ?? null;
      if (upEvent instanceof PointerEvent && activePointerId !== null && upEvent.pointerId !== activePointerId) return;
      if (cleanedUp) return;
      cleanedUp = true;

      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
      window.removeEventListener("blur", handleUp);
      target?.removeEventListener("lostpointercapture", handleUp);

      if (target && activePointerId !== null && typeof target.releasePointerCapture === "function") {
        try {
          if (target.hasPointerCapture(activePointerId)) {
            target.releasePointerCapture(activePointerId);
          }
        } catch {
          // Ignore release failures during teardown.
        }
      }

      body.classList.remove("is-resizing");
      body.removeAttribute("data-resize-kind");
      target?.classList.remove("is-active");
      resizeStateRef.current = null;
    };

    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    window.addEventListener("blur", handleUp);
    target?.addEventListener("lostpointercapture", handleUp);
  }

  function workspaceStageLabel(app: WorkspaceStageApp): string {
    if (app === "Neural-Space-Pro") return "Neural-Space-Pro";
    return app;
  }

  function workspaceStageUrl(app: WorkspaceStageApp): string {
    if (app === "Neural-Space-Pro") {
      const qs = new URLSearchParams();
      qs.set("embed", "1");
      qs.set("ws_id", workspaceId || DEFAULT_WS_ID);
      return `/Neural-Space-Pro/index.html?${qs.toString()}`;
    }
    const base = buildAppSurfaceUrl(app, workspaceId) || "/";
    if (app === "Smokehouse-Standalone") {
      const join = base.includes("?") ? "&" : "?";
      return `${base}${join}auto_smoke=1&smoke_interval_ms=45000`;
    }
    return base;
  }

  function renderTutorialPanel(appId: SkyeAppId) {
    const steps = APP_TUTORIALS[appId] || [];
    const completed = steps.filter((step) => tutorialChecks[makeTutorialKey(appId, step)]).length;
    const standaloneUrl = buildStandaloneAppUrl(appId, workspaceId);
    const nextUnchecked = steps.find((step) => !tutorialChecks[makeTutorialKey(appId, step)]);
    const appSummary = SKYE_APPS.find((app) => app.id === appId)?.summary || `${appId} launch guide`;
    const guideCards = buildTutorialGuideCards(appId, steps, nextUnchecked, standaloneUrl);
    return (
      <div className="tutorial-overlay" onClick={() => setShowTutorialPanel(false)}>
        <section className="tutorial-dialog" onClick={(event) => event.stopPropagation()}>
          <header>
            <h2>{appId} Guided Launch</h2>
            <p>{appSummary}</p>
          </header>
          <div className="tool-actions left">
            <button className="ghost" type="button" onClick={() => setShowTutorialPanel(false)}>Close Tutorial</button>
            <button className="ghost" type="button" onClick={() => openAuthCenterWindow({ focus: true, guide: true })}>Launch Guided Onboarding</button>
            {standaloneUrl ? <a className="ghost" href={standaloneUrl} target="_blank" rel="noreferrer">Open Standalone</a> : null}
            <a className="ghost" href="https://skyesol.netlify.app/kaixu/requestkaixuapikey" target="_blank" rel="noreferrer">Request kAIxU Key</a>
            <button className="ghost" type="button" onClick={exportAppHealthSnapshot}>Export Health Snapshot</button>
          </div>
          <section className="auth-session-feedback" style={{ marginBottom: 14 }}>
            <strong>Operator Route</strong>
            <div>Progress: {completed}/{steps.length || 1} complete</div>
            <div>Next step: {nextUnchecked || "Checklist complete. Validate one live handoff before closing this guide."}</div>
            <div>Access path: {hasApiKeyLoaded ? "kAIxU key loaded for this browser origin." : "Key missing. Use Guided Onboarding or the request link before cross-app work."}</div>
            <div className="tool-actions left" style={{ marginTop: 8 }}>
              <button className="ghost" type="button" onClick={() => routeCrossAppFocus("AE-Flow", { note: `${appId} handoff into AE-Flow.` })}>Open AE-Flow</button>
              <button className="ghost" type="button" onClick={() => routeCrossAppFocus("GoogleBusinessProfileRescuePlatform", { note: `${appId} handoff into GBP Rescue.` })}>Open GBP Rescue</button>
              <button className="ghost" type="button" onClick={() => window.open(`/ContractorNetwork/index.html?ws_id=${encodeURIComponent(workspaceId)}`, "_blank", "noopener,noreferrer")}>Open ContractorNetwork</button>
              <button className="ghost" type="button" onClick={() => setAppMode("neural")}>Open Neural Space Pro</button>
            </div>
          </section>
          <section className="onboarding-guide-grid" style={{ marginBottom: 14 }}>
            {guideCards.map((card, index) => (
              <article key={`${appId}-guide-${card.title}`} className="onboarding-step-card tutorial-route-card">
                <div className="onboarding-step-index">{index + 1}</div>
                <h3>{card.title}</h3>
                <p>{card.detail}</p>
                <div className="tool-actions left">
                  <button className="ghost" type="button" onClick={card.run}>{card.label}</button>
                </div>
              </article>
            ))}
          </section>
          <section className="auth-session-feedback" style={{ marginBottom: 14 }}>
            <strong>Live checklist</strong>
            <div>Use the route cards above to drive the flow, then mark off the checklist below as each live interaction is actually verified.</div>
          </section>
          <div className="tool-actions left" style={{ marginBottom: 10 }}>
            <button className="ghost" type="button" onClick={resetSelectedAppDemoState}>Reset App Demo State</button>
          </div>
          <div className="list-stack">
          {steps.map((step) => {
            const checked = Boolean(tutorialChecks[makeTutorialKey(appId, step)]);
            return (
              <label key={`${appId}-${step}`} className="list-item tutorial-step">
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
      </div>
    );
  }

  function renderAppModule() {
    if (selectedSkyeApp === "SkyeDocs") {
      return (
        <section className="app-module">
          <header><h2>SkyeDocs</h2><p>Code editing is now anchored in the IDE Workspace panel so every app keeps direct IDE access.</p></header>
          <p className="muted-copy">Use the IDE Workspace panel for Monaco editing, workspace save/load, GitHub push, and Netlify deploy actions.</p>
        </section>
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

    if (
      selectedSkyeApp === "SkyDex4.6" ||
      selectedSkyeApp === "REACT2HTML" ||
      selectedSkyeApp === "SKYEMAIL-GEN" ||
      selectedSkyeApp === "Skye-ID" ||
      selectedSkyeApp === "SkyeBookx" ||
      selectedSkyeApp === "SkyePlatinum"
    ) {
      const surfacePath = APP_SURFACE_PATHS[selectedSkyeApp] || "/";
      const surfaceHref = `${surfacePath}?ws_id=${encodeURIComponent(workspaceId)}`;
      return (
        <section className="app-module" style={{ minHeight: "84vh" }}>
          <header>
            <h2>{selectedSkyeApp}</h2>
            <p>Featured utility surface with standalone deployment + embedded command deck access inside SuperIDE.</p>
          </header>
          <div className="tool-actions left" style={{ marginBottom: 10 }}>
            <a className="ghost" href={surfaceHref} target="_blank" rel="noreferrer">Open Standalone</a>
            <button className="ghost" type="button" onClick={() => setSelectedSkyeApp("SkyeAdmin")}>Open Key Control (SkyeAdmin)</button>
          </div>
          <iframe
            title={selectedSkyeApp}
            src={surfaceHref}
            className="platform-frame"
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
          <div className="tool-actions left">
            <a className="ghost" href={`/SkyeTasks/index.html?ws_id=${encodeURIComponent(workspaceId)}`} target="_blank" rel="noreferrer">Open Standalone</a>
          </div>
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
        <section className="app-module platform-shell" style={{ minHeight: "84vh" }}>
          <header>
            <h2>SkyeMail Platform</h2>
            <p>Dedicated standalone mail workspace integrated into IDE. Users can create accounts, set mailbox profile, send mail, and work from inbox surface.</p>
            <p className="muted-copy">Delivery path: outbound email now supports SMTP (Gmail-compatible) with fallback to Resend. Inbox stream unifies outbound + inbound records.</p>
            <p className="muted-copy">Inbound bridge endpoint: <code>/api/skymail-inbound-ingest</code> (secured via <code>MAIL_INGEST_SECRET</code>).</p>
          </header>
          <div className="tool-actions left" style={{ marginBottom: 10 }}>
            <a className="ghost" href={`/SkyeMail/index.html?ws_id=${encodeURIComponent(workspaceId)}`} target="_blank" rel="noreferrer">Open SkyeMail Standalone</a>
            <button className="ghost" type="button" onClick={() => setSelectedSkyeApp("SkyeChat")}>Go To SkyeChat</button>
            <button className="ghost" type="button" onClick={() => setSelectedSkyeApp("SkyeDocs")}>Return To IDE Workspace</button>
          </div>
          <iframe
            title="SkyeMail Workspace"
            src={`/SkyeMail/index.html?embed=1&ws_id=${encodeURIComponent(workspaceId)}`}
            className="platform-frame"
          />
        </section>
      );
    }

    if (selectedSkyeApp === "AE-Flow") {
      return (
        <section className="app-module platform-shell" style={{ minHeight: "84vh" }}>
          <header>
            <h2>AE-Flow Platform</h2>
            <p>Embedded CRM platform system inside SuperIDE with shared workspace context and command-deck positioning.</p>
            <p className="muted-copy">This remains treated as a platform, not an isolated app, so operators can move directly into SkyeChat, SkyeMail, and Neural Space Pro from the same workspace lane.</p>
          </header>
          <div className="tool-actions left" style={{ marginBottom: 10 }}>
            <a className="ghost" href={`/AE-Flow/index.html?ws_id=${encodeURIComponent(workspaceId)}`} target="_blank" rel="noreferrer">Open AE-Flow Standalone</a>
            <button className="ghost" type="button" onClick={() => setSelectedSkyeApp("SkyeChat")}>Route To SkyeChat</button>
            <button className="ghost" type="button" onClick={() => setAppMode("neural")}>Open Neural Space Pro</button>
            <button className="ghost" type="button" onClick={() => setSelectedSkyeApp("SkyeDocs")}>Return To IDE Workspace</button>
          </div>
          <iframe
            title="AE-Flow Platform"
            src={`/AE-Flow/index.html?embed=1&ws_id=${encodeURIComponent(workspaceId)}`}
            className="platform-frame"
          />
        </section>
      );
    }

    if (selectedSkyeApp === "GoogleBusinessProfileRescuePlatform") {
      return (
        <section className="app-module platform-shell" style={{ minHeight: "84vh" }}>
          <header>
            <h2>Google Business Rescue Platform</h2>
            <p>Embedded rescue operations platform positioned as a full system for diagnostics, evidence prep, and reinstatement execution inside the command deck.</p>
            <p className="muted-copy">The deeper source workspace is staged in-repo; this live capsule keeps the platform visible and integrated inside SuperIDE right now.</p>
          </header>
          <div className="tool-actions left" style={{ marginBottom: 10 }}>
            <a className="ghost" href={`/GoogleBusinessProfileRescuePlatform/index.html?ws_id=${encodeURIComponent(workspaceId)}`} target="_blank" rel="noreferrer">Open Rescue Platform Capsule</a>
            <button className="ghost" type="button" onClick={() => setSelectedSkyeApp("SkyeChat")}>Route To SkyeChat</button>
            <button className="ghost" type="button" onClick={() => setSelectedSkyeApp("SkyeMail")}>Route To SkyeMail</button>
            <button className="ghost" type="button" onClick={() => setAppMode("neural")}>Open Neural Space Pro</button>
          </div>
          <iframe
            title="Google Business Rescue Platform"
            src={`/GoogleBusinessProfileRescuePlatform/index.html?embed=1&ws_id=${encodeURIComponent(workspaceId)}`}
            className="platform-frame"
          />
        </section>
      );
    }

    if (selectedSkyeApp === "SkyeChat") {
      return (
        <section className="app-module platform-shell" style={{ minHeight: "84vh" }}>
          <header>
            <h2>SkyeChat Platform</h2>
            <p>Dedicated standalone chat workspace integrated into IDE with room feed, identity profile, and kAIxU threaded responses.</p>
          </header>
          <div className="tool-actions left" style={{ marginBottom: 10 }}>
            <button className="ghost" type="button" onClick={applyNeuralRoomDefaultsToChat}>Use Neural Room Defaults</button>
            <button className="ghost" type="button" onClick={() => setAppMode("neural")}>Open Neural Space Pro</button>
            <a className="ghost" href={`/SkyeChat/index.html?ws_id=${encodeURIComponent(workspaceId)}`} target="_blank" rel="noreferrer">Open SkyeChat Standalone</a>
            <button className="ghost" type="button" onClick={() => setSelectedSkyeApp("SkyeDocs")}>Return To IDE Workspace</button>
          </div>
          <iframe
            title="SkyeChat Workspace"
            src={`/SkyeChat/index.html?embed=1&ws_id=${encodeURIComponent(workspaceId)}&channel=${encodeURIComponent(chatHistoryChannel || chatChannelInput || "general")}`}
            className="platform-frame"
          />
          <div className="neural-fusion-stack">
            <h3>Neural Space Layer</h3>
            <p className="muted-copy">Neural Space Pro is embedded directly in the SkyeChat workflow for parallel room collaboration + kAIxU context.</p>
            <iframe title="Neural Space in SkyeChat" src="/Neural-Space-Pro/index.html" className="platform-frame" />
          </div>
        </section>
      );
    }

    if (selectedSkyeApp === "SkyeCalendar") {
      const filtered = calendarEvents.filter((item) =>
        `${item.title} ${item.owner} ${item.notes}`.toLowerCase().includes((appSearch || "").toLowerCase())
      );
      const [year, month] = calendarViewMonth.split("-").map((n) => Number(n));
      const first = new Date(year, Math.max(0, month - 1), 1);
      const startPad = first.getDay();
      const daysInMonth = new Date(year, Math.max(1, month), 0).getDate();
      const dayCells = Array.from({ length: startPad + daysInMonth }, (_, i) => (i < startPad ? 0 : i - startPad + 1));
      const eventsByDay = new Map<number, CalendarEvent[]>();
      for (const evt of filtered) {
        const dt = new Date(`${evt.start_date}T00:00:00`);
        if (dt.getFullYear() === year && dt.getMonth() === month - 1) {
          const day = dt.getDate();
          const list = eventsByDay.get(day) || [];
          list.push(evt);
          eventsByDay.set(day, list);
        }
      }
      return (
        <section className="app-module">
          <header><h2>SkyeCalendar</h2><p>Real month-view calendar with event cards and automatic SkyeTasks due-date integration.</p></header>
          <div className="tool-actions left">
            <a className="ghost" href={`/SkyeCalendar/index.html?ws_id=${encodeURIComponent(workspaceId)}`} target="_blank" rel="noreferrer">Open Standalone</a>
            <button className="ghost" type="button" onClick={() => setCalendarViewMonth(new Date().toISOString().slice(0, 7))}>Today</button>
          </div>
          <div className="tool-row split">
            <input value={calendarDraftTitle} onChange={(e) => setCalendarDraftTitle(e.target.value)} placeholder="Event title" />
            <input type="date" value={calendarDraftStart} onChange={(e) => setCalendarDraftStart(e.target.value)} />
          </div>
          <div className="tool-row split">
            <input type="date" value={calendarDraftEnd} onChange={(e) => setCalendarDraftEnd(e.target.value)} />
            <input type="month" value={calendarViewMonth} onChange={(e) => setCalendarViewMonth(e.target.value)} />
          </div>
          <div className="calendar-grid">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={`h-${d}`} className="calendar-head">{d}</div>
            ))}
            {dayCells.map((day, idx) => {
              if (!day) return <div key={`blank-${idx}`} className="calendar-cell blank" />;
              const dayEvents = eventsByDay.get(day) || [];
              return (
                <div key={`day-${day}`} className="calendar-cell">
                  <div className="calendar-day">{day}</div>
                  {dayEvents.slice(0, 3).map((evt) => (
                    <div key={evt.id} className={`calendar-pill ${evt.status}`}>{evt.title}</div>
                  ))}
                  {dayEvents.length > 3 && <div className="calendar-more">+{dayEvents.length - 3} more</div>}
                </div>
              );
            })}
          </div>
          <div className="tool-actions left">
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
          <header><h2>SkyeDrive</h2><p>Shared asset plane for the whole command deck. Drop files anywhere in the shell and they land here.</p></header>
          <div className="tool-actions left">
            <a className="ghost" href={`/SkyeDrive/index.html?ws_id=${encodeURIComponent(workspaceId)}`} target="_blank" rel="noreferrer">Open Standalone</a>
          </div>
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
                <div className="muted-copy">path={asset.relative_path || asset.name} · source={asset.source_app || "manual"}</div>
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
          <div className="tool-actions left">
            <a className="ghost" href={`/SkyeVault/index.html?ws_id=${encodeURIComponent(workspaceId)}`} target="_blank" rel="noreferrer">Open Standalone</a>
          </div>
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
          <div className="tool-actions left">
            <a className="ghost" href={`/SkyeForms/index.html?ws_id=${encodeURIComponent(workspaceId)}`} target="_blank" rel="noreferrer">Open Standalone</a>
          </div>
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
          <div className="tool-actions left">
            <a className="ghost" href={`/SkyeNotes/index.html?ws_id=${encodeURIComponent(workspaceId)}`} target="_blank" rel="noreferrer">Open Standalone</a>
          </div>
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
      const keyAssignments = orgKeyPolicy?.assignments || [];
      const currentUserKeyAssignment = keyAssignments.find((entry) => entry.email.toLowerCase() === authUser.trim().toLowerCase()) || null;
      const orgKpis = [
        ["Plan", orgSeatSummary?.plan_tier || "unknown"],
        ["Seats Reserved", String(orgSeatSummary?.seats_reserved ?? 0)],
        ["Seats Available", orgSeatSummary?.seat_limit == null ? "unlimited" : String(orgSeatSummary?.seats_available ?? 0)],
        ["Primary Workspace", primaryWorkspace?.name || primaryWorkspace?.id || "pending"],
      ];
      return (
        <section className="app-module">
          <header><h2>SkyeAdmin</h2><p>Org user and role controls.</p></header>

          <div className="kpi-grid">
            {orgKpis.map(([label, value]) => (
              <article key={label} className="kpi-card">
                <div>{label}</div>
                <strong>{value}</strong>
              </article>
            ))}
          </div>

          <div className="list-stack">
            <div className="list-item">
              <strong>{orgSeatSummary?.org_name || authOrgName || "Organization"}</strong>
              <div className="muted-copy">workspace_id={primaryWorkspace?.id || workspaceId || "pending"}</div>
              <div className="muted-copy">
                members={orgSeatSummary?.active_members ?? adminUsers.length} · pending_invites={orgSeatSummary?.pending_invites ?? 0} · personal_overrides={orgSeatSummary?.allow_personal_key_override ? "enabled" : "disabled"}
              </div>
            </div>
          </div>

          <section className="neural-room-bridge">
            <h3>Workspace Tour + Platform Wiring</h3>
            <p className="muted-copy">Use the guided onboarding flow, workspace presets, and platform jumps to turn the command deck into the user's default operating system during setup.</p>
            <div className="tool-actions left">
              <button className="ghost" type="button" onClick={() => openAuthCenterWindow({ focus: true, guide: true })}>Launch Guided Onboarding</button>
              <button className="ghost" type="button" onClick={() => setShowTutorialPanel(true)}>Open Guided Checklist</button>
              <button className="ghost" type="button" onClick={() => setSelectedSkyeApp("AE-Flow")}>Open AE-Flow Platform</button>
              <button className="ghost" type="button" onClick={() => setSelectedSkyeApp("GoogleBusinessProfileRescuePlatform")}>Open GBP Rescue Platform</button>
            </div>
            <div className="starter-lane-list">
              {WORKBENCH_STARTER_PRESETS.map((preset) => (
                <button key={`skyeadmin-preset-${preset.id}`} type="button" className="starter-lane-button" onClick={() => applyWorkbenchStarter(preset.id)}>
                  <strong>{preset.label}</strong>
                  <span>{preset.description}</span>
                  <small>{preset.focusApp} focus</small>
                </button>
              ))}
            </div>
          </section>

          <section className="neural-room-bridge">
            <h3>Protected Admin Board</h3>
            <p className="muted-copy">Infrastructure controls, smokehouse, pricing, and company onboarding stay behind ADMIN_KEY even inside SkyeAdmin.</p>
            {!adminBoardUnlocked ? (
              <>
                <label htmlFor="skyeadmin-admin-key">Admin Board Key</label>
                <input
                  id="skyeadmin-admin-key"
                  type="password"
                  value={adminBoardKey}
                  onChange={(event) => setAdminBoardKey(event.target.value)}
                  placeholder="Enter ADMIN_KEY"
                />
                <div className="tool-actions left">
                  <button className="ghost" type="button" onClick={() => void verifyAdminBoardKey()} disabled={isAdminBoardVerifying}>
                    {isAdminBoardVerifying ? "Unlocking..." : "Unlock Admin Board"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="tool-actions left">
                  <button className="ghost" type="button" onClick={() => { setToolTab("smokehouse"); void runSmokehouseSuite("manual"); }}>Run Smokehouse</button>
                  <button className="ghost" type="button" onClick={() => setToolTab("playground")}>Open API Playground</button>
                  <button className="ghost" type="button" onClick={() => setSelectedSkyeApp("AE-Flow")}>AE-Flow</button>
                  <button className="ghost" type="button" onClick={() => setSelectedSkyeApp("GoogleBusinessProfileRescuePlatform")}>GBP Rescue</button>
                  <button className="ghost" type="button" onClick={() => openAuthCenterWindow({ focus: true, guide: true })}>Open Onboarding</button>
                  <a className="ghost" href="/pricing.html" target="_blank" rel="noreferrer">Pricing</a>
                  <button className="ghost" type="button" onClick={lockAdminBoard}>Lock Admin Board</button>
                </div>
                <label>Neural Space Pro Embed Snippet</label>
                <textarea className="report-box" rows={4} readOnly value={neuralEmbedSnippet} />
                <div className="tool-actions left">
                  <button className="ghost" type="button" onClick={() => void copyAdminBoardText(neuralEmbedSnippet, "Neural Space Pro embed snippet copied.")}>Copy Embed Snippet</button>
                </div>
              </>
            )}
            {adminBoardResult ? <p className="muted-copy">{adminBoardResult}</p> : null}
          </section>

          <label>kAIxU Access Key (Bearer)</label>
          <textarea
            className="report-box"
            rows={3}
            value={apiAccessToken}
            onChange={(event) => setApiAccessToken(event.target.value)}
            placeholder="kx_at_..."
          />
          <label>Key Lock Email (X-Token-Email)</label>
          <input
            value={apiTokenEmail}
            onChange={(event) => setApiTokenEmail(event.target.value)}
            placeholder="user@company.com"
          />
          <div className="tool-actions left">
            <button className="ghost" type="button" onClick={() => void checkAssistantAuth()}>Validate Auth Path</button>
            <button className="ghost" type="button" onClick={() => { setApiAccessToken(""); setAssistantAuthStatus("unknown"); }}>Clear Key</button>
          </div>
          <p className="muted-copy">Only kAIxU keys are supported here. Assistant and API Playground auto-apply this key and `X-Token-Email` when present.</p>

          <label>Issue kAIxU Key Label Prefix</label>
          <input value={tokenLabelPrefix} onChange={(event) => setTokenLabelPrefix(event.target.value)} placeholder="ide-key" />
          <div className="tool-row split">
            <div>
              <label>TTL Preset</label>
              <select value={tokenTtlPreset} onChange={(event) => setTokenTtlPreset(event.target.value)}>
                <option value="test_2m">test_2m</option>
                <option value="1h">1h</option>
                <option value="5h">5h</option>
                <option value="day">day</option>
                <option value="week">week</option>
                <option value="month">month</option>
                <option value="quarter">quarter</option>
                <option value="year">year</option>
              </select>
            </div>
            <div>
              <label>Scope</label>
              <input value="generate (fixed)" readOnly />
            </div>
          </div>
          <div className="tool-actions left">
            <button className="ghost" type="button" onClick={() => void issueAccessToken()} disabled={isIssuingTesterToken}>
              {isIssuingTesterToken ? "Issuing..." : "Issue kAIxU Key"}
            </button>
            <button className="ghost" type="button" onClick={() => void loadTokenInventory()} disabled={isLoadingTokenInventory}>
              {isLoadingTokenInventory ? "Refreshing..." : "Refresh kAIxU Key Inventory"}
            </button>
            <button className="ghost" type="button" onClick={() => void loadOrgKeyPolicy()} disabled={isLoadingOrgKeyPolicy}>
              {isLoadingOrgKeyPolicy ? "Syncing Policy..." : "Refresh Org Key Policy"}
            </button>
          </div>
          {tokenOpsResult && <p className="muted-copy">{tokenOpsResult}</p>}

          <label>Org Default Key Label Prefix</label>
          <input value={orgDefaultKeyLabelPrefix} onChange={(event) => setOrgDefaultKeyLabelPrefix(event.target.value)} placeholder="org-default" />
          <div className="tool-row split">
            <div>
              <label>Org Default TTL</label>
              <select value={orgDefaultKeyTtlPreset} onChange={(event) => setOrgDefaultKeyTtlPreset(event.target.value)}>
                <option value="1h">1h</option>
                <option value="day">day</option>
                <option value="week">week</option>
                <option value="month">month</option>
                <option value="quarter">quarter</option>
                <option value="year">year</option>
              </select>
            </div>
            <div>
              <label>Personal Override Policy</label>
              <input value={orgKeyPolicy?.allow_personal_key_override ? "enabled" : "disabled"} readOnly />
            </div>
          </div>
          <div className="tool-actions left">
            <button
              className="ghost"
              type="button"
              onClick={() => void runOrgKeyPolicyAction("issue_org_default_key", { label_prefix: orgDefaultKeyLabelPrefix, ttl_preset: orgDefaultKeyTtlPreset })}
              disabled={isRunningOrgKeyAction}
            >
              {isRunningOrgKeyAction ? "Working..." : "Issue Org Default Key"}
            </button>
            <button
              className="ghost"
              type="button"
              onClick={() => void runOrgKeyPolicyAction("clear_org_default_key")}
              disabled={isRunningOrgKeyAction || !orgKeyPolicy?.default_token}
            >
              Clear Org Default Key
            </button>
            <button
              className="ghost"
              type="button"
              onClick={() => void runOrgKeyPolicyAction("set_personal_override_policy", { allow_personal_key_override: !orgKeyPolicy?.allow_personal_key_override })}
              disabled={isRunningOrgKeyAction}
            >
              {orgKeyPolicy?.allow_personal_key_override ? "Disable Personal Overrides" : "Enable Personal Overrides"}
            </button>
            <button
              className="ghost"
              type="button"
              onClick={() => void runOrgKeyPolicyAction("issue_personal_override", { label_prefix: "personal-override", ttl_preset: "quarter" })}
              disabled={isRunningOrgKeyAction || !orgKeyPolicy?.allow_personal_key_override}
            >
              Issue My Personal Override
            </button>
            <button
              className="ghost"
              type="button"
              onClick={() => void runOrgKeyPolicyAction("clear_personal_override")}
              disabled={isRunningOrgKeyAction || !currentUserKeyAssignment?.personal_token}
            >
              Clear My Personal Override
            </button>
          </div>
          {orgKeyPolicy?.default_token && (
            <div className="list-stack">
              <div className="list-item">
                <strong>Org Default Key</strong>
                <div className="muted-copy">label={orgKeyPolicy.default_token.label} · prefix={orgKeyPolicy.default_token.prefix}</div>
                <div className="muted-copy">locked_email={orgKeyPolicy.default_token.locked_email || "<none>"} · expires={orgKeyPolicy.default_token.expires_at || "n/a"}</div>
              </div>
            </div>
          )}

          <label>Assign Member-Specific Key</label>
          <input value={assignedKeyEmail} onChange={(event) => setAssignedKeyEmail(event.target.value)} placeholder="teammate@company.com" />
          <div className="tool-row split">
            <div>
              <label>Assigned Key Label Prefix</label>
              <input value={assignedKeyLabelPrefix} onChange={(event) => setAssignedKeyLabelPrefix(event.target.value)} placeholder="member-assigned" />
            </div>
            <div>
              <label>Assigned Key TTL</label>
              <select value={assignedKeyTtlPreset} onChange={(event) => setAssignedKeyTtlPreset(event.target.value)}>
                <option value="1h">1h</option>
                <option value="day">day</option>
                <option value="week">week</option>
                <option value="month">month</option>
                <option value="quarter">quarter</option>
                <option value="year">year</option>
              </select>
            </div>
          </div>
          <div className="tool-actions left">
            <button
              className="ghost"
              type="button"
              onClick={() => void runOrgKeyPolicyAction("issue_user_assignment", { target: assignedKeyEmail, label_prefix: assignedKeyLabelPrefix, ttl_preset: assignedKeyTtlPreset })}
              disabled={isRunningOrgKeyAction || !assignedKeyEmail.trim()}
            >
              Issue Assigned User Key
            </button>
            <button
              className="ghost"
              type="button"
              onClick={() => void runOrgKeyPolicyAction("clear_user_assignment", { target: assignedKeyEmail })}
              disabled={isRunningOrgKeyAction || !assignedKeyEmail.trim()}
            >
              Clear Assigned User Key
            </button>
          </div>

          {orgKeyActionResult && <p className="muted-copy">{orgKeyActionResult}</p>}
          {orgKeyIssuedMeta && <p className="muted-copy">{orgKeyIssuedMeta}</p>}
          {orgKeyIssuedToken && (
            <>
              <label>Issued Org Key (shown once, save it now)</label>
              <textarea className="report-box" readOnly value={orgKeyIssuedToken} rows={4} />
            </>
          )}

          <div className="list-stack">
            {keyAssignments.map((assignment) => (
              <div key={`org-key-${assignment.user_id}`} className="list-item">
                <div className="admin-row">
                  <strong>{assignment.email}</strong>
                  <span>{assignment.effective_source}</span>
                </div>
                <div className="muted-copy">effective={assignment.effective_token?.label || "<none>"} · locked={assignment.effective_token?.locked_email || "<none>"}</div>
                <div className="muted-copy">assigned={assignment.assigned_token?.label || "<none>"} · personal={assignment.personal_token?.label || "<none>"}</div>
              </div>
            ))}
            {!keyAssignments.length && <div className="command-feed-empty">No org key assignments loaded yet.</div>}
          </div>
          <div className="list-stack">
            {tokenInventory.map((token) => (
              <div key={token.id} className="list-item">
                <div className="admin-row">
                  <strong>{token.label || token.prefix}</strong>
                  <span>{token.status}</span>
                </div>
                <div className="muted-copy">id={token.id}</div>
                <div className="muted-copy">prefix={token.prefix} · locked={token.locked_email || "<none>"}</div>
                <div className="muted-copy">scopes={(Array.isArray(token.scopes_json) ? token.scopes_json : ["generate"]).join(", ")}</div>
                <div className="muted-copy">expires={token.expires_at || "n/a"} · last_used={token.last_used_at || "never"}</div>
                <div className="tool-actions left">
                  <button className="ghost" type="button" onClick={() => void revokeToken(token.id)} disabled={revokingTokenId === token.id || token.status === "revoked"}>
                    {revokingTokenId === token.id ? "Revoking..." : token.status === "revoked" ? "Revoked" : "Revoke"}
                  </button>
                </div>
              </div>
            ))}
          </div>

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
              {isIssuingTesterToken ? "Issuing..." : "Issue 2-Min Tester Key"}
            </button>
          </div>
          {testerTokenMeta && <p className="muted-copy">{testerTokenMeta}</p>}
          <label>Tester key (shown once, save it now)</label>
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
        ["Calendar Events", calendarEvents.length],
        ["Team Members", adminUsers.length],
      ];
      return (
        <section className="app-module">
          <header><h2>SkyeAnalytics</h2><p>Operational dashboard with live platform KPIs and execution telemetry.</p></header>
          <div className="tool-actions left">
            <a className="ghost" href={`/SkyeAnalytics/index.html?ws_id=${encodeURIComponent(workspaceId)}`} target="_blank" rel="noreferrer">Open Standalone</a>
          </div>
          <div className="kpi-grid">
            {kpis.map(([label, value]) => (
              <article key={label} className="kpi-card">
                <div>{label}</div>
                <strong>{value}</strong>
              </article>
            ))}
          </div>
          <div className="list-stack">
            {smokeResults.slice(-4).map((result) => (
              <div key={`an-${result.name}-${result.url}`} className="list-item">
                <strong>{result.name}</strong>
                <div>Status={result.status} · {result.ok ? "PASS" : "FAIL"}</div>
              </div>
            ))}
          </div>
        </section>
      );
    }

    const fallbackSurface = buildAppSurfaceUrl(selectedSkyeApp, workspaceId);
    if (fallbackSurface) {
      return (
        <section className="app-module">
          <header>
            <h2>{selectedSkyeApp}</h2>
            <p>Embedded standalone surface for this app is now loaded directly inside IDE.</p>
          </header>
          <div className="tool-actions left">
            <a className="ghost" href={fallbackSurface} target="_blank" rel="noreferrer">Open Standalone</a>
          </div>
          <iframe
            key={`${selectedSkyeApp}-${workspaceId}`}
            title={`${selectedSkyeApp} Embedded`}
            src={fallbackSurface}
            className="platform-frame"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads"
          />
        </section>
      );
    }

    return null;
  }

  const isSkyeDocsStackMode = appMode === "skyeide" && selectedSkyeApp === "SkyeDocs";
  const dockApps: DockApp[] = ["SkyeMail", "SkyeDrive", "SovereignVariables", "SkyeCalendar", "SkyeChat"];
  const standaloneIdeUrl = buildStandaloneAppUrl("SkyDex4.6", workspaceId) || "/SkyDex4.6/index.html";
  const leftMiddleDockUrl = buildAppSurfaceUrl(leftMiddleDockApp, workspaceId) || "/";
  const leftMiddleDockEmbedUrl = `${leftMiddleDockUrl}${leftMiddleDockUrl.includes("?") ? "&" : "?"}embed=1`;
  const leftBottomDockUrl = buildAppSurfaceUrl(leftBottomDockApp, workspaceId) || "/";
  const leftBottomDockEmbedUrl = `${leftBottomDockUrl}${leftBottomDockUrl.includes("?") ? "&" : "?"}embed=1`;
  const rightTopDockUrl = buildAppSurfaceUrl(rightTopDockApp, workspaceId) || "/";
  const rightTopDockEmbedUrl = `${rightTopDockUrl}${rightTopDockUrl.includes("?") ? "&" : "?"}embed=1`;
  const rightMiddleDockUrl = buildAppSurfaceUrl(rightMiddleDockApp, workspaceId) || "/";
  const rightMiddleDockEmbedUrl = `${rightMiddleDockUrl}${rightMiddleDockUrl.includes("?") ? "&" : "?"}embed=1`;
  const rightBottomDockUrl = buildAppSurfaceUrl(rightBottomDockApp, workspaceId) || "/";
  const rightBottomDockEmbedUrl = `${rightBottomDockUrl}${rightBottomDockUrl.includes("?") ? "&" : "?"}embed=1`;
  const publicSiteBase = (siteBaseUrl.trim() || window.location.origin).replace(/\/+$/, "");
  const neuralEmbedSnippet = `<iframe src="${publicSiteBase}/Neural-Space-Pro/index.html?embed=1&ws_id=${encodeURIComponent(workspaceId || DEFAULT_WS_ID)}" title="Neural Space Pro" width="100%" height="720" style="border:0;border-radius:24px;overflow:hidden" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;

  if (isAuthCenterMode) {
    return (
      <div className="ide-shell">
        <div className="shell-atmo" aria-hidden="true">
          <div className="atmo-grid" />
          <div className="atmo-orb orb-a" />
          <div className="atmo-orb orb-b" />
        </div>
        {hideCinematicIntro ? null : (
          <div className="cine-intro" aria-hidden="true">
            <div className="cine-grid" />
            <div className="cine-scan" />
            <div className="cine-terminal">
              &gt; BOOTING SKYEIDE COMMAND DECK v2.0<br />
              &gt; MOUNTING AUTH CENTER<br />
              &gt; SYNCING SESSION + KEY STATE
            </div>
            <div className="cine-whiteout" />
            <div className="cine-core">
              <img className="cine-logo" src="/SKYESOVERLONDONDIETYLOGO.png" alt="" />
              <div className="cine-title">AUTH CENTER</div>
              <div className="cine-sub">IDENTITY AND ACCESS ONLINE</div>
            </div>
          </div>
        )}
        {renderAuthCenterContents()}
      </div>
    );
  }

  return (
    <div className="ide-shell">
      <div className="shell-atmo" aria-hidden="true">
        <div className="atmo-grid" />
        <div className="atmo-orb orb-a" />
        <div className="atmo-orb orb-b" />
      </div>
      {!hideCinematicIntro && <div className="cine-intro" aria-hidden="true">
        <div className="cine-grid" />
        <div className="cine-scan" />
        <div className="cine-terminal">
          &gt; BOOTING SKYEIDE COMMAND DECK v2.0<br />
          &gt; MOUNTING WORKSPACE SURFACES<br />
          &gt; CALIBRATING kAIxU EXECUTION CHANNEL<br />
          &gt; LINKING NEURAL SPACE BRIDGE
        </div>
        <div className="cine-whiteout" />
        <div className="cine-core">
          <img className="cine-logo" src="/SKYESOVERLONDONDIETYLOGO.png" alt="" />
          <div className="cine-title">kAIxU SKYEIDE</div>
          <div className="cine-sub">PRIMARY WORKSPACE ONLINE</div>
        </div>
      </div>}
      <header className="topbar">
        <div className="topbar-brand">
          <img className="floating-logo" src="/SKYESOVERLONDONDIETYLOGO.png" alt="SKYES OVER LONDON" />
          <div className="topbar-brand-copy">
            <h1>SkyeIDE Command Deck</h1>
            <p>DocxPro-grade workspace shell · live surfaces · detachable preview</p>
          </div>
        </div>
        <div className="topbar-right">
          <a className="ghost" href={standaloneIdeUrl} target="_blank" rel="noreferrer">Standalone IDE</a>
          <a className="ghost" href="/upgrade-notes.html" target="_blank" rel="noreferrer">Upgrade Notes</a>
          <button className="ghost" type="button" onClick={() => openAuthCenterWindow({ focus: true, guide: showOnboardingGuide })}>Auth Center</button>
          <div className={`status-dot ${assistantAuthStatus === "ok" || assistantAuthStatus === "token" ? "ok" : "fail"}`}>
            Auth {assistantAuthStatus === "ok" || assistantAuthStatus === "token" ? "Ready" : "Needs Setup"}
          </div>
          <div className={`status-dot ${runnerStatus}`}>
            Worker {runnerStatus === "ok" ? "Healthy" : runnerStatus === "fail" ? "Offline" : runnerStatus === "boundary" ? "Boundary" : "Unknown"}
          </div>
          <button className="ghost" type="button" onClick={onManualSmoke} disabled={isSmokeChecking}>
            {isSmokeChecking ? "Checking..." : "Smoke Test"}
          </button>
        </div>
      </header>

      <section className="workspace-surface-bar">
        <div className="workspace-surface-meta">Home Control Stack</div>
        <div className="workspace-surface-meta">{showHomePanels ? "Expanded" : "Collapsed by default so the primary workspace stays first."}</div>
        <span className="telemetry-chip">Command feed: {commandFeed.length}</span>
        <span className="telemetry-chip">Events: {sovereignEvents.length}</span>
        <span className="telemetry-chip">Active app: {selectedSkyeApp}</span>
        <button className="ghost" type="button" onClick={() => setShowHomePanels((old) => !old)}>
          {showHomePanels ? "Hide Home Panels" : "Show Home Panels"}
        </button>
        <button className="ghost" type="button" onClick={() => openAuthCenterWindow({ focus: true, guide: true })}>
          Guided Onboarding
        </button>
        <button className="ghost" type="button" onClick={() => setShowTutorialPanel(true)}>
          Tutorials
        </button>
        <button className="ghost" type="button" onClick={() => routeCrossAppFocus("GoogleBusinessProfileRescuePlatform", { note: "Launch GBP Rescue from the home control stack." })}>
          Open GBP Rescue
        </button>
      </section>

      {showHomePanels ? (
        <>
      <section className="command-feed-rail" aria-label="command feed">
        <div className="command-feed-head">
          <strong>Command Feed</strong>
          <span className="telemetry-chip">Cross-app handoffs, drops, auth, deploy, and runtime confirmations</span>
        </div>
        <div className="command-feed-list">
          {commandFeed.slice(0, 4).map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`command-feed-item ${entry.tone}`}
              onClick={() => handleCommandFeedEntryClick(entry)}
            >
              <span className={`status-dot ${entry.tone}`}>{entry.source}</span>
              <span className="command-feed-copy">
                <span className="command-feed-line">
                  <strong>{entry.detail}</strong>
                  {entry.badge ? <span className="telemetry-chip command-feed-badge">{entry.badge}</span> : null}
                </span>
                <small>
                  {new Date(entry.at).toLocaleTimeString()}
                  {entry.action?.kind === "show-file-list" ? " · click for protected file list" : ""}
                  {entry.action?.kind === "focus-contractor" ? " · click for contractor review focus" : ""}
                  {entry.action?.kind === "open-sovereign-variables" ? " · click for SovereignVariables handoff" : ""}
                </small>
              </span>
            </button>
          ))}
          {!commandFeed.length && (
            <div className="command-feed-empty">
              Waiting for app actions, drops, shares, and auth events.
            </div>
          )}
        </div>
        {commandFeedInspector && (
          <div className="command-feed-empty" style={{ marginTop: 10, textAlign: "left" }}>
            <strong>{commandFeedInspector.title}</strong>
            {commandFeedInspector.description ? <div style={{ marginTop: 6 }}>{commandFeedInspector.description}</div> : null}
            <div className="file-list" style={{ marginTop: 10, maxHeight: 180 }}>
              {commandFeedInspector.paths.map((path) => (
                <button
                  key={path}
                  type="button"
                  className={`file-item ${path === activePath ? "active" : ""}`}
                  onClick={() => {
                    if (path.includes("=")) return;
                    setActivePath(path);
                    setSelectedSkyeApp("SkyDex4.6");
                  }}
                >
                  {path}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="sovereign-event-head">
          <strong>Sovereign Events</strong>
          <div className="sovereign-event-actions">
            <span className="telemetry-chip">Typed event feed for workspace, chat, and mail actions</span>
            <span className="telemetry-chip">Contractor signals: {contractorEventCount}</span>
            {contractorAdminToken.trim() && !contractorStatusFilter.trim() && !contractorSearch.trim() ? (
              <span className="telemetry-chip">Queue: {contractorNewCount} new / {contractorPendingCount} pending</span>
            ) : null}
            <button className="ghost" type="button" onClick={() => void loadSovereignEvents()} disabled={isSovereignEventsLoading || !hasActiveAuthSession}>
              {isSovereignEventsLoading ? "Syncing..." : "Refresh"}
            </button>
          </div>
        </div>
        <div className="sovereign-event-list">
          {sovereignEvents.slice(0, 4).map((entry) => {
            const appId = getSovereignEventAppId(entry);
            return (
              <button
                key={entry.id}
                type="button"
                className={`command-feed-item ${getSovereignEventTone(entry)}`}
                onClick={() => {
                  if (!appId) return;
                  setAppMode("skyeide");
                  setSelectedSkyeApp(appId);
                }}
              >
                <span className={`status-dot ${getSovereignEventTone(entry)}`}>{entry.source_app || entry.event_family || "event"}</span>
                <span className="command-feed-copy">
                  <strong>{entry.summary || entry.event_type}</strong>
                  <small className="sovereign-event-meta">
                    {entry.event_type} · {new Date(entry.occurred_at).toLocaleTimeString()}
                  </small>
                </span>
              </button>
            );
          })}
          {!sovereignEvents.length && (
            <div className="command-feed-empty">
              {hasActiveAuthSession ? "Waiting for first-class sovereign events." : "Sign in to load the sovereign event feed."}
            </div>
          )}
        </div>
      </section>

      <section className="platform-intro" aria-label="platform intro">
        <div className="platform-intro-copy">
          <p className="platform-intro-kicker">Enterprise Platform Intro</p>
          <h2>Several full enterprise-level platforms under one roof.</h2>
          <p>
            This stack is built as a real multi-product operating environment, not a thin demo shell. You can credibly position it as
            a full email service, a full chatroom service with Reddit-like threaded community conversation, and a full Google DocX
            replacement—plus operations, identity, and analytics surfaces aligned to enterprise rollout.
          </p>
        </div>
        <div className="platform-intro-grid">
          {PLATFORM_INTRO_PILLARS.map((pillar) => (
            <article key={pillar.title} className="platform-intro-card">
              <h3>{pillar.title}</h3>
              <p>{pillar.detail}</p>
            </article>
          ))}
        </div>
        <div className="topbar-telemetry platform-intro-telemetry">
          <span className="telemetry-chip">Surface: {selectedSkyeApp}</span>
          <span className="telemetry-chip">Mode: {appMode === "skyeide" ? "SkyeIDE" : "Neural"}</span>
          <span className="telemetry-chip">Preview: {previewPane}/{previewDevice}</span>
          <span className="telemetry-chip">Assistant: {assistantAuthStatus}</span>
        </div>
      </section>

      <section className="suite-network" aria-label="suite command network">
        <div className="suite-network-copy">
          <p className="platform-intro-kicker">Suite Command Network</p>
          <h2>Make the suite talk in public, not just in the plumbing.</h2>
          <p>
            The command deck now surfaces the handoff lanes that are actually active, highlights which apps are speaking the loudest,
            and gives the operator one-click routes for the next cross-app move from the current surface.
          </p>
        </div>
        <div className="suite-network-grid">
          <article className="suite-network-card">
            <header className="suite-network-card-head">
              <div>
                <h3>Live suite metrics</h3>
                <p>Cross-app activity, governed signals, and runtime lane health in one place.</p>
              </div>
            </header>
            <div className="suite-network-metrics">
              {suiteNetworkBoard.metrics.map((metric) => (
                <div key={metric.label} className="suite-network-metric">
                  <small>{metric.label}</small>
                  <strong>{metric.value}</strong>
                  <span>{metric.detail}</span>
                </div>
              ))}
            </div>
          </article>

          <article className="suite-network-card">
            <header className="suite-network-card-head">
              <div>
                <h3>Command lanes</h3>
                <p>The most active handoffs currently visible to the command deck.</p>
              </div>
            </header>
            <div className="suite-network-lanes">
              {suiteNetworkBoard.edges.map((edge) => (
                <button
                  key={edge.key}
                  type="button"
                  className={`suite-network-lane ${edge.tone}`}
                  onClick={() => {
                    if (edge.target === "Neural-Space-Pro") {
                      setAppMode("neural");
                      if (edge.detail) pushIdeDiagnostic("info", edge.detail);
                      return;
                    }
                    if (SKYE_APP_ID_SET.has(edge.target)) {
                      routeCrossAppFocus(edge.target as SkyeAppId, { note: edge.detail });
                    }
                  }}
                >
                  <div className="suite-network-lane-line">
                    <strong>{edge.source}</strong>
                    <span>to</span>
                    <strong>{edge.target}</strong>
                    <span className="telemetry-chip">{edge.count}x</span>
                  </div>
                  <small>{edge.detail}</small>
                </button>
              ))}
              {!suiteNetworkBoard.edges.length ? <div className="suite-network-empty">Waiting for visible cross-app handoffs.</div> : null}
            </div>
          </article>

          <article className="suite-network-card">
            <header className="suite-network-card-head">
              <div>
                <h3>{selectedSkyeApp} next routes</h3>
                <p>Direct suite jumps that turn the current surface into a connected operating lane.</p>
              </div>
            </header>
            <div className="suite-network-actions">
              {suiteRouteSuggestions.map((item) => (
                <button
                  key={`${selectedSkyeApp}-${item.appId}-${item.title}`}
                  type="button"
                  className="suite-network-action"
                  onClick={() => triggerSuiteRoute(item.appId, { note: item.detail, channel: item.channel })}
                >
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                  <small>Open {item.appId}</small>
                </button>
              ))}
            </div>
          </article>

          <article className="suite-network-card">
            <header className="suite-network-card-head">
              <div>
                <h3>{selectedSkyeApp} integration</h3>
                <p>Upstream inputs, downstream outputs, and the last successful persisted handoff for the current surface.</p>
              </div>
            </header>
            <div className="suite-pulse-list">
              <div className="suite-pulse-row" style={{ cursor: "default" }}>
                <div className="suite-pulse-copy">
                  <strong>Upstream inputs</strong>
                  <span>{selectedSuiteIntegrationCard.upstream.length ? `${selectedSuiteIntegrationCard.upstream.length} routes` : "none yet"}</span>
                </div>
                <small>
                  {selectedSuiteIntegrationCard.upstream.length
                    ? selectedSuiteIntegrationCard.upstream.map((item) => `${item.appId} -> ${item.intentName} (${item.count}x)`).join(" | ")
                    : "No upstream suite handoffs recorded for this app yet."}
                </small>
              </div>
              <div className="suite-pulse-row" style={{ cursor: "default" }}>
                <div className="suite-pulse-copy">
                  <strong>Downstream outputs</strong>
                  <span>{selectedSuiteIntegrationCard.downstream.length ? `${selectedSuiteIntegrationCard.downstream.length} routes` : "none yet"}</span>
                </div>
                <small>
                  {selectedSuiteIntegrationCard.downstream.length
                    ? selectedSuiteIntegrationCard.downstream.map((item) => `${item.intentName} -> ${item.appId} (${item.count}x)`).join(" | ")
                    : "No downstream suite handoffs recorded for this app yet."}
                </small>
              </div>
              <div className="suite-pulse-row" style={{ cursor: "default" }}>
                <div className="suite-pulse-copy">
                  <strong>Last successful handoff</strong>
                  <span>{isSuiteEventsLoading ? "refreshing" : selectedSuiteIntegrationCard.lastSuccessful ? new Date(selectedSuiteIntegrationCard.lastSuccessful.occurred_at).toLocaleTimeString() : "none"}</span>
                </div>
                <small>
                  {selectedSuiteIntegrationCard.lastSuccessful
                    ? `${selectedSuiteIntegrationCard.lastSuccessful.source_app}${selectedSuiteIntegrationCard.lastSuccessful.target_app ? ` -> ${selectedSuiteIntegrationCard.lastSuccessful.target_app}` : ""} · ${selectedSuiteIntegrationCard.lastSuccessful.intent.name}`
                    : "Waiting for the first completed persisted suite handoff."}
                </small>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section className="executive-grid" aria-label="executive operator panels">
        <article className="executive-card">
          <header className="executive-card-head">
            <div>
              <p className="platform-intro-kicker">Executive Timeline</p>
              <h3>Recent governed activity</h3>
            </div>
            <div className="tool-actions left executive-card-actions">
              <button className="ghost" type="button" onClick={() => void loadTimelineEntries()} disabled={isTimelineLoading || !hasActiveAuthSession}>
                {isTimelineLoading ? "Syncing..." : "Refresh"}
              </button>
              <button className="ghost" type="button" onClick={() => setSelectedSkyeApp("SkyeAnalytics")}>
                Open SkyeAnalytics
              </button>
            </div>
          </header>
          <div className="executive-card-list">
            {timelineEntries.slice(0, 5).map((entry) => (
              <div key={entry.id} className="executive-list-row">
                <span className="telemetry-chip">{entry.source_app || entry.entry_type}</span>
                <span className="executive-list-copy">
                  <strong>{entry.title}</strong>
                  <span>{entry.summary || entry.entry_type}</span>
                </span>
                <small>{new Date(entry.at).toLocaleTimeString()}</small>
              </div>
            ))}
            {!timelineEntries.length && (
              <div className="command-feed-empty">
                {hasActiveAuthSession ? "No timeline entries yet for this scope." : "Sign in to load the executive timeline."}
              </div>
            )}
          </div>
        </article>

        <article className="executive-card">
          <header className="executive-card-head">
            <div>
              <p className="platform-intro-kicker">Mission Control</p>
              <h3>Scoped operational containers</h3>
            </div>
            <div className="tool-actions left executive-card-actions">
              <button className="ghost" type="button" onClick={() => void loadMissionRecords()} disabled={isMissionsLoading || !hasActiveAuthSession}>
                {isMissionsLoading ? "Syncing..." : "Refresh"}
              </button>
              <button className="ghost" type="button" onClick={() => setSelectedSkyeApp("SkyeTasks")}>
                Open SkyeTasks
              </button>
            </div>
          </header>
          <div className="tool-row split executive-form-grid">
            <div>
              <label htmlFor="mission-title">Mission Title</label>
              <input
                id="mission-title"
                value={missionDraftTitle}
                onChange={(event) => setMissionDraftTitle(event.target.value)}
                placeholder="Product launch · Investor packet · Client onboarding"
              />
            </div>
            <div>
              <label htmlFor="mission-priority">Priority</label>
              <select id="mission-priority" value={missionDraftPriority} onChange={(event) => setMissionDraftPriority(event.target.value as MissionRecord["priority"])}>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="critical">critical</option>
              </select>
            </div>
          </div>
          <div className="tool-row">
            <label htmlFor="mission-goal">First Goal</label>
            <textarea
              id="mission-goal"
              value={missionDraftGoal}
              onChange={(event) => setMissionDraftGoal(event.target.value)}
              placeholder="Get the DocxPro draft through BookX, Blog, Chat, Mail, and release review."
            />
          </div>
          <div className="tool-actions left executive-card-actions">
            <button className="ghost" type="button" onClick={() => void createMissionRecord()} disabled={isCreatingMission || !hasActiveAuthSession}>
              {isCreatingMission ? "Creating..." : "Create Mission"}
            </button>
            <span className="telemetry-chip">Workspace: {workspaceId || "org-scope"}</span>
          </div>
          {selectedMission && (
            <>
              <div className="tool-row split executive-form-grid">
                <div>
                  <label htmlFor="mission-edit-title">Selected Mission</label>
                  <input
                    id="mission-edit-title"
                    value={missionEditTitle}
                    onChange={(event) => setMissionEditTitle(event.target.value)}
                    placeholder="Mission title"
                  />
                </div>
                <div>
                  <label htmlFor="mission-edit-status">Status</label>
                  <select id="mission-edit-status" value={missionEditStatus} onChange={(event) => setMissionEditStatus(event.target.value as MissionRecord["status"])}>
                    <option value="draft">draft</option>
                    <option value="active">active</option>
                    <option value="blocked">blocked</option>
                    <option value="completed">completed</option>
                    <option value="archived">archived</option>
                  </select>
                </div>
              </div>
              <div className="tool-row split executive-form-grid">
                <div>
                  <label htmlFor="mission-edit-goal">Lead Goal</label>
                  <textarea
                    id="mission-edit-goal"
                    value={missionEditGoal}
                    onChange={(event) => setMissionEditGoal(event.target.value)}
                    placeholder="Refine the lead mission goal"
                  />
                </div>
                <div>
                  <label htmlFor="mission-edit-priority">Update Priority</label>
                  <select id="mission-edit-priority" value={missionEditPriority} onChange={(event) => setMissionEditPriority(event.target.value as MissionRecord["priority"])}>
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                    <option value="critical">critical</option>
                  </select>
                </div>
              </div>
              <div className="tool-actions left executive-card-actions">
                <button className="ghost" type="button" onClick={() => void updateMissionRecord()} disabled={isUpdatingMission || !hasActiveAuthSession}>
                  {isUpdatingMission ? "Saving..." : "Update Mission"}
                </button>
                <span className="telemetry-chip">Selected: {selectedMission.id.slice(0, 8)}</span>
              </div>
              <div className="tool-row split executive-form-grid">
                <div>
                  <label htmlFor="mission-collaborator-email">Attach Collaborator</label>
                  <input
                    id="mission-collaborator-email"
                    value={missionCollaboratorEmail}
                    onChange={(event) => setMissionCollaboratorEmail(event.target.value)}
                    placeholder="teammate@company.com"
                  />
                </div>
                <div>
                  <label htmlFor="mission-collaborator-role">Collaborator Role</label>
                  <select id="mission-collaborator-role" value={missionCollaboratorRole} onChange={(event) => setMissionCollaboratorRole(event.target.value as MissionCollaboratorRole)}>
                    <option value="collaborator">collaborator</option>
                    <option value="viewer">viewer</option>
                    <option value="owner">owner</option>
                  </select>
                </div>
              </div>
              <div className="tool-actions left executive-card-actions">
                <button className="ghost" type="button" onClick={() => void attachMissionCollaborator()} disabled={isAttachingMissionCollaborator || !hasActiveAuthSession}>
                  {isAttachingMissionCollaborator ? "Attaching..." : "Attach Collaborator"}
                </button>
              </div>
              <div className="tool-row split executive-form-grid">
                <div>
                  <label htmlFor="mission-asset-source">Asset Source App</label>
                  <input
                    id="mission-asset-source"
                    value={missionAssetSourceApp}
                    onChange={(event) => setMissionAssetSourceApp(event.target.value)}
                    placeholder="SkyeDrive"
                  />
                </div>
                <div>
                  <label htmlFor="mission-asset-kind">Asset Kind</label>
                  <input
                    id="mission-asset-kind"
                    value={missionAssetKind}
                    onChange={(event) => setMissionAssetKind(event.target.value)}
                    placeholder="workspace_file"
                  />
                </div>
              </div>
              <div className="tool-row split executive-form-grid">
                <div>
                  <label htmlFor="mission-asset-id">Asset Id</label>
                  <input
                    id="mission-asset-id"
                    value={missionAssetId}
                    onChange={(event) => setMissionAssetId(event.target.value)}
                    placeholder="docs/launch-plan.md"
                  />
                </div>
                <div>
                  <label htmlFor="mission-asset-title">Asset Title</label>
                  <input
                    id="mission-asset-title"
                    value={missionAssetTitle}
                    onChange={(event) => setMissionAssetTitle(event.target.value)}
                    placeholder="Launch plan"
                  />
                </div>
              </div>
              <div className="tool-actions left executive-card-actions">
                <button className="ghost" type="button" onClick={() => void attachMissionAsset()} disabled={isAttachingMissionAsset || !hasActiveAuthSession}>
                  {isAttachingMissionAsset ? "Attaching..." : "Attach Asset"}
                </button>
              </div>
            </>
          )}
          {missionResult && <div className="auth-session-feedback executive-feedback">{missionResult}</div>}
          <div className="executive-card-list">
            {missions.slice(0, 5).map((mission) => (
              <button
                key={mission.id}
                type="button"
                className="executive-list-row mission-row"
                onClick={() => setSelectedMissionId(mission.id)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: selectedMissionId === mission.id ? "rgba(255, 211, 106, 0.08)" : "transparent",
                  border: selectedMissionId === mission.id ? "1px solid rgba(255, 211, 106, 0.24)" : "1px solid transparent",
                  cursor: "pointer",
                }}
              >
                <span className={`status-dot ${mission.status === "blocked" ? "boundary" : "ok"}`}>{mission.priority}</span>
                <span className="executive-list-copy">
                  <strong>{mission.title}</strong>
                  <span>{mission.status} · {(mission.goals_json || []).slice(0, 1).join(" ") || "No goals attached yet."}</span>
                </span>
                <small>{mission.collaborator_count || 0} collab · {mission.asset_count || 0} assets</small>
              </button>
            ))}
            {!missions.length && (
              <div className="command-feed-empty">
                {hasActiveAuthSession ? "No missions created yet for this scope." : "Sign in to load mission control."}
              </div>
            )}
          </div>
        </article>

        <article className="executive-card">
          <header className="executive-card-head">
            <div>
              <p className="platform-intro-kicker">ContractorNetwork</p>
              <h3>Submission intake and admin review</h3>
            </div>
            <div className="tool-actions left executive-card-actions">
              <button className="ghost" type="button" onClick={() => void loadContractorSubmissions()} disabled={isContractorLoading || !contractorAdminToken.trim()}>
                {isContractorLoading ? "Syncing..." : "Refresh"}
              </button>
              <button className="ghost" type="button" onClick={() => window.open(`/ContractorNetwork/index.html?ws_id=${encodeURIComponent(workspaceId)}`, "_blank", "noopener,noreferrer")}>
                Open Surface
              </button>
            </div>
          </header>
          <div className="tool-row split executive-form-grid">
            <div>
              <label htmlFor="contractor-admin-password">Admin Password</label>
              <input
                id="contractor-admin-password"
                type="password"
                value={contractorAdminPassword}
                onChange={(event) => setContractorAdminPassword(event.target.value)}
                placeholder="ContractorNetwork admin password"
              />
            </div>
            <div>
              <label htmlFor="contractor-status-filter">Filter Status</label>
              <select id="contractor-status-filter" value={contractorStatusFilter} onChange={(event) => setContractorStatusFilter(event.target.value)}>
                <option value="">all</option>
                <option value="new">new</option>
                <option value="reviewing">reviewing</option>
                <option value="approved">approved</option>
                <option value="on_hold">on_hold</option>
                <option value="rejected">rejected</option>
              </select>
            </div>
          </div>
          <div className="tool-row">
            <label htmlFor="contractor-search">Search</label>
            <input
              id="contractor-search"
              value={contractorSearch}
              onChange={(event) => setContractorSearch(event.target.value)}
              placeholder="name, email, coverage, lane"
            />
          </div>
          <div className="tool-actions left executive-card-actions">
            <button className="ghost" type="button" onClick={() => void loginContractorAdmin()} disabled={isContractorLoggingIn}>
              {isContractorLoggingIn ? "Logging In..." : contractorAdminToken.trim() ? "Reissue Admin Token" : "Admin Login"}
            </button>
            <button className="ghost" type="button" onClick={() => logoutContractorAdmin()} disabled={!contractorAdminToken.trim()}>
              Logout
            </button>
            <button className="ghost" type="button" onClick={() => void exportContractorSubmissions()} disabled={isContractorExporting || !contractorAdminToken.trim()}>
              {isContractorExporting ? "Exporting..." : "Export CSV"}
            </button>
            <span className="telemetry-chip">{contractorAdminToken.trim() ? "Admin session loaded" : "Admin login required"}</span>
            {contractorAdminToken.trim() ? <span className="telemetry-chip">{contractorNewCount} new / {contractorPendingCount} pending</span> : null}
          </div>
          {selectedContractorSubmission && (
            <>
              <div className="tool-row split executive-form-grid">
                <div>
                  <label htmlFor="contractor-admin-status">Update Status</label>
                  <select id="contractor-admin-status" value={contractorAdminStatus} onChange={(event) => setContractorAdminStatus(event.target.value as ContractorSubmissionRecord["status"])}>
                    <option value="new">new</option>
                    <option value="reviewing">reviewing</option>
                    <option value="approved">approved</option>
                    <option value="on_hold">on_hold</option>
                    <option value="rejected">rejected</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="contractor-admin-tags">Tags</label>
                  <input
                    id="contractor-admin-tags"
                    value={contractorAdminTags}
                    onChange={(event) => setContractorAdminTags(event.target.value)}
                    placeholder="seo, phoenix, urgent"
                  />
                </div>
              </div>
              <div className="tool-row">
                <label htmlFor="contractor-admin-notes">Admin Notes</label>
                <textarea
                  id="contractor-admin-notes"
                  value={contractorAdminNotes}
                  onChange={(event) => setContractorAdminNotes(event.target.value)}
                  placeholder="Dispatch notes, fit assessment, verification steps"
                />
              </div>
              <div className="tool-actions left executive-card-actions">
                <button className="ghost" type="button" onClick={() => void saveContractorSubmission()} disabled={isContractorSaving || !contractorAdminToken.trim()}>
                  {isContractorSaving ? "Saving..." : "Save Submission"}
                </button>
                <span className="telemetry-chip">Selected: {selectedContractorSubmission.full_name}</span>
              </div>
            </>
          )}
          {contractorAdminResult && <div className="auth-session-feedback executive-feedback">{contractorAdminResult}</div>}
          <div className="executive-card-list">
            {contractorSubmissions.slice(0, 6).map((submission) => (
              <button
                key={submission.id}
                type="button"
                className="executive-list-row mission-row"
                onClick={() => setSelectedContractorSubmissionId(submission.id)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: selectedContractorSubmissionId === submission.id ? "rgba(39, 242, 255, 0.08)" : "transparent",
                  border: selectedContractorSubmissionId === submission.id ? "1px solid rgba(39, 242, 255, 0.24)" : "1px solid transparent",
                  cursor: "pointer",
                }}
              >
                <span className={`status-dot ${submission.status === "rejected" ? "fail" : submission.status === "on_hold" ? "boundary" : "ok"}`}>{submission.status}</span>
                <span className="executive-list-copy">
                  <strong>{submission.full_name}</strong>
                  <span>
                    {submission.email}
                    {submission.coverage ? ` · ${submission.coverage}` : ""}
                    {submission.lanes?.length ? ` · ${submission.lanes.slice(0, 2).join(", ")}` : ""}
                  </span>
                </span>
                <small>{(submission.files || []).length} files · {(submission.tags || []).length} tags</small>
              </button>
            ))}
            {!contractorSubmissions.length && (
              <div className="command-feed-empty">
                {contractorAdminToken.trim() ? "No ContractorNetwork submissions loaded for this filter." : "Admin login required to load ContractorNetwork submissions."}
              </div>
            )}
          </div>
        </article>
      </section>

      <section className="workspace-surface-bar">
        <div className="workspace-surface-meta">Internal Control Lane</div>
        {!adminBoardUnlocked ? (
          <>
            <label htmlFor="admin-board-key">Admin Board Key</label>
            <input
              id="admin-board-key"
              type="password"
              value={adminBoardKey}
              onChange={(event) => setAdminBoardKey(event.target.value)}
              placeholder="Enter ADMIN_KEY"
            />
            <button className="ghost" type="button" onClick={() => void verifyAdminBoardKey()} disabled={isAdminBoardVerifying}>
              {isAdminBoardVerifying ? "Unlocking..." : "Unlock Admin Board"}
            </button>
            <div className="workspace-surface-meta">Public users do not see workspace/site/worker controls, smokehouse, or internal pricing rails.</div>
            {adminBoardResult ? <div className="muted-copy">{adminBoardResult}</div> : null}
          </>
        ) : (
          <>
            <div className="workspace-surface-meta">Active Surface · {selectedSkyeApp}</div>
            <label htmlFor="workspace-id-global">Workspace ID</label>
            <input
              id="workspace-id-global"
              value={workspaceId}
              onChange={(event) => setWorkspaceId(event.target.value)}
              placeholder="Workspace UUID"
            />
            <label htmlFor="site-base-global">Site Base</label>
            <input
              id="site-base-global"
              value={siteBaseUrl}
              onChange={(event) => setSiteBaseUrl(event.target.value)}
              placeholder="https://your-site.netlify.app"
            />
            <label htmlFor="worker-url-global">Worker URL</label>
            <input
              id="worker-url-global"
              value={workerUrl}
              onChange={(event) => setWorkerUrl(event.target.value)}
              placeholder="https://your-worker.workers.dev"
            />
            <button className="ghost" type="button" onClick={() => void saveWorkspaceNow()} disabled={isSavingWorkspace}>
              {isSavingWorkspace ? "Saving..." : "Save"}
            </button>
            <button className="ghost" type="button" onClick={() => void loadWorkspaceNow()} disabled={isLoadingWorkspace}>
              {isLoadingWorkspace ? "Loading..." : "Load"}
            </button>
            <button className="ghost" type="button" onClick={() => void checkAssistantAuth()}>
              Validate Auth
            </button>
            <button className="ghost" type="button" onClick={() => openAuthCenterWindow({ focus: true, guide: true })}>
              Open Onboarding
            </button>
            <button className="ghost" type="button" onClick={() => setShowTutorialPanel((old) => !old)}>
              {showTutorialPanel ? "Hide Tutorials" : "Show Tutorials"}
            </button>
            <button className="ghost" type="button" onClick={() => { setToolTab("smokehouse"); void runSmokehouseSuite("manual"); }}>
              Smokehouse
            </button>
            <button className="ghost" type="button" onClick={() => setToolTab("playground")}>
              API Playground
            </button>
            <a className="ghost" href="/pricing.html" target="_blank" rel="noreferrer">Pricing</a>
            <button className="ghost" type="button" onClick={lockAdminBoard}>
              Lock Admin Board
            </button>
            {adminBoardResult ? <div className="muted-copy">{adminBoardResult}</div> : null}
          </>
        )}
      </section>
        </>
      ) : null}

      {showFailSafeBanner && (
        <section className="smoke-warning" style={{ margin: "10px 12px 0 12px" }}>
          <strong>Fail-Safe Mode Active</strong>
          <div>Core dependencies are degraded. Actions that depend on auth, gateway, or worker may be restricted.</div>
          <div>Signals: {failSafeSignals.join(" · ")}</div>
        </section>
      )}

      {tokenMisuseState !== "none" && (
        <section className="smoke-warning" style={{ margin: "10px 12px 0 12px" }}>
          <strong>Key Lock Mismatch Detected</strong>
          <div>State: {tokenMisuseState}</div>
          <div>Set a valid key-lock email that matches the active auth user to avoid authorization failures.</div>
        </section>
      )}

      {showOnboardingPrompt && authCenterLaunchBlocked && (
        <div className="onboarding-prompt-overlay" role="dialog" aria-modal="true" aria-labelledby="onboarding-prompt-title">
          <div className="onboarding-prompt-card">
            <p className="platform-intro-kicker">Auth Center</p>
            <h2 id="onboarding-prompt-title">Open the standalone auth center</h2>
            <p>
              Onboarding, login, recovery, key minting, and admin controls now live in a separate auth center window so the main workspace bench stays clean.
            </p>
            <div className="tool-actions left onboarding-prompt-actions">
              <button className="ghost" type="button" onClick={() => { setAuthCenterLaunchBlocked(!openAuthCenterWindow({ focus: true, guide: true })); }}>Open Guided Auth Center</button>
              <button className="ghost" type="button" onClick={() => { setAuthCenterLaunchBlocked(!openAuthCenterWindow({ focus: true, guide: false })); }}>Open Self-Serve Auth Center</button>
              <button className="ghost" type="button" onClick={() => chooseOnboardingAssistMode("later")}>Maybe Later</button>
            </div>
          </div>
        </div>
      )}

      {isGlobalDropActive && (
        <div className="global-drop-overlay" aria-hidden="true">
          <div className="global-drop-card">
            <strong>Drop Files Anywhere</strong>
            <p>Assets will be captured into SkyeDrive, announced in the command feed, and text/code files will import into the IDE workspace.</p>
          </div>
        </div>
      )}

      <div className={`workspace-stack ${isSkyeDocsStackMode ? "workspace-stack-docs" : ""}`}>
      {appMode === "skyeide" && (
        <section className="app-strip" aria-label="Skye app switcher">
          <div className="app-strip-head">
            <strong>Browse Apps By Function</strong>
            <input
              value={appSearch}
              onChange={(event) => setAppSearch(event.target.value)}
              placeholder="Search apps, workflows, or capabilities..."
              aria-label="search apps"
            />
            <a className="ghost" href={standaloneIdeUrl} target="_blank" rel="noreferrer">Open Standalone IDE</a>
          </div>
          <div className="app-strip-featured" role="tablist" aria-label="featured apps">
            {FEATURED_APP_IDS.map((appId) => {
              const app = SKYE_APPS.find((entry) => entry.id === appId);
              if (!app) return null;
              return (
                <button
                  key={`strip-featured-${app.id}`}
                  type="button"
                  className={`app-item compact ${selectedSkyeApp === app.id ? "active" : ""}`}
                  onClick={() => {
                    setSelectedSkyeApp(app.id);
                    setAppMode("skyeide");
                  }}
                >
                  <span>{app.id}</span>
                  <small>featured</small>
                </button>
              );
            })}
          </div>
          {contractorMiniRailItems.length ? (
            <div className="contractor-mini-rail" aria-label="contractor intake rail">
              {contractorMiniRailItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`contractor-mini-card ${item.tone}`}
                  onClick={() =>
                    handleCommandFeedEntryClick({
                      id: item.id,
                      source: "ContractorNetwork",
                      detail: `Contractor focus: ${item.name}`,
                      tone: item.tone,
                      at: new Date().toISOString(),
                      action: {
                        kind: "focus-contractor",
                        submissionId: item.submissionId,
                        filter: item.status === "new" ? "new" : item.status === "reviewing" || item.status === "on_hold" ? "reviewing" : undefined,
                      },
                      badge: item.status,
                    })
                  }
                >
                  <span className={`status-dot ${item.tone}`}>{item.status}</span>
                  <span className="contractor-mini-copy">
                    <strong>{item.name}</strong>
                    <small>{item.detail}</small>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="app-drawer-grid" aria-label="grouped app drawer">
            {filteredAppGroups.map((group) => (
              <section key={group.id} className="app-drawer-group">
                <header>
                  <strong>{group.label}</strong>
                  <p>{group.description}</p>
                </header>
                <div className="app-drawer-list">
                  {group.apps.map((appId) => {
                    const app = SKYE_APPS.find((entry) => entry.id === appId);
                    if (!app) return null;
                    const done = app.mvp.filter((item) => mvpChecks[makeMvpKey(app.id, item)]).length;
                    return (
                      <button
                        key={`drawer-${group.id}-${app.id}`}
                        type="button"
                        className={`app-item grouped ${selectedSkyeApp === app.id ? "active" : ""}`}
                        onClick={() => {
                          setSelectedSkyeApp(app.id);
                          setAppMode("skyeide");
                        }}
                      >
                        <span className="app-item-copy">
                          <strong>{app.id}</strong>
                          <small>{app.summary}</small>
                        </span>
                        <span className="telemetry-chip">{done}/{app.mvp.length}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
            {!filteredAppGroups.length && (
              <section className="app-drawer-empty">
                <strong>No apps match that search.</strong>
                <p>Try product names like SkyeMail, roles like analytics, or capabilities like export or deploy.</p>
              </section>
            )}
          </div>
        </section>
      )}
      <div className="workspace-body" style={{ ["--sidebar-width" as any]: `${workspaceSidebarWidth}px`, ["--right-panel-width" as any]: `${workspaceRightPanelWidth}px` }}>
        <aside className="file-pane">
          <div className="file-pane-scroll">
            <div className="mode-switch">
              <button type="button" className={`switch-btn ${appMode === "skyeide" ? "active" : ""}`} onClick={() => setAppMode("skyeide")}>SkyeIDE</button>
              <button type="button" className={`switch-btn ${appMode === "neural" ? "active" : ""}`} onClick={() => setAppMode("neural")}>AI Copilot Mode</button>
            </div>
            <div className="mode-badge">
              {appMode === "skyeide" ? `SkyeIDE · ${selectedSkyeApp}` : "AI Copilot Mode · Dedicated Workspace"}
            </div>

            <section className="ops-status-card">
              <header>
                <strong>Platform Status</strong>
                <button className="ghost" type="button" onClick={() => void checkAssistantAuth()} disabled={isPlatformStatusLoading}>
                  {isPlatformStatusLoading ? "Syncing..." : "Refresh"}
                </button>
              </header>
              <div className="ops-status-grid">
                {platformStatusItems.map((item) => (
                  <article key={item.label} className="ops-status-item">
                    <span className={`status-dot ${item.tone}`}>{item.label}</span>
                    <div>
                      <strong>{item.detail}</strong>
                      {item.label === "Deploy" && integrationRuntimeStatus?.github.connected && (
                        <small>{integrationRuntimeStatus.github.owner}/{integrationRuntimeStatus.github.repo} · {integrationRuntimeStatus.github.branch || "main"}</small>
                      )}
                      {item.label === "Deploy" && !integrationRuntimeStatus?.github.connected && integrationRuntimeStatus?.netlify.connected && (
                        <small>{integrationRuntimeStatus.netlify.site_name || integrationRuntimeStatus.netlify.site_id}</small>
                      )}
                      {item.label === "Mail" && mailRuntimeStatus?.sender_source && (
                        <small>sender source: {mailRuntimeStatus.sender_source}</small>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>

            {appMode === "skyeide" ? (
              <>
                <section className="starter-lane-card">
                  <header>
                    <h3>Start Here</h3>
                    <p>Pick a role preset to reshape the bench around the job you are doing.</p>
                  </header>
                  <div className="starter-lane-list">
                    {WORKBENCH_STARTER_PRESETS.map((preset) => (
                      <button
                        key={`starter-${preset.id}`}
                        type="button"
                        className={`starter-lane-button ${selectedSkyeApp === preset.focusApp && topWorkspaceApp === preset.top && middleWorkspaceApp === preset.middle && bottomWorkspaceApp === preset.bottom ? "active" : ""}`}
                        onClick={() => applyWorkbenchStarter(preset.id)}
                      >
                        <strong>{preset.label}</strong>
                        <span>{preset.description}</span>
                        <small>{preset.focusApp} focus</small>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="side-settings-block">
                  <div className="tool-actions left" style={{ marginBottom: 12 }}>
                    <h3 style={{ margin: 0, flex: 1 }}>Execution Pipeline</h3>
                    <button className="ghost" type="button" onClick={() => setShowExecutionSettings((old) => !old)}>
                      {showExecutionSettings ? "Hide Setup" : "Show Setup"}
                    </button>
                  </div>
                  <div className="onboarding-summary-grid" style={{ marginBottom: 12 }}>
                    <div>
                      <strong>Bench lane</strong>
                      <span>{`${workspaceStageLabel(topWorkspaceApp)} -> ${workspaceStageLabel(middleWorkspaceApp)} -> ${workspaceStageLabel(bottomWorkspaceApp)}`}</span>
                    </div>
                    <div>
                      <strong>Side rails</strong>
                      <span>{`${leftMiddleDockApp} / ${leftBottomDockApp} / ${rightTopDockApp} / ${rightMiddleDockApp} / ${rightBottomDockApp}`}</span>
                    </div>
                    <div>
                      <strong>Access</strong>
                      <span>{hasApiKeyLoaded ? "kAIxU key loaded" : "kAIxU key missing"}</span>
                    </div>
                    <div>
                      <strong>Workspace stack</strong>
                      <span>{showWorkspaceStack ? "expanded" : "collapsed"}</span>
                    </div>
                  </div>
                  <div className="tool-actions left" style={{ marginBottom: 12 }}>
                    <button className="ghost" type="button" onClick={() => openAuthCenterWindow({ focus: true, guide: true })}>Guided Onboarding</button>
                    <a className="ghost" href="https://skyesol.netlify.app/kaixu/requestkaixuapikey" target="_blank" rel="noreferrer">Request kAIxU Key</a>
                    <button className="ghost" type="button" onClick={() => routeCrossAppFocus("AE-Flow", { note: "Launch AE-Flow from the execution rail." })}>Open AE-Flow</button>
                    <button className="ghost" type="button" onClick={() => routeCrossAppFocus("GoogleBusinessProfileRescuePlatform", { note: "Launch GBP Rescue from the execution rail." })}>Open GBP Rescue</button>
                    <button className="ghost" type="button" onClick={() => window.open(`/ContractorNetwork/index.html?ws_id=${encodeURIComponent(workspaceId)}`, "_blank", "noopener,noreferrer")}>Open ContractorNetwork</button>
                  </div>
                  <div className="tool-actions left" style={{ marginBottom: showExecutionSettings ? 12 : 0 }}>
                    <button className="ghost" type="button" onClick={() => setShowWorkspaceStack((old) => !old)}>
                      {showWorkspaceStack ? "Hide Workspace Stack" : "Show Workspace Stack"}
                    </button>
                    <button className="ghost" type="button" onClick={() => setShowTutorialPanel(true)}>Show Tutorials</button>
                    <a className="ghost inline-action-link" href={standaloneIdeUrl} target="_blank" rel="noreferrer">Open SkyDex 4.6</a>
                  </div>
                  {showExecutionSettings ? (
                    <>
                      <div className="tool-row split">
                        <div>
                          <label>Top Workspace</label>
                          <select value={topWorkspaceApp} onChange={(event) => setTopWorkspaceApp(event.target.value as WorkspaceStageApp)}>
                            <option value="Neural-Space-Pro">Neural-Space-Pro</option>
                            {SKYE_APPS.map((app) => (
                              <option key={`left-top-${app.id}`} value={app.id}>{app.id}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label>Middle Workspace</label>
                          <select value={middleWorkspaceApp} onChange={(event) => setMiddleWorkspaceApp(event.target.value as WorkspaceStageApp)}>
                            <option value="Neural-Space-Pro">Neural-Space-Pro</option>
                            {SKYE_APPS.map((app) => (
                              <option key={`left-mid-${app.id}`} value={app.id}>{app.id}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="tool-row split">
                        <div>
                          <label>Bottom Workspace</label>
                          <select value={bottomWorkspaceApp} onChange={(event) => setBottomWorkspaceApp(event.target.value as WorkspaceStageApp)}>
                            <option value="Neural-Space-Pro">Neural-Space-Pro</option>
                            {SKYE_APPS.map((app) => (
                              <option key={`left-bottom-${app.id}`} value={app.id}>{app.id}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label>Sidebar Width</label>
                          <input readOnly value={`${Math.round(workspaceSidebarWidth)}px`} />
                        </div>
                      </div>
                      <div className="tool-row split">
                        <div>
                          <label>Left Middle Dock</label>
                          <select value={leftMiddleDockApp} onChange={(event) => setLeftMiddleDockApp(event.target.value as DockApp)}>
                            {dockApps.map((app) => (
                              <option key={`left-middle-dock-${app}`} value={app}>{app}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label>Left Bottom Dock</label>
                          <select value={leftBottomDockApp} onChange={(event) => setLeftBottomDockApp(event.target.value as DockApp)}>
                            {dockApps.map((app) => (
                              <option key={`left-dock-${app}`} value={app}>{app}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="tool-row split">
                        <div>
                          <label>Right Panel Width</label>
                          <input readOnly value={`${Math.round(workspaceRightPanelWidth)}px`} />
                        </div>
                        <div>
                          <label>Standalone IDE</label>
                          <a className="ghost inline-action-link" href={standaloneIdeUrl} target="_blank" rel="noreferrer">Open SkyDex 4.6</a>
                        </div>
                      </div>
                      <div className="tool-row split tool-row-triple">
                        <div>
                          <label>Right Panel Top App</label>
                          <select value={rightTopDockApp} onChange={(event) => setRightTopDockApp(event.target.value as DockApp)}>
                            {dockApps.map((app) => (
                              <option key={`right-top-${app}`} value={app}>{app}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label>Right Panel Middle App</label>
                          <select value={rightMiddleDockApp} onChange={(event) => setRightMiddleDockApp(event.target.value as DockApp)}>
                            {dockApps.map((app) => (
                              <option key={`right-middle-${app}`} value={app}>{app}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label>Right Panel Bottom App</label>
                          <select value={rightBottomDockApp} onChange={(event) => setRightBottomDockApp(event.target.value as DockApp)}>
                            {dockApps.map((app) => (
                              <option key={`right-bottom-${app}`} value={app}>{app}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </>
                  ) : null}
                </section>

                <div className="suite-progress">
                  Suite MVP Progress: {completeMvpItems}/{totalMvpItems}
                </div>

                <h3>File Safety Policy</h3>
                <textarea
                  value={sknoreText}
                  onChange={(event) => setSknoreText(event.target.value)}
                  rows={6}
                  placeholder="One glob pattern per line"
                />
                <div className="suite-progress">Protected files: {sknoreBlockedCount}</div>
                <div className="tool-actions left">
                  <a className="ghost" href={`/SKNore/index.html?ws_id=${encodeURIComponent(workspaceId)}`} target="_blank" rel="noreferrer">
                    Open Policy Console
                  </a>
                </div>

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
                <h3>AI Copilot Mode</h3>
                <p className="muted-copy">Dedicated copilot workspace with isolated context and live handoff back into the main bench.</p>
                <div className="tool-actions left">
                  <button type="button" className="ghost" onClick={() => setToolTab("assistant")}>Open Assistant</button>
                  <button type="button" className="ghost" onClick={() => setAppMode("skyeide")}>Return to SkyeIDE</button>
                </div>
              </section>
            )}
          </div>

          {appMode === "skyeide" && (
            <section className="right-dock-module file-pane-dock">
              <header className="right-dock-head">
                <strong>Left Middle Dock</strong>
                <select value={leftMiddleDockApp} onChange={(event) => setLeftMiddleDockApp(event.target.value as DockApp)}>
                  {dockApps.map((app) => (
                    <option key={`left-middle-dock-panel-${app}`} value={app}>{app}</option>
                  ))}
                </select>
              </header>
              <div className="right-dock-embed-shell">
                <div className="tool-actions left">
                  <a className="ghost" href={leftMiddleDockUrl} target="_blank" rel="noreferrer">Open Standalone</a>
                </div>
                <iframe
                  className="right-dock-embed"
                  title={`Left Middle Dock ${leftMiddleDockApp}`}
                  src={leftMiddleDockEmbedUrl}
                />
              </div>
            </section>
          )}

          {appMode === "skyeide" && (
            <section className="right-dock-module file-pane-dock">
              <header className="right-dock-head">
                <strong>Left Bottom Dock</strong>
                <select value={leftBottomDockApp} onChange={(event) => setLeftBottomDockApp(event.target.value as DockApp)}>
                  {dockApps.map((app) => (
                    <option key={`left-bottom-dock-${app}`} value={app}>{app}</option>
                  ))}
                </select>
              </header>
              <div className="right-dock-embed-shell">
                <div className="tool-actions left">
                  <a className="ghost" href={leftBottomDockUrl} target="_blank" rel="noreferrer">Open Standalone</a>
                </div>
                <iframe
                  className="right-dock-embed"
                  title={`Left Bottom Dock ${leftBottomDockApp}`}
                  src={leftBottomDockEmbedUrl}
                />
              </div>
            </section>
          )}
        </aside>

        <div
          className="panel-resizer vertical"
          role="separator"
          aria-label="Resize workspace columns"
          onPointerDown={(event) => beginResize("sidebar", event)}
        />

        <main className="editor-pane">
          {appMode === "skyeide" ? (
            selectedSkyeApp === "SkyeDocs" ? (
              <>
                <section className="app-module workspace-stage-settings">
                  <header>
                    <h2>Primary Workspace Stack</h2>
                    <p>The extra workspace stack is now optional. Keep it collapsed unless you actively need staging or validation rails ahead of the IDE.</p>
                  </header>
                  <div className="tool-actions left">
                    <button className="ghost" type="button" onClick={() => setShowWorkspaceStack((old) => !old)}>
                      {showWorkspaceStack ? "Collapse Stack" : "Expand Stack"}
                    </button>
                    <button className="ghost" type="button" onClick={() => setShowExecutionSettings(true)}>
                      Configure Pipeline
                    </button>
                    <span className="telemetry-chip">Configured: {`${workspaceStageLabel(topWorkspaceApp)} -> ${workspaceStageLabel(middleWorkspaceApp)} -> ${workspaceStageLabel(bottomWorkspaceApp)}`}</span>
                  </div>
                  <div className="onboarding-summary-grid">
                    <div>
                      <strong>Primary stack</strong>
                      <span>{`${workspaceStageLabel(topWorkspaceApp)} -> ${workspaceStageLabel(middleWorkspaceApp)} -> ${workspaceStageLabel(bottomWorkspaceApp)}`}</span>
                    </div>
                    <div>
                      <strong>Validation rails</strong>
                      <span>Smokehouse-Standalone to API-Playground</span>
                    </div>
                  </div>
                </section>

                {showWorkspaceStack ? (
                  ([topWorkspaceApp, middleWorkspaceApp, bottomWorkspaceApp, "Smokehouse-Standalone", "API-Playground"] as WorkspaceStageApp[]).map((app, index) => {
                    const slot =
                      index === 0
                        ? "Top Workspace"
                        : index === 1
                          ? "Middle Workspace"
                          : index === 2
                            ? "Bottom Workspace"
                            : index === 3
                              ? "Validation Workspace: Smokehouse"
                              : "Validation Workspace: API Playground";
                    const src = workspaceStageUrl(app);
                    return (
                      <section key={`stack-${slot}-${app}`} className="app-module workspace-stage-block">
                        <header>
                          <h2>{slot}: {workspaceStageLabel(app)}</h2>
                          <p>{index >= 3 ? "Fixed 1:1 validation guard rail." : "1:1 embedded surface in the primary container workspace."}</p>
                        </header>
                        <div className="tool-actions left">
                          <a className="ghost" href={src} target="_blank" rel="noreferrer">Open Standalone</a>
                        </div>
                        <iframe className="workspace-stage-frame" title={`${slot}-${workspaceStageLabel(app)}`} src={src} />
                      </section>
                    );
                  })
                ) : (
                  <section className="app-module workspace-stage-block">
                    <header>
                      <h2>Workspace Stack Collapsed</h2>
                      <p>The IDE workspace below is now the primary working surface. Expand the stack only when you need sidecar staging or validation rails.</p>
                    </header>
                    <div className="tool-actions left">
                      <button className="ghost" type="button" onClick={() => setShowWorkspaceStack(true)}>Open Stack</button>
                    </div>
                  </section>
                )}

                <section className="app-module ide-module-focus">
                  <header><h2>IDE Workspace</h2><p>Real app-focused workspace with side-by-side code and live preview that can be detached.</p></header>
                  <div className="tool-row split">
                    <input value={newFilePath} onChange={(event) => setNewFilePath(event.target.value)} placeholder="src/new-file.ts" />
                    <div className="tool-actions left">
                      <button className="ghost" type="button" onClick={addWorkspaceFile}>Add File</button>
                      <button className="ghost" type="button" onClick={deleteActiveWorkspaceFile}>Delete Active</button>
                    </div>
                  </div>
                  <div className="tool-row split">
                    <input value={ideCommitMessage} onChange={(event) => setIdeCommitMessage(event.target.value)} placeholder="Commit message for GitHub push" />
                  </div>
                  <div className="tool-actions left">
                    <button className="ghost" type="button" onClick={() => void saveWorkspaceNow()} disabled={isSavingWorkspace}>
                      {isSavingWorkspace ? "Saving..." : "Save Workspace"}
                    </button>
                    <button className="ghost" type="button" onClick={() => void loadWorkspaceNow()} disabled={isLoadingWorkspace}>
                      {isLoadingWorkspace ? "Loading..." : "Load Workspace"}
                    </button>
                    <button className="ghost" type="button" onClick={() => void pushWorkspaceToGitHub()} disabled={isGitPushing}>
                      {isGitPushing ? "Pushing..." : "Push to GitHub"}
                    </button>
                    <button className="ghost" type="button" onClick={() => void deployWorkspaceNow()} disabled={isDeployingWorkspace}>
                      {isDeployingWorkspace ? "Deploying..." : "Deploy to Netlify"}
                    </button>
                    <button className="ghost" type="button" onClick={() => void exportSelectedAppAsSkye()}>
                      Export .skye
                    </button>
                    <button className="ghost" type="button" onClick={() => document.getElementById("skye-import-input")?.click()} disabled={isImportingSkye}>
                      {isImportingSkye ? "Importing..." : "Import .skye"}
                    </button>
                  </div>
                  <input id="skye-import-input" type="file" accept=".skye" style={{ display: "none" }} onChange={onImportSkyeFile} />
                  {ideOpsResult && <p className="muted-copy">{ideOpsResult}</p>}
                  <div className="ide-super-shell">
                    <aside className="ide-super-rail" aria-label="Workbench rail">
                      <button className={`ghost ${ideRailTab === "explorer" ? "active" : ""}`} type="button" onClick={() => setIdeRailTab("explorer")}>Files</button>
                      <button className={`ghost ${ideRailTab === "search" ? "active" : ""}`} type="button" onClick={() => setIdeRailTab("search")}>Search</button>
                      <button className={`ghost ${ideRailTab === "git" ? "active" : ""}`} type="button" onClick={() => setIdeRailTab("git")}>Git</button>
                      <button className={`ghost ${ideRailTab === "run" ? "active" : ""}`} type="button" onClick={() => setIdeRailTab("run")}>Run</button>
                      <button className={`ghost ${ideRailTab === "extensions" ? "active" : ""}`} type="button" onClick={() => setIdeRailTab("extensions")}>Ext</button>
                    </aside>

                    <aside className="ide-super-sidebar" aria-label="Workbench sidebar">
                      {ideRailTab === "explorer" && (
                        <>
                          <h3>Workspace Files</h3>
                          <div className="ide-sidebar-list">
                            {files.map((file) => (
                              <button
                                key={`explorer-${file.path}`}
                                type="button"
                                className={`ghost ide-sidebar-item ${activePath === file.path ? "active" : ""}`}
                                onClick={() => setActivePath(file.path)}
                              >
                                {file.path}
                              </button>
                            ))}
                          </div>
                        </>
                      )}

                      {ideRailTab === "search" && (
                        <>
                          <h3>Find File</h3>
                          <input
                            value={ideFileSearch}
                            onChange={(event) => setIdeFileSearch(event.target.value)}
                            placeholder="Search by path..."
                          />
                          <div className="ide-sidebar-list">
                            {ideVisibleFiles.map((file) => (
                              <button
                                key={`search-${file.path}`}
                                type="button"
                                className={`ghost ide-sidebar-item ${activePath === file.path ? "active" : ""}`}
                                onClick={() => setActivePath(file.path)}
                              >
                                {file.path}
                              </button>
                            ))}
                            {!ideVisibleFiles.length && <p className="muted-copy">No files match that path filter.</p>}
                          </div>
                        </>
                      )}

                      {ideRailTab === "git" && (
                        <>
                          <h3>Git Actions</h3>
                          <p className="muted-copy">Commit and push from the same workspace shell.</p>
                          {workspaceConflict && (
                            <div className="smoke-warning">
                              <strong>Save Conflict</strong>
                              <div>{workspaceConflict.message}</div>
                              <div className="tool-actions left">
                                <button className="ghost" type="button" onClick={() => void loadWorkspaceNow()} disabled={isLoadingWorkspace}>
                                  Reload Server Copy
                                </button>
                                <button className="ghost" type="button" onClick={() => void saveWorkspaceNow(true)} disabled={isSavingWorkspace}>
                                  Force Save
                                </button>
                              </div>
                            </div>
                          )}
                          <div className="tool-actions left">
                            <button className="ghost" type="button" onClick={() => void saveWorkspaceNow()} disabled={isSavingWorkspace}>
                              {isSavingWorkspace ? "Saving..." : "Save"}
                            </button>
                            <button className="ghost" type="button" onClick={() => void pushWorkspaceToGitHub()} disabled={isGitPushing}>
                              {isGitPushing ? "Pushing..." : "Push"}
                            </button>
                          </div>
                        </>
                      )}

                      {ideRailTab === "run" && (
                        <>
                          <h3>Run + Deploy</h3>
                          <p className="muted-copy">Preview is available inline. Deploy remains one-click here.</p>
                          <div className="tool-actions left">
                            <button className="ghost" type="button" onClick={() => setAutoSaveEnabled((old) => !old)}>
                              Autosave: {autoSaveEnabled ? "ON" : "OFF"}
                            </button>
                            <button className="ghost" type="button" onClick={() => void saveWorkspaceNow()} disabled={isSavingWorkspace}>
                              {isSavingWorkspace ? "Saving..." : "Save Now"}
                            </button>
                          </div>
                          <div className="tool-actions left">
                            <button className="ghost" type="button" onClick={retryPreview}>Retry Preview</button>
                            <button className="ghost" type="button" onClick={openDetachedPreview}>Open Preview</button>
                            <button className="ghost" type="button" onClick={() => void deployWorkspaceNow()} disabled={isDeployingWorkspace}>
                              {isDeployingWorkspace ? "Deploying..." : "Deploy"}
                            </button>
                          </div>
                        </>
                      )}

                      {ideRailTab === "extensions" && (
                        <>
                          <h3>Workbench Status</h3>
                          <p className="muted-copy">Drop-in shell is wired into SuperIDE. This stays in the same app runtime and identity context.</p>
                          <p className="muted-copy">Current file: {activeFile?.path || "none"}</p>
                        </>
                      )}
                    </aside>

                  <div className="ide-super-main">
                    <div className="preview-head">
                      <strong>Code + Live Preview</strong>
                      <div className="tool-actions left">
                        <span className="telemetry-chip">Runtime: {previewRuntimeMode}</span>
                        <button className="ghost" type="button" onClick={() => setPreviewRuntimeMode("quick")} disabled={previewRuntimeMode === "quick"}>Quick</button>
                        <button className="ghost" type="button" onClick={() => setPreviewRuntimeMode("project")} disabled={previewRuntimeMode === "project"}>Project</button>
                        <span className="telemetry-chip">Autosave: {autoSaveEnabled ? "on" : "off"}</span>
                        <span className="telemetry-chip">Files: {workspaceDirty ? "Dirty" : "Saved"}</span>
                        <span className="telemetry-chip">Preview Health: {previewHealth}</span>
                        <button className="ghost" type="button" onClick={() => setPreviewPane("split")} disabled={previewPane === "split"}>Split</button>
                        <button className="ghost" type="button" onClick={() => setPreviewPane("code")} disabled={previewPane === "code"}>Code</button>
                        <button className="ghost" type="button" onClick={() => setPreviewPane("preview")} disabled={previewPane === "preview"}>Preview</button>
                        <button className="ghost" type="button" onClick={() => setPreviewDevice("desktop")} disabled={previewDevice === "desktop"}>Desktop</button>
                        <button className="ghost" type="button" onClick={() => setPreviewDevice("mobile")} disabled={previewDevice === "mobile"}>Mobile</button>
                        <button className="ghost" type="button" onClick={retryPreview}>Retry</button>
                        <button className="ghost" type="button" onClick={openDetachedPreview}>Detach</button>
                      </div>
                    </div>
                    <div className={`ide-workbench ${previewPane}`}>
                      {previewPane === "split" ? (
                        <div className="ide-split-resizable" ref={ideSplitRef}>
                          <div className="ide-code-col" style={{ width: `${ideSplitRatio}%` }}>
                            <div className="editor-head">{activeFile?.path || "No file"}</div>
                            <Editor
                              height="72vh"
                              theme="vs-dark"
                              path={activeFile?.path}
                              value={activeFile?.content || ""}
                              onChange={(value) => updateActiveFileContent(value || "")}
                              options={{ minimap: { enabled: false }, fontSize: 13, wordWrap: "on", automaticLayout: true }}
                            />
                          </div>
                          <div
                            className="panel-resizer vertical"
                            role="separator"
                            aria-label="Resize code and preview"
                            onPointerDown={(event) => beginResize("ide-split", event)}
                          />
                          <div className="preview-shell" style={{ width: `${100 - ideSplitRatio}%` }}>
                            {effectivePreviewDocument ? (
                              <div className={`preview-frame-wrap ${previewDevice}`}>
                                <iframe key={`${activeFile?.path || "file"}-${effectivePreviewDocument.length}-${previewRuntimeMode}`} title="IDE File Preview" className="preview-frame" srcDoc={effectivePreviewDocument} sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads" />
                              </div>
                            ) : effectivePreviewUrl ? (
                              <div className={`preview-frame-wrap ${previewDevice}`}>
                                <iframe
                                  key={`${effectivePreviewUrl}-${previewReloadToken}-${previewRuntimeMode}`}
                                  title="IDE Live Preview"
                                  className="preview-frame"
                                  src={effectivePreviewUrl}
                                  sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads"
                                  onLoad={() => {
                                    setPreviewFrameError("");
                                    pushIdeDiagnostic("info", `${previewRuntimeMode} preview loaded.`);
                                  }}
                                  onError={() => {
                                    const message = `Preview failed for ${effectivePreviewUrl}`;
                                    setPreviewFrameError(message);
                                    pushIdeDiagnostic("error", message);
                                  }}
                                />
                                {previewFrameError && (
                                  <p className="muted-copy">
                                    {previewFrameError}. <button className="ghost" type="button" onClick={openDetachedPreview}>Open in new tab</button>
                                  </p>
                                )}
                              </div>
                            ) : (
                              <p className="muted-copy">Preview supports live app surfaces and `.html`, `.htm`, `.svg`, `.md` file rendering.</p>
                            )}
                          </div>
                        </div>
                      ) : (
                        <>
                          {previewPane !== "preview" && (
                            <div className="ide-code-col">
                              <div className="editor-head">{activeFile?.path || "No file"}</div>
                              <Editor
                                height="76vh"
                                theme="vs-dark"
                                path={activeFile?.path}
                                value={activeFile?.content || ""}
                                onChange={(value) => updateActiveFileContent(value || "")}
                                options={{ minimap: { enabled: false }, fontSize: 13, wordWrap: "on", automaticLayout: true }}
                              />
                            </div>
                          )}
                          {previewPane !== "code" && (
                            <div className="preview-shell">
                              {effectivePreviewDocument ? (
                                <div className={`preview-frame-wrap ${previewDevice}`}>
                                  <iframe key={`${activeFile?.path || "file"}-${effectivePreviewDocument.length}-${previewRuntimeMode}`} title="IDE File Preview" className="preview-frame" srcDoc={effectivePreviewDocument} sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads" />
                                </div>
                              ) : effectivePreviewUrl ? (
                                <div className={`preview-frame-wrap ${previewDevice}`}>
                                  <iframe
                                    key={`${effectivePreviewUrl}-${previewReloadToken}-${previewRuntimeMode}`}
                                    title="IDE Live Preview"
                                    className="preview-frame"
                                    src={effectivePreviewUrl}
                                    sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads"
                                    onLoad={() => {
                                      setPreviewFrameError("");
                                      pushIdeDiagnostic("info", `${previewRuntimeMode} preview loaded.`);
                                    }}
                                    onError={() => {
                                      const message = `Preview failed for ${effectivePreviewUrl}`;
                                      setPreviewFrameError(message);
                                      pushIdeDiagnostic("error", message);
                                    }}
                                  />
                                  {previewFrameError && (
                                    <p className="muted-copy">
                                      {previewFrameError}. <button className="ghost" type="button" onClick={openDetachedPreview}>Open in new tab</button>
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <p className="muted-copy">Preview supports live app surfaces and `.html`, `.htm`, `.svg`, `.md` file rendering.</p>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    <div className="ide-diagnostics">
                      <div className="ide-diagnostics-head">
                        <strong>Diagnostics</strong>
                        <button className="ghost" type="button" onClick={() => setIdeDiagnostics([])}>Clear</button>
                      </div>
                      <div className="ide-diagnostics-list">
                        {!ideDiagnostics.length && <p className="muted-copy">No diagnostics yet.</p>}
                        {ideDiagnostics.map((entry) => (
                          <div key={entry.id} className={`ide-diagnostic-row ${entry.level}`}>
                            <span className="telemetry-chip">{entry.level.toUpperCase()}</span>
                            <span>{entry.message}</span>
                            <small>{new Date(entry.at).toLocaleTimeString()}</small>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </section>
              </>
            ) : (
              <>
                <section className="app-quickstart-bar">
                  <header>
                    <h2>{selectedSkyeApp} Quick Start</h2>
                    <p>Interactive tutorial is available on demand without taking over the workspace.</p>
                  </header>
                  {!dismissedSpotlightByApp[selectedSkyeApp] && (
                    <div className="smoke-warning">
                      <strong>First-Run Spotlight</strong>
                      <div>Use Start Tutorial, validate auth/key context, then run one real workflow and save/export.</div>
                      <div className="tool-actions left">
                        <button className="ghost" type="button" onClick={() => setShowTutorialPanel(true)}>Open Tutorial Now</button>
                        <button className="ghost" type="button" onClick={dismissCurrentSpotlight}>Dismiss Spotlight</button>
                      </div>
                    </div>
                  )}
                  <p className="muted-copy">App health: {selectedAppHealthSignal}</p>
                  <div className="tool-actions left">
                    <button className="ghost" type="button" onClick={() => setShowTutorialPanel(true)}>
                      Start Tutorial
                    </button>
                    <button className="ghost" type="button" onClick={exportAppHealthSnapshot}>
                      Export Health Snapshot
                    </button>
                    <button className="ghost" type="button" onClick={resetSelectedAppDemoState}>
                      Reset App Demo State
                    </button>
                  </div>
                </section>
                {renderAppModule()}
                {showTutorialPanel && renderTutorialPanel(selectedSkyeApp)}
              </>
            )
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

        <div
          className="panel-resizer vertical"
          role="separator"
          aria-label="Resize right dock panel"
          onPointerDown={(event) => beginResize("rightpanel", event)}
        />

        <aside className="workspace-right-pane" aria-label="Right dock panel">
          <section className="right-dock-module">
            <header className="right-dock-head">
              <strong>Top Dock</strong>
              <select value={rightTopDockApp} onChange={(event) => setRightTopDockApp(event.target.value as DockApp)}>
                {dockApps.map((app) => (
                  <option key={`top-dock-${app}`} value={app}>{app}</option>
                ))}
              </select>
            </header>
            <div className="right-dock-embed-shell">
              <div className="tool-actions left">
                <a className="ghost" href={rightTopDockUrl} target="_blank" rel="noreferrer">Open Standalone</a>
              </div>
              <iframe
                className="right-dock-embed"
                title={`Top Dock ${rightTopDockApp}`}
                src={rightTopDockEmbedUrl}
              />
            </div>
          </section>

          <section className="right-dock-module">
            <header className="right-dock-head">
              <strong>Middle Dock</strong>
              <select value={rightMiddleDockApp} onChange={(event) => setRightMiddleDockApp(event.target.value as DockApp)}>
                {dockApps.map((app) => (
                  <option key={`middle-dock-${app}`} value={app}>{app}</option>
                ))}
              </select>
            </header>
            <div className="right-dock-embed-shell">
              <div className="tool-actions left">
                <a className="ghost" href={rightMiddleDockUrl} target="_blank" rel="noreferrer">Open Standalone</a>
              </div>
              <iframe
                className="right-dock-embed"
                title={`Middle Dock ${rightMiddleDockApp}`}
                src={rightMiddleDockEmbedUrl}
              />
            </div>
          </section>

          <section className="right-dock-module">
            <header className="right-dock-head">
              <strong>Bottom Dock</strong>
              <select value={rightBottomDockApp} onChange={(event) => setRightBottomDockApp(event.target.value as DockApp)}>
                {dockApps.map((app) => (
                  <option key={`bottom-dock-${app}`} value={app}>{app}</option>
                ))}
              </select>
            </header>
            <div className="right-dock-embed-shell">
              <div className="tool-actions left">
                <a className="ghost" href={rightBottomDockUrl} target="_blank" rel="noreferrer">Open Standalone</a>
              </div>
              <iframe
                className="right-dock-embed"
                title={`Bottom Dock ${rightBottomDockApp}`}
                src={rightBottomDockEmbedUrl}
              />
            </div>
          </section>
        </aside>

      </div>
      </div>
      <footer className="build-metadata-footer">
        <span>Build {buildMetadata.version}</span>
        <span>Commit {buildMetadata.commit}</span>
        <span>Built {buildMetadata.builtAt}</span>
        <span>Signature {buildMetadata.signature}</span>
      </footer>
      {commandPaletteOpen && (
        <div className="command-palette-overlay" onClick={() => setCommandPaletteOpen(false)}>
          <div className="command-palette" onClick={(event) => event.stopPropagation()}>
            <input
              autoFocus
              value={commandPaletteQuery}
              onChange={(event) => setCommandPaletteQuery(event.target.value)}
              placeholder="Type a command (Ctrl/Cmd+K)"
            />
            <div className="command-palette-list">
              {filteredCommandPaletteActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  className="command-palette-item"
                  onClick={() => {
                    setCommandPaletteOpen(false);
                    setCommandPaletteQuery("");
                    action.run();
                  }}
                >
                  {action.label}
                </button>
              ))}
              {!filteredCommandPaletteActions.length && <p className="muted-copy">No commands match this query.</p>}
            </div>
          </div>
        </div>
      )}
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
