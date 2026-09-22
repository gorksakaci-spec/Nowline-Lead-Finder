---
name: Workspace package installs
description: Monorepo-specific dependency installation behavior for artifact server packages
---

Use a workspace-filtered pnpm add command when adding a dependency to one package. The generic package installer currently attempts to add packages at the monorepo root and stops on pnpm's workspace-root protection.

**Why:** The API server needs package-local runtime dependencies, and installing them at the root can create an invalid dependency boundary for the artifact.

**How to apply:** Target the package explicitly, for example `pnpm --filter @workspace/api-server add <package>`, then restart the affected workflow.