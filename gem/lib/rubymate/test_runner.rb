# frozen_string_literal: true

module Rubymate
  # Test runner for RSpec and Minitest
  class TestRunner
    def initialize(framework: :auto)
      @framework = framework
    end

    def run_test(file_path, line_number = nil)
      framework = detect_framework(file_path)

      case framework
      when :rspec
        run_rspec(file_path, line_number)
      when :minitest
        run_minitest(file_path, line_number)
      else
        { error: "Unknown test framework" }
      end
    end

    def run_file(file_path)
      run_test(file_path, nil)
    end

    def discover_tests(directory)
      tests = []

      # Find RSpec tests
      Dir.glob(File.join(directory, "**", "*_spec.rb")).each do |file|
        tests << { file: file, framework: :rspec, type: :rspec }
      end

      # Find Minitest tests
      Dir.glob(File.join(directory, "**", "*_test.rb")).each do |file|
        tests << { file: file, framework: :minitest, type: :minitest }
      end

      tests
    end

    private

    def detect_framework(file_path)
      return @framework unless @framework == :auto

      if file_path.end_with?("_spec.rb") || File.read(file_path).include?("RSpec")
        :rspec
      elsif file_path.end_with?("_test.rb") || File.read(file_path).include?("Minitest")
        :minitest
      else
        :unknown
      end
    end

    def run_rspec(file_path, line_number)
      command = line_number ? "rspec #{file_path}:#{line_number}" : "rspec #{file_path}"

      {
        command: command,
        framework: :rspec,
        file: file_path,
        line: line_number
      }
    end

    def run_minitest(file_path, line_number)
      command = "ruby #{file_path}"

      {
        command: command,
        framework: :minitest,
        file: file_path
      }
    end
  end
end
