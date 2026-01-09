# RubyMate Testing Guide

This document provides a comprehensive manual testing checklist for RubyMate features. Use this to verify that all features work correctly before releases.

## Test Environment Setup

### Prerequisites
- [ ] VS Code version: 1.85.0+
- [ ] Ruby version: 3.0+ (test with 3.3.x)
- [ ] Test Rails app (generate if needed): `rails new test-app`
- [ ] Test gems installed:
  ```bash
  gem install ruby-lsp solargraph rubocop debug rspec
  ```

### Test Project Structure
Create a test Rails app with:
- [ ] Models: `User`, `Post` with associations
- [ ] Controllers: `UsersController`, `PostsController`
- [ ] Views: At least 2 views per controller
- [ ] Specs: RSpec tests for models and controllers
- [ ] Minitest: Optional for Minitest testing

---

## Feature Testing Checklist

### 1. Language Server & Code Completion

#### Ruby LSP
- [ ] **Activation**: Open `.rb` file → Check status bar shows "Ruby LSP"
- [ ] **Autocomplete**: Type `Array.` → See methods like `map`, `select`, `each`
- [ ] **Hover docs**: Hover over `Array` → See documentation
- [ ] **Diagnostics**: Create syntax error → See red squiggly
- [ ] **Restart**: Command Palette → "Ruby: Restart Language Server" → Works

#### Solargraph
- [ ] **Activation**: Check status bar shows "Solargraph"
- [ ] **YARD docs**: In method with YARD comments → Hover shows docs
- [ ] **Project indexing**: Large project → Wait 30s → Autocomplete includes project classes
- [ ] **Gem completion**: Type `Rails.` → See Rails methods (in Rails project)

#### Merged Completions
- [ ] Type `user.` → See completions from both servers
- [ ] No duplicate suggestions (or minimal duplicates)
- [ ] Completions sorted logically (most relevant first)

**Status**: ✅ Pass / ⚠️ Partial / ❌ Fail
**Notes**: _____________________________________________

---

### 2. Navigation Features

#### Go to Definition (Ctrl+B / Ctrl+Click)
- [ ] Class: `User` → Jump to `app/models/user.rb`
- [ ] Method: `calculate_total` → Jump to method definition
- [ ] Module: `Concerns::Trackable` → Jump to concern file
- [ ] Gem method: `validates` → Jump to gem source (or show docs)
- [ ] Rails helper: `link_to` → Show Rails source

#### Go to Class (Ctrl+N)
- [ ] Type "User" → Find `User` model
- [ ] Fuzzy search: Type "UsC" → Find `UsersController`
- [ ] Multiple matches: Type "Post" → Show `Post`, `PostsController`, etc.
- [ ] Case insensitive: Type "user" → Find `User`

#### File Structure (Ctrl+F12)
- [ ] Open `user.rb` → See outline: class, methods, attributes
- [ ] Click method in outline → Jump to method
- [ ] Search in outline: Type "valid" → Filter to validation methods
- [ ] Nested classes/modules shown correctly

#### Find Usages (Alt+F7)
- [ ] Place cursor on `User` → Find all references
- [ ] Method usage: `calculate_total` → Show all calls
- [ ] Shows file path and line number
- [ ] Click result → Jump to usage

#### Search Everywhere (Shift+Shift)
- [ ] Files: Type "user.rb" → Find file
- [ ] Classes: Type "User" → Find class
- [ ] Symbols: Type "calculate" → Find methods

**Status**: ✅ Pass / ⚠️ Partial / ❌ Fail
**Notes**: _____________________________________________

---

### 3. Rails Integration

#### Rails Detection
- [ ] Open Rails project → Status bar shows "$(ruby) Rails"
- [ ] Non-Rails project → Status bar doesn't show Rails button
- [ ] Setting `rubymate.enableRailsSupport: false` → Disables Rails features

#### Navigate to Model
- [ ] From controller: `@user = User.find` → Navigate to Model → Opens `user.rb`
- [ ] From view: `@user.name` → Navigate to Model → Opens `user.rb`
- [ ] Multiple models: Select from list

#### Navigate to Controller
- [ ] From model → Navigate to Controller → Opens `users_controller.rb`
- [ ] From view → Navigate to Controller → Opens correct controller

#### Navigate to View
- [ ] From controller action → Navigate to View → Opens correct template
- [ ] Multiple views: Select from list (index, show, edit, etc.)

#### Navigate to Migration
- [ ] Command → Navigate to Migration → Show list of migrations
- [ ] Select migration → Opens file

#### Navigate to Spec
- [ ] From model → Navigate to Spec → Opens `user_spec.rb`
- [ ] From spec → Navigate back to source → Opens `user.rb`
- [ ] Create spec if not exists → Generates spec file

#### Show Routes
- [ ] Command → Show Routes → Display all routes
- [ ] Search routes: Type "users" → Filter to user routes
- [ ] Click route → Jump to controller action

#### Go to Route
- [ ] Command → Go to Route → Search for specific route
- [ ] Select route → Opens controller action

