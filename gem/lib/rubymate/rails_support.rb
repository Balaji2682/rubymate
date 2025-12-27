# frozen_string_literal: true

module Rubymate
  # Rails-specific support
  class RailsSupport
    def initialize(root_path)
      @root_path = root_path
      @is_rails = File.exist?(File.join(root_path, "config", "application.rb"))
    end

    def rails_project?
      @is_rails
    end

    def navigate_to_related_file(current_file)
      return nil unless rails_project?

      case current_file
      when %r{app/models/(.+)\.rb$}
        # Model -> Migration or Spec
        model_name = ::Regexp.last_match(1)
        [
          find_migration(model_name),
          find_spec("models", model_name)
        ].compact
      when %r{app/controllers/(.+)_controller\.rb$}
        # Controller -> View or Spec
        controller_name = ::Regexp.last_match(1)
        [
          find_views(controller_name),
          find_spec("controllers", "#{controller_name}_controller")
        ].flatten.compact
      when %r{spec/(.+)/(.+)_spec\.rb$}
        # Spec -> Implementation
        type = ::Regexp.last_match(1)
        name = ::Regexp.last_match(2)
        [find_implementation(type, name)].compact
      else
        []
      end
    end

    def get_route_helpers
      return [] unless rails_project?

      routes_file = File.join(@root_path, "config", "routes.rb")
      return [] unless File.exist?(routes_file)

      # Parse routes file and extract route helpers
      # This is a simplified version
      []
    end

    private

    def find_migration(model_name)
      migrations_dir = File.join(@root_path, "db", "migrate")
      return nil unless Dir.exist?(migrations_dir)

      Dir.glob(File.join(migrations_dir, "*_create_#{model_name.pluralize}.rb")).first
    end

    def find_spec(type, name)
      spec_file = File.join(@root_path, "spec", type, "#{name}_spec.rb")
      File.exist?(spec_file) ? spec_file : nil
    end

    def find_views(controller_name)
      views_dir = File.join(@root_path, "app", "views", controller_name)
      return [] unless Dir.exist?(views_dir)

      Dir.glob(File.join(views_dir, "*"))
    end

    def find_implementation(type, name)
      impl_file = File.join(@root_path, "app", type, "#{name}.rb")
      File.exist?(impl_file) ? impl_file : nil
    end
  end
end
