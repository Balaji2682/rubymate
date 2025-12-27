# frozen_string_literal: true

module Rubymate
  # Merges completions from Ruby LSP and Solargraph, handling conflicts intelligently
  class CompletionMerger
    def initialize(logger: Rubymate.logger)
      @logger = logger
    end

    def merge(ruby_lsp_completions, solargraph_completions)
      return solargraph_completions if ruby_lsp_completions.nil? || ruby_lsp_completions.empty?
      return ruby_lsp_completions if solargraph_completions.nil? || solargraph_completions.empty?

      @logger.debug("Merging #{ruby_lsp_completions.size} Ruby LSP + #{solargraph_completions.size} Solargraph completions")

      # Create a hash to track unique completions by label
      merged = {}

      # Add Ruby LSP completions first (they have priority for RBS-typed code)
      ruby_lsp_completions.each do |completion|
        label = completion[:label] || completion["label"]
        merged[label] = {
          completion: completion,
          source: :ruby_lsp,
          priority: calculate_priority(completion, :ruby_lsp)
        }
      end

      # Add Solargraph completions, preferring them for YARD-documented code
      solargraph_completions.each do |completion|
        label = completion[:label] || completion["label"]

        if merged[label]
          # Conflict detected - choose the better one
          existing = merged[label]
          solargraph_priority = calculate_priority(completion, :solargraph)

          if should_prefer_solargraph?(existing[:completion], completion)
            @logger.debug("Preferring Solargraph completion for '#{label}' (better docs)")
            merged[label] = {
              completion: enhance_with_ruby_lsp(completion, existing[:completion]),
              source: :solargraph,
              priority: solargraph_priority
            }
          else
            @logger.debug("Keeping Ruby LSP completion for '#{label}' (better types)")
            # Enhance Ruby LSP completion with Solargraph documentation if better
            merged[label][:completion] = enhance_with_solargraph(
              existing[:completion],
              completion
            )
          end
        else
          # No conflict, add Solargraph completion
          merged[label] = {
            completion: completion,
            source: :solargraph,
            priority: calculate_priority(completion, :solargraph)
          }
        end
      end

      # Sort by priority and return completions
      result = merged.values
                     .sort_by { |item| -item[:priority] }
                     .map { |item| item[:completion] }

      @logger.debug("Merged result: #{result.size} unique completions")
      result
    end

    private

    def calculate_priority(completion, source)
      priority = 0

      # Base priority by source
      priority += source == :solargraph ? 10 : 20 # Prefer Ruby LSP slightly

      # Boost if has documentation
      has_docs = completion[:documentation] || completion["documentation"]
      priority += 15 if has_docs && !has_docs.to_s.empty?

      # Boost if has type information
      has_detail = completion[:detail] || completion["detail"]
      priority += 10 if has_detail && !has_detail.to_s.empty?

      # Boost based on completion kind (methods > variables > keywords)
      kind = completion[:kind] || completion["kind"]
      priority += case kind
                  when 2 then 20 # Method
                  when 7, 9 then 15 # Class/Module
                  when 6 then 10 # Variable
                  when 21 then 12 # Constant
                  else 5
                  end

      priority
    end

    def should_prefer_solargraph?(ruby_lsp_completion, solargraph_completion)
      # Prefer Solargraph if it has significantly better documentation
      lsp_docs = extract_documentation(ruby_lsp_completion)
      solar_docs = extract_documentation(solargraph_completion)

      # If Solargraph has YARD documentation and Ruby LSP doesn't
      if solar_docs.length > 50 && lsp_docs.length < 20
        return true
      end

      # If Solargraph has parameter information
      if solar_docs.include?("**Parameters:**") && !lsp_docs.include?("**Parameters:**")
        return true
      end

      # Otherwise prefer Ruby LSP (better type information)
      false
    end

    def enhance_with_solargraph(ruby_lsp_completion, solargraph_completion)
      enhanced = ruby_lsp_completion.dup

      # Add Solargraph documentation if Ruby LSP doesn't have it
      lsp_docs = extract_documentation(ruby_lsp_completion)
      solar_docs = extract_documentation(solargraph_completion)

      if solar_docs.length > lsp_docs.length
        enhanced[:documentation] = solargraph_completion[:documentation]
        enhanced[:detail] = "#{enhanced[:detail]} (YARD)" if enhanced[:detail]
      end

      enhanced
    end

    def enhance_with_ruby_lsp(solargraph_completion, ruby_lsp_completion)
      enhanced = solargraph_completion.dup

      # Add Ruby LSP type information if available
      lsp_detail = ruby_lsp_completion[:detail] || ruby_lsp_completion["detail"]
      if lsp_detail && lsp_detail.include?("->")
        enhanced[:detail] = "#{lsp_detail} (RBS)"
      end

      enhanced
    end

    def extract_documentation(completion)
      docs = completion[:documentation] || completion["documentation"]
      return "" unless docs

      if docs.is_a?(Hash)
        docs[:value] || docs["value"] || ""
      else
        docs.to_s
      end
    end
  end
end
