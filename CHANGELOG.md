# Changelog

All notable changes to the "RubyMate" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2025-01-XX

### Added
- 🚀 **Initial Release** of RubyMate - Ultimate Ruby & Rails IDE
- 🔍 **Dual Language Server Integration**
  - Ruby LSP support for modern Ruby features
  - Solargraph integration for YARD documentation
  - Intelligent completion merging from both servers
- 🧭 **IntelliJ-Style Navigation**
  - Go to Definition (`Ctrl+B`, `Ctrl+Click`)
  - Go to Class (`Ctrl+N`) with fuzzy search
  - File Structure (`Ctrl+F12`) with symbol outline
  - Search Everywhere (`Shift+Shift`)
  - Find Usages (`Alt+F7`)
  - Recent Files (`Ctrl+E`)
  - Navigate Back/Forward (`Ctrl+Alt+Left/Right`)
- 🚂 **Deep Rails Integration**
  - Smart navigation between Models, Controllers, Views, Migrations, and Specs
  - Route Explorer with browse and jump functionality
  - Schema awareness with table definition jumping
  - Rails Generators (Model, Controller, Migration, Scaffold)
  - Database operations (Run migrations, Rollback)
  - Rails Console integration
  - Concerns navigator
  - Rails project auto-detection
  - Status bar indicator for Rails projects
- 🐛 **Powerful Debugging**
  - Ruby Debug (rdbg) integration with DAP support
  - One-click debug for current file (`F5`)
  - Rails-specific debug configurations (Server, Console, Rake tasks)
  - RSpec/Minitest test debugging
  - Line, conditional, and exception breakpoints
  - Variable inspection with tree view
  - Interactive debug console
  - Remote debugging support (attach mode)
- 🧪 **Native Test Explorer**
  - Visual test tree in Testing sidebar
  - RSpec test discovery (`describe`/`context`/`it` parsing)
  - Minitest test discovery (class/method detection)
  - Run individual tests, suites, or files
  - Debug tests with one click
  - Live test results with ✅/❌ decorations
  - Execution time tracking
  - Auto-discovery with file watching
- 🎨 **Code Quality**
  - Auto-format with RuboCop (`Ctrl+Shift+L`)
  - Real-time linting and diagnostics
  - Code actions and quick fixes
- 📝 **Rich Snippets**
  - 40+ Ruby code snippets
  - Rails-specific snippets for common patterns
- ⚙️ **Configuration**
  - `rubymate.enableRubyLSP` - Enable/disable Ruby LSP
  - `rubymate.enableSolargraph` - Enable/disable Solargraph
  - `rubymate.formatOnSave` - Auto-format on save
  - `rubymate.rubyPath` - Custom Ruby executable path
  - `rubymate.enableRailsSupport` - Enable Rails features
  - `rubymate.testFramework` - Test framework selection (auto/rspec/minitest)
- 📚 **Documentation**
  - Comprehensive README with usage guide
  - Phase-by-phase implementation documentation
  - Contributing guidelines
  - Code of Conduct

### Changed
- N/A (initial release)

### Deprecated
- N/A (initial release)

### Removed
- N/A (initial release)

### Fixed
- N/A (initial release)

### Security
- N/A (initial release)

---

## Release Notes

### Version 0.1.0

**The First Release!** 🎉

RubyMate brings a unified, comprehensive Ruby and Rails development experience to VS Code. No more juggling multiple extensions - everything you need is built-in.

**Highlights:**
- ✨ Combines Ruby LSP + Solargraph for the best completions
- 🎯 IntelliJ/RubyMine-style shortcuts work out of the box
- 🚂 Deep Rails integration with smart navigation
- 🐛 Full debugging support with official debug gem
- 🧪 Native test explorer for RSpec and Minitest
- 📝 40+ code snippets included

**Installation:**
```bash
# In your project
gem install ruby-lsp solargraph rubocop debug

# Then install RubyMate from VS Code Marketplace
```

**Quick Start:**
1. Open a Ruby/Rails project
2. Press `Ctrl+N` to search for classes
3. Press `F5` to debug current file
4. Click beaker icon to see all tests
5. For Rails: Click "Rails" in status bar for commands

Enjoy coding! 🚀

---

## Future Releases

### Planned for 0.2.0
- [ ] Code coverage visualization (SimpleCov integration)
- [ ] Refactoring tools (extract method, rename, inline)
- [ ] Performance profiling integration
- [ ] Docker/remote container support
- [ ] Multi-root workspace support

### Planned for 0.3.0
- [ ] Custom inflections for Rails
- [ ] GraphQL schema support
- [ ] Hotwire/Turbo helpers
- [ ] Advanced test runner features (parallel tests, flaky detection)
- [ ] Gem explorer and documentation viewer

---

[Unreleased]: https://github.com/your-username/rubymate/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/your-username/rubymate/releases/tag/v0.1.0
