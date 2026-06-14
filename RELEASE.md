# Releasing container-mcp

Two artifacts, in order: **npm** (hosts the code) then the **MCP Registry**
(hosts only metadata and points at npm). Always npm first.

## 1. Pre-flight (local)

```bash
npm ci
npm run typecheck
npm test
npm run build
```

All four must pass. `prepublishOnly` re-runs build+test on publish as a backstop.

## 2. Publish to npm

The version in `package.json` is already `0.2.0`. Tag it and let CI publish:

```bash
# [NEEDS NPM AUTH] Create an "Automation" access token at
#   https://www.npmjs.com/settings/<your-username>/tokens  (type: Automation)
# [NEEDS GITHUB AUTH] Store it as the secret the release workflow reads:
gh auth switch -u mustafaTokmak
gh secret set NPM_TOKEN --repo mustafaTokmak/container-mcp   # paste npm_… token

git push                                  # push prep commits first
git tag v0.2.0 && git push origin v0.2.0  # tag push triggers .github/workflows/release.yml
gh run watch --repo mustafaTokmak/container-mcp
npm view container-mcp version            # expect: 0.2.0
```

Manual fallback (if the workflow is unavailable):

```bash
npm login                       # completes 2FA
npm publish --access public     # provenance needs CI/OIDC; omit --provenance locally
```

## 3. Publish to the MCP Registry

The registry only stores metadata; it verifies you own the npm package via the
`mcpName` field in `package.json` (must equal `server.json`'s `name`), and it
verifies the `io.github.*` namespace via GitHub login.

```bash
# Install the publisher CLI (macOS):
curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz mcp-publisher && sudo mv mcp-publisher /usr/local/bin/

# Authenticate as the GitHub account that owns this repo:
mcp-publisher login github

# Publish the committed server.json:
mcp-publisher publish
```

### ⚠️ Verify the namespace casing first

`server.json` `name` and `package.json` `mcpName` are both set to
`io.github.mustafatokmak/container-mcp` (lowercase). GitHub logins are
case-insensitive and the registry normally normalizes to lowercase, but if
`mcp-publisher login github` reports a different authorized namespace, or
`publish` rejects with an ownership/namespace error, set **both** files to the
exact namespace it names and re-run. They must always match each other.

### Version must match npm

`server.json` `version` and the npm `version` must be the same (`0.2.0`). When
you cut a new npm version later, bump both `package.json` and `server.json`
before re-running `mcp-publisher publish`.

## 4. After publishing — distribution

- Submit a PR adding container-mcp to `punkpeye/awesome-mcp-servers` (see the
  draft entry in the PR description / project notes).
- Announce: lead with the agent-sandbox hook ("run code your agent wrote five
  seconds ago in a throwaway VM"), not "container manager".
