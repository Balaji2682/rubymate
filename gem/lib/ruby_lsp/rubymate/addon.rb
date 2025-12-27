# frozen_string_literal: true

require "ruby_lsp/addon"
require_relative "../../rubymate"

module RubyLsp
  module Rubymate
    class Addon < ::RubyLsp::Addon
      def activate(global_state, message_queue)
        @global_state = global_state
        @message_queue = message_queue
        @logger = ::Rubymate.logger

        begin
          # Initialize Solargraph bridge with workspace path
          workspace_path = @global_state.workspace_path
          @solargraph_bridge = ::Rubymate::SolargraphBridge.new(workspace_path)
          @completion_merger = ::Rubymate::CompletionMerger.new

          if @solargraph_bridge.initialized?
            @logger.info("RubyMate addon activated successfully with Solargraph integration")
          else
            @logger.warn("RubyMate addon activated but Solargraph failed to initialize")
          end
        rescue StandardError => e
          @logger.error("Failed to activate RubyMate addon: #{e.message}")
          @logger.debug(e.backtrace.join("\n"))
          @solargraph_bridge = nil
        end
      end

      def deactivate
        @logger.info("RubyMate addon deactivated")
        @solargraph_bridge = nil
        @completion_merger = nil
      end

      def name
        "RubyMate"
      end

      def solargraph_enabled?
        @solargraph_bridge&.initialized? || false
      end

      # Create listeners to handle LSP requests
      def create_hover_listeners(response_builder, nesting, index, dispatcher)
        return [] unless solargraph_enabled?

        # Enhance hover with Solargraph documentation
        [SolargraphHoverListener.new(
          response_builder,
          nesting,
          index,
          dispatcher,
          @solargraph_bridge
        )]
      rescue StandardError => e
        @logger.error("Failed to create hover listeners: #{e.message}")
        []
      end

      def create_completion_listeners(response_builder, nesting, index, dispatcher)
        return [] unless solargraph_enabled?

        # Enhance completions with Solargraph suggestions
        [SolargraphCompletionListener.new(
          response_builder,
          nesting,
          index,
          dispatcher,
          @solargraph_bridge,
          @completion_merger
        )]
      rescue StandardError => e
        @logger.error("Failed to create completion listeners: #{e.message}")
        []
      end

      def create_definition_listeners(response_builder, uri, nesting, index, dispatcher)
        return [] unless solargraph_enabled?

        # Enhance go-to-definition with Solargraph
        [SolargraphDefinitionListener.new(
          response_builder,
          uri,
          nesting,
          index,
          dispatcher,
          @solargraph_bridge
        )]
      rescue StandardError => e
        @logger.error("Failed to create definition listeners: #{e.message}")
        []
      end

      def workspace_did_change_watched_files(changes)
        return unless solargraph_enabled?

        # Handle file changes - reload Solargraph workspace if needed
        ruby_files_changed = changes.any? do |change|
          uri = change[:uri] || change["uri"]
          uri.to_s.end_with?(".rb")
        end

        if ruby_files_changed
          @logger.debug("Ruby files changed, reloading Solargraph workspace")
          @solargraph_bridge.reload_workspace
        end
      rescue StandardError => e
        @logger.error("Error handling file changes: #{e.message}")
      end
    end

    # Hover listener that integrates Solargraph
    class SolargraphHoverListener
      include Requests::Support::Common

      def initialize(response_builder, nesting, index, dispatcher, bridge)
        @response_builder = response_builder
        @nesting = nesting
        @index = index
        @dispatcher = dispatcher
        @bridge = bridge
        @logger = ::Rubymate.logger
      end

      def on_const(node)
        return unless @bridge

        begin
          # Get position from node
          uri = node.location.source.uri
          line = node.location.start_line - 1
          character = node.location.start_column

          docs = @bridge.get_hover_documentation(uri, line, character)
          @response_builder.push(docs) if docs
        rescue StandardError => e
          @logger.debug("Solargraph hover error: #{e.message}")
        end
      end

      def on_call(node)
        on_const(node)
      end
    end

    # Completion listener that integrates Solargraph
    class SolargraphCompletionListener
      include Requests::Support::Common

      def initialize(response_builder, nesting, index, dispatcher, bridge, merger)
        @response_builder = response_builder
        @nesting = nesting
        @index = index
        @dispatcher = dispatcher
        @bridge = bridge
        @merger = merger
        @logger = ::Rubymate.logger
      end

      def on_call(node)
        return unless @bridge

        begin
          # Get Solargraph completions
          uri = node.location.source.uri
          line = node.location.start_line - 1
          character = node.location.start_column

          solargraph_completions = @bridge.get_completions(uri, line, character)

          # Note: In a real implementation, we'd merge with Ruby LSP completions here
          # For now, just add Solargraph completions
          solargraph_completions.each do |completion|
            @response_builder.push(completion)
          end
        rescue StandardError => e
          @logger.debug("Solargraph completion error: #{e.message}")
        end
      end
    end

    # Definition listener that integrates Solargraph
    class SolargraphDefinitionListener
      include Requests::Support::Common

      def initialize(response_builder, uri, nesting, index, dispatcher, bridge)
        @response_builder = response_builder
        @uri = uri
        @nesting = nesting
        @index = index
        @dispatcher = dispatcher
        @bridge = bridge
        @logger = ::Rubymate.logger
      end

      def on_const(node)
        return unless @bridge

        begin
          # Get definition from Solargraph
          uri = node.location.source.uri
          line = node.location.start_line - 1
          character = node.location.start_column

          locations = @bridge.get_definition(uri, line, character)
          locations&.each { |location| @response_builder.push(location) }
        rescue StandardError => e
          @logger.debug("Solargraph definition error: #{e.message}")
        end
      end

      def on_call(node)
        on_const(node)
      end
    end
  end
end
