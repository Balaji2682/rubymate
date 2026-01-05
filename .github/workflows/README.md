# GitHub Actions Workflows

This directory contains automated workflows for the RubyMate extension.

## Available Workflows

### 📦 `publish.yml` - Marketplace Publishing
**Trigger**: Push of version tags (e.g., `v0.2.1`, `v1.0.0`)

**What it does**:
1. Checks out the code
2. Sets up Node.js 18
3. Installs dependencies for both root and extension
4. Builds the extension in production mode
5. Packages the extension as `.vsix`
6. Publishes to VS Code Marketplace using `VSCE_TOKEN`
7. Uploads `.vsix` as GitHub artifact

**Requirements**:
- GitHub secret `VSCE_TOKEN` must be set (see setup below)

---

### 🚀 `release.yml` - GitHub Release Creation
**Trigger**: Push of version tags (e.g., `v0.2.1`, `v1.0.0`)

**What it does**:
1. Checks out the code
2. Sets up Node.js 18
3. Installs dependencies for both root and extension
4. Builds the extension in production mode
5. Packages the extension as `.vsix`
6. Creates a GitHub release with auto-generated notes
7. Attaches `.vsix` file to the release

**Requirements**:
- Uses automatic `GITHUB_TOKEN` (no setup needed)

---

## Setup Instructions

### One-Time Setup

1. **Create a Personal Access Token (PAT)** in Azure DevOps:
   - Go to [Azure DevOps](https://dev.azure.com)
   - Click profile → Personal access tokens → New Token
   - Name: `vsce-publishing`
   - Scope: **Marketplace (Manage)**
   - Expiration: Set to 1+ year
   - Copy the token (you won't see it again!)

2. **Add PAT as GitHub Secret**:
   - Go to your GitHub repo
   - Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `VSCE_TOKEN`
   - Value: Paste your Personal Access Token
   - Click "Add secret"

### Usage

Once setup is complete, publishing is automated:

```bash
# 1. Update version in extension/package.json
# 2. Update CHANGELOG.md

# 3. Commit and push changes
git add .
git commit -m "Release v0.2.2"
git push

# 4. Create and push version tag
git tag v0.2.2
git push origin v0.2.2

# 5. Done! ✨
# Both workflows will run automatically
```

### Monitoring

- Go to **Actions** tab in your GitHub repo
- Watch workflows run in real-time
- Check logs if something fails
- Extension will be live on marketplace within minutes

### Troubleshooting

**❌ "Error: Authentication failed"**
- Check if `VSCE_TOKEN` secret is set correctly
- Verify PAT hasn't expired
- Ensure PAT has correct scope (Marketplace → Manage)

**❌ Build fails**
- Test locally: `cd extension && npm run compile:prod`
- Fix TypeScript errors
- Commit fixes and re-run workflow

**❌ "Publisher not found"**
- Verify `publisher` field in `extension/package.json` matches your VS Code publisher ID
- Login to [VS Code Marketplace](https://marketplace.visualstudio.com/manage) to check

---

## Workflow Permissions

Both workflows use minimal required permissions:

- `publish.yml`: Needs `VSCE_TOKEN` (write access to marketplace)
- `release.yml`: Uses `GITHUB_TOKEN` with `contents: write` (to create releases)

---

## Manual Publishing (Fallback)

If you need to publish manually:

```bash
cd extension
npx vsce publish -p YOUR_PERSONAL_ACCESS_TOKEN
```

See [PUBLISHING.md](../../PUBLISHING.md) for detailed manual instructions.
