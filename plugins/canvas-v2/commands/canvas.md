---
description: Put this project's app on your canvas, beside the chat
argument-hint: [port]
---
Put my app on my canvas, beside this chat, with the canvas tools (this plugin's show_local).

If I wrote a port after /canvas, use http://localhost:<that port>/ and skip finding: $ARGUMENTS
Find the app yourself, without asking me. The app is the one the project's people use: what its dev script (or .claude/launch.json's main entry) serves, and in a monorepo its main web app. Never a tool beside it: Storybook, a docs site, a test runner or its UI, a database studio, a mail catcher or a debugger. Skip any port, script or launch entry named for one (storybook, docs, test, e2e, studio), and any page whose title names one.
1. The app Claude's own preview runs for this project, if any (.claude/launch.json names it and its port), when it's running.
2. Else this project's app, if it's running: list the ports this machine listens on with their processes (macOS and Linux: lsof -nP -iTCP -sTCP:LISTEN), and keep those whose process works in this project's folder (lsof -a -p <pid> -d cwd). Of those, the one whose / answers the app's own page.
3. If none is running, start this project's dev command in the background (Claude's preview, if this chat has it, else the dev or start script in package.json, or the framework's own), and use the address it prints.
4. Ask me only if there's no app to find or start.
Then call show_local with that address and a short name (the project's), and do what its answer says, quietly. Tell me in one short line which app is on the canvas; nothing about helpers, ports or sign-in.
