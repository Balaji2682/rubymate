# RubyMate - Ultimate Ruby & Rails IDE for VS Code

[![Version](https://img.shields.io/visual-studio-marketplace/v/BalajiR.rubymate?style=flat-square&label=version)](https://marketplace.visualstudio.com/items?itemName=BalajiR.rubymate)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/BalajiR.rubymate?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=BalajiR.rubymate)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/BalajiR.rubymate?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=BalajiR.rubymate)
[![License](https://img.shields.io/github/license/Balaji2682/rubymate?style=flat-square)](https://github.com/Balaji2682/rubymate/blob/main/LICENSE)

**The all-in-one Ruby and Rails extension for VS Code.** RubyMate uses its own parser and symbol indexer for navigation, outline, references, Rails conventions, debugging, Rails support, and test exploration in a single extension.

> **📸 Visual Guide Coming Soon**: We're adding screenshots and animated GIFs to showcase features in action. Want to contribute? See [Contributing Guidelines](CONTRIBUTING.md).

## Features

### Intelligent Code Completion
- **Custom Parser and Indexer**: Fast, intelligent symbol indexing for Ruby and Rails codebases
- **Hover Documentation**: Method signatures, containers, and indexed documentation when available
- **Rails-Aware**: ActiveRecord models, associations, route helpers, and more
- **Context-Aware Suggestions**: Smart completion based on code context

### Advanced-Style Navigation
- **Go to Definition** (`F12` / `Ctrl+Click`): Jump to method/class definitions
- **Go to Symbol in Workspace** (`Ctrl+T`): Fuzzy search for any class or module
- **Go to Symbol in Editor** (`Ctrl+Shift+O`): Quick outline view with fuzzy search
- **Quick Open** (`Ctrl+P`): Search files; `@` for symbols, `#` for workspace symbols
- **Find References** (`Shift+F12`): Find all references to a symbol
- **Navigate Related**: Jump between models, controllers, views, and specs

> **Note**: For IntelliJ-style shortcuts (`Ctrl+N`, `Alt+F7`, etc.), see [Custom Keybindings](#custom-keybindings) section.

### Deep Rails Integration
- **Smart Navigation**: Model ↔ Controller ↔ View ↔ Migration ↔ Spec
- **Route Explorer**: Browse and jump to routes from `routes.rb`
- **Schema Awareness**: Jump to table definitions in `schema.rb`
- **Rails Generators**: Create models, controllers, migrations, scaffolds
- **Database Operations**: Run migrations, rollback with one click
- **Rails Console**: Integrated terminal with `rails console`
- **Concerns Navigator**: Quick access to model/controller concerns

### Powerful Debugging
- **Ruby Debug (rdbg)**: Official debugger with full DAP support
- **One-Click Debug**: Press `F5` to debug current file
- **Rails Debugging**: Debug Rails server, console, and Rake tasks
- **Test Debugging**: Debug individual RSpec/Minitest tests
- **Breakpoints**: Line, conditional, and exception breakpoints
- **Interactive Console**: Evaluate expressions during debugging
- **Remote Debugging**: Attach to running processes and containers

### Native Test Explorer
- **Visual Test Tree**: Hierarchical view of all tests
- **RSpec Support**: Full `describe`/`context`/`it` parsing
- **Minitest Support**: Class and method detection
- **Run Individual Tests**: Click to run any test, suite, or file
- **Debug Tests**: One-click debugging with breakpoints
- **Live Results**: ✅/❌ decorations with execution times
- **Auto-Discovery**: Watches for test file changes

### Code Quality
- **Auto-Format** (`Ctrl+Shift+L`): Format with RuboCop
- **Linting**: Real-time RuboCop suggestions
- **Code Actions**: Quick fixes and refactorings
- **Snippets**: 40+ Ruby and Rails code snippets

---

## Feature Status

This table shows the current CI and manual smoke-test status of major features. Help us test!

| Feature | Status | Tested | Known Issues |
|---------|--------|--------|--------------|
| **Code Completion** | ✅ | Custom parser/indexer | Dynamic Ruby remains conservative |
| **Go to Definition (F12)** | ✅ | Standard Ruby code | May fail on metaprogramming |
| **Go to Symbol (Ctrl+T)** | ✅ | Ruby & Rails classes | - |
| **Symbol Outline (Ctrl+Shift+O)** | ✅ | Classes, methods | - |
| **Find References (Shift+F12)** | ✅ | Standard references | - |
| **Quick Open (Ctrl+P)** | ✅ | Files, symbols | Native VS Code feature |
| **Navigate Related** | ✅ | Model ↔ Controller ↔ View | Supports namespaces, fuzzy matching, custom names |
| **Rails Generators** | ✅ | Model, Controller, Migration | - |
| **Rails Console** | ✅ | Terminal integration | - |
| **Route Explorer** | ✅ | Routes parsing | - |
| **Schema Navigation** | ✅ | Jump to table definitions | - |
| **Ruby Debug (F5)** | ✅ | Current file debug | - |
| **Rails Server Debug** | ✅ | Breakpoints work | - |
| **Test Debugging** | ✅ | RSpec & Minitest | - |
| **Test Explorer** | ✅ | RSpec fully, Minitest basic | Minitest limited nesting |
| **Run Individual Tests** | ✅ | Single test/suite/file | - |
| **Live Test Results** | ✅ | ✅/❌ decorations | - |
| **Auto-Format (RuboCop)** | ✅ | Format on save & manual | Requires .rubocop.yml |
| **Real-time Linting** | ✅ | RuboCop integration | - |

### Legend
- ✅ **CI/manual smoke tested**: Covered by automated checks, manual smoke testing, or both
- ⚠️ **Limited testing**: Core functionality works, edge cases need testing
- 🧪 **Experimental**: New feature, feedback needed
- ❌ **Known Issues**: Feature has reported problems

**Want to help test?** Report your experience in [Discussions](https://github.com/Balaji2682/rubymate/discussions) or [Issues](https://github.com/Balaji2682/rubymate/issues).

---

## Quick Start

### Prerequisites
1. **Ruby** (2.7+) - Ruby 3.0+ recommended
2. **Bundler** (2.0+)
3. **Recommended gems** - Install manually for formatting, debugging, and tests:
   ```bash
   gem install rubocop debug rspec
   ```

   Or add to your `Gemfile` (recommended):
   ```ruby
   group :development do
     gem 'rubocop'
     gem 'debug'
     gem 'rspec'
   end
   ```
   Then run: `bundle install`

### Installation
1. Install from [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=BalajiR.rubymate)
2. Open a Ruby or Rails project
3. RubyMate activates automatically
4. RubyMate indexes your workspace with its built-in parser/indexer

### First Steps
1. **Open a Ruby file** - Autocomplete and navigation work immediately
2. **Press `Ctrl+T`** - Search for any class/module in your codebase
3. **Set a breakpoint** - Click the gutter, then press `F5` to debug
4. **Open Test Explorer** - Click the beaker icon to see all tests
5. **Rails projects** - Click "$(ruby) Rails" in status bar for Rails commands

---

## Version Compatibility

### Supported Versions
- **VS Code**: 1.85.0 or higher
- **Ruby**: 2.7.0 - 3.3.x (3.0+ recommended)
- **Rails**: 6.0+ (optional, for Rails features)
- **Bundler**: 2.0+

### Tested Configurations
| Ruby | Rails | Status |
|------|-------|--------|
| 3.3.x | 7.1.x | ✅ CI/manual smoke tested |
| 3.2.x | 7.0.x | ✅ CI/manual smoke tested |
| 3.1.x | 6.1.x | ✅ Expected compatible |
| 3.0.x | 6.0+ | ✅ Expected compatible |
| 2.7.x | 6.0+ | ⚠️ Limited testing |

### Platform Support
- **Linux**: ✅ Supported and smoke tested
- **macOS**: ✅ Supported and smoke tested
- **Windows**: ✅ Supported (WSL2 recommended)

---

## Usage Guide

### Navigation Shortcuts

| Shortcut | Action | Description |
|----------|--------|-------------|
| `F12` | Go to Definition | Jump to class/method definition |
| `Ctrl+Click` | Go to Definition | Alternative to F12 |
| `Ctrl+T` | Go to Symbol in Workspace | Fuzzy search for classes/modules |
| `Ctrl+Shift+O` | Go to Symbol in Editor | Outline view with search |
| `Ctrl+P` | Quick Open | Files, `@` for symbols, `#` for workspace |
| `Shift+F12` | Find References | Show all references |
| `Ctrl+Tab` | Recent Files | Quick file switcher |
| `Shift+Alt+F` | Format Document | Auto-format with RuboCop |

> **IntelliJ Users**: See [Custom Keybindings](#custom-keybindings) to map `Ctrl+N`, `Alt+F7`, etc.

### Rails Commands

**Access via**: Status bar "$(ruby) Rails" button or Command Palette

| Command | Description |
|---------|-------------|
| Navigate to Model | Jump to related model |
| Navigate to Controller | Jump to related controller |
| Navigate to View | Jump to view template |
| Navigate to Migration | Browse and open migrations |
| Navigate to Spec | Toggle between code and spec |
| Show Routes | Browse all Rails routes |
| Go to Route | Search for specific route |
| Generate Model | Create new model with attributes |
| Generate Controller | Create new controller |
| Generate Migration | Create new migration |
| Run Migrations | Execute `rails db:migrate` |
| Open Rails Console | Launch interactive console |
| Show Schema | View `db/schema.rb` |
| Go to Table Definition | Jump to table in schema |

### Debugging

#### Quick Debug Current File
1. Open Ruby file
2. Press `F5`
3. Debugger starts automatically

#### Debug RSpec Test
1. Open spec file
2. Open Test Explorer (beaker icon)
3. Click debug icon next to test
4. Or use Command Palette: `Test: Debug Test at Cursor`

#### Debug Rails Server
1. Press `F5`
2. Select "Debug Rails Server"
3. Set breakpoints in controllers/models
4. Visit route in browser
5. Debugger pauses at breakpoints

### Testing

#### Run Tests from Explorer
1. Open Test Explorer (Testing sidebar)
2. Click play icon on test/suite/file
3. Results appear with ✅/❌ indicators

#### Run Test at Cursor
1. Place cursor in test
2. Command Palette: `Test: Run Test at Cursor`
3. Or click gutter icon

#### Debug Failing Test
1. Test fails in explorer (❌)
2. Click debug icon
3. Debugger launches with breakpoints
4. Inspect variables and fix issue

---

## Real-World Example Workflows

### Workflow 1: Adding a New Feature to Rails App

**Scenario**: Add a "published" status to blog posts

1. **Navigate to model**
   - Press `Ctrl+T` → Type "Post" → Jump to `app/models/post.rb`

2. **Check current schema**
   - Click status bar "$(ruby) Rails" → "Show Schema"
   - Search for `create_table "posts"`

3. **Generate migration**
   - Command Palette → "RubyMate: Generate Migration"
   - Name: `add_published_to_posts`
   - Adds: `add_column :posts, :published, :boolean, default: false`

4. **Run migration**
   - Status bar → "$(ruby) Rails" → "Run Migrations"
   - Or: `rails db:migrate` in integrated terminal

5. **Update model**
   - In `post.rb`, add: `scope :published, -> { where(published: true) }`
   - Press `Ctrl+Space` for autocomplete

6. **Find usages**
   - Place cursor on `Post`
   - Press `Shift+F12` → See all references
   - Update controllers/views as needed

7. **Write test**
   - Command Palette → "Go to Test" → Creates `spec/models/post_spec.rb`
   - Write test: `it { should have_db_column(:published) }`
   - Run test: Click play icon in Test Explorer

8. **Debug if needed**
   - Set breakpoint in model
   - Click debug icon in Test Explorer
   - Step through code with `F10` / `F11`

**Time saved**: What takes 20 minutes manually → 5 minutes with RubyMate

---

### Workflow 2: Investigating a Bug

**Scenario**: Users report 500 error on `/users/123/profile`

1. **Find the route**
   - Status bar → "$(ruby) Rails" → "Show Routes"
   - Search: "profile" → Finds `users#profile`

2. **Jump to controller**
   - Click route → Opens `app/controllers/users_controller.rb`
   - Goes directly to `profile` action

3. **Check model methods**
   - Hover over `@user.display_name` → See method definition from YARD docs
   - `Ctrl+Click` → Jump to model method

4. **Set breakpoint**
   - Click gutter on line: `@user = User.find(params[:id])`
   - Press `F5` → Select "Debug Rails Server"

5. **Reproduce bug**
   - Visit `http://localhost:3000/users/123/profile` in browser
   - Debugger pauses at breakpoint

6. **Inspect variables**
   - Check Debug Console: `params[:id]` → "123"
   - Check: `@user` → nil (Found the bug!)
   - Realize: User 123 doesn't exist, need error handling

7. **Fix and test**
   - Add: `@user = User.find_by(id: params[:id]) || return redirect_to(root_path)`
   - Write test for missing user
   - Run test: Click play in Test Explorer → ✅

8. **Find related views**
   - Status bar → "$(ruby) Rails" → "Navigate to View"
   - Updates `app/views/users/profile.html.erb`

**Time saved**: What takes 1 hour of debugging → 15 minutes with RubyMate

---

### Workflow 3: Refactoring with Confidence

**Scenario**: Rename method `calculate_total` → `calculate_order_total`

1. **Find all usages**
   - Open `order.rb`
   - Place cursor on `calculate_total`
   - Press `Shift+F12` → Shows 15 usages across 8 files

2. **Review each usage**
   - Click each result → Understand context
   - Verify it's safe to rename

3. **Use Find & Replace**
   - `Ctrl+H` → Find: `calculate_total`, Replace: `calculate_order_total`
   - Replace in all 15 locations

4. **Update tests**
   - Command Palette → "Go to Test" → Jump to spec file
   - Update test names to match

5. **Run full test suite**
   - Test Explorer → Click play on root folder
   - All tests pass ✅

6. **Check for missed references**
   - `Ctrl+Shift+F` → Search entire project for old name
   - Update comments/documentation

**Time saved**: Refactoring safely without professional IDE → Now possible in VS Code

---

## Configuration

### Basic Settings

```json
{
  // Auto-format on save
  "rubymate.formatOnSave": false,

  // Ruby executable path
  "rubymate.rubyPath": "ruby",

  // Test framework (auto-detects)
  "rubymate.testFramework": "auto", // "rspec" | "minitest" | "auto"

  // Enable Rails features (auto-detects)
  "rubymate.enableRailsSupport": true
}
```

### Custom Keybindings

**For IntelliJ/RubyMine Users**: Add these to `keybindings.json` for familiar shortcuts:

```json
[
  // IntelliJ-style Navigation
  {
    "key": "ctrl+n",
    "command": "workbench.action.gotoSymbol",
    "when": "editorTextFocus"
  },
  {
    "key": "alt+f7",
    "command": "references-view.findReferences",
    "when": "editorHasReferenceProvider && editorTextFocus"
  },
  {
    "key": "ctrl+e",
    "command": "workbench.action.quickOpen"
  },
  {
    "key": "ctrl+shift+t",
    "command": "workbench.action.quickOpen",
    "args": "test"
  },

  // Rails Navigation (macOS: use 'cmd' instead of 'ctrl')
  {
    "key": "ctrl+shift+m",
    "command": "rubymate.rails.navigateToModel",
    "when": "editorLangId == ruby"
  },
  {
    "key": "ctrl+shift+c",
    "command": "rubymate.rails.navigateToController",
    "when": "editorLangId == ruby"
  },
  {
    "key": "ctrl+shift+v",
    "command": "rubymate.rails.navigateToView",
    "when": "editorLangId == ruby"
  }
]
```

> **Note**: These override VS Code defaults. `Ctrl+N` normally creates a new file.

---

## Troubleshooting

### Parser or Indexer Not Ready

**Symptoms**: Missing navigation results, stale symbols, or parser/index degraded status

**Solutions**:
1. Check Ruby version: `ruby --version` (must be 2.7+)
2. Check Output panel: View → Output → Select "RubyMate"
3. Run Command Palette → "RubyMate: Re-index Workspace"
4. If Tree-sitter assets fail to load, RubyMate falls back to the legacy parser in `auto` mode
5. Check logs: `~/.vscode/extensions/BalajiR.rubymate-*/logs/`

### Autocomplete Not Working

**Possible causes**:
- Wrong Ruby version in use → Check: `which ruby`
- Project not indexed yet → Wait 30-60s after opening large projects
- Parser/indexer degraded → Run "RubyMate: Re-index Workspace" and check the RubyMate output

**Fix**: Reload window (Command Palette → "Developer: Reload Window")

### Debug Button Does Nothing

**Common issues**:
1. **Debug gem not installed**
   ```bash
   gem install debug
   ```

2. **No launch configuration**
   - Create `.vscode/launch.json` if missing
   - Or press F5 and select "Ruby" from dropdown

3. **Wrong Ruby path**
   - Check setting: `rubymate.rubyPath`
   - Verify: `which ruby`

### Test Explorer Empty

**Checklist**:
- [ ] Test files exist in `spec/` or `test/` directory
- [ ] File names match pattern: `*_spec.rb` (RSpec) or `*_test.rb` (Minitest)
- [ ] Test framework installed: `gem list | grep -E "(rspec|minitest)"`
- [ ] Check setting: `rubymate.testFramework` (should be "auto" or correct framework)
- [ ] Refresh tests: Click refresh icon in Test Explorer

**Manual refresh**: Command Palette → "Test: Refresh Tests"

### Rails Commands Not Appearing

**Requirements**:
- File `config/application.rb` must exist in workspace
- Setting: `rubymate.enableRailsSupport` must be `true`
- Rails gem installed: `bundle list | grep rails`

**Fix**: Reload window or check status bar shows "$(ruby) Rails"

### Slow Performance / High CPU Usage

**Causes**:
- Large project indexing (100k+ lines)
- Large vendor, tmp, or generated directories watched by VS Code

**Optimizations**:
```json
{
  // Exclude large directories from indexing
  "files.watcherExclude": {
    "**/node_modules/**": true,
    "**/tmp/**": true,
    "**/log/**": true
  }
}
```

### RuboCop Formatting Issues

**Problem**: Format on save not working

**Solutions**:
1. Install RuboCop: `gem install rubocop`
2. Check config: `rubymate.formatOnSave: true`
3. Verify RuboCop config exists: `.rubocop.yml`
4. Manual format: `Shift+Alt+F` or Command Palette → "Format Document"

### "Command not found" Errors

**Symptoms**: Extension can't find `ruby`, `bundle`, or `gem` commands

**Fix**:
1. Ensure Ruby is in PATH: `echo $PATH`
2. Restart VS Code after installing Ruby
3. On macOS with rbenv/rvm:
   ```json
   {
     "rubymate.rubyPath": "/Users/yourusername/.rbenv/shims/ruby"
   }
   ```

### Still Having Issues?

1. **Check Extension Output**: View → Output → Select "RubyMate"
2. **Enable Debug Logs**:
   ```json
   {
     "rubymate.trace.server": "verbose"
   }
   ```
3. **Report Bug**: [GitHub Issues](https://github.com/Balaji2682/rubymate/issues/new?template=bug_report.md)
   - Include: VS Code version, Ruby version, extension version
   - Attach: Output logs, error messages, screenshots

---

## Comparison

### vs. Individual Extensions

| Feature | RubyMate | Multiple Extensions |
|---------|----------|-------------------------------|
| Setup | Install one extension | Install 3-4 extensions |
| Code Intelligence | Custom parser/indexer | Varies by extension |
| Rails Support | Deep integration | Basic or none |
| Test Explorer | Native UI | Terminal only |
| Navigation | Advanced shortcuts | Basic LSP only |
| Debugging | Integrated | Separate setup |
| Maintenance | One extension | Multiple updates |

### vs. Professional IDE

| Feature | RubyMate | Professional IDE |
|---------|----------|----------|
| Cost | Free | $249/year |
| Performance | Lightweight | Heavy IDE |
| Ecosystem | VS Code extensions | Advanced plugins |
| Navigation | ✅ Similar shortcuts | ✅ Excellent |
| Rails Support | ✅ Comprehensive | ✅ Excellent |
| Debugging | ✅ Full DAP | ✅ Full |
| Test Runner | ✅ Native UI | ✅ Native UI |

---

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Setup

```bash
# Clone repository
git clone https://github.com/Balaji2682/rubymate.git
cd rubymate

# Install dependencies
npm run install:all

# Build extension
cd extension && npm run compile

# Build gem
cd ../gem && bundle install

# Open in VS Code
code .

# Press F5 to launch Extension Development Host
```

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

---

## License

MIT License - see [LICENSE](LICENSE) file for details.

---

## Acknowledgments

Integrates with:
- [debug](https://github.com/ruby/debug) by Ruby core team
- [rubocop](https://github.com/rubocop/rubocop) by RuboCop team

Inspired by Professional IDEs for providing advanced Ruby development workflows.

---

## Support & Community

### Get Help

**Having issues?** Check these resources first:
1. 📖 **[Troubleshooting Guide](#troubleshooting)** - Common problems and solutions
2. ❓ **[FAQ & Discussions](https://github.com/Balaji2682/rubymate/discussions)** - Ask questions, share tips
3. 📚 **[Documentation](https://github.com/Balaji2682/rubymate/wiki)** - Detailed guides
4. 🐛 **[Known Issues](https://github.com/Balaji2682/rubymate/issues?q=is%3Aissue+is%3Aopen+label%3Abug)** - Check if your issue is already reported

### Report a Bug

Found a bug? Help us improve!

**[🐛 Report Bug](https://github.com/Balaji2682/rubymate/issues/new?template=bug_report.md&title=[Bug]%20)** (Please include):
- VS Code version (`Help` → `About`)
- Ruby version (`ruby --version`)
- RubyMate version (Extensions → RubyMate → Version)
- Output logs (`View` → `Output` → Select "RubyMate")
- Steps to reproduce

### Request a Feature

Want a new feature?

**[✨ Request Feature](https://github.com/Balaji2682/rubymate/issues/new?template=feature_request.md&title=[Feature]%20)**

Popular requests:
- Steep static analyzer support
- Haml/Slim syntax support
- More Rails generators
- Enhanced test coverage reporting

### Contribute

Help make RubyMate better!

- 🧪 **[Beta Test Features](https://github.com/Balaji2682/rubymate/discussions/categories/beta-testing)** - Try new features first
- 📝 **[Improve Documentation](CONTRIBUTING.md)** - Fix typos, add examples
- 💻 **[Submit Pull Requests](CONTRIBUTING.md)** - Fix bugs, add features
- ⭐ **[Star on GitHub](https://github.com/Balaji2682/rubymate)** - Show support!

### Stay Updated

- 📢 **[Release Notes](CHANGELOG.md)** - What's new in each version
- 💬 **[Discussions](https://github.com/Balaji2682/rubymate/discussions)** - Community updates
- 🐦 **Follow Updates** - Watch the repo for notifications

### Response Time

- 🐛 **Critical bugs**: 24-48 hours
- 🔧 **Other issues**: 3-5 days
- 💡 **Feature requests**: Reviewed weekly
- ❓ **Questions**: Community-answered, usually same day

---

<div align="center">

**Made with ❤️ for the Ruby community**

[Install Now](https://marketplace.visualstudio.com/items?itemName=BalajiR.rubymate) | [GitHub](https://github.com/Balaji2682/rubymate) | [⭐ Star](https://github.com/Balaji2682/rubymate) | [Report Issue](https://github.com/Balaji2682/rubymate/issues/new)

[![GitHub stars](https://img.shields.io/github/stars/Balaji2682/rubymate?style=social)](https://github.com/Balaji2682/rubymate)

</div>