#### Rails Generators
- [ ] **Generate Model**: Name "Article", attributes "title:string body:text"
  - [ ] Creates `app/models/article.rb`
  - [ ] Creates `db/migrate/..._create_articles.rb`
  - [ ] Creates `spec/models/article_spec.rb`

- [ ] **Generate Controller**: Name "Articles", actions "index show"
  - [ ] Creates `app/controllers/articles_controller.rb`
  - [ ] Creates views: `index.html.erb`, `show.html.erb`

- [ ] **Generate Migration**: Name "add_status_to_articles"
  - [ ] Creates migration file in `db/migrate/`

- [ ] **Generate Scaffold**: Full CRUD (optional test)

#### Database Operations
- [ ] **Run Migrations**: Command → "Run Migrations" → Executes `rails db:migrate`
- [ ] **Rollback**: Command → "Rollback Migration" → Executes `rails db:rollback`
- [ ] Output shown in terminal

#### Rails Console
- [ ] Command → "Open Rails Console" → Terminal opens with `rails console`
- [ ] Can interact with models: `User.count`

#### Schema Navigation
- [ ] Command → "Show Schema" → Opens `db/schema.rb`
- [ ] Command → "Go to Table Definition" → Jump to table in schema

**Status**: ✅ Pass / ⚠️ Partial / ❌ Fail
**Notes**: _____________________________________________

---

### 4. Debugging

#### Debug Current File (F5)
- [ ] Open `user.rb` → Press F5
- [ ] Debugger starts (Debug Console appears)
- [ ] Set breakpoint on line
- [ ] Run code → Breakpoint hits
- [ ] Inspect variables in Debug panel
- [ ] Step Over (F10) works
- [ ] Step Into (F11) works
- [ ] Continue (F5) works

#### Debug Rails Server
- [ ] Launch config: "Debug Rails Server"
- [ ] Set breakpoint in controller action
- [ ] Visit route in browser
- [ ] Debugger pauses at breakpoint
- [ ] Inspect `params`, `@user`, etc.
- [ ] Continue → Request completes

#### Debug Rails Console
- [ ] Launch config: "Debug Rails Console"
- [ ] Console starts
- [ ] Set breakpoint in model method
- [ ] Call method from console
- [ ] Breakpoint hits

#### Debug Rake Task
- [ ] Create Rake task with breakpoint
- [ ] Launch config: "Debug Rake Task"
- [ ] Breakpoint hits

#### Conditional Breakpoints
- [ ] Right-click gutter → "Add Conditional Breakpoint"
- [ ] Condition: `user.id == 123`
- [ ] Runs code → Only breaks when condition true

#### Exception Breakpoints
- [ ] Debug panel → "Breakpoints" section
- [ ] Toggle "All Exceptions" or "Uncaught Exceptions"
- [ ] Code raises exception → Debugger catches it

#### Remote Debugging
- [ ] Start remote process with `rdbg` flag
- [ ] Launch config: "Attach to Remote"
- [ ] Connects successfully

**Status**: ✅ Pass / ⚠️ Partial / ❌ Fail
**Notes**: _____________________________________________

---

### 5. Test Explorer

#### RSpec Support
- [ ] Open project with RSpec tests
- [ ] Test Explorer shows test tree
- [ ] Structure: File → `describe` → `context` → `it`
- [ ] Test names display correctly

#### Minitest Support
- [ ] Open project with Minitest
- [ ] Test Explorer shows test classes
- [ ] Structure: File → Test Class → test methods

#### Run Individual Test
- [ ] Click play icon on single `it` test
- [ ] Test runs
- [ ] Result shown: ✅ (pass) or ❌ (fail)
- [ ] Execution time displayed

#### Run Test Suite
- [ ] Click play icon on `describe` block
- [ ] All tests in suite run
- [ ] Results aggregated

#### Run All Tests in File
- [ ] Click play icon on file
- [ ] All tests run
- [ ] Results shown per test

#### Run All Tests
- [ ] Click play icon on root
- [ ] All tests in project run (may take time)

#### Debug Test
- [ ] Click debug icon on test
- [ ] Debugger starts
- [ ] Set breakpoint in test or code
- [ ] Breakpoint hits
- [ ] Can inspect variables

#### Test Results
- [ ] Passing test: Shows ✅ green checkmark
- [ ] Failing test: Shows ❌ red X
- [ ] Click failed test → See failure message
- [ ] Execution time shown

#### Auto-Discovery
- [ ] Create new test file
- [ ] Save file
- [ ] Test Explorer refreshes automatically
- [ ] New tests appear

#### Refresh Tests
- [ ] Click refresh icon
- [ ] Tests reload

**Status**: ✅ Pass / ⚠️ Partial / ❌ Fail
**Notes**: _____________________________________________

---

### 6. Code Quality

#### RuboCop Linting
- [ ] Open file with RuboCop issues
- [ ] Yellow/red squigglies appear
- [ ] Hover → See RuboCop message
- [ ] Quick fix available (if supported)

