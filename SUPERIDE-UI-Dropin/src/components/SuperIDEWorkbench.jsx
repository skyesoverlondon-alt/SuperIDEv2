import { useMemo, useState } from "react";
import {
  SandpackProvider,
  SandpackLayout,
  SandpackFileExplorer,
  SandpackCodeEditor,
  SandpackPreview,
  SandpackConsole,
  SandpackFileTabs,
} from "@codesandbox/sandpack-react";
import { defaultFiles } from "../lib/defaultFiles";

const activityItems = [
  { id: "explorer", label: "Explorer", glyph: "📁" },
  { id: "search", label: "Search", glyph: "⌕" },
  { id: "git", label: "Source Control", glyph: "⑂" },
  { id: "run", label: "Run", glyph: "▶" },
  { id: "extensions", label: "Extensions", glyph: "◇" },
];

const previewModes = [
  { id: "preview", label: "Preview" },
  { id: "console", label: "Console" },
];

export default function SuperIDEWorkbench() {
  const [activeRail, setActiveRail] = useState("explorer");
  const [activePreviewMode, setActivePreviewMode] = useState("preview");

  const files = useMemo(() => defaultFiles, []);

  return (
    <div className="workbench-shell">
      <header className="topbar">
        <div className="topbar-left">
          <div className="traffic-lights" aria-hidden="true">
            <span className="light red" />
            <span className="light yellow" />
            <span className="light green" />
          </div>
          <div>
            <div className="app-title">kAIxU SuperIDE UI</div>
            <div className="app-subtitle">Workbench shell only — wire your own backend plumbing</div>
          </div>
        </div>
        <nav className="topbar-nav" aria-label="Workbench areas">
          <a href="#editor">Editor</a>
          <a href="#preview">Preview</a>
          <a href="#console">Console</a>
        </nav>
      </header>

      <SandpackProvider
        template="react"
        theme="dark"
        files={files}
        options={{
          activeFile: "/App.js",
          visibleFiles: ["/App.js", "/styles.css"],
          showTabs: true,
          showNavigator: true,
          showLineNumbers: true,
          wrapContent: true,
          recompileMode: "delayed",
          recompileDelay: 300,
          autorun: true,
        }}
      >
        <div className="workbench-grid">
          <aside className="activity-rail" aria-label="Activity rail">
            {activityItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === activeRail ? "rail-btn active" : "rail-btn"}
                onClick={() => setActiveRail(item.id)}
                title={item.label}
                aria-label={item.label}
              >
                <span>{item.glyph}</span>
              </button>
            ))}
          </aside>

          <aside className="sidebar-panel">
            <div className="panel-title-row">
              <span className="panel-kicker">{activeRail}</span>
              <strong>Project</strong>
            </div>
            <div className="panel-body">
              <SandpackFileExplorer autoHiddenFiles={false} />
            </div>
          </aside>

          <section className="editor-pane" id="editor">
            <div className="section-header">
              <span>Workspace</span>
              <small>React runtime • hot preview</small>
            </div>
            <SandpackLayout className="editor-layout">
              <div className="editor-stack">
                <SandpackFileTabs />
                <SandpackCodeEditor
                  showLineNumbers
                  showInlineErrors
                  wrapContent
                  closableTabs
                  style={{ height: "100%" }}
                />
              </div>
            </SandpackLayout>
          </section>

          <section className="preview-pane" id="preview">
            <div className="section-header preview-header">
              <div className="preview-tabs" role="tablist" aria-label="Preview modes">
                {previewModes.map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    className={mode.id === activePreviewMode ? "preview-tab active" : "preview-tab"}
                    onClick={() => setActivePreviewMode(mode.id)}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
              <small>Instant browser runtime</small>
            </div>

            <div className="preview-body">
              {activePreviewMode === "preview" ? (
                <SandpackPreview
                  showNavigator
                  showRefreshButton
                  showOpenInCodeSandbox={false}
                  style={{ height: "100%" }}
                />
              ) : (
                <div className="console-wrapper" id="console">
                  <SandpackConsole resetOnPreviewRestart showHeader style={{ height: "100%" }} />
                </div>
              )}
            </div>
          </section>
        </div>
      </SandpackProvider>

      <footer className="statusbar">
        <div className="status-left">
          <span>main</span>
          <span>UTF-8</span>
          <span>LF</span>
          <span>JavaScript React</span>
        </div>
        <div className="status-right">
          <span>Preview ready</span>
          <span>Sandpack runtime</span>
        </div>
      </footer>
    </div>
  );
}
