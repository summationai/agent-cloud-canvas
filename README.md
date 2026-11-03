# agent.cloud canvas

A plugin for Claude (desktop Cowork and Code, Claude Code) and Codex (desktop and CLI) that connects your own agent to
your agent.cloud canvas, where it builds an app with you: versions that differ on purpose, your choice at the forks that
matter, each one live.

It brings one MCP server, the canvas, and its skill. Publishing a pick as an agent.cloud app uses the
[agent.cloud plugin](https://github.com/summationai/agent-cloud-plugin).

Start at the canvas's Bring your agent page, which installs it in one click. By hand:

```text
Claude Code   claude plugin marketplace add summationai/agent-cloud-canvas && claude plugin install canvas@agent-cloud-canvas
Codex         codex plugin marketplace add summationai/agent-cloud-canvas && codex plugin add canvas@agent-cloud-canvas
```

This repository is a test bed for the canvas's onboarding (it points at canvas-e2e.agent.cloud); it merges back into the
agent.cloud plugin.
