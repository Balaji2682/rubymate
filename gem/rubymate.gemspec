# frozen_string_literal: true

require_relative "lib/rubymate/version"

Gem::Specification.new do |spec|
  spec.name = "rubymate"
  spec.version = Rubymate::VERSION
  spec.authors = ["Your Name"]
  spec.email = ["your.email@example.com"]

  spec.summary = "RubyMate - Unified Ruby LSP add-on combining Solargraph, formatting, and Rails support"
  spec.description = "A comprehensive Ruby LSP add-on that integrates Solargraph, RuboCop formatting, Rails support, and test running capabilities into a single, seamless VS Code experience"
  spec.homepage = "https://github.com/your-username/rubymate"
  spec.license = "MIT"
  spec.required_ruby_version = ">= 3.0.0"

  spec.metadata["homepage_uri"] = spec.homepage
  spec.metadata["source_code_uri"] = spec.homepage
  spec.metadata["changelog_uri"] = "#{spec.homepage}/blob/main/CHANGELOG.md"

  # Specify which files should be added to the gem when it is released.
  spec.files = Dir.glob("lib/**/*.rb")
  spec.require_paths = ["lib"]

  # Dependencies
  spec.add_dependency "ruby-lsp", "~> 0.13"
  spec.add_dependency "solargraph", "~> 0.50"

  # Optional dependencies for enhanced features
  spec.add_development_dependency "ruby-lsp-rails"
  spec.add_development_dependency "rubocop", "~> 1.50"
  spec.add_development_dependency "debug", "~> 1.8"
end
