# Ruby & Rails - Complete IDE for VS Code

[![Version](https://img.shields.io/visual-studio-marketplace/v/BalajiR.rubymate?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=BalajiR.rubymate)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/BalajiR.rubymate?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=BalajiR.rubymate)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/BalajiR.rubymate?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=BalajiR.rubymate)
[![License](https://img.shields.io/github/license/Balaji2682/rubymate?style=flat-square)](LICENSE)

**The complete Ruby and Ruby on Rails IDE extension for VS Code.** Self-contained, all-in-one solution for Ruby development featuring: **IDE-like navigation**, **intelligent code indexing**, **Ruby debugger**, **RSpec & Minitest test explorer**, **RuboCop linter**, **Rails support** with ActiveRecord intelligence, **code navigation**, **auto-complete**, **syntax highlighting**, **ERB/HAML support**, and **N+1 query detection**.

Perfect for Ruby on Rails developers who need professional-grade tools for debugging, testing, formatting, and navigating Ruby code. **No external dependencies required** - works out of the box! Supports all Ruby versions (2.7+) and Rails (6.0+) with rbenv, rvm, chruby, and asdf compatibility.

## 🚀 Quick Feature Overview

- ✅ **IDE-like Navigation** - Go to definition, find all references, type hierarchy, call hierarchy
- ✅ **Self-Contained Indexing** - No external LSP needed, fast and reliable
- ✅ **Full Debugger** - Breakpoints, step debugging, variable inspection
- ✅ **Test Explorer** - RSpec & Minitest with UI, run/debug individual tests
- ✅ **RuboCop Integration** - Linting, formatting, auto-fix
- ✅ **Rails Support** - ActiveRecord, routes, ERB, migrations, models
- ✅ **Smart Search** - Context-aware symbol search with ranking
- ✅ **N+1 Query Detection** - Automatic detection with gem exclusion
- ✅ **Dead Code Detection** - Find unused classes and methods
- ✅ **40+ Snippets** - Ruby and Rails code snippets

---

## 🎯 IDE-like Navigation (NEW!)

**Professional code navigation without external dependencies!**

### Find Where Methods Are Used
```ruby
class User
  def full_name  # Click here, press Shift+F12
    "#{first_name} #{last_name}"
  end
end
# See all 15 places where full_name is called!
```

### What You Get
- **Go to Definition** (F12): Click any method/class → jump to definition (popup if multiple)
- **Find All References** (Shift+F12): See everywhere a symbol is used
- **Type Hierarchy**: View class inheritance trees and mixins
- **Call Hierarchy**: See what calls a method and what it calls
- **Hover Documentation**: Mouse over → see method signature and docs
- **Smart Symbol Search** (Ctrl+T): Find any class/method in workspace

### It Just Works™
- ✅ No gems to install
- ✅ No external LSP needed
- ✅ Works immediately after installation
- ✅ Detects 12+ Ruby patterns (sends, delegates, symbols, etc.)
- ✅ Progress indicators for large searches
- ✅ ~5-15 second initial indexing, then instant

---

## ✨ Detailed Features

### 🔍 Intelligent Code Navigation
- **Go to Definition** (F12): Jump to classes, methods, modules, constants - with multi-result popup
- **Find All References** (Shift+F12): See everywhere a symbol is used across your codebase
- **Type Hierarchy**: View class inheritance trees, included/extended modules
- **Call Hierarchy**: See incoming calls (who calls this) and outgoing calls (what it calls)
- **Hover Documentation**: See method signatures, parameters, and file locations
- **Symbol Search** (Ctrl+T): Quickly find any class, method, or module in workspace
- **Self-Contained**: No external dependencies, uses our own fast indexer

### 🔎 Advanced Reference Detection
Finds references in all these Ruby patterns:
- ✅ Direct calls: `user.full_name`
- ✅ Method chains: `current_user.full_name.upcase`
- ✅ Dynamic sends: `send(:full_name)`, `public_send(:full_name)`
- ✅ Symbols: `:full_name`
- ✅ Hash keys: `{ full_name: "..." }`
- ✅ Delegates: `delegate :full_name, to: :user`
- ✅ Aliases: `alias :name :full_name`
- ✅ respond_to?: `respond_to?(:full_name)`
- ✅ Block parameters: `map(&:full_name)`
- ✅ Instance/class variables: `@name`, `@@count`

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

### 🧠 Intelligent Indexing (NEW!)
**Professional-grade semantic code intelligence**

- **Semantic Graph**: Understands code relationships, inheritance, method calls
- **Type Inference**: Infers types from schema, associations, and code flow
- **Call Hierarchy** (`Ctrl+H`): See who calls a method and who calls them
- **Type Hierarchy** (`Ctrl+Shift+H`): View inheritance chains
- **Smart Search** (`Cmd+Shift+F`): Context-aware ranked search (by usage, recency, relevance)
- **Rails Navigation** (`Cmd+Shift+T`): Jump between Model ↔ Controller ↔ View ↔ Spec
- **Find All References** (`Alt+F7`): Categorized by reads, writes, calls
- **Dead Code Detection**: Automatically find unused classes, methods, constants
- **Find Subclasses** (`Ctrl+Alt+B`): See all classes that inherit from current class

**Features:**
- 95% confidence type inference from `schema.rb`
- 90% confidence from ActiveRecord associations
- Tracks method calls across entire codebase
- Usage frequency and recency scoring
- Project code ranked higher than gems
- ~40KB bundle size for complete intelligence

---

## 🚀 Quick Start

### Prerequisites

**RubyMate works out of the box - no gems required!** ✅

1. **Ruby**: 2.7, 3.0, 3.1, 3.2, 3.3+ (any version)
2. **Rails**: 6.0, 6.1, 7.0, 7.1, 7.2+ (optional)
3. **Bundler**: Any version

**Optional gems for enhanced features** (add to your `Gemfile`):
   ```ruby
   group :development do
     gem 'rubocop'      # For linting and formatting
     gem 'debug'        # For debugging (or 'byebug' for Ruby 2.7)
   end
   ```

**Version managers**: Works with rbenv, rvm, chruby, asdf - automatically detects your Ruby version!

**No external dependencies needed** - Navigation, indexing, and all core features work immediately after installation!

### Installation
1. Install from [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=BalajiR.rubymate)
2. Open a Ruby or Rails project
3. RubyMate activates automatically and indexes your workspace (takes ~5-15 seconds)
4. **That's it!** All features work immediately - no gems or external LSP needed

### First Steps
1. **Open a Ruby file** - Navigation works immediately
2. **Press `F12`** - Try "Go to Definition" on any class or method
3. **Press `Shift+F12`** - See all places where a method is used
4. **Right-click** - Try "Show Type Hierarchy" or "Show Call Hierarchy"
5. **Hover over code** - See method signatures and documentation
6. **Rails projects** - Click "$(ruby) Rails" in status bar for Rails commands

---

## 📖 Usage Guide

### Navigation Shortcuts

| Shortcut | Action | Description |
|----------|--------|-------------|
| `F12` or `Ctrl+Click` | Go to Definition | Jump to class/method definition (shows popup if multiple) |
| `Shift+F12` | Find All References | Show everywhere a symbol is used |
| `Ctrl+T` | Go to Symbol | Search any class/method/module in workspace |
| `Ctrl+Shift+O` | File Outline | Show symbols in current file |
| `Alt+Left` | Go Back | Navigate backwards |
| `Alt+Right` | Go Forward | Navigate forwards |
| Right-click menu | Type Hierarchy | Show class inheritance tree |
| Right-click menu | Call Hierarchy | Show method call relationships |
| Hover mouse | Quick Documentation | See method signature and info |

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
  // Auto-format on save
  "rubymate.formatOnSave": false,

  // Ruby executable path (auto-detects from rbenv/rvm/chruby/asdf)
  "rubymate.rubyPath": "ruby",

  // Test framework (auto-detects from project)
  "rubymate.testFramework": "auto", // "rspec" | "minitest" | "auto"

  // Enable Rails features (auto-detects Rails projects)
  "rubymate.enableRailsSupport": true,

  // Enable N+1 query detection
  "rubymate.enableN1Detection": true,

  // Paths to exclude from N+1 detection
  "rubymate.n1DetectionExcludePaths": []
}
```

### Custom Keybindings

Add to `keybindings.json`:

```json
[
  // Rails Navigation
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
  },

  // Intelligent Navigation
  {
    "key": "ctrl+h",
    "command": "rubymate.showCallHierarchy",
    "when": "editorLangId == ruby"
  },
  {
    "key": "ctrl+shift+h",
    "command": "rubymate.showTypeHierarchy",
    "when": "editorLangId == ruby"
  },
  {
    "key": "ctrl+alt+b",
    "command": "rubymate.findAllSubclasses",
    "when": "editorLangId == ruby"
  },
  {
    "key": "alt+f7",
    "command": "rubymate.findAllReferences",
    "when": "editorLangId == ruby"
  },
  {
    "key": "cmd+shift+t",
    "command": "rubymate.goToRelatedFiles",
    "when": "editorLangId == ruby"
  },
  {
    "key": "cmd+shift+f",
    "command": "rubymate.smartSearch",
    "when": "editorLangId == ruby"
  }
]
```

---

## 🆚 Comparison

### vs. Individual Extensions

| Feature | RubyMate | Ruby LSP + Shopify.ruby-lsp |
|---------|----------|------------------------------|
| **Setup** | Install one extension | Install extension + gem |
| **Dependencies** | ✅ None (self-contained) | ❌ Requires ruby-lsp gem |
| **Navigation** | ✅ IDE-like (6+ features) | ✅ Basic LSP |
| **Find References** | ✅ 12 Ruby patterns | ❌ Basic search |
| **Type Hierarchy** | ✅ Full inheritance tree | ❌ Not available |
| **Call Hierarchy** | ✅ Incoming + outgoing | ❌ Not available |
| **Require Navigation** | ✅ Built-in | ❌ Not available |
| **N+1 Detection** | ✅ Built-in | ❌ Not available |
| **Rails Support** | ✅ Deep integration | ⚠️ Via add-on |
| **Test Explorer** | ✅ Native UI | ✅ Via extension |
| **Speed** | ⚡ Fast (in-process) | 🐢 Slower (separate process) |
| **Reliability** | ✅ Self-contained | ⚠️ External gem dependency |

---

## 🤝 Contributing

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

## 📝 Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

---

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

Integrates with (optional):
- [debug](https://github.com/ruby/debug) by Ruby core team - for debugging features
- [rubocop](https://github.com/rubocop/rubocop) by RuboCop team - for linting and formatting

Inspired by:
- IDE's navigation features
- Shopify's [ruby-lsp](https://github.com/Shopify/ruby-lsp) architecture

Built with ❤️ for the Ruby community as a **self-contained**, **dependency-free** solution.

---

## 📞 Support

- 🐛 [Report Issues](https://github.com/Balaji2682/rubymate/issues)
- 💬 [Discussions](https://github.com/Balaji2682/rubymate/discussions)
- 📚 [Documentation](https://github.com/Balaji2682/rubymate/wiki)
- ⭐ [Star on GitHub](https://github.com/Balaji2682/rubymate)

---

<div align="center">

**Made with ❤️ for the Ruby community**

[Install Now](https://marketplace.visualstudio.com/items?itemName=BalajiR.rubymate) | [GitHub](https://github.com/Balaji2682/rubymate) | [Report Issue](https://github.com/Balaji2682/rubymate/issues)

</div>
