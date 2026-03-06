# AI Cheat Sheet (Simple Version)

## What You Already Have

You now have 5 helper files in this repo:

1. `.github/copilot-instructions.md`
- Main project rules.

2. `.github/instructions/netlify-functions.instructions.md`
- Rules for backend function edits.

3. `.github/instructions/worker-runtime.instructions.md`
- Rules for worker/security edits.

4. `.github/prompts/release-gate.prompt.md`
- One command to run important checks in order.

5. `.github/agents/superide-integration.agent.md`
- A special mode for big changes across multiple parts.

## How To Use (No Technical Terms)

### Normal work
- Just ask for changes like usual.
- The assistant reads your project rule files and should follow them automatically.

### Before a release
- Run `/release-gate`
- You get a simple pass/fail summary.

### Big, risky changes
- Use the `SuperIDE Integration` agent mode.
- It is designed to keep multi-part changes coordinated.

## Important: New Chat Sessions

Even if every chat is new, these files still stay in your repo.

That means:
- New chat: fresh conversation memory.
- Same repo files: same rules loaded again.

So yes, the rules can still apply in new sessions because they are saved in the project itself.

## How To Check In 10 Seconds

At the start of a new chat, ask:

- "Tell me the project rules you are following from this repo."

If it lists your `.github/...` files and summarizes them correctly, you are good.

## If It Ever Ignores Rules

Use this quick message:

- "Follow the rules in `.github/copilot-instructions.md` and all files in `.github/instructions/` before making changes."

Then ask it to continue.

## Bottom Line

You do NOT need to rebuild this setup each time.
The rules are saved in the repo and should carry across new Codespaces and new chats.