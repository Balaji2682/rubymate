import * as vscode from 'vscode';

/**
 * Rails Template Completion Provider
 * Provides IntelliSense for Rails helpers in ERB, Haml, and Slim templates
 */
export class TemplateCompletionProvider implements vscode.CompletionItemProvider {
    private railsHelpers: vscode.CompletionItem[];

    constructor() {
        this.railsHelpers = this.buildRailsHelpers();
    }

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
        const lineText = document.lineAt(position.line).text;
        const linePrefix = lineText.substring(0, position.character);

        // Check if we're inside Ruby code in templates
        const isInRubyCode = this.isInRubyCode(linePrefix, document.languageId);

        if (!isInRubyCode) {
            return undefined;
        }

        // Return all Rails helpers
        return this.railsHelpers;
    }

    private isInRubyCode(linePrefix: string, languageId: string): boolean {
        switch (languageId) {
            case 'erb':
                // Check if inside <%= %> or <% %>
                return linePrefix.includes('<%') && !linePrefix.includes('%>');
            case 'haml':
                // In Haml, check for = or - at start of line or after tag
                return /[=-]\s*\w*$/.test(linePrefix) || /^\s*[=-]/.test(linePrefix);
            case 'slim':
                // In Slim, check for = or - or ruby: at start of line
                return /[=-]\s*\w*$/.test(linePrefix) || /^\s*[=-]/.test(linePrefix) || /ruby:/.test(linePrefix);
            default:
                return false;
        }
    }

    private buildRailsHelpers(): vscode.CompletionItem[] {
        const helpers: Array<{
            name: string;
            snippet: string;
            documentation: string;
            kind: vscode.CompletionItemKind;
        }> = [
            // Link helpers
            {
                name: 'link_to',
                snippet: 'link_to "${1:text}", ${2:path}${3:, class: "${4:class}"}',
                documentation: 'Creates a link tag of the given name using a URL created by the set of options.',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'button_to',
                snippet: 'button_to "${1:text}", ${2:path}${3:, method: :${4:post}}',
                documentation: 'Generates a form containing a single button that submits to the URL.',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'mail_to',
                snippet: 'mail_to "${1:email@example.com}"${2:, "${3:Email me}"}',
                documentation: 'Creates a mailto link tag to the specified email address.',
                kind: vscode.CompletionItemKind.Function
            },

            // Form helpers
            {
                name: 'form_with',
                snippet: 'form_with(model: ${1:@model}${2:, local: true}) do |${3:f}|\n  $0\nend',
                documentation: 'Creates a form that allows the user to create or update the attributes of a model.',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'form_for',
                snippet: 'form_for ${1:@model} do |${2:f}|\n  $0\nend',
                documentation: 'Creates a form that allows the user to create or update the attributes of a model (legacy).',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'form_tag',
                snippet: 'form_tag ${1:url} do\n  $0\nend',
                documentation: 'Creates a form tag that points to a URL (does not use a model).',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'text_field',
                snippet: '${1:f}.text_field :${2:attribute}${3:, class: "${4:class}"}',
                documentation: 'Returns an input tag of the "text" type.',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'text_area',
                snippet: '${1:f}.text_area :${2:attribute}${3:, rows: ${4:5}}',
                documentation: 'Returns a textarea opening and closing tag.',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'password_field',
                snippet: '${1:f}.password_field :${2:password}',
                documentation: 'Returns an input tag of the "password" type.',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'email_field',
                snippet: '${1:f}.email_field :${2:email}',
                documentation: 'Returns an input tag of the "email" type.',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'number_field',
                snippet: '${1:f}.number_field :${2:attribute}${3:, in: ${4:1}..${5:10}}',
                documentation: 'Returns an input tag of the "number" type.',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'check_box',
                snippet: '${1:f}.check_box :${2:attribute}',
                documentation: 'Returns a checkbox tag.',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'radio_button',
                snippet: '${1:f}.radio_button :${2:attribute}, ${3:value}',
                documentation: 'Returns a radio button tag.',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'select',
                snippet: '${1:f}.select :${2:attribute}, ${3:options}',
                documentation: 'Creates a select tag and options tags for a collection.',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'collection_select',
                snippet: '${1:f}.collection_select :${2:attribute}, ${3:collection}, :${4:id}, :${5:name}',
                documentation: 'Returns select and option tags for a collection of existing objects.',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'file_field',
                snippet: '${1:f}.file_field :${2:attribute}',
                documentation: 'Returns a file upload input tag.',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'hidden_field',
                snippet: '${1:f}.hidden_field :${2:attribute}',
                documentation: 'Returns a hidden input tag.',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'label',
                snippet: '${1:f}.label :${2:attribute}${3:, "${4:Label}"}',
                documentation: 'Returns a label tag.',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'submit',
                snippet: '${1:f}.submit "${2:Submit}"',
                documentation: 'Returns a submit button.',
                kind: vscode.CompletionItemKind.Function
            },

            // Render helpers
            {
                name: 'render',
                snippet: 'render ${1|"partial","partial: \\"name\\"","template: \\"name\\"","layout: \\"name\\"|}',
                documentation: 'Renders a template or partial.',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'render partial',
                snippet: 'render partial: "${1:partial}"${2:, locals: { ${3:key}: ${4:value} \\}}',
                documentation: 'Renders a partial with optional local variables.',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'render collection',
                snippet: 'render partial: "${1:partial}", collection: ${2:@collection}',
                documentation: 'Renders a partial for each item in a collection.',
                kind: vscode.CompletionItemKind.Function
            },

            // Content helpers
            {
                name: 'content_for',
                snippet: 'content_for :${1:name} do\n  $0\nend',
                documentation: 'Captures a block of markup in a named buffer for later use.',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'yield',
                snippet: 'yield${1: :${2:name}}',
                documentation: 'Renders the content captured by content_for.',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'provide',
                snippet: 'provide :${1:name}, "${2:content}"',
                documentation: 'Provides content for a named yield block.',
                kind: vscode.CompletionItemKind.Function
            },

            // Asset helpers
            {
                name: 'image_tag',
                snippet: 'image_tag "${1:image.png}"${2:, alt: "${3:Alt text}"}',
                documentation: 'Returns an HTML image tag.',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'stylesheet_link_tag',
                snippet: 'stylesheet_link_tag "${1:application}"',
                documentation: 'Returns a stylesheet link tag.',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'javascript_include_tag',
                snippet: 'javascript_include_tag "${1:application}"',
                documentation: 'Returns a JavaScript include tag.',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'asset_path',
                snippet: 'asset_path("${1:asset}")',
                documentation: 'Returns the path to an asset.',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'video_tag',
                snippet: 'video_tag "${1:video.mp4}"${2:, controls: true}',
                documentation: 'Returns a video tag.',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'audio_tag',
                snippet: 'audio_tag "${1:audio.mp3}"${2:, controls: true}',
                documentation: 'Returns an audio tag.',
                kind: vscode.CompletionItemKind.Function
            },

            // Text helpers
            {
                name: 'truncate',
                snippet: 'truncate(${1:text}, length: ${2:30})',
                documentation: 'Truncates text to a given length.',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'simple_format',
                snippet: 'simple_format(${1:text})',
                documentation: 'Converts newlines to <br> and wraps in <p> tags.',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'pluralize',
                snippet: 'pluralize(${1:count}, "${2:word}")',
                documentation: 'Pluralizes a word based on a count.',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'time_ago_in_words',
                snippet: 'time_ago_in_words(${1:time})',
                documentation: 'Converts a time to words like "2 hours ago".',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'number_to_currency',
                snippet: 'number_to_currency(${1:number})',
                documentation: 'Formats a number as currency.',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'number_with_delimiter',
                snippet: 'number_with_delimiter(${1:number})',
                documentation: 'Formats a number with thousands delimiter.',
                kind: vscode.CompletionItemKind.Function
            },

            // Tag helpers
            {
                name: 'content_tag',
                snippet: 'content_tag :${1:div}, "${2:content}"${3:, class: "${4:class}"}',
                documentation: 'Returns an HTML block tag with content.',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'tag',
                snippet: 'tag.${1:div}${2: "${3:content}"}${4:, class: "${5:class}"}',
                documentation: 'Returns an HTML tag.',
                kind: vscode.CompletionItemKind.Function
            },

            // URL helpers
            {
                name: 'url_for',
                snippet: 'url_for(${1:options})',
                documentation: 'Returns the URL for the given options.',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'link_to_if',
                snippet: 'link_to_if(${1:condition}, "${2:text}", ${3:path})',
                documentation: 'Creates a link if condition is true.',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'link_to_unless',
                snippet: 'link_to_unless(${1:condition}, "${2:text}", ${3:path})',
                documentation: 'Creates a link unless condition is true.',
                kind: vscode.CompletionItemKind.Function
            },

            // Sanitize helpers
            {
                name: 'sanitize',
                snippet: 'sanitize(${1:html})',
                documentation: 'Sanitizes HTML to prevent XSS attacks.',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'raw',
                snippet: 'raw(${1:html})',
                documentation: 'Outputs unescaped HTML (use carefully!).',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'h',
                snippet: 'h(${1:text})',
                documentation: 'HTML escapes text (alias for html_escape).',
                kind: vscode.CompletionItemKind.Function
            },

            // Flash helpers
            {
                name: 'flash',
                snippet: 'flash[:${1|notice,alert,error,warning|}]',
                documentation: 'Accesses flash messages.',
                kind: vscode.CompletionItemKind.Variable
            },

            // CSRF helpers
            {
                name: 'csrf_meta_tags',
                snippet: 'csrf_meta_tags',
                documentation: 'Returns CSRF meta tags for forms.',
                kind: vscode.CompletionItemKind.Function
            },

            // Turbo helpers (Rails 7+)
            {
                name: 'turbo_stream',
                snippet: 'turbo_stream.${1|replace,update,append,prepend,remove|}("${2:target}")',
                documentation: 'Returns a Turbo Stream action.',
                kind: vscode.CompletionItemKind.Function
            },
            {
                name: 'turbo_frame_tag',
                snippet: 'turbo_frame_tag "${1:id}" do\n  $0\nend',
                documentation: 'Creates a Turbo Frame.',
                kind: vscode.CompletionItemKind.Function
            }
        ];

        return helpers.map(helper => {
            const item = new vscode.CompletionItem(helper.name, helper.kind);
            item.insertText = new vscode.SnippetString(helper.snippet);
            item.documentation = new vscode.MarkdownString(helper.documentation);
            item.detail = 'Rails Helper';
            return item;
        });
    }
}
