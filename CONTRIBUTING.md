# Contributing to RubyMate

First off, thank you for considering contributing to RubyMate! It's people like you that make RubyMate such a great tool for the Ruby community.

## Code of Conduct

This project and everyone participating in it is governed by the [RubyMate Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to [support@example.com].

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the [issue tracker](https://github.com/your-username/rubymate/issues) as you might find out that you don't need to create one. When you are creating a bug report, please include as many details as possible:

* **Use a clear and descriptive title**
* **Describe the exact steps to reproduce the problem**
* **Provide specific examples** to demonstrate the steps
* **Describe the behavior you observed** and what you expected
* **Include screenshots** if relevant
* **Include your environment details**: VS Code version, Ruby version, OS

**Bug Report Template:**
```markdown
## Description
[A clear description of the bug]

## Steps to Reproduce
1. Go to '...'
2. Click on '....'
3. See error

## Expected Behavior
[What you expected to happen]

## Actual Behavior
[What actually happened]

## Environment
- RubyMate version:
- VS Code version:
- Ruby version:
- OS:

## Additional Context
[Any additional information, screenshots, etc.]
```

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, please include:

* **Use a clear and descriptive title**
* **Provide a detailed description** of the suggested enhancement
* **Explain why this enhancement would be useful** to most users
* **List any alternatives** you've considered

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Make your changes** following our coding standards
3. **Add tests** if applicable
4. **Update documentation** as needed
5. **Ensure the test suite passes**
6. **Make sure your code lints**
7. **Submit the pull request**

## Development Setup

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Ruby (3.0 or higher)
- Bundler

### Installation

```bash
# Clone your fork
git clone https://github.com/YOUR-USERNAME/rubymate.git
cd rubymate

# Install dependencies
npm run install:all

# Build extension
cd extension
npm run compile

# Build gem
cd ../gem
bundle install
```

### Running Locally

1. Open the project in VS Code
2. Press `F5` to open a new VS Code window with the extension loaded
3. Open a Ruby project in the Extension Development Host
4. Test your changes

### Project Structure

```
rubymate/
├── extension/          # TypeScript VS Code extension
│   ├── src/
│   │   ├── extension.ts        # Main entry point
│   │   ├── languageClient.ts   # LSP client
│   │   ├── debugAdapter.ts     # Debug adapter
│   │   ├── testExplorer.ts     # Test explorer
│   │   ├── commands/           # Command implementations
│   │   └── providers/          # VS Code providers
│   ├── snippets/               # Code snippets
│   └── package.json            # Extension manifest
├── gem/                # Ruby LSP add-on
│   └── lib/
│       ├── rubymate.rb
│       └── rubymate/
│           ├── solargraph_bridge.rb
│           ├── completion_merger.rb
│           └── ...
└── docs/               # Documentation
```

## Coding Standards

### TypeScript (Extension)

- Use TypeScript strict mode
- Follow ESLint configuration
- Use async/await over promises
- Add JSDoc comments for public APIs
- Use meaningful variable names

**Example:**
```typescript
/**
 * Navigates to a Ruby class by name
 * @param className The name of the class to navigate to
 */
async function navigateToClass(className: string): Promise<void> {
    const symbols = await findSymbols(className);
    // ...
}
```

### Ruby (Gem)

- Follow Ruby style guide (RuboCop)
- Use descriptive method names
- Add YARD documentation
- Write RSpec tests

**Example:**
```ruby
# Merges completions from multiple sources
# @param ruby_lsp_completions [Array<Hash>] Completions from Ruby LSP
# @param solargraph_completions [Array<Hash>] Completions from Solargraph
# @return [Array<Hash>] Merged and deduplicated completions
def merge_completions(ruby_lsp_completions, solargraph_completions)
  # ...
end
```

## Testing

### Extension Tests

```bash
cd extension
npm test
```

### Gem Tests

```bash
cd gem
bundle exec rspec
```

## Documentation

- Update README.md if you change functionality
- Update CHANGELOG.md following [Keep a Changelog](https://keepachangelog.com/)
- Add inline documentation for complex logic
- Update phase documentation if applicable

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `perf`: Performance improvement
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

**Examples:**
```
feat(rails): add migration navigation command

Implement Navigate to Migration command that shows a quick pick
of all migrations related to the current model.

Closes #123
```

```
fix(debug): resolve breakpoint line offset issue

Breakpoints were off by one line due to incorrect range calculation.
Updated to use zero-based indexing.

Fixes #456
```

## Release Process

Releases are handled by maintainers:

1. Update CHANGELOG.md
2. Bump version in package.json
3. Create git tag
4. GitHub Actions builds and publishes to marketplace

## Questions?

Feel free to:
- Open an issue for questions
- Start a discussion in [GitHub Discussions](https://github.com/your-username/rubymate/discussions)
- Reach out to maintainers

## Recognition

Contributors will be recognized in:
- README.md
- Release notes
- GitHub contributors page

Thank you for contributing! 🎉
