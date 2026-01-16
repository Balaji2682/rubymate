/**
 * Chain of Responsibility Pattern
 *
 * Allows multiple handlers to process requests in a chain.
 * Used for completion providers, hover providers, and other
 * scenarios with fallback handling.
 */

/**
 * Handler interface for the chain
 */
export interface Handler<TRequest, TResponse> {
    /** Handle the request and return a response or null to pass to next */
    handle(request: TRequest): TResponse | null | Promise<TResponse | null>;

    /** Set the next handler in the chain (optional) */
    setNext?(handler: Handler<TRequest, TResponse>): Handler<TRequest, TResponse>;
}

/**
 * Handler function type for simpler handlers
 */
export type HandlerFunction<TRequest, TResponse> = (
    request: TRequest
) => TResponse | null | Promise<TResponse | null>;

/**
 * Base handler class with built-in chain support
 *
 * @example
 * ```typescript
 * class LocalSymbolHandler extends BaseHandler<SymbolRequest, Symbol[]> {
 *   async handle(request: SymbolRequest): Promise<Symbol[] | null> {
 *     const symbols = await this.searchLocalSymbols(request);
 *     if (symbols.length > 0) {
 *       return symbols;
 *     }
 *     return this.passToNext(request);
 *   }
 * }
 * ```
 */
export abstract class BaseHandler<TRequest, TResponse>
    implements Handler<TRequest, TResponse> {
    protected next?: Handler<TRequest, TResponse>;

    /**
     * Set the next handler in the chain
     * @returns The next handler for chaining
     */
    setNext(handler: Handler<TRequest, TResponse>): Handler<TRequest, TResponse> {
        this.next = handler;
        return handler;
    }

    /**
     * Handle the request - must be implemented by subclasses
     */
    abstract handle(request: TRequest): TResponse | null | Promise<TResponse | null>;

    /**
     * Pass the request to the next handler
     */
    protected passToNext(request: TRequest): TResponse | null | Promise<TResponse | null> {
        if (this.next) {
            return this.next.handle(request);
        }
        return null;
    }
}

/**
 * Options for handler chain
 */
export interface HandlerChainOptions {
    /** Stop on first successful response. Default: true */
    stopOnSuccess?: boolean;

    /** Timeout for async handlers in milliseconds */
    timeout?: number;

    /** Continue even if a handler throws an error */
    continueOnError?: boolean;
}

/**
 * Handler chain builder for fluent API
 *
 * @example
 * ```typescript
 * const chain = new HandlerChain<Request, Response>()
 *   .addHandler(new CacheHandler())
 *   .addHandler(new LocalHandler())
 *   .addHandler(new RemoteHandler());
 *
 * const result = await chain.handle(request);
 * ```
 */
export class HandlerChain<TRequest, TResponse> {
    private handlers: Array<Handler<TRequest, TResponse>> = [];
    private readonly options: Required<HandlerChainOptions>;

    constructor(options: HandlerChainOptions = {}) {
        this.options = {
            stopOnSuccess: true,
            timeout: 0,
            continueOnError: false,
            ...options
        };
    }

    /**
     * Add a handler to the chain
     */
    addHandler(handler: Handler<TRequest, TResponse>): this;
    addHandler(handler: HandlerFunction<TRequest, TResponse>): this;
    addHandler(
        handler: Handler<TRequest, TResponse> | HandlerFunction<TRequest, TResponse>
    ): this {
        if (typeof handler === 'function') {
            // Wrap function in handler object
            this.handlers.push({
                handle: handler
            });
        } else {
            this.handlers.push(handler);
        }
        return this;
    }

    /**
     * Insert a handler at a specific position
     */
    insertHandler(
        index: number,
        handler: Handler<TRequest, TResponse> | HandlerFunction<TRequest, TResponse>
    ): this {
        const wrappedHandler: Handler<TRequest, TResponse> =
            typeof handler === 'function' ? { handle: handler } : handler;

        this.handlers.splice(index, 0, wrappedHandler);
        return this;
    }

    /**
     * Remove a handler from the chain
     */
    removeHandler(handler: Handler<TRequest, TResponse>): boolean {
        const index = this.handlers.indexOf(handler);
        if (index !== -1) {
            this.handlers.splice(index, 1);
            return true;
        }
        return false;
    }

