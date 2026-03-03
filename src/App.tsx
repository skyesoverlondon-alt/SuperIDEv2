import { FormEvent, useEffect, useMemo, useState } from "react";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: string;
};

type HealthPayload = {
  ok?: boolean;
  name?: string;
};

const DEFAULT_WORKER_URL = "https://kaixu-superide-runner.workers.dev";

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function App() {
  const [workerUrl, setWorkerUrl] = useState(() => {
    return localStorage.getItem("kx.worker.url") || DEFAULT_WORKER_URL;
  });
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      id: makeId(),
      role: "assistant",
      text: "Runner UI online. Send any message to run a smoke-check against /health.",
      at: new Date().toISOString(),
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [overlayText, setOverlayText] = useState("Booting runner console...");
  const [runnerStatus, setRunnerStatus] = useState<"unknown" | "ok" | "fail">("unknown");

  const healthUrl = useMemo(() => `${normalizeBaseUrl(workerUrl)}/health`, [workerUrl]);

  useEffect(() => {
    localStorage.setItem("kx.worker.url", workerUrl);
  }, [workerUrl]);

  useEffect(() => {
    void runSmokeTest("Initial smoke check...");
  }, []);

  async function runSmokeTest(phaseText = "Running smoke test...") {
    setIsLoading(true);
    setOverlayText(phaseText);
    try {
      const response = await fetch(healthUrl, { method: "GET" });
      const data = (await response.json()) as HealthPayload;
      if (!response.ok || !data?.ok) {
        setRunnerStatus("fail");
        return {
          ok: false,
          text: `Smoke failed (${response.status}). Check Worker URL and deployment.`,
        };
      }
      setRunnerStatus("ok");
      return {
        ok: true,
        text: `Smoke passed: ${data.name || "runner"} is healthy.`,
      };
    } catch (error: any) {
      setRunnerStatus("fail");
      return {
        ok: false,
        text: `Smoke failed: ${error?.message || "network error"}`,
      };
    } finally {
      setIsLoading(false);
    }
  }

  async function onSend(event: FormEvent) {
    event.preventDefault();
    const prompt = input.trim();
    if (!prompt || isLoading) return;

    const userMessage: Message = {
      id: makeId(),
      role: "user",
      text: prompt,
      at: new Date().toISOString(),
    };
    setMessages((old) => [...old, userMessage]);
    setInput("");

    const result = await runSmokeTest("Running smoke-check for your message...");
    const assistantText = result.ok
      ? `${result.text}\n\nYou said: \"${prompt}\"\n\nWorker endpoint: ${healthUrl}`
      : `${result.text}\n\nYou said: \"${prompt}\"`;

    setMessages((old) => [
      ...old,
      {
        id: makeId(),
        role: "assistant",
        text: assistantText,
        at: new Date().toISOString(),
      },
    ]);
  }

  async function onManualSmoke() {
    const result = await runSmokeTest("Manual smoke-check in progress...");
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

  return (
    <div className="app-shell">
      {isLoading && (
        <div className="smoke-screen" role="status" aria-live="polite">
          <div className="smoke-core">
            <div className="smoke-ring" />
            <p>{overlayText}</p>
          </div>
        </div>
      )}

      <aside className="side-panel">
        <h1>kAIxU Runner UI</h1>
        <p className="muted">Neural-Space-inspired console for smoke tests + chat flow.</p>

        <label htmlFor="worker-url">Worker URL</label>
        <input
          id="worker-url"
          value={workerUrl}
          onChange={(event) => setWorkerUrl(event.target.value)}
          placeholder="https://your-worker.workers.dev"
        />

        <button type="button" className="ghost" onClick={onManualSmoke} disabled={isLoading}>
          Run Smoke Test
        </button>

        <div className={`status ${runnerStatus}`}>
          Status: {runnerStatus === "ok" ? "Healthy" : runnerStatus === "fail" ? "Failing" : "Unknown"}
        </div>
      </aside>

      <main className="chat-panel">
        <header>
          <h2>Runner Chat</h2>
          <span>{healthUrl}</span>
        </header>

        <section className="messages">
          {messages.map((message) => (
            <article key={message.id} className={`bubble ${message.role}`}>
              <div className="meta">{message.role === "assistant" ? "Runner" : "You"}</div>
              <p>{message.text}</p>
            </article>
          ))}
        </section>

        <form className="composer" onSubmit={onSend}>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Type a message to run a Worker smoke-check..."
            rows={2}
          />
          <button type="submit" disabled={isLoading || !input.trim()}>
            Send
          </button>
        </form>
      </main>
    </div>
  );
}
