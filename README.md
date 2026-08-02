# RubyMate — Ruby & Rails for Visual Studio Code

[![Version](https://img.shields.io/visual-studio-marketplace/v/BalajiR.rubymate?style=flat-square&label=version)](https://marketplace.visualstudio.com/items?itemName=BalajiR.rubymate)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/BalajiR.rubymate?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=BalajiR.rubymate)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/BalajiR.rubymate?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=BalajiR.rubymate)
[![License](https://img.shields.io/github/license/Balaji2682/rubymate?style=flat-square)](https://github.com/Balaji2682/rubymate/blob/main/LICENSE)

A single, self-contained extension for Ruby and Ruby on Rails development. RubyMate provides code
intelligence, debugging, testing, Rails navigation, template editing, and gem management in one
package — no separate language server required.

Navigation and completion run on a built-in parser and symbol indexer (Tree-sitter with a legacy
fallback), so core features work as soon as you open a project.

> Looking for the marketplace description? See [`extension/README.md`](extension/README.md). This
> file is the repository overview.

---

## Features

### Code Intelligence
- **Built-in parser & indexer** — fast symbol indexing for Ruby and Rails codebases.
- **Semantic completion** — receiver-aware suggestions ranked by how your codebase uses each method.
- **Hover documentation** — method signatures, containers, and indexed docs when available.
- **Rails-aware** — ActiveRecord models, associations, and route helpers.

### Navigation
- **Go to Definition** (`F12` / `Ctrl+Click`)
- **Find All References** (`Shift+F12`)
- **Go to Symbol in Workspace** (`Ctrl+T`)
- **Go to Symbol in File** (`Ctrl+Shift+O`)
- **Quick Open** (`Ctrl+P`) — files, `@` for symbols, `#` for workspace symbols
- **Type Hierarchy** and **Call Hierarchy**
- **Navigate Related** — jump between models, controllers, views, and specs

### Rails Integration
- **Smart navigation** — Model ↔ Controller ↔ View ↔ Migration ↔ Spec.
- **Route Explorer** — browse and jump to routes from `routes.rb`.
- **Generators** — models, controllers, migrations, and scaffolds.
- **Rails Console** — integrated `rails console`.
- **Schema & migrations** — view the schema, jump to table definitions, run and roll back migrations.
- **Concerns navigator** — quick access to model/controller concerns.

### Database Tools
- Show the database schema and jump to table definitions.
- Inspect table columns.
- Generate a migration from a model.
- Open a database console and run ad-hoc SQL queries.

### Templates & Hotwire
- **ERB, Haml & Slim** — 50+ Rails helper completions, path helpers from routes, instance
  variables from controller context, I18n key completion, and go-to-definition for every common
  `render` partial form.
- **Hotwire** — Stimulus completion, go-to-definition, and hover for controllers, actions,
  targets, and values; Turbo Frame, Stream, and Drive attribute completion.

### Debugging
- **Ruby Debug (rdbg)** — the official debugger with full DAP support.
- **One-click debug** — press `F5` to debug the current file.
- **Rails debugging** — servers, console sessions, and Rake tasks.
- **Test debugging** — individual RSpec/Minitest examples.
- **Breakpoints** — line, conditional, and exception breakpoints.
- **Remote debugging** — attach to running processes and containers.

### Testing
- **Native Test Explorer** — hierarchical view of all tests.
- **RSpec & Minitest** — `describe`/`context`/`it` and class/method detection.
- **Run & debug** — individual examples, suites, or files with live pass/fail results.
- **Auto-discovery** — watches test files for changes.

### Code Quality
- **RuboCop** — real-time linting and formatting (format-on-save via `rubymate.formatOnSave`).
- **N+1 query detection** for ActiveRecord.
- **Dead-code detection** for unused classes, methods, and constants.
- **Auto-insert `end`** for Ruby blocks.
- **35+ Ruby and Rails snippets.**

### Gem Explorer
Sidebar for managing gems (shown when a `Gemfile` is present): grouped gem tree from
`Gemfile.lock`, outdated detection, `bundle audit` security scan, per-gem actions (open on
RubyGems.org, browse source, `bundle update`, copy name/version), and bundle commands.

---

## Getting Started

### Prerequisites
- **Ruby** 2.7+ (3.0+ recommended)
- **Bundler** 2.0+
- **Rails** 6.0+ (optional, for Rails features)

Optional gems power formatting, debugging, and tests:

```bash
gem install rubocop debug rspec
```

Or add them to your `Gemfile`:

```ruby
group :development, :test do
  gem 'rubocop'   # Linting and formatting
  gem 'debug'     # Debugging (Ruby 3.0+)
  gem 'rspec'     # RSpec test support
end
```

### Installation
1. Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=BalajiR.rubymate).
2. Open a Ruby or Rails project — RubyMate activates automatically and indexes the workspace.

### First Steps
1. Open a Ruby file — completion and navigation work immediately.
2. Press `Ctrl+T` to search any class or module.
3. Set a breakpoint in the gutter and press `F5` to debug.
4. Open the Test Explorer (beaker icon) to see all tests.
5. In Rails projects, click the Ruby icon in the status bar for Rails commands.

---

## Keyboard Shortcuts

Standard VS Code shortcuts provided by RubyMate:

| Shortcut | Action |
|----------|--------|
| `F12` / `Ctrl+Click` | Go to Definition |
| `Shift+F12` | Find All References |
| `Ctrl+T` | Go to Symbol in Workspace |
| `Ctrl+Shift+O` | Go to Symbol in File |
| `Ctrl+P` | Quick Open (`@` symbols, `#` workspace symbols) |
| `F5` | Start Debugging |

RubyMate commands (Ruby files):

| Shortcut | Command |
|----------|---------|
| `Alt+Shift+G` | Go to Class |
| `Alt+Shift+R` | Navigate to Related File |
| `Alt+Shift+T` | Toggle Between Code and Spec |
| `Alt+Shift+F` | File Structure |
| `Alt+Shift+S` | Search Everywhere |

> Formatting is available via **Format Document** (command palette / right-click) or on save with
> `rubymate.formatOnSave`. Note that RubyMate maps `Alt+Shift+F` to File Structure for Ruby files.

Rails and database commands live under the **Rails** and **Database** categories in the command
palette (`Ctrl+Shift+P`), or the Ruby icon in the status bar.

---

## Configuration

```json
{
  // Auto-format Ruby files on save with RuboCop
  "rubymate.formatOnSave": false,

  // Auto-insert the 'end' keyword for Ruby blocks
  "rubymate.autoInsertEnd": true,

  // Ruby executable (auto-detected by default)
  "rubymate.rubyPath": "ruby",

  // Test framework: "rspec" | "minitest" | "auto"
  "rubymate.testFramework": "auto",

  // Enable Rails-specific features (auto-detected)
  "rubymate.enableRailsSupport": true,

  // N+1 query detection
  "rubymate.enableN1Detection": true,
  "rubymate.n1DetectionExcludePaths": [],

  // Semantic autocompletion
  "rubymate.completion.enabled": true,

  // Parser engine: "auto" | "tree-sitter" | "legacy"
  "rubymate.parser.engine": "auto",

  // Hotwire (Stimulus & Turbo) support
  "rubymate.hotwire.enabled": true,
  "rubymate.hotwire.stimulusPath": "app/javascript/controllers"
}
```

### Custom Keybindings (IntelliJ / RubyMine users)

Add familiar shortcuts to `keybindings.json`:

```json
[
  { "key": "ctrl+n", "command": "workbench.action.gotoSymbol", "when": "editorTextFocus" },
  { "key": "alt+f7", "command": "references-view.findReferences", "when": "editorHasReferenceProvider && editorTextFocus" },
  { "key": "ctrl+e", "command": "workbench.action.quickOpen" },
  { "key": "ctrl+shift+m", "command": "rubymate.rails.navigateToModel", "when": "editorLangId == ruby" },
  { "key": "ctrl+shift+c", "command": "rubymate.rails.navigateToController", "when": "editorLangId == ruby" },
  { "key": "ctrl+shift+v", "command": "rubymate.rails.navigateToView", "when": "editorLangId == ruby" }
]
```

> These override VS Code defaults — for example, `Ctrl+N` normally creates a new file. On macOS,
> use `cmd` in place of `ctrl`.

---

## Remote Development

RubyMate is a workspace extension: in WSL, Remote SSH, Dev Containers, and Codespaces it runs on
the same host as your workspace and executes Ruby tools there. `rubymate.rubyPath` is resolved on
the workspace host, not the UI machine. Virtual workspaces are unsupported because RubyMate needs
real Ruby tools and files. Run **RubyMate: Show Runtime Status** to inspect the active host,
resolved tools, and parser/index health.

---

## Troubleshooting

### Navigation or indexing not ready
1. Confirm the Ruby version: `ruby --version` (2.7+).
2. Check View → Output → "RubyMate".
3. Run "RubyMate: Re-index Workspace".
4. In `auto` mode, RubyMate falls back to the legacy parser if Tree-sitter assets fail to load.

### Autocomplete not working
- Verify the Ruby in use: `which ruby`.
- Wait for indexing to finish on large projects, then reload the window
  ("Developer: Reload Window").

### Debugging does nothing
- Install the debug gem: `gem install debug` (Ruby 3.0+).
- Create `.vscode/launch.json`, or press `F5` and pick a Ruby configuration.
- Check `rubymate.rubyPath`.

### Test Explorer empty
- Tests live in `spec/` (`*_spec.rb`) or `test/` (`*_test.rb`).
- The framework is installed: `gem list | grep -E "(rspec|minitest)"`.
- `rubymate.testFramework` is `auto` or the correct framework.
- Refresh with "Test: Refresh Tests".

### Rails commands missing
- `config/application.rb` exists and `rubymate.enableRailsSupport` is `true`.
- Rails is installed: `bundle list | grep rails`.

### Slow performance on large projects
Exclude generated directories from watching:

```json
{
  "files.watcherExclude": {
    "**/node_modules/**": true,
    "**/tmp/**": true,
    "**/log/**": true
  }
}
```

### Command not found (ruby / bundle / gem)
Ensure Ruby is on `PATH` and restart VS Code. With a version manager, point at the shim:

```json
{ "rubymate.rubyPath": "/home/you/.rbenv/shims/ruby" }
```

Still stuck? Open the RubyMate output channel and file a report at
[GitHub Issues](https://github.com/Balaji2682/rubymate/issues) with your VS Code, Ruby, and
extension versions plus the log output.

---

## Comparison

| Aspect | RubyMate | Multiple separate extensions |
|--------|----------|------------------------------|
| Setup | One extension | 3–4 extensions to install and align |
| Code intelligence | Built-in parser/indexer | Varies per extension |
| Rails support | Deep, built-in | Basic or add-on |
| Test Explorer | Native UI | Often terminal-only |
| Debugging | Integrated (rdbg) | Separate setup |
| Maintenance | Single update | Multiple updates |

---

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
git clone https://github.com/Balaji2682/rubymate.git
cd rubymate
npm run install:all              # extension + gem dependencies
cd extension && npm run compile  # then press F5 to launch the Extension Development Host
```

---

## Resources

- **Changelog** — [CHANGELOG.md](CHANGELOG.md)
- **Issues** — [GitHub Issues](https://github.com/Balaji2682/rubymate/issues)
- **Discussions** — [GitHub Discussions](https://github.com/Balaji2682/rubymate/discussions)
- **Releases** — [Release Notes](https://github.com/Balaji2682/rubymate/releases)

## Acknowledgments

- [Ruby Debug](https://github.com/ruby/debug) — the official debugger from the Ruby core team
- [RuboCop](https://github.com/rubocop/rubocop) — Ruby static analyzer and formatter

## License

Released under the [MIT License](LICENSE).
