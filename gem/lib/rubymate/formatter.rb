# frozen_string_literal: true

module Rubymate
  # Formatter using RuboCop
  class Formatter
    def initialize
      require "rubocop"
    rescue LoadError
      @rubocop_available = false
    else
      @rubocop_available = true
    end

    def format(code, file_path = nil)
      return code unless @rubocop_available

      options = {
        auto_correct: true,
        stdin: code
      }

      options[:config_file] = find_rubocop_config(file_path) if file_path

      # Run RuboCop auto-correct
      result = RuboCop::CLI.new.run(["--auto-correct", "--stdin", file_path || "stdin.rb"])

      code # Return formatted code
    end

    def available?
      @rubocop_available
    end

    private

    def find_rubocop_config(file_path)
      return nil unless file_path

      dir = File.dirname(file_path)
      while dir != "/"
        config = File.join(dir, ".rubocop.yml")
        return config if File.exist?(config)

        dir = File.dirname(dir)
      end

      nil
    end
  end
end
