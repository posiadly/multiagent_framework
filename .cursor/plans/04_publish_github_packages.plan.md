---
name: Publish GitHub Packages
overview: Publish the library to GitHub Packages as `@posiadly/multiagent` (scope must match the repo owner) and document how AI_devs4 installs it with a personal access token.
todos:
  - id: rename-scope
    content: Rename library to @posiadly/multiagent and add GitHub Packages publishConfig + prepublishOnly
    status: completed
  - id: update-refs
    content: Update workspace scripts, console imports, README, and docs/03 to the new package name
    status: completed
  - id: publish-workflow
    content: Add GitHub Actions workflow that publishes on release
    status: completed
isProject: false
---

# Publish the library to GitHub Packages

GitHub Packages does not accept `@proaxia/multiagent` for [posiadly/multiagent_framework](https://github.com/posiadly/multiagent_framework). The npm scope must match the GitHub user: **`@posiadly/multiagent`**.

Registry: `https://npm.pkg.github.com`. This is not the public npmjs.com registry. Installs from other repos (including [AI_devs4](https://github.com/posiadly/AI_devs4)) need a PAT with `read:packages`.

## Package metadata

Update [packages/multiagent/package.json](packages/multiagent/package.json):

- `name`: `@posiadly/multiagent`
- `publishConfig.registry`: `https://npm.pkg.github.com`
- `prepublishOnly`: `npm run build` so `dist/` is produced (`dist` is gitignored)
- Keep `files: ["dist"]`, `repository.url` pointing at this GitHub repo, and the `directory: packages/multiagent` field

Replace `@proaxia/multiagent` in live code and scripts:

- [package.json](package.json) workspace scripts
- [examples/console/package.json](examples/console/package.json) and its `src` imports
- [README.md](README.md) and [docs/03_mcp_attachment.md](docs/03_mcp_attachment.md)

Leave [docs/02_library_split.md](docs/02_library_split.md) as the historical design note.

## Publish workflow

Add [.github/workflows/publish.yml](.github/workflows/publish.yml):

- Trigger: GitHub Release published, plus `workflow_dispatch`
- `permissions: packages: write`
- `npm ci` at the repo root, then `npm publish --workspace=@posiadly/multiagent`
- Auth: `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` with `registry-url: https://npm.pkg.github.com`

Bump `version` in the library `package.json` before each release (start stays `1.0.0` for the first publish).

After the first publish, in the GitHub package settings set visibility to **public** if you want installs without being a collaborator. Same-user installs still need a token either way for GitHub Packages.

## How AI_devs4 installs it

In the consumer machine or repo `.npmrc` (do not commit the token):

```
@posiadly:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

PAT: `read:packages` (and `write:packages` only on the machine that publishes, if not using Actions).

```bash
npm install @posiadly/multiagent
```

```ts
import { Agent, Runtime, createOpenRouterLlm } from "@posiadly/multiagent";
```

SAP stays `@posiadly/multiagent/sap`. The `internet-search` MCP example is not part of this package.
