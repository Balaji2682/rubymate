# Publishing RubyMate to VS Code Marketplace

This guide walks you through publishing RubyMate to the Visual Studio Code Marketplace.

---

## Prerequisites

1. **GitHub Repository**: ✅ https://github.com/Balaji2682/rubymate
2. **Microsoft Account**: You need a Microsoft account to create a publisher
3. **Azure DevOps Account**: Required for Personal Access Token (PAT)
4. **vsce CLI**: Already installed in devDependencies

---

## Step 1: Create a Publisher Account

### 1.1 Sign up for Azure DevOps

1. Go to [Azure DevOps](https://dev.azure.com)
2. Sign in with your Microsoft account (or create one)
3. Create a new organization (if you don't have one)

### 1.2 Create a Personal Access Token (PAT)

1. In Azure DevOps, click your profile picture → **Personal access tokens**
2. Click **+ New Token**
3. Configure the token:
   - **Name**: `vsce-publishing`
   - **Organization**: Select your organization
   - **Expiration**: Custom defined (set to 1 year or more)
   - **Scopes**: Select **Custom defined**
     - Check **Marketplace** → **Manage**
4. Click **Create**
5. **IMPORTANT**: Copy the token immediately (you won't see it again)
6. Save it securely (e.g., password manager)

### 1.3 Create a Publisher

1. Go to [Visual Studio Marketplace Publisher Management](https://marketplace.visualstudio.com/manage)
2. Click **+ Create publisher**
3. Fill in the details:
   - **ID**: Choose a unique identifier (e.g., `balaji2682`)
   - **Name**: Your display name (e.g., `Balaji`)
   - **Email**: Your contact email
4. Click **Create**
5. **Remember your Publisher ID** - you'll need it

---

## Step 2: Update Extension Configuration

### 2.1 Update `package.json`

Update the `publisher` field with your actual publisher ID:

```bash
cd extension
```

Edit `package.json`:
```json
{
  "publisher": "balaji2682",  // Replace with YOUR publisher ID
  // ... rest of config
}
```

### 2.2 Add Extension Icon (Optional but Recommended)

Create a 128x128px PNG icon:

```bash
# Create images directory
mkdir -p extension/images

# Add your icon as extension/images/icon.png
# Recommended: Ruby-themed icon with transparent background
```

If you skip the icon, remove the `"icon"` line from `package.json`:
```json
// Remove or comment out this line if no icon:
// "icon": "images/icon.png",
```

---

## Step 3: Build and Package the Extension

### 3.1 Build the Extension

```bash
cd extension

# Install dependencies (if not already done)
npm install

# Compile TypeScript
npm run compile

# This creates the ./out directory with compiled JavaScript
```

### 3.2 Login to vsce

```bash
# Login with your publisher ID and PAT
npx vsce login balaji2682
# When prompted, paste your Personal Access Token
```

### 3.3 Package the Extension

```bash
# Create a .vsix file (doesn't publish yet)
npx vsce package

# This creates: rubymate-0.1.0.vsix
```

**Verify the package:**
```bash
# List contents of the package
npx vsce ls

# Test install locally
code --install-extension rubymate-0.1.0.vsix
```

---

## Step 4: Publish to Marketplace

### 4.1 First-Time Publish

```bash
# Publish to marketplace
npx vsce publish

# Or specify version
npx vsce publish 0.1.0
```

**What happens:**
1. Extension is uploaded to marketplace
2. Goes through automated verification
3. Becomes publicly available (usually within minutes)
4. You'll receive a confirmation email

### 4.2 Verify Publication

1. Go to [VS Code Marketplace](https://marketplace.visualstudio.com/vscode)
2. Search for "RubyMate"
3. Your extension should appear!
4. Check the listing looks correct

### 4.3 Share Your Extension

Your extension will be available at:
```
https://marketplace.visualstudio.com/items?itemName=balaji2682.rubymate
```

Users can install via:
- VS Code Extensions sidebar (search "RubyMate")
- Command line: `code --install-extension balaji2682.rubymate`

---

## Step 5: Update Extension (Future Releases)

### 5.1 Version Bump

```bash
cd extension

# Bump patch version (0.1.0 → 0.1.1)
npx vsce publish patch

# Bump minor version (0.1.0 → 0.2.0)
npx vsce publish minor

# Bump major version (0.1.0 → 1.0.0)
npx vsce publish major

# Or specify exact version
npx vsce publish 0.2.0
```

### 5.2 Update CHANGELOG.md

Before each release, update `CHANGELOG.md`:
```markdown
## [0.2.0] - 2025-02-XX

### Added
- New feature X

### Fixed
- Bug fix Y
```

### 5.3 Create Git Tag

```bash
git tag v0.2.0
git push origin v0.2.0
```

---

## Important Notes

### Before Publishing Checklist

- [ ] Extension builds without errors (`npm run compile`)
- [ ] Updated `publisher` in `package.json`
- [ ] Updated repository URLs to `Balaji2682/rubymate`
- [ ] README.md is comprehensive
- [ ] CHANGELOG.md is up to date
- [ ] Icon is added (or icon field removed from package.json)
- [ ] Tested locally with `code --install-extension rubymate-0.1.0.vsix`
- [ ] All placeholder URLs updated (no `your-username` references)
- [ ] LICENSE file exists

### Marketplace Requirements

✅ **Required Fields** (already set):
- `name`: Unique identifier
- `displayName`: Human-readable name
- `description`: Short description
- `version`: Semantic version
- `publisher`: Your publisher ID
- `engines.vscode`: VS Code version
- `categories`: At least one category
- `repository`: Valid GitHub URL

⚠️ **Recommended**:
- Icon (128x128 PNG)
- README with screenshots
- LICENSE file
- Categories (we have 5)
- Keywords (we have 13)

### Common Issues

**Issue**: `ERROR Missing publisher name`
**Fix**: Update `publisher` field in `package.json`

**Issue**: `ERROR Invalid icon path`
**Fix**: Either add `extension/images/icon.png` or remove `"icon"` field

**Issue**: `ERROR Repository URL not found`
**Fix**: Ensure GitHub repo is public and URL is correct

**Issue**: `ENOENT: no such file or directory, open 'README.md'`
**Fix**: Ensure README.md exists in the extension directory

---

## Step 6: Set Up Automated Publishing with GitHub Actions ⭐ RECOMMENDED

**This repository now includes automated publishing workflows!** The workflows are already created in `.github/workflows/`.

### 6.1 Setup GitHub Secret

Add your Personal Access Token as a GitHub secret:

1. Go to your repo → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. **Name**: `VSCE_TOKEN`
4. **Value**: Paste your Personal Access Token (from Step 1.2)
5. Click **Add secret**

### 6.2 How Automated Publishing Works

Two workflows are included:

**📦 `publish.yml`** - Publishes to VS Code Marketplace
- Triggers on version tags (e.g., `v0.2.1`)
- Builds and publishes extension automatically
- Uploads `.vsix` file as GitHub artifact

**🚀 `release.yml`** - Creates GitHub Release
- Triggers on version tags
- Attaches `.vsix` file to GitHub release
- Auto-generates release notes

### 6.3 Publishing Process (Automated)

```bash
# 1. Update version in extension/package.json
cd extension
# Manually update version from 0.2.1 to 0.2.2

# 2. Update CHANGELOG.md with new changes

# 3. Commit changes
git add .
git commit -m "Release v0.2.2"
git push

# 4. Create and push tag
git tag v0.2.2
git push origin v0.2.2

# 5. Sit back and relax! 🎉
# GitHub Actions will:
# - Build the extension
# - Publish to VS Code Marketplace
# - Create GitHub release with .vsix file
```

### 6.4 Monitor Automation

After pushing a tag:
1. Go to your repo → **Actions** tab
2. Watch the workflows run in real-time
3. Check for success ✅ or errors ❌
4. Extension appears on marketplace within minutes

### 6.5 Troubleshooting Automation

**Workflow fails with "Authentication failed"**:
- Verify `VSCE_TOKEN` secret is set correctly
- Check if PAT has expired
- Ensure PAT has "Marketplace (Manage)" scope

**Workflow fails at build step**:
- Test build locally: `cd extension && npm run compile:prod`
- Fix any TypeScript errors
- Commit and push fixes
- Re-run workflow or create new tag

---

## Quick Reference Commands

```bash
# Login
npx vsce login YOUR-PUBLISHER-ID

# Package (test locally)
npx vsce package

# Install locally
code --install-extension rubymate-0.1.0.vsix

# Publish
npx vsce publish

# Update (patch)
npx vsce publish patch

# Unpublish (careful!)
npx vsce unpublish balaji2682.rubymate
```

---

## Support After Publishing

### Monitor Your Extension

1. **Marketplace Stats**: Visit your [publisher management page](https://marketplace.visualstudio.com/manage/publishers/balaji2682)
2. **Ratings & Reviews**: Respond to user feedback
3. **Q&A**: Answer user questions on marketplace page
4. **GitHub Issues**: Monitor https://github.com/Balaji2682/rubymate/issues

### Marketing Your Extension

1. **Announce on social media** (Twitter, Reddit r/ruby, etc.)
2. **Write a blog post** about the extension
3. **Share in Ruby communities** (Ruby Weekly, etc.)
4. **Add to README**: Update with marketplace badge
5. **Create demo GIF/video** showing features

---

## Ready to Publish?

**Pre-flight checklist:**
```bash
# 1. Update publisher in package.json
# 2. Build extension
cd extension
npm run compile

# 3. Test package
npx vsce package
code --install-extension rubymate-0.1.0.vsix

# 4. Publish!
npx vsce publish
```

**First-time setup:**
1. ✅ Create Azure DevOps account
2. ✅ Generate Personal Access Token
3. ✅ Create publisher ID
4. ✅ Update package.json with publisher
5. ✅ Login: `npx vsce login YOUR-ID`
6. ✅ Publish: `npx vsce publish`

Good luck! 🚀

---

## Need Help?

- [Official vsce documentation](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Marketplace Publisher Guide](https://code.visualstudio.com/api/references/extension-manifest)
- Open an issue if you encounter problems!