    /**
     * Handle a request through the chain
     * Returns the first successful response or null
     */
    async handle(request: TRequest): Promise<TResponse | null> {
        for (const handler of this.handlers) {
            try {
                const result = await this.executeHandler(handler, request);
                if (result !== null && this.options.stopOnSuccess) {
                    return result;
                }
            } catch (error) {
                if (!this.options.continueOnError) {
                    throw error;
                }
                console.error('Handler error (continuing):', error);
            }
        }
        return null;
    }

    /**
     * Handle a request in parallel (race for first non-null response)
     * Returns as soon as any handler returns a non-null result
     */
    async handleParallel(request: TRequest): Promise<TResponse | null> {
        if (this.handlers.length === 0) {
            return null;
        }

        return new Promise((resolve, reject) => {
            let completed = 0;
            let hasResolved = false;
            const totalHandlers = this.handlers.length;

            for (const handler of this.handlers) {
                this.executeHandler(handler, request)
                    .then((result) => {
                        if (hasResolved) return;

                        if (result !== null) {
                            hasResolved = true;
                            resolve(result);
                        } else {
                            completed++;
                            // All handlers returned null
                            if (completed === totalHandlers) {
                                resolve(null);
                            }
                        }
                    })
                    .catch((error) => {
                        if (hasResolved) return;

                        if (!this.options.continueOnError) {
                            hasResolved = true;
                            reject(error);
                        } else {
                            console.error('Handler error (continuing):', error);
                            completed++;
                            // All handlers failed or returned null
                            if (completed === totalHandlers) {
                                resolve(null);
                            }
                        }
                    });
            }
        });
    }

    /**
     * Handle and collect all non-null responses
     */
    async handleAll(request: TRequest): Promise<TResponse[]> {
        const results: TResponse[] = [];

        for (const handler of this.handlers) {
            try {
                const result = await this.executeHandler(handler, request);
                if (result !== null) {
                    results.push(result);
                }
            } catch (error) {
                if (!this.options.continueOnError) {
                    throw error;
                }
                console.error('Handler error (continuing):', error);
            }
        }

        return results;
    }

    /**
     * Handle and merge all array responses
     */
    async handleMerge(request: TRequest): Promise<TResponse extends unknown[] ? TResponse : TResponse[]> {
        const allResults = await this.handleAll(request);

        // If responses are arrays, flatten them
        const merged: unknown[] = [];
        for (const result of allResults) {
            if (Array.isArray(result)) {
                merged.push(...result);
            } else {
                merged.push(result);
            }
        }

        return merged as TResponse extends unknown[] ? TResponse : TResponse[];
    }

    /**
     * Get the number of handlers in the chain
     */
    get length(): number {
        return this.handlers.length;
    }

    /**
     * Check if the chain has any handlers
     */
    isEmpty(): boolean {
        return this.handlers.length === 0;
    }

    /**
     * Clear all handlers
     */
    clear(): void {
        this.handlers = [];
    }

    /**
     * Create a linked chain (traditional CoR pattern)
     */
    buildLinkedChain(): Handler<TRequest, TResponse> | undefined {
        if (this.handlers.length === 0) {
            return undefined;
        }

        for (let i = 0; i < this.handlers.length - 1; i++) {
            const handler = this.handlers[i];
            if (handler.setNext) {
                handler.setNext(this.handlers[i + 1]);
            }
        }

        return this.handlers[0];
    }

    // Private methods

    private async executeHandler(
        handler: Handler<TRequest, TResponse>,
        request: TRequest
    ): Promise<TResponse | null> {
        const promise = Promise.resolve(handler.handle(request));

        if (this.options.timeout > 0) {
            return Promise.race([
                promise,
                this.timeoutPromise()
            ]);
        }

        return promise;
    }

    private timeoutPromise(): Promise<null> {
        return new Promise((resolve) => {
            setTimeout(() => resolve(null), this.options.timeout);
        });
    }
}

/**
 * Priority handler that tracks handler priority
 */
export interface PriorityHandler<TRequest, TResponse> extends Handler<TRequest, TResponse> {
    priority: number;
}

/**
 * Priority-based handler chain that executes handlers by priority
 */
