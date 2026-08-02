# RubyMate — Ruby & Rails for Visual Studio Code

[![Version](https://img.shields.io/visual-studio-marketplace/v/BalajiR.rubymate?style=flat-square&label=version)](https://marketplace.visualstudio.com/items?itemName=BalajiR.rubymate)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/BalajiR.rubymate?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=BalajiR.rubymate)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/BalajiR.rubymate?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=BalajiR.rubymate)
[![License](https://img.shields.io/github/license/Balaji2682/rubymate?style=flat-square)](https://github.com/Balaji2682/rubymate/blob/main/LICENSE)

A single, self-contained extension for Ruby and Ruby on Rails development. RubyMate provides
code intelligence, debugging, testing, Rails navigation, template editing, and gem management
out of the box — no separate language server required.

Navigation and completion are powered by a built-in parser and indexer (Tree-sitter with a
legacy fallback), so core features work as soon as you open a project.

---

## Features at a Glance

| Area | What you get |
|------|--------------|
| **Code Intelligence** | Go to Definition, Find All References, Symbol Search, Hover, Type & Call Hierarchy |
| **Autocompletion** | Semantic, receiver-aware completion ranked by how your codebase uses each method |
| **Debugging** | Visual debugger built on Ruby's `debug` gem (rdbg) — files, tests, Rails servers |
| **Testing** | Native Test Explorer for RSpec and Minitest with run, debug, and gutter icons |
| **Rails** | Navigation, route explorer, generators, console, schema, and migration tools |
| **Templates** | ERB, Haml, and Slim editing with Rails helpers, path helpers, and partial navigation |
| **Hotwire** | Stimulus and Turbo completion, navigation, and hover documentation |
| **Code Quality** | RuboCop linting & formatting, N+1 query detection, dead-code analysis |
| **Gems** | Gem Explorer sidebar with outdated checks, security audit, and bundle commands |

---

## Getting Started

1. Install RubyMate from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=BalajiR.rubymate).
2. Open any Ruby or Rails project — RubyMate activates automatically and begins indexing.
3. (Optional) Install the gems that power formatting, debugging, and tests:

   ```bash
   gem install rubocop debug rspec
   ```

   Or add them to your `Gemfile`:

   ```ruby
   group :development, :test do
     gem 'debug'     # Debugging (Ruby 3.0+)
     gem 'rubocop'   # Linting and formatting
     gem 'rspec'     # RSpec test support
   end
   ```

Core navigation and completion need no extra setup. The gems above are only required for the
features that depend on them.

### Requirements

- **Ruby** 2.7+ (auto-detected via rbenv, rvm, chruby, asdf, or mise)
- **Bundler** (ships with standard Ruby installations)
- **Rails** 6.0+ (optional, enables Rails-specific features)

---

## Code Intelligence

- **Go to Definition** — jump to any class, method, module, or constant.
- **Find All References** — see every usage of a symbol across the project.
- **Symbol Search** — locate any symbol in the workspace.
- **Hover Documentation** — view signatures and documentation inline.
- **Type Hierarchy** — inspect inheritance chains, included modules, and subclasses.
- **Call Hierarchy** — trace incoming and outgoing method calls.

Detection covers direct calls, method chains, dynamic sends, symbols, hash keys, delegates,
aliases, block parameters, instance and class variables, and ActiveRecord associations.

### Semantic Autocompletion

Context-aware completion that resolves the cursor position before suggesting:

- **Member completion** (`user.`, `order.line_items&.`) resolves the receiver's type and offers
  its full method resolution order, including inherited and mixin methods, filtered by
  reachable visibility.
- **Bareword completion** ranks in-scope locals, `self` methods, and Ruby keywords together.
- **Constants, namespaces, and variables** — `Foo`, `Namespace::`, `@ivar`, `@@cvar` — resolve
  from the project's semantic graph.
- **Core and Rails knowledge** — `String`, `Array`, `ActiveRecord::Base`, and friends resolve
  through a bundled knowledge base, preferring RBS/RBI signatures installed on your machine.
- **Call-graph ranking** orders suggestions by real usage in your codebase.
- **Call snippets** expand methods with required arguments into calls with tab stops.

Toggle with `rubymate.completion.enabled`.

---

## Rails Integration

- **Smart Navigation** — jump between Models, Controllers, Views, Specs, and Migrations.
- **Route Explorer** — browse and search routes, then navigate straight to the definition.
- **Generators** — create models, controllers, migrations, and scaffolds from the palette.
- **Rails Console** — open an integrated `rails console`.
- **Schema & Migrations** — view the schema, jump to table definitions, run migrations, and
  roll back — all from the command palette.
- **Concerns** — navigate to included concerns.

### Database Tools

- Show the database schema and jump to table definitions.
- Inspect table columns.
- Generate a migration from a model.
- Open a database console and run ad-hoc SQL queries.

---

## Templates & Hotwire

### ERB, Haml & Slim

- **50+ Rails helpers** — completion for `link_to`, `form_with`, `render`, `image_tag`, and more.
- **Path helpers from routes** — `user_path`, `edit_user_path`, `new_admin_user_path`, and so on.
- **Instance variables** — completion for `@user`, `@posts` from controller context.
- **I18n keys** — translation completion for `t('.key')` from your locale files.
- **Go to Definition for partials** across every common `render` form:

  ```erb
  <%= render 'shared/header' %>
  <%= render partial: 'form', locals: { user: @user } %>
  <%= render @user %>          <%# → _user.html.erb %>
  <%= render @users %>         <%# → _user.html.erb (singularized) %>
  <%= render layout: 'admin' %>
  <%= render template: 'users/show' %>
  ```

- **Custom & path helpers** navigate to their definition (`current_user`, `admin?`, `user_path`).

### Hotwire

- **Stimulus** — completion and go-to-definition for controllers, actions, targets, and values,
  plus hover documentation. Controller location is configurable via
  `rubymate.hotwire.stimulusPath`.
- **Turbo** — completion for Turbo Frames, Turbo Streams, and Turbo Drive attributes.

Toggle the whole stack with `rubymate.hotwire.enabled`.

---

## Debugging

Powered by Ruby's official `debug` gem (rdbg):

- **One-click debugging** — press `F5` to debug the current file.
- **Breakpoints** — line, conditional, and exception breakpoints.
- **Variable inspection** — locals, instance variables, and watch expressions.
- **Step debugging** — step through code with full call-stack visibility.
- **Rails debugging** — debug servers, console sessions, and Rake tasks.
- **Test debugging** — debug RSpec and Minitest examples with breakpoints.

Ready-made launch configurations are contributed for the current file, the Rails server, RSpec,
and attaching to a remote debugger.

---

## Testing

A native Test Explorer for RSpec and Minitest:

- **Test tree** — hierarchical view of every test in the project.
- **Run & debug** — individual examples, suites, or whole files.
- **Live results** — pass/fail indicators with execution times.
- **Auto-discovery** — detects and watches test files for changes.
- **Gutter icons** — run or debug directly from the editor.

---

## Code Quality

- **RuboCop integration** — linting with auto-fix.
- **Formatting** — format the document or selection with RuboCop; enable format-on-save with
  `rubymate.formatOnSave`.
- **Auto-insert `end`** — closes Ruby blocks automatically (`rubymate.autoInsertEnd`).
- **N+1 query detection** — flags likely N+1 ActiveRecord patterns (`rubymate.enableN1Detection`).
- **Dead-code detection** — finds unused classes, methods, and constants.
- **Snippets** — 35+ Ruby and Rails snippets.

---

## Gem Explorer

A dedicated sidebar for managing gems (shown when a `Gemfile` is present):

- **Grouped gem tree** from `Gemfile.lock` (Default, Development, Test, Transitive).
- **Outdated detection** with one click.
- **Security audit** via `bundle audit`.
- **Per-gem actions** — open on RubyGems.org, browse source locally, `bundle update`, or copy
  the name/version to the clipboard.
- **Bundle commands** — run `bundle install` and `bundle update` from the toolbar.
- **Auto-refresh** — watches `Gemfile` and `Gemfile.lock`.

---

## Keyboard Shortcuts

Standard VS Code shortcuts provided by RubyMate:

| Shortcut | Action |
|----------|--------|
| `F12` | Go to Definition |
| `Shift+F12` | Find All References |
| `Ctrl+T` | Go to Symbol in Workspace |
| `F5` | Start Debugging |
| `Ctrl+Shift+O` | Go to Symbol in File |

RubyMate commands (Ruby files):

| Shortcut | Command |
|----------|---------|
| `Alt+Shift+G` | Go to Class |
| `Alt+Shift+R` | Navigate to Related File |
| `Alt+Shift+T` | Toggle Between Code and Spec |
| `Alt+Shift+F` | File Structure |
| `Alt+Shift+S` | Search Everywhere |

Rails and database commands are available from the command palette (`Ctrl+Shift+P`) under the
**Rails** and **Database** categories, or from the Ruby icon in the status bar.

---

## Configuration

RubyMate works with sensible defaults. Common settings:

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

For team consistency, commit the relevant keys to `.vscode/settings.json`.

---

## Remote Development

RubyMate is a workspace extension: in WSL, Remote SSH, Dev Containers, and Codespaces it runs on
the same host as your workspace and executes Ruby tools there.

- **WSL / Remote SSH** — open the folder through the corresponding Remote extension and enable
  RubyMate on that host.
- **Ruby path** — `rubymate.rubyPath` is resolved on the workspace host, not the UI machine.
- **Virtual workspaces** — unsupported, because RubyMate needs real Ruby tools and files.

Run **RubyMate: Show Runtime Status** to see the active host, resolved Ruby/Bundler/RuboCop/
Rails/rdbg tools, and parser/index health.

---

## Troubleshooting

**Extension not activating** — confirm `ruby -v` works in the terminal and the project contains
`.rb` files. Check View → Extensions → RubyMate for errors.

**Navigation not working** — first-time indexing takes a few seconds; save the file and, if
needed, run "Developer: Reload Window".

**Debugging issues** — add `gem 'debug'` (Ruby 3.0+) and verify `.vscode/launch.json`.

**Test Explorer empty** — ensure RSpec or Minitest is installed and tests live under `spec/` or
`test/`; then refresh the Test Explorer.

---

## Contributing

Contributions are welcome:

- Report bugs: [GitHub Issues](https://github.com/Balaji2682/rubymate/issues)
- Suggest features: [GitHub Discussions](https://github.com/Balaji2682/rubymate/discussions)
- Submit pull requests: see [CONTRIBUTING.md](https://github.com/Balaji2682/rubymate/blob/main/CONTRIBUTING.md)

```bash
git clone https://github.com/Balaji2682/rubymate.git
cd rubymate
npm run install:all
cd extension && npm run compile   # then press F5 to launch the Extension Development Host
```

---

## Resources

- **Changelog** — [CHANGELOG.md](https://github.com/Balaji2682/rubymate/blob/main/CHANGELOG.md)
- **Issues** — [GitHub Issues](https://github.com/Balaji2682/rubymate/issues)
- **Discussions** — [GitHub Discussions](https://github.com/Balaji2682/rubymate/discussions)
- **Releases** — [Release Notes](https://github.com/Balaji2682/rubymate/releases)

## Acknowledgments

RubyMate integrates with excellent Ruby tooling:

- [Ruby Debug](https://github.com/ruby/debug) — the official debugger from the Ruby core team
- [RuboCop](https://github.com/rubocop/rubocop) — Ruby static analyzer and formatter

## License

Released under the [MIT License](https://github.com/Balaji2682/rubymate/blob/main/LICENSE).