#### Auto-Format with RuboCop
- [ ] Create file with bad formatting
- [ ] Press `Ctrl+Shift+L` → Format Document
- [ ] Code reformatted according to `.rubocop.yml`

#### Format on Save
- [ ] Enable: `"rubymate.formatOnSave": true`
- [ ] Modify file with bad formatting
- [ ] Save file → Auto-formatted

#### Code Actions
- [ ] Cursor on issue → Light bulb appears
- [ ] Click light bulb → See quick fixes
- [ ] Apply fix → Code corrected

#### Snippets
- [ ] Type `def` → Tab → Method snippet expands
- [ ] Type `class` → Tab → Class snippet expands
- [ ] Rails snippets: `bt` (belongs_to), `hm` (has_many)
- [ ] Test snippets: `desc` (describe), `it` (it block)

**Status**: ✅ Pass / ⚠️ Partial / ❌ Fail
**Notes**: _____________________________________________

---

### 7. Performance

#### Startup Time
- [ ] Close VS Code
- [ ] Open Ruby project
- [ ] Measure time until autocomplete works
- [ ] **Expected**: < 10 seconds for small project, < 30s for large

#### Memory Usage
- [ ] Open Task Manager / Activity Monitor
- [ ] Check VS Code memory usage
- [ ] **Expected**: < 500MB with both servers
- [ ] **Note**: Varies by project size

#### Large Project (100k+ LOC)
- [ ] Open large Rails project
- [ ] Check indexing time
- [ ] Autocomplete still responsive
- [ ] Navigation features work
- [ ] **Note**: May need to disable Solargraph

#### CPU Usage
- [ ] Monitor CPU during indexing
- [ ] Should spike initially, then drop
- [ ] Normal usage: < 5% CPU

**Status**: ✅ Pass / ⚠️ Partial / ❌ Fail
**Notes**: _____________________________________________

---

### 8. Configuration

#### Basic Settings
- [ ] `rubymate.enableRubyLSP: false` → Disables Ruby LSP
- [ ] `rubymate.enableSolargraph: false` → Disables Solargraph
- [ ] `rubymate.rubyPath` → Custom Ruby path works
- [ ] `rubymate.testFramework: "rspec"` → Forces RSpec

#### Custom Keybindings
- [ ] Add custom keybinding for Rails command
- [ ] Keybinding works

#### Per-Project Settings
- [ ] Create `.vscode/settings.json` with RubyMate config
- [ ] Settings apply to project only

**Status**: ✅ Pass / ⚠️ Partial / ❌ Fail
**Notes**: _____________________________________________

---

## Platform-Specific Testing

### Linux
- [ ] All features work on Ubuntu/Debian
- [ ] Terminal integration works
- [ ] Debugging works

### macOS
- [ ] All features work on macOS
- [ ] Rbenv integration works
- [ ] RVM integration works

### Windows (WSL2)
- [ ] WSL2 detected correctly
- [ ] All features work in WSL2
- [ ] File paths resolve correctly

**Status**: ✅ Pass / ⚠️ Partial / ❌ Fail
**Notes**: _____________________________________________

---

## Edge Cases & Error Handling

### Missing Dependencies
- [ ] No Ruby LSP installed → Warning message shown
- [ ] No Solargraph installed → Warning message shown
- [ ] No RuboCop installed → Format gracefully fails with message
- [ ] No debug gem → Debug fails with clear error

### Corrupt Project
- [ ] Invalid `Gemfile` → Extension still loads
- [ ] Missing `config/application.rb` → Rails features disabled
- [ ] Syntax errors in code → Language server recovers

### Large Files
- [ ] Open 5000+ line file → Autocomplete still works
- [ ] Formatting works on large files

### Special Characters in Paths
- [ ] Project path with spaces: `/home/user/my project/`
- [ ] Project path with unicode: `/home/user/プロジェクト/`

**Status**: ✅ Pass / ⚠️ Partial / ❌ Fail
**Notes**: _____________________________________________

---

## Test Result Summary

**Date**: ________________
**Tester**: ________________
**RubyMate Version**: ________________
**VS Code Version**: ________________
**Ruby Version**: ________________

### Overall Results
- **Total Tests**: ______
- **Passed**: ______
- **Partial**: ______
- **Failed**: ______

### Critical Issues Found
1. _____________________________________________
2. _____________________________________________
3. _____________________________________________

### Minor Issues Found
1. _____________________________________________
2. _____________________________________________
3. _____________________________________________

### Recommendations
_____________________________________________
_____________________________________________
_____________________________________________

---

## Reporting Test Results

After completing testing:

1. **File Issue for Bugs**: [GitHub Issues](https://github.com/Balaji2682/rubymate/issues/new?template=bug_report.md)
2. **Share Results**: [Discussions](https://github.com/Balaji2682/rubymate/discussions)
3. **Update Feature Status**: Update README.md Feature Status table

Thank you for testing RubyMate!
