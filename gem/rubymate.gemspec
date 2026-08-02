# frozen_string_literal: true

require_relative "lib/rubymate/version"

Gem::Specification.new do |spec|
  spec.name = "rubymate"
  spec.version = Rubymate::VERSION
  spec.authors = ["Balaji R"]
  spec.email = ["admin@zengrid.dev"]

  spec.summary = "RubyMate helper library for formatting, Rails file lookup, and test metadata"
  spec.description = "Small Ruby-side helpers used by RubyMate tooling for RuboCop formatting, Rails file lookup, and test metadata. Code navigation is handled by the VS Code extension's built-in parser and indexer."
  spec.homepage = "https://github.com/your-username/rubymate"
  spec.license = "MIT"
  spec.required_ruby_version = ">= 3.0.0"

  spec.metadata["homepage_uri"] = spec.homepage
  spec.metadata["source_code_uri"] = spec.homepage
  spec.metadata["changelog_uri"] = "#{spec.homepage}/blob/main/CHANGELOG.md"

  # Specify which files should be added to the gem when it is released.
  spec.files = Dir.glob("lib/**/*.rb")
  spec.require_paths = ["lib"]

  # Optional dependencies for helper development and smoke tests.
  spec.add_development_dependency "rubocop", "~> 1.50"
  spec.add_development_dependency "debug", "~> 1.8"
end