export class PriorityHandlerChain<TRequest, TResponse> extends HandlerChain<TRequest, TResponse> {
    private priorityHandlers: Array<PriorityHandler<TRequest, TResponse>> = [];

    /**
     * Add a handler with priority (higher = executed first)
     */
    addPriorityHandler(
        handler: Handler<TRequest, TResponse>,
        priority: number
    ): this {
        // Create a wrapper that preserves the original handler's methods
        const priorityHandler: PriorityHandler<TRequest, TResponse> = {
            priority,
            handle: (request: TRequest) => handler.handle(request),
            setNext: handler.setNext?.bind(handler)
        };

        this.priorityHandlers.push(priorityHandler);
        this.priorityHandlers.sort((a, b) => b.priority - a.priority);

        // Rebuild the base handlers array
        this.rebuildHandlers();

        return this;
    }

    /**
     * Update a handler's priority
     */
    updatePriority(handler: Handler<TRequest, TResponse>, newPriority: number): boolean {
        const existing = this.priorityHandlers.find(h =>
            h.handle === handler.handle || h === handler
        );

        if (existing) {
            existing.priority = newPriority;
            this.priorityHandlers.sort((a, b) => b.priority - a.priority);
            this.rebuildHandlers();
            return true;
        }

        return false;
    }

    private rebuildHandlers(): void {
        this.clear();
        for (const handler of this.priorityHandlers) {
            super.addHandler(handler);
        }
    }
}

/**
 * Conditional handler that only processes requests matching a condition
 */
export class ConditionalHandler<TRequest, TResponse>
    extends BaseHandler<TRequest, TResponse> {
    constructor(
        private readonly condition: (request: TRequest) => boolean,
        private readonly handler: Handler<TRequest, TResponse>
    ) {
        super();
    }

    async handle(request: TRequest): Promise<TResponse | null> {
        if (this.condition(request)) {
            return this.handler.handle(request);
        }
        return this.passToNext(request);
    }
}

/**
 * Fallback handler that provides a default response
 */
export class FallbackHandler<TRequest, TResponse>
    extends BaseHandler<TRequest, TResponse> {
    constructor(
        private readonly fallbackValue: TResponse | ((request: TRequest) => TResponse)
    ) {
        super();
    }

    handle(request: TRequest): TResponse {
        if (typeof this.fallbackValue === 'function') {
            return (this.fallbackValue as (request: TRequest) => TResponse)(request);
        }
        return this.fallbackValue;
    }
}

/**
 * Caching handler that caches responses
 */
export class CachingHandler<TRequest, TResponse>
    extends BaseHandler<TRequest, TResponse> {
    private cache: Map<string, { value: TResponse; timestamp: number }> = new Map();

    constructor(
        private readonly handler: Handler<TRequest, TResponse>,
        private readonly keyFn: (request: TRequest) => string,
        private readonly ttlMs: number = 60000
    ) {
        super();
    }

    async handle(request: TRequest): Promise<TResponse | null> {
        const key = this.keyFn(request);
        const cached = this.cache.get(key);

        if (cached && Date.now() - cached.timestamp < this.ttlMs) {
            return cached.value;
        }

        const result = await this.handler.handle(request);

        if (result !== null) {
            this.cache.set(key, { value: result, timestamp: Date.now() });
        }

        return result;
    }

    /**
     * Clear the cache
     */
    clearCache(): void {
        this.cache.clear();
    }

    /**
     * Remove a specific cache entry
     */
    invalidate(request: TRequest): boolean {
        const key = this.keyFn(request);
        return this.cache.delete(key);
    }
}

/**
 * Retry handler that retries on failure
 */
export class RetryHandler<TRequest, TResponse>
    extends BaseHandler<TRequest, TResponse> {
    constructor(
        private readonly handler: Handler<TRequest, TResponse>,
        private readonly maxRetries: number = 3,
        private readonly delayMs: number = 1000
    ) {
        super();
    }

    async handle(request: TRequest): Promise<TResponse | null> {
        let lastError: Error | undefined;

        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                const result = await this.handler.handle(request);
                if (result !== null) {
                    return result;
                }
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                if (attempt < this.maxRetries) {
                    await this.delay(this.delayMs * Math.pow(2, attempt));
                }
            }
        }

        if (lastError) {
            throw lastError;
        }

        return this.passToNext(request);
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
