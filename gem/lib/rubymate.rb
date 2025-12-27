# frozen_string_literal: true

require "logger"
require_relative "rubymate/version"
require_relative "rubymate/solargraph_bridge"
require_relative "rubymate/completion_merger"
require_relative "rubymate/formatter"
require_relative "rubymate/test_runner"
require_relative "rubymate/rails_support"

module Rubymate
  class Error < StandardError; end

  class << self
    attr_writer :logger

    def logger
      @logger ||= begin
        logger = Logger.new($stdout)
        logger.level = ENV["RUBYMATE_LOG_LEVEL"]&.upcase == "DEBUG" ? Logger::DEBUG : Logger::INFO
        logger.formatter = proc do |severity, datetime, _progname, msg|
          "[RubyMate] #{severity} #{datetime.strftime('%Y-%m-%d %H:%M:%S')}: #{msg}\n"
        end
        logger
      end
    end

    def configure
      yield self if block_given?
    end
  end
end
