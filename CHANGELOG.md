# Changelog

All notable changes to the "RubyMate" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Semantic Ruby autocompletion** - Context-aware completion that reads the cursor's grammatical situation and answers each accordingly:
  - Member completion after `.`/`&.` resolves the receiver's type (locals, constructors, and inference) and offers its full method resolution order, filtered to reachable visibility
  - Bareword completion competes in-scope locals, `self` methods (including private/protected), and Ruby keywords on one ranked list
  - Constant, `Namespace::`, `@ivar`, and `@@cvar` completion from the semantic graph
  - Core and Rails types resolve through a bundled knowledge base that prefers the RBS/RBI signatures already on the user's machine, with a bundled floor fallback
  - Results are ranked by how the codebase actually uses each method (call-graph usage counts), not just alphabetically, alongside match quality, scope proximity, and type-resolution confidence
  - Methods with required arguments complete to a call snippet with tab stops
  - Toggle with `rubymate.completion.enabled`
- Reliability hardening for RubyMate's built-in parser/indexer pipeline:
  - Open and visible Ruby documents are re-indexed before navigation/provider lookups
  - Per-file index status is tracked as `ok`, `fallback`, `parse_error`, `stale`, or `deleted`
  - Status bar now distinguishes ready, indexing, degraded, and failed index states
  - References and definitions understand Ruby suffix methods (`?`, `!`, `=`) and qualified constants consistently
- **Gem Explorer** - Dedicated sidebar panel for Ruby gem management
  - Visual tree view of all gems from `Gemfile.lock`, grouped by Gemfile group
  - Distinguishes direct dependencies from transitive dependencies
  - One-click outdated gem detection (`bundle outdated`)
  - Security audit via `bundle audit` with vulnerability reporting
  - Right-click context menu: open on RubyGems.org, browse source, update, copy name/spec
  - Auto-refresh on `Gemfile` / `Gemfile.lock` changes
  - Bundle install and bundle update commands from toolbar

## [0.1.0] - 2025-01-XX

### Added
- 🚀 **Initial Release** of RubyMate - Ultimate Ruby & Rails IDE
- 🔍 **RubyMate Code Intelligence**
  - Built-in Ruby parser/indexer for project symbols
  - Rails-aware navigation, references, and outline support
  - Conservative handling for dynamic Ruby and metaprogramming
- 🧭 **Advanced-Style Navigation**
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
- ✨ Built-in parser/indexer for Ruby and Rails navigation
- 🎯 Advanced/Professional IDE-style shortcuts work out of the box
- 🚂 Deep Rails integration with smart navigation
- 🐛 Full debugging support with official debug gem
- 🧪 Native test explorer for RSpec and Minitest
- 📝 40+ code snippets included

**Installation:**
```bash
# In your project
gem install rubocop debug

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
