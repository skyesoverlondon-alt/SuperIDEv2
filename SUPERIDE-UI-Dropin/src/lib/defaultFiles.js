export const defaultFiles = {
  "/App.js": {
    code: `import "./styles.css";

export default function App() {
  const cards = [
    { title: "Gateway Health", value: "OK", detail: "Three gates online" },
    { title: "Preview Runtime", value: "Live", detail: "Sandpack running" },
    { title: "Mode", value: "UI Only", detail: "Wire your own plumbing" },
  ];

  return (
    <main className="page-shell">
      <section className="hero-card">
        <p className="eyebrow">Skyes Over London LC</p>
        <h1>SuperIDE UI Workbench</h1>
        <p className="hero-copy">
          This is the browser IDE surface. File explorer on the left, live editor in the
          middle, running preview on the right. Swap these files with your repo plumbing
          and you are off to the races.
        </p>
      </section>

      <section className="card-grid">
        {cards.map((card) => (
          <article key={card.title} className="stat-card">
            <span>{card.title}</span>
            <strong>{card.value}</strong>
            <small>{card.detail}</small>
          </article>
        ))}
      </section>
    </main>
  );
}`,
    active: true,
  },
  "/styles.css": {
    code: `.page-shell {
  min-height: 100vh;
  background:
    radial-gradient(circle at top left, rgba(138, 92, 246, 0.28), transparent 32%),
    radial-gradient(circle at top right, rgba(255, 215, 0, 0.18), transparent 30%),
    linear-gradient(180deg, #090c12 0%, #111828 100%);
  color: #f4f7fb;
  font-family: Inter, Arial, sans-serif;
  padding: 32px;
}

.hero-card,
.stat-card {
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(18, 22, 33, 0.86);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
  border-radius: 20px;
}

.hero-card {
  padding: 28px;
  margin-bottom: 22px;
}

.hero-card h1 {
  margin: 0 0 10px;
  font-size: 42px;
  line-height: 1.05;
}

.eyebrow {
  margin: 0 0 10px;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-size: 12px;
  color: #ceb8ff;
}

.hero-copy {
  max-width: 760px;
  margin: 0;
  color: #d0d7e6;
  line-height: 1.65;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}

.stat-card {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.stat-card span,
.stat-card small {
  color: #aeb9cf;
}

.stat-card strong {
  font-size: 28px;
}

@media (max-width: 840px) {
  .card-grid {
    grid-template-columns: 1fr;
  }

  .hero-card h1 {
    font-size: 32px;
  }
}`,
  },
  "/index.js": {
    code: `import { createRoot } from "react-dom/client";
import App from "./App";

const root = createRoot(document.getElementById("root"));
root.render(<App />);`,
    hidden: true,
  },
  "/package.json": {
    code: `{
  "name": "runtime-preview",
  "main": "/index.js"
}`,
    hidden: true,
  },
};
