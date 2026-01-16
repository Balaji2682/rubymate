/**
 * Factory Pattern for Provider Creation
 *
 * Centralizes the creation and registration of VS Code providers,
 * making the extension.ts cleaner and provider management easier.
 */

import * as vscode from 'vscode';

/**
 * Provider types supported by the factory
 */
export type ProviderType =
    | 'completion'
    | 'definition'
    | 'reference'
    | 'hover'
    | 'documentSymbol'
    | 'workspaceSymbol'
    | 'codeAction'
    | 'codeLens'
    | 'formatting'
    | 'rename'
    | 'signatureHelp'
    | 'typeHierarchy'
    | 'callHierarchy';

/**
 * Configuration for a provider registration
 */
export interface ProviderConfig {
    /** Provider type */
    type: ProviderType;

    /** Document selector for the provider */
    selector: vscode.DocumentSelector;

    /** Provider instance */
    provider: unknown;

    /** Trigger characters (for completion providers) */
    triggerCharacters?: string[];

    /** Provider ID for identification */
    id?: string;

    /** Whether the provider is enabled */
    enabled?: boolean;

    /** Priority for this provider (higher = more important) */
    priority?: number;
}

/**
 * Registration result with metadata
 */
export interface ProviderRegistration {
    id: string;
    type: ProviderType;
    disposable: vscode.Disposable;
}

/**
 * Provider Factory
 *
 * Centralizes provider creation and registration, providing:
 * - Consistent registration API
 * - Easy enable/disable of providers
 * - Bulk registration and cleanup
 * - Provider dependency management
 */
export class ProviderFactory {
    private registrations: Map<string, ProviderRegistration> = new Map();
    private configById: Map<string, ProviderConfig> = new Map();
    private idCounter: number = 0;

    /**
     * Register a single provider
     * @throws Error if provider is null/undefined
     */
    register(config: ProviderConfig): ProviderRegistration {
        const id = config.id || this.generateId(config.type);

        // Validate provider is not null/undefined
        if (!config.provider) {
            throw new Error(`Provider instance is required for '${id}'`);
        }

        if (config.enabled === false) {
            // Return a no-op registration for disabled providers
            return {
                id,
                type: config.type,
                disposable: new vscode.Disposable(() => { })
            };
        }

        // Check for duplicate ID and warn
        if (this.registrations.has(id)) {
            console.warn(`ProviderFactory: Provider with ID '${id}' already registered, overwriting`);
            this.unregister(id);
        }

        const disposable = this.createDisposable(config);

        const registration: ProviderRegistration = {
            id,
            type: config.type,
            disposable
        };

        this.registrations.set(id, registration);
        this.configById.set(id, config);

        return registration;
    }

    /**
     * Register multiple providers at once
     */
    registerAll(configs: ProviderConfig[]): ProviderRegistration[] {
        // Sort by priority (higher first)
        const sorted = [...configs].sort((a, b) =>
            (b.priority ?? 0) - (a.priority ?? 0)
        );

        return sorted.map(config => this.register(config));
    }

    /**
     * Unregister a provider by ID
     */
    unregister(id: string): boolean {
        const registration = this.registrations.get(id);
        if (!registration) {
            return false;
        }

        registration.disposable.dispose();
        this.registrations.delete(id);
        this.configById.delete(id);
        return true;
    }

    /**
     * Unregister all providers of a given type
     */
    unregisterByType(type: ProviderType): number {
        let count = 0;
        for (const [id, registration] of this.registrations) {
            if (registration.type === type) {
                this.unregister(id);
                count++;
            }
        }
        return count;
    }

    /**
     * Unregister all providers
     */
    unregisterAll(): void {
        for (const registration of this.registrations.values()) {
            registration.disposable.dispose();
        }
        this.registrations.clear();
        this.configById.clear();
    }

    /**
     * Get a registration by ID
     */
    getRegistration(id: string): ProviderRegistration | undefined {
        return this.registrations.get(id);
    }

    /**
     * Get all registrations
     */
    getAllRegistrations(): ProviderRegistration[] {
        return Array.from(this.registrations.values());
    }

    /**
     * Get all registrations of a given type
     */
    getRegistrationsByType(type: ProviderType): ProviderRegistration[] {
        return Array.from(this.registrations.values())
            .filter(r => r.type === type);
    }

    /**
     * Check if a provider is registered
     */
    isRegistered(id: string): boolean {
        return this.registrations.has(id);
    }

    /**
     * Get all disposables for context.subscriptions
     */
    getDisposables(): vscode.Disposable[] {
        return Array.from(this.registrations.values())
            .map(r => r.disposable);
    }

    /**
     * Add all registered providers to extension context
     */
    addToContext(context: vscode.ExtensionContext): void {
        for (const registration of this.registrations.values()) {
            context.subscriptions.push(registration.disposable);
        }
    }

    private generateId(type: ProviderType): string {
        return `${type}-${++this.idCounter}`;
    }

