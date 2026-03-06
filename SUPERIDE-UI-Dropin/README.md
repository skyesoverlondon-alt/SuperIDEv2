# SuperIDE UI Drop-In

This is the UI-only browser IDE shell you asked for:
- file explorer
- code editor
- tabs
- live preview
- console
- VS Code-style chrome

## Run

```bash
npm install
npm run dev
```

## What this is

A front-end workbench built on Sandpack. It does not ship your repo plumbing, auth, saves, git, deploy, remote execution, or container logic.

## Where to wire your own stack

- `src/components/SuperIDEWorkbench.jsx`
- `src/lib/defaultFiles.js`

## Swap in your own files

Replace `defaultFiles` with files from your own backend or repo API.

## Notes

This is the right move when you already have the real backend guts and only need the editor surface.
