# RubyMate - All-in-One Ruby & Rails IDE for VS Code

[![Version](https://img.shields.io/visual-studio-marketplace/v/BalajiR.rubymate?style=flat-square&label=version)](https://marketplace.visualstudio.com/items?itemName=BalajiR.rubymate)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/BalajiR.rubymate?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=BalajiR.rubymate)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/BalajiR.rubymate?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=BalajiR.rubymate)
[![License](https://img.shields.io/github/license/Balaji2682/rubymate?style=flat-square)](https://github.com/Balaji2682/rubymate/blob/main/LICENSE)

> **A complete, self-contained Ruby and Rails development environment for Visual Studio Code.** Everything you need for professional Ruby development in a single extension - no complex setup, no external dependencies, just install and start coding.

---

## Why RubyMate?

**One Extension. Complete Solution.**

Instead of installing and configuring multiple extensions, language servers, and dependencies, RubyMate provides a unified, professional development environment out of the box.

### Key Benefits

- **Works Immediately** - No gems to install, no LSP servers to configure
- **All-in-One** - Navigation, debugging, testing, linting, and Rails support in one package
- **Zero Config** - Auto-detects Ruby version managers (rbenv, rvm, chruby, asdf)
- **Rails Native** - Deep integration with Ruby on Rails projects
- **Performance Focused** - Fast indexing and responsive navigation

---

## Core Features

### Intelligent Code Navigation

Professional-grade code intelligence built directly into the extension:

- **Go to Definition** (F12) - Jump to any class, method, module, or constant
- **Find All References** (Shift+F12) - See everywhere a symbol is used across your project
- **Symbol Search** (Ctrl+T) - Quickly find and navigate to any symbol in your workspace
- **Hover Documentation** - View method signatures and documentation on mouse hover
- **Type Hierarchy** - Visualize class inheritance trees and module inclusions
- **Call Hierarchy** - Understand method call relationships throughout your codebase

**Smart Detection** - Recognizes Ruby patterns including:
- Direct method calls, method chains, and dynamic sends
- Symbols, hash keys, delegates, and aliases
- Block parameters, instance variables, and class variables
- ActiveRecord associations and Rails-specific patterns

### Deep Rails Integration

Seamlessly navigate and work with Ruby on Rails projects:

- **Smart Navigation** - Quick jump between Models ↔ Controllers ↔ Views ↔ Specs ↔ Migrations
- **Route Explorer** - Browse and search Rails routes with instant navigation
- **Schema Intelligence** - Jump to table definitions and view database schema
- **Rails Console** - Integrated terminal access to `rails console`
- **Generators** - Create models, controllers, migrations, and scaffolds from the command palette
- **Database Tools** - Run migrations and rollbacks with one click

### Full Debugging Support

Integrated debugging powered by Ruby's official debug gem:

- **One-Click Debugging** - Press F5 to debug current file instantly
- **Breakpoints** - Line breakpoints, conditional breakpoints, and exception breakpoints
- **Variable Inspection** - Examine local variables, instance variables, and expressions
- **Step Debugging** - Step through code line by line with full call stack visibility
- **Rails Debugging** - Debug Rails servers, console sessions, and Rake tasks
- **Test Debugging** - Debug RSpec and Minitest tests with breakpoint support

### Integrated Test Explorer

Visual testing interface for RSpec and Minitest:

- **Test Tree View** - Hierarchical display of all tests in your project
- **Run & Debug** - Execute or debug individual tests, suites, or entire files
- **Live Results** - See test results with pass/fail indicators and execution times
- **Auto-Discovery** - Automatically detects and watches for test file changes
- **Gutter Icons** - Run/debug tests directly from the editor

### Code Quality & Analysis

Built-in tools to maintain code quality:

- **RuboCop Integration** - Real-time linting with auto-fix capabilities
- **Auto-Formatting** - Format document or selection with RuboCop (Alt+Shift+F)
- **Format on Save** - Automatically format Ruby files when saving (configurable)
- **Auto-Insert End** - Automatically insert 'end' keyword for Ruby blocks (def, class, if, etc.)
- **N+1 Query Detection** - Identify potential performance issues in ActiveRecord queries
- **Dead Code Detection** - Find unused classes, methods, and constants
- **Code Snippets** - 40+ Ruby and Rails snippets for faster coding

---

## Quick Start

### Installation

1. Install RubyMate from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=BalajiR.rubymate)
2. Open a Ruby or Rails project in VS Code
3. Start coding - RubyMate activates automatically

That's it! No additional configuration needed.

### Requirements

- **Ruby** 2.7 or higher (automatically detected via rbenv, rvm, chruby, or asdf)
- **Bundler** (standard with Ruby installations)
- **Rails** 6.0 or higher (optional, for Rails-specific features)

**Optional dependencies** for enhanced features:

```ruby
# Gemfile
group :development do
  gem 'debug'        # For debugging (Ruby 3.0+)
  gem 'rubocop'      # For linting and formatting
  gem 'rspec'        # For RSpec test support
end
```

### First Steps

1. **Try Navigation** - Open a Ruby file, place cursor on a method name, press `F12` to jump to definition
2. **Explore References** - Select a method, press `Shift+F12` to see all usages
3. **Rails Projects** - Click the Ruby icon in the status bar for Rails commands
4. **Run Tests** - Open the Testing sidebar to see and run your test suite
5. **Debug Code** - Set a breakpoint, press `F5` to start debugging

---

## Essential Shortcuts

| Shortcut | Command | Description |
|----------|---------|-------------|
| `F12` | Go to Definition | Jump to where a symbol is defined |
| `Shift+F12` | Find All References | Show all usages of a symbol |
| `Ctrl+T` | Go to Symbol | Search for any class, method, or module |
| `F5` | Start Debugging | Debug the current file or test |
| `Ctrl+Shift+O` | File Symbols | View outline of current file |
| `Alt+Shift+F` | Format Document | Format with RuboCop |

### Rails Navigation (Command Palette)

Access via `Ctrl+Shift+P` or status bar Ruby icon:

- **RubyMate: Navigate to Model** - Jump to related model
- **RubyMate: Navigate to Controller** - Jump to related controller
- **RubyMate: Navigate to View** - Jump to view template
- **RubyMate: Toggle Between Code and Spec** - Switch between implementation and tests
- **RubyMate: Show Rails Routes** - Browse all application routes
- **RubyMate: Rails Console** - Open interactive Rails console

---

## Configuration

RubyMate works with sensible defaults. Customize via VS Code settings if needed:

### Common Settings

```json
{
  // Auto-format Ruby files on save
  "rubymate.formatOnSave": false,

  // Auto-insert 'end' keyword for Ruby blocks
  "rubymate.autoInsertEnd": true,

  // Ruby executable (auto-detected by default)
  "rubymate.rubyPath": "ruby",

  // Test framework (auto-detected)
  "rubymate.testFramework": "auto",  // "rspec" | "minitest" | "auto"

  // Enable Rails features (auto-detected)
  "rubymate.enableRailsSupport": true,

  // N+1 query detection
  "rubymate.enableN1Detection": true,
  "rubymate.n1DetectionExcludePaths": ["**/lib/**"]
}
```

### Workspace Settings

For team consistency, add to `.vscode/settings.json` in your project:

```json
{
  "rubymate.formatOnSave": true,
  "rubymate.testFramework": "rspec"
}
```

---

## Comparison with Other Solutions

### RubyMate vs. Multiple Extensions

| Aspect | RubyMate | Typical Multi-Extension Setup |
|--------|----------|-------------------------------|
| **Installation** | One extension | 3-5+ extensions |
| **Setup Time** | < 1 minute | 15-30 minutes |
| **External Dependencies** | None required | Gems + LSP servers |
| **Maintenance** | Single update | Multiple extension updates |
| **Compatibility** | Guaranteed integration | Potential conflicts |
| **Performance** | Optimized single process | Multiple separate processes |
| **Support** | Unified | Fragmented across projects |

### RubyMate vs. Language Server Protocol (LSP) Extensions

| Feature | RubyMate | LSP-Based Extensions |
|---------|----------|----------------------|
| **Installation** | Install and go | Install extension + gem |
| **Dependencies** | Self-contained | Requires ruby-lsp gem in every project |
| **Navigation** | IDE-quality features | Basic LSP features |
| **Rails Support** | Built-in deep integration | Limited or via add-ons |
| **Debugging** | Integrated | Separate extension needed |
| **Testing** | Visual Test Explorer | Separate extension needed |
| **Reliability** | Single codebase | Multiple components can break |

---

## Advanced Features

### Type Hierarchy

Visualize class inheritance and module relationships:

1. Place cursor on a class name
2. Right-click → "Show Type Hierarchy"
3. See inheritance chain, included modules, and all subclasses

### Call Hierarchy

Understand method call relationships:

1. Place cursor on a method name
2. Right-click → "Show Call Hierarchy"
3. View incoming calls (who calls this method) and outgoing calls (what it calls)

### Smart Search

Context-aware search that understands Ruby code:

1. Open command palette → "RubyMate: Smart Search"
2. Type any symbol name
3. Results ranked by relevance, usage frequency, and recency

### Dead Code Detection

Find unused code to keep your project clean:

1. Command palette → "RubyMate: Detect Dead Code"
2. Review list of potentially unused classes and methods
3. Safely remove or refactor dead code

---

## Debugging Guide

### Debug Current File

1. Open a Ruby file
2. Set breakpoints by clicking left of line numbers
3. Press `F5` or use Run → Start Debugging
4. Code execution pauses at breakpoints

### Debug Rails Application

1. Create launch configuration (F5 → "Create launch.json")
2. Select "Debug Rails Server"
3. Start debugging - Rails server runs in debug mode
4. Visit routes in browser - execution pauses at breakpoints

### Debug Tests

**From Test Explorer:**
1. Open Testing sidebar (beaker icon)
2. Click debug icon next to any test
3. Test runs with debugger attached

**From Editor:**
1. Open test file
2. Place cursor in test
3. Command palette → "Test: Debug Test at Cursor"

---

## Troubleshooting

### Extension Not Activating

- **Check Ruby installation**: Run `ruby -v` in terminal
- **Verify project has Ruby files**: Extension activates on `.rb` files
- **Check extension status**: View → Extensions → RubyMate → Check for errors

### Navigation Not Working

- **Wait for indexing**: First-time indexing takes 5-15 seconds
- **Check file is saved**: Save file before using navigation features
- **Reload window**: Command palette → "Developer: Reload Window"

### Debugging Issues

- **Install debug gem**: Add `gem 'debug'` to Gemfile (development group)
- **Check Ruby version**: Debug gem requires Ruby 3.0+ (use byebug for Ruby 2.7)
- **Verify launch configuration**: Check `.vscode/launch.json` is valid

### Test Explorer Not Showing Tests

- **Verify test framework**: RSpec or Minitest installed in project
- **Check file patterns**: Tests in `spec/` or `test/` directories
- **Refresh tests**: Click refresh icon in Test Explorer

---

## User Testimonials

*Share your experience! If RubyMate has improved your Ruby development workflow, we'd love to hear from you. [Open a discussion](https://github.com/Balaji2682/rubymate/discussions) to share your story.*

<!-- Testimonials will be added here as users share their experiences -->

---

## Roadmap

We're continuously improving RubyMate. Upcoming features:

- Enhanced refactoring tools
- Code metrics and complexity analysis
- Advanced search and replace with Ruby patterns
- AI-powered code suggestions
- Bundler integration and gem management

**Have a feature request?** [Open an issue](https://github.com/Balaji2682/rubymate/issues) on GitHub.

---

## Contributing

Contributions are welcome! Here's how you can help:

- **Report bugs** - [Open an issue](https://github.com/Balaji2682/rubymate/issues)
- **Suggest features** - [Start a discussion](https://github.com/Balaji2682/rubymate/discussions)
- **Submit pull requests** - See [CONTRIBUTING.md](https://github.com/Balaji2682/rubymate/blob/main/CONTRIBUTING.md)
- **Star the project** - Show your support on [GitHub](https://github.com/Balaji2682/rubymate)
- **Spread the word** - Share with fellow Ruby developers

### Development Setup

```bash
# Clone repository
git clone https://github.com/Balaji2682/rubymate.git
cd rubymate

# Install dependencies
npm run install:all

# Build extension
cd extension && npm run compile

# Launch Extension Development Host
# Press F5 in VS Code
```

---

## Changelog

See [CHANGELOG.md](https://github.com/Balaji2682/rubymate/blob/main/CHANGELOG.md) for detailed version history and release notes.

---

## Support & Resources

- **Documentation** - [GitHub Wiki](https://github.com/Balaji2682/rubymate/wiki)
- **Discussions** - [GitHub Discussions](https://github.com/Balaji2682/rubymate/discussions)
- **Bug Reports** - [GitHub Issues](https://github.com/Balaji2682/rubymate/issues)
- **Updates** - [Release Notes](https://github.com/Balaji2682/rubymate/releases)
- **Star on GitHub** - [github.com/Balaji2682/rubymate](https://github.com/Balaji2682/rubymate)

---

## License

MIT License - See [LICENSE](https://github.com/Balaji2682/rubymate/blob/main/LICENSE) for details.

---

## Acknowledgments

RubyMate integrates with excellent Ruby tools:

- **[Ruby Debug](https://github.com/ruby/debug)** - Official Ruby debugger by the Ruby core team
- **[RuboCop](https://github.com/rubocop/rubocop)** - Ruby static code analyzer and formatter

Built with ❤️ for the Ruby community.

---

<div align="center">

### Ready to enhance your Ruby development?

[![Install Now](https://img.shields.io/badge/Install-VS%20Code%20Marketplace-007ACC?style=for-the-badge&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=BalajiR.rubymate)
[![View on GitHub](https://img.shields.io/badge/View-GitHub-181717?style=for-the-badge&logo=github)](https://github.com/Balaji2682/rubymate)
[![Report Issue](https://img.shields.io/badge/Report-Issue-E74C3C?style=for-the-badge&logo=github)](https://github.com/Balaji2682/rubymate/issues)

**One extension. Complete solution. Start building better Ruby applications today.**

</div>