    private createDisposable(config: ProviderConfig): vscode.Disposable {
        const { type, selector, provider, triggerCharacters } = config;

        switch (type) {
            case 'completion':
                return vscode.languages.registerCompletionItemProvider(
                    selector,
                    provider as vscode.CompletionItemProvider,
                    ...(triggerCharacters || [])
                );

            case 'definition':
                return vscode.languages.registerDefinitionProvider(
                    selector,
                    provider as vscode.DefinitionProvider
                );

            case 'reference':
                return vscode.languages.registerReferenceProvider(
                    selector,
                    provider as vscode.ReferenceProvider
                );

            case 'hover':
                return vscode.languages.registerHoverProvider(
                    selector,
                    provider as vscode.HoverProvider
                );

            case 'documentSymbol':
                return vscode.languages.registerDocumentSymbolProvider(
                    selector,
                    provider as vscode.DocumentSymbolProvider
                );

            case 'workspaceSymbol':
                return vscode.languages.registerWorkspaceSymbolProvider(
                    provider as vscode.WorkspaceSymbolProvider
                );

            case 'codeAction':
                return vscode.languages.registerCodeActionsProvider(
                    selector,
                    provider as vscode.CodeActionProvider
                );

            case 'codeLens':
                return vscode.languages.registerCodeLensProvider(
                    selector,
                    provider as vscode.CodeLensProvider
                );

            case 'formatting':
                return vscode.languages.registerDocumentFormattingEditProvider(
                    selector,
                    provider as vscode.DocumentFormattingEditProvider
                );

            case 'rename':
                return vscode.languages.registerRenameProvider(
                    selector,
                    provider as vscode.RenameProvider
                );

            case 'signatureHelp':
                return vscode.languages.registerSignatureHelpProvider(
                    selector,
                    provider as vscode.SignatureHelpProvider,
                    ...(triggerCharacters || [])
                );

            case 'typeHierarchy':
                return vscode.languages.registerTypeHierarchyProvider(
                    selector,
                    provider as vscode.TypeHierarchyProvider
                );

            case 'callHierarchy':
                return vscode.languages.registerCallHierarchyProvider(
                    selector,
                    provider as vscode.CallHierarchyProvider
                );

            default:
                throw new Error(`Unknown provider type: ${type}`);
        }
    }
}

/**
 * Provider configuration builder for fluent API
 */
export class ProviderConfigBuilder {
    private config: Partial<ProviderConfig> = {};

    /**
     * Set the provider type
     */
    type(type: ProviderType): this {
        this.config.type = type;
        return this;
    }

    /**
     * Set the document selector
     */
    selector(selector: vscode.DocumentSelector): this {
        this.config.selector = selector;
        return this;
    }

    /**
     * Set the provider instance
     */
    provider(provider: unknown): this {
        this.config.provider = provider;
        return this;
    }

    /**
     * Set trigger characters
     */
    triggers(...chars: string[]): this {
        this.config.triggerCharacters = chars;
        return this;
    }

    /**
     * Set the provider ID
     */
    id(id: string): this {
        this.config.id = id;
        return this;
    }

    /**
     * Set whether the provider is enabled
     */
    enabled(enabled: boolean): this {
        this.config.enabled = enabled;
        return this;
    }

    /**
     * Set the priority
     */
    priority(priority: number): this {
        this.config.priority = priority;
        return this;
    }

    /**
     * Build the configuration
     */
    build(): ProviderConfig {
        if (!this.config.type) {
            throw new Error('Provider type is required');
        }
        if (!this.config.selector) {
            throw new Error('Document selector is required');
        }
        if (!this.config.provider) {
            throw new Error('Provider instance is required');
        }

        return this.config as ProviderConfig;
    }

    /**
     * Create a new builder
     */
    static create(): ProviderConfigBuilder {
        return new ProviderConfigBuilder();
    }
}

/**
 * Language selectors for common languages
 */
export const LanguageSelectors = {
    ruby: { language: 'ruby' } as vscode.DocumentSelector,
    erb: { language: 'erb' } as vscode.DocumentSelector,
    haml: { language: 'haml' } as vscode.DocumentSelector,
    slim: { language: 'slim' } as vscode.DocumentSelector,

    /** All Ruby-related languages */
    rubyAll: [
        { language: 'ruby' },
        { language: 'erb' },
        { language: 'haml' },
        { language: 'slim' }
    ] as vscode.DocumentSelector,

    /** Ruby template languages only */
    rubyTemplates: [
        { language: 'erb' },
        { language: 'haml' },
        { language: 'slim' }
    ] as vscode.DocumentSelector,

    /** Rails-specific patterns */
    railsControllers: { language: 'ruby', pattern: '**/controllers/**/*.rb' } as vscode.DocumentSelector,
    railsModels: { language: 'ruby', pattern: '**/models/**/*.rb' } as vscode.DocumentSelector,
    railsViews: [
        { language: 'erb', pattern: '**/views/**/*.erb' },
        { language: 'haml', pattern: '**/views/**/*.haml' },
        { language: 'slim', pattern: '**/views/**/*.slim' }
    ] as vscode.DocumentSelector
};

/**
 * Common trigger characters
 */
export const TriggerCharacters = {
    ruby: ['.', ':', '@', '$'],
    erb: ['<', '%', '=', '.', ':', '@'],
    method: ['.'],
    module: [':', ':'],
    variable: ['@', '$'],
    html: ['<', '/', '"', "'"]
};
