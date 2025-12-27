# RubyMate - Ultimate Ruby & Rails IDE for VS Code

[![Version](https://img.shields.io/visual-studio-marketplace/v/your-publisher.rubymate?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=your-publisher.rubymate)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/your-publisher.rubymate?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=your-publisher.rubymate)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/your-publisher.rubymate?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=your-publisher.rubymate)
[![License](https://img.shields.io/github/license/your-username/rubymate?style=flat-square)](LICENSE)

**The all-in-one Ruby and Rails extension for VS Code.** Combines the power of Ruby LSP, Solargraph, intelligent debugging, Rails support, and test exploration into a single, cohesive experience. Brings IntelliJ/RubyMine-style productivity to VS Code.

## ✨ Features

### 🔍 Intelligent Code Completion
- **Dual Language Server**: Combines Ruby LSP and Solargraph for superior autocomplete
- **YARD Documentation**: Rich documentation on hover from Solargraph
- **RBS Type Support**: Modern type checking via Ruby LSP
- **Rails-Aware**: ActiveRecord models, associations, route helpers, and more
- **Smart Merging**: Best suggestions from both language servers

### 🧭 IntelliJ-Style Navigation
- **Go to Definition** (`Ctrl+B` / `Ctrl+Click`): Jump to method/class definitions
- **Go to Class** (`Ctrl+N`): Fuzzy search for any class or module
- **File Structure** (`Ctrl+F12`): Quick outline view with fuzzy search
- **Search Everywhere** (`Shift+Shift`): Universal search for files, classes, and symbols
- **Find Usages** (`Alt+F7`): Find all references to a symbol
- **Navigate Related**: Jump between models, controllers, views, and specs

### 🚂 Deep Rails Integration
- **Smart Navigation**: Model ↔ Controller ↔ View ↔ Migration ↔ Spec
- **Route Explorer**: Browse and jump to routes from `routes.rb`
- **Schema Awareness**: Jump to table definitions in `schema.rb`
- **Rails Generators**: Create models, controllers, migrations, scaffolds
- **Database Operations**: Run migrations, rollback with one click
- **Rails Console**: Integrated terminal with `rails console`
- **Concerns Navigator**: Quick access to model/controller concerns

### 🐛 Powerful Debugging
- **Ruby Debug (rdbg)**: Official debugger with full DAP support
- **One-Click Debug**: Press `F5` to debug current file
- **Rails Debugging**: Debug Rails server, console, and Rake tasks
- **Test Debugging**: Debug individual RSpec/Minitest tests
- **Breakpoints**: Line, conditional, and exception breakpoints
- **Interactive Console**: Evaluate expressions during debugging
- **Remote Debugging**: Attach to running processes and containers

### 🧪 Native Test Explorer
- **Visual Test Tree**: Hierarchical view of all tests
- **RSpec Support**: Full `describe`/`context`/`it` parsing
- **Minitest Support**: Class and method detection
- **Run Individual Tests**: Click to run any test, suite, or file
- **Debug Tests**: One-click debugging with breakpoints
- **Live Results**: ✅/❌ decorations with execution times
- **Auto-Discovery**: Watches for test file changes

### 🎨 Code Quality
- **Auto-Format** (`Ctrl+Shift+L`): Format with RuboCop
- **Linting**: Real-time RuboCop suggestions
- **Code Actions**: Quick fixes and refactorings
- **Snippets**: 40+ Ruby and Rails code snippets

---

## 🚀 Quick Start

### Prerequisites
1. **Ruby** (2.7+)
2. **Bundler**
3. Required gems (auto-installed):
   ```bash
   gem install ruby-lsp solargraph rubocop debug
   ```

### Installation
1. Install from [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=your-publisher.rubymate)
2. Open a Ruby or Rails project
3. RubyMate activates automatically
4. Language server starts and indexes your workspace

### First Steps
1. **Open a Ruby file** - Autocomplete and navigation work immediately
2. **Press `Ctrl+N`** - Try "Go to Class" to search your codebase
3. **Set a breakpoint** - Click the gutter, then press `F5` to debug
4. **Open Test Explorer** - Click the beaker icon to see all tests
5. **Rails projects** - Click "$(ruby) Rails" in status bar for Rails commands

---

## 📖 Usage Guide

### Navigation Shortcuts

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Ctrl+B` | Go to Definition | Jump to class/method definition |
| `Ctrl+Click` | Go to Definition | Alternative to Ctrl+B |
| `Ctrl+N` | Go to Class | Fuzzy search for classes/modules |
| `Ctrl+F12` | File Structure | Outline view with search |
| `Shift+Shift` | Search Everywhere | Universal fuzzy search |
| `Alt+F7` | Find Usages | Show all references |
| `Ctrl+E` | Recent Files | Quick file switcher |
| `Ctrl+Shift+L` | Format Document | Auto-format with RuboCop |

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

## ⚙️ Configuration

### Basic Settings

```json
{
  // Enable Ruby LSP (recommended)
  "rubymate.enableRubyLSP": true,

  // Enable Solargraph for enhanced completions (recommended)
  "rubymate.enableSolargraph": true,

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

Add to `keybindings.json`:

```json
[
  {
    "key": "cmd+shift+m",
    "command": "rubymate.rails.navigateToModel",
    "when": "editorLangId == ruby"
  },
  {
    "key": "cmd+shift+c",
    "command": "rubymate.rails.navigateToController",
    "when": "editorLangId == ruby"
  },
  {
    "key": "cmd+shift+v",
    "command": "rubymate.rails.navigateToView",
    "when": "editorLangId == ruby"
  }
]
```

---

## 🆚 Comparison

### vs. Individual Extensions

| Feature | RubyMate | Ruby LSP + Solargraph + Debug |
|---------|----------|-------------------------------|
| Setup | Install one extension | Install 3-4 extensions |
| Language Servers | Merged intelligently | Run separately, conflicts |
| Rails Support | Deep integration | Basic or none |
| Test Explorer | Native UI | Terminal only |
| Navigation | IntelliJ-style | Basic LSP only |
| Debugging | Integrated | Separate setup |
| Maintenance | One extension | Multiple updates |

### vs. RubyMine

| Feature | RubyMate | RubyMine |
|---------|----------|----------|
| Cost | Free | $249/year |
| Performance | Lightweight | Heavy IDE |
| Ecosystem | VS Code extensions | IntelliJ plugins |
| Navigation | ✅ Similar shortcuts | ✅ Excellent |
| Rails Support | ✅ Comprehensive | ✅ Excellent |
| Debugging | ✅ Full DAP | ✅ Full |
| Test Runner | ✅ Native UI | ✅ Native UI |

---

## 🤝 Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Setup

```bash
# Clone repository
git clone https://github.com/your-username/rubymate.git
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

## 📝 Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

---

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

Built on top of:
- [ruby-lsp](https://github.com/Shopify/ruby-lsp) by Shopify
- [solargraph](https://github.com/castwide/solargraph) by Fred Snyder
- [debug](https://github.com/ruby/debug) by Ruby core team
- [rubocop](https://github.com/rubocop/rubocop) by RuboCop team

Inspired by IntelliJ IDEA and RubyMine.

---

## 📞 Support

- 🐛 [Report Issues](https://github.com/your-username/rubymate/issues)
- 💬 [Discussions](https://github.com/your-username/rubymate/discussions)
- 📚 [Documentation](https://github.com/your-username/rubymate/wiki)
- ⭐ [Star on GitHub](https://github.com/your-username/rubymate)

---

<div align="center">

**Made with ❤️ for the Ruby community**

[Install Now](https://marketplace.visualstudio.com/items?itemName=your-publisher.rubymate) | [GitHub](https://github.com/your-username/rubymate) | [Report Issue](https://github.com/your-username/rubymate/issues)

</div>
