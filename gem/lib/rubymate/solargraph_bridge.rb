# frozen_string_literal: true

require "solargraph"
require "logger"

module Rubymate
  # Bridge to integrate Solargraph functionality into Ruby LSP
  class SolargraphBridge
    attr_reader :workspace

    def initialize(workspace_path = nil)
      @workspace_path = workspace_path || Dir.pwd
      @logger = Rubymate.logger
      @initialized = false
      @workspace = nil

      initialize_workspace
    rescue StandardError => e
      @logger.error("Failed to initialize Solargraph: #{e.message}")
      @logger.debug(e.backtrace.join("\n"))
      @initialized = false
    end

    def initialized?
      @initialized
    end

    def get_hover_documentation(uri, line, character)
      return nil unless initialized?

      begin
        source = read_source(uri)
        return nil unless source

        position = Solargraph::Source::Position.new(line, character)
        cursor = Solargraph::Source::Cursor.new(source, position)

        pins = @workspace.api_map.complete(cursor)
        return nil if pins.empty?

        pin = pins.first
        {
          contents: {
            kind: "markdown",
            value: format_documentation(pin)
          }
        }
      rescue StandardError => e
        @logger.error("Solargraph hover error: #{e.message}")
        nil
      end
    end

    def get_completions(uri, line, character, trigger_kind = 1)
      return [] unless initialized?

      begin
        source = read_source(uri)
        return [] unless source

        position = Solargraph::Source::Position.new(line, character)
        cursor = Solargraph::Source::Cursor.new(source, position)

        pins = @workspace.api_map.complete(cursor)

        pins.map do |pin|
          {
            label: pin.name,
            kind: completion_kind(pin),
            detail: pin.return_type&.to_s || pin.path,
            documentation: {
              kind: "markdown",
              value: format_documentation(pin)
            },
            insert_text: pin.name,
            insert_text_format: 1, # PlainText
            data: {
              source: "solargraph",
              path: pin.path
            }
          }
        end
      rescue StandardError => e
        @logger.error("Solargraph completion error: #{e.message}")
        []
      end
    end

    def get_definition(uri, line, character)
      return nil unless initialized?

      begin
        source = read_source(uri)
        return nil unless source

        position = Solargraph::Source::Position.new(line, character)
        cursor = Solargraph::Source::Cursor.new(source, position)

        pins = @workspace.definitions_at(source.filename, line, character)
        return nil if pins.empty?

        pins.map do |pin|
          next unless pin.location

          {
            uri: "file://#{pin.location.filename}",
            range: {
              start: {
                line: pin.location.range.start.line,
                character: pin.location.range.start.column
              },
              end: {
                line: pin.location.range.ending.line,
                character: pin.location.range.ending.column
              }
            }
          }
        end.compact
      rescue StandardError => e
        @logger.error("Solargraph definition error: #{e.message}")
        nil
      end
    end

    def get_references(uri, line, character)
      return [] unless initialized?

      begin
        source = read_source(uri)
        return [] unless source

        # Solargraph doesn't have a direct references API
        # This would require more complex implementation
        []
      rescue StandardError => e
        @logger.error("Solargraph references error: #{e.message}")
        []
      end
    end

    def reload_workspace
      initialize_workspace
    end

    private

    def initialize_workspace
      @logger.info("Initializing Solargraph workspace at: #{@workspace_path}")

      config_file = find_solargraph_config
      if config_file
        @logger.info("Found Solargraph config: #{config_file}")
        @workspace = Solargraph::Workspace.new(@workspace_path, config_file)
      else
        @logger.info("No Solargraph config found, using defaults")
        @workspace = Solargraph::Workspace.new(@workspace_path)
      end

      # Catalog the workspace
      @workspace.catalog
      @initialized = true
      @logger.info("Solargraph workspace initialized successfully")
    rescue StandardError => e
      @logger.error("Failed to initialize Solargraph workspace: #{e.message}")
      @initialized = false
      raise
    end

    def find_solargraph_config
      config_files = [".solargraph.yml", ".solargraph.json"]

      config_files.each do |config_file|
        path = File.join(@workspace_path, config_file)
        return path if File.exist?(path)
      end

      nil
    end

    def read_source(uri)
      # Convert URI to file path
      file_path = uri.to_s.sub(/^file:\/\//, "")
      return nil unless File.exist?(file_path)

      code = File.read(file_path)
      Solargraph::Source.load_string(code, file_path)
    rescue StandardError => e
      @logger.error("Failed to read source #{uri}: #{e.message}")
      nil
    end

    def format_documentation(pin)
      parts = []

      # Add signature
      if pin.path && !pin.path.empty?
        parts << "```ruby\n#{pin.path}\n```"
      end

      # Add documentation from YARD
      if pin.documentation && !pin.documentation.empty?
        parts << pin.documentation
      end

      # Add return type
      if pin.return_type && !pin.return_type.undefined?
        parts << "**Returns:** `#{pin.return_type}`"
      end

      # Add parameters
      if pin.respond_to?(:parameters) && !pin.parameters.empty?
        params = pin.parameters.map { |p| "`#{p.name}`" }.join(", ")
        parts << "**Parameters:** #{params}"
      end

      # Add location
      if pin.location
        location = "#{File.basename(pin.location.filename)}:#{pin.location.range.start.line + 1}"
        parts << "*Defined in: #{location}*"
      end

      parts.join("\n\n")
    end

    def completion_kind(pin)
      # Map Solargraph pin types to LSP completion kinds
      case pin.class.name
      when /Method/
        2 # Method
      when /Class/
        7 # Class
      when /Module/
        9 # Module
      when /Constant/
        21 # Constant
      when /Variable/
        6 # Variable
      when /Keyword/
        14 # Keyword
      else
        1 # Text
      end
    end
  end
end
