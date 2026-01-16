/**
 * Decorator Pattern
 *
 * Extend and enhance providers with additional functionality
 * like caching, logging, metrics, and timeouts without modifying
 * the original implementation.
 */

/**
 * Generic decorator interface
 */
export interface Decorator<T> {
    wrap(target: T): T;
}

/**
 * Metrics data structure
 */
export interface MetricsData {
    callCount: number;
    successCount: number;
    errorCount: number;
    totalDuration: number;
    avgDuration: number;
    minDuration: number;
    maxDuration: number;
    lastCallTime?: number;
    lastError?: Error;
}

/**
 * Metrics collector interface
 */
export interface MetricsCollector {
    recordCall(methodName: string, duration: number, success: boolean, error?: Error): void;
    getMetrics(methodName?: string): MetricsData | Map<string, MetricsData>;
    reset(methodName?: string): void;
}

/**
 * Simple in-memory metrics collector
 */
export class SimpleMetricsCollector implements MetricsCollector {
    private metrics: Map<string, MetricsData> = new Map();

    recordCall(methodName: string, duration: number, success: boolean, error?: Error): void {
        let data = this.metrics.get(methodName);

        if (!data) {
            data = {
                callCount: 0,
                successCount: 0,
                errorCount: 0,
                totalDuration: 0,
                avgDuration: 0,
                minDuration: Infinity,
                maxDuration: 0
            };
            this.metrics.set(methodName, data);
        }

        data.callCount++;
        data.totalDuration += duration;
        data.avgDuration = data.totalDuration / data.callCount;
        data.minDuration = Math.min(data.minDuration, duration);
        data.maxDuration = Math.max(data.maxDuration, duration);
        data.lastCallTime = Date.now();

        if (success) {
            data.successCount++;
        } else {
            data.errorCount++;
            data.lastError = error;
        }
    }

    getMetrics(methodName?: string): MetricsData | Map<string, MetricsData> {
        if (methodName) {
            return this.metrics.get(methodName) ?? {
                callCount: 0,
                successCount: 0,
                errorCount: 0,
                totalDuration: 0,
                avgDuration: 0,
                minDuration: 0,
                maxDuration: 0
            };
        }
        return new Map(this.metrics);
    }

    reset(methodName?: string): void {
        if (methodName) {
            this.metrics.delete(methodName);
        } else {
            this.metrics.clear();
        }
    }
}

/**
 * Logger function type
 */
export type LoggerFn = (
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    data?: Record<string, unknown>
) => void;

/**
 * Cache interface for decorator
 */
export interface DecoratorCache<K, V> {
    get(key: K): V | undefined;
    set(key: K, value: V): void;
    has(key: K): boolean;
    delete(key: K): boolean;
    clear(): void;
}

/**
 * Simple TTL cache implementation
 */
export class TTLCache<K, V> implements DecoratorCache<K, V> {
    private cache: Map<K, { value: V; expiry: number }> = new Map();
    private readonly ttlMs: number;

    constructor(ttlMs: number = 60000) {
        this.ttlMs = ttlMs;
    }

    get(key: K): V | undefined {
        const entry = this.cache.get(key);
        if (!entry) {
            return undefined;
        }

        if (Date.now() > entry.expiry) {
            this.cache.delete(key);
            return undefined;
        }

        return entry.value;
    }

    set(key: K, value: V): void {
        this.cache.set(key, {
            value,
            expiry: Date.now() + this.ttlMs
        });
    }

    has(key: K): boolean {
        return this.get(key) !== undefined;
    }

    delete(key: K): boolean {
        return this.cache.delete(key);
    }

    clear(): void {
        this.cache.clear();
    }

    /**
     * Remove expired entries
     */
    cleanup(): number {
        const now = Date.now();
        let removed = 0;

        for (const [key, entry] of this.cache) {
            if (now > entry.expiry) {
                this.cache.delete(key);
                removed++;
            }
        }

        return removed;
    }
}

/**
 * Options for the decorator builder
 */
export interface DecoratorOptions {
    /** Cache for caching decorator */
    cache?: DecoratorCache<string, unknown>;

    /** Key generator for caching */
    cacheKeyFn?: (...args: unknown[]) => string;

    /** Logger function for logging decorator */
    logger?: LoggerFn;

    /** Log level for successful calls */
    logLevel?: 'debug' | 'info';

    /** Metrics collector for metrics decorator */
    metrics?: MetricsCollector;

    /** Timeout in milliseconds for timeout decorator */
    timeout?: number;

    /** Methods to decorate (default: all) */
    methods?: string[];

    /** Methods to exclude from decoration */
    excludeMethods?: string[];
}

/**
 * Create a caching decorator for a function
 */
export function withCaching<T extends (...args: unknown[]) => unknown>(
    fn: T,
    cache: DecoratorCache<string, ReturnType<T>>,
    keyFn: (...args: Parameters<T>) => string = (...args) => JSON.stringify(args)
): T {
    return ((...args: Parameters<T>): ReturnType<T> => {
        const key = keyFn(...args);
        const cached = cache.get(key);

        if (cached !== undefined) {
            return cached as ReturnType<T>;
        }

        const result = fn(...args);

        // Handle promises
        if (result instanceof Promise) {
            return result.then((value) => {
                cache.set(key, value as ReturnType<T>);
                return value;
            }) as ReturnType<T>;
        }

        cache.set(key, result as ReturnType<T>);
        return result as ReturnType<T>;
    }) as T;
}

/**
 * Create a logging decorator for a function
 */
export function withLogging<T extends (...args: unknown[]) => unknown>(
    fn: T,
    name: string,
    logger: LoggerFn,
    level: 'debug' | 'info' = 'debug'
): T {
    return ((...args: Parameters<T>): ReturnType<T> => {
        const startTime = Date.now();
        logger(level, `${name} called`, { args });

        try {
            const result = fn(...args);

            // Handle promises
            if (result instanceof Promise) {
                return result
                    .then((value) => {
                        const duration = Date.now() - startTime;
                        logger(level, `${name} completed`, { duration, result: value });
                        return value;
                    })
                    .catch((error) => {
                        const duration = Date.now() - startTime;
                        logger('error', `${name} failed`, { duration, error });
                        throw error;
                    }) as ReturnType<T>;
            }

            const duration = Date.now() - startTime;
            logger(level, `${name} completed`, { duration, result });
            return result as ReturnType<T>;
        } catch (error) {
            const duration = Date.now() - startTime;
            logger('error', `${name} failed`, { duration, error });
            throw error;
        }
    }) as T;
}

/**
 * Create a metrics decorator for a function
 */
export function withMetrics<T extends (...args: unknown[]) => unknown>(
    fn: T,
    name: string,
    metrics: MetricsCollector
): T {
    return ((...args: Parameters<T>): ReturnType<T> => {
        const startTime = Date.now();

        try {
            const result = fn(...args);

            // Handle promises
            if (result instanceof Promise) {
                return result
                    .then((value) => {
                        const duration = Date.now() - startTime;
                        metrics.recordCall(name, duration, true);
                        return value;
                    })
                    .catch((error) => {
                        const duration = Date.now() - startTime;
                        metrics.recordCall(name, duration, false, error);
                        throw error;
                    }) as ReturnType<T>;
            }

            const duration = Date.now() - startTime;
            metrics.recordCall(name, duration, true);
            return result as ReturnType<T>;
        } catch (error) {
            const duration = Date.now() - startTime;
            const err = error instanceof Error ? error : new Error(String(error));
            metrics.recordCall(name, duration, false, err);
            throw error;
        }
    }) as T;
}

/**
 * Create a timeout decorator for an async function
 * If the function is synchronous, it will be wrapped and still have timeout applied
 */
export function withTimeout<T extends (...args: unknown[]) => unknown>(
    fn: T,
    timeoutMs: number,
    timeoutError?: Error
): T {
    return ((...args: Parameters<T>): ReturnType<T> => {
        const result = fn(...args);

        // If result is not a promise, return as-is (sync functions don't need timeout)
        if (!(result instanceof Promise)) {
            return result as ReturnType<T>;
        }

        // For async functions, race against timeout
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
                reject(timeoutError ?? new Error(`Operation timed out after ${timeoutMs}ms`));
            }, timeoutMs);
        });

        return Promise.race([result, timeoutPromise]) as ReturnType<T>;
    }) as T;
}

/**
 * Create a retry decorator for a function
 */
export function withRetry<T extends (...args: unknown[]) => Promise<unknown>>(
    fn: T,
    maxRetries: number = 3,
    delayMs: number = 1000,
    shouldRetry: (error: Error) => boolean = () => true
): T {
    return (async (...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> => {
        let lastError: Error | undefined;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await fn(...args) as Awaited<ReturnType<T>>;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));

                if (attempt < maxRetries && shouldRetry(lastError)) {
                    await new Promise(resolve => setTimeout(resolve, delayMs * Math.pow(2, attempt)));
                } else {
                    break;
                }
            }
        }

        throw lastError;
    }) as T;
}

/**
 * Create a throttle decorator for a function
 */
export function withThrottle<T extends (...args: unknown[]) => unknown>(
    fn: T,
    intervalMs: number
): T & { reset: () => void } {
    let lastCallTime = 0;
    let lastResult: ReturnType<T> | undefined;

    const throttled = ((...args: Parameters<T>): ReturnType<T> => {
        const now = Date.now();
        if (now - lastCallTime >= intervalMs) {
            lastCallTime = now;
            lastResult = fn(...args) as ReturnType<T>;
        }
        return lastResult as ReturnType<T>;
    }) as T & { reset: () => void };

    throttled.reset = () => {
        lastCallTime = 0;
        lastResult = undefined;
    };

    return throttled;
}

/**
 * Decorator builder for fluent API
 *
 * @example
 * ```typescript
 * const decorated = new DecoratorBuilder(myProvider)
 *   .withCaching(cache, keyFn)
 *   .withLogging(logger)
 *   .withMetrics(metrics)
 *   .withTimeout(5000)
 *   .build();
 * ```
 */
export class DecoratorBuilder<T extends object> {
    private target: T;
    private decorators: Array<(target: T) => T> = [];
    private readonly options: DecoratorOptions;

    constructor(target: T, options: DecoratorOptions = {}) {
        this.target = target;
        this.options = options;
    }

    /**
     * Add caching to specified methods
     */
    withCaching(
        cache?: DecoratorCache<string, unknown>,
        keyFn?: (...args: unknown[]) => string
    ): this {
        const effectiveCache = cache ?? this.options.cache ?? new TTLCache(60000);
        const effectiveKeyFn = keyFn ?? this.options.cacheKeyFn ?? ((...args) => JSON.stringify(args));

        this.decorators.push((target) => {
            return this.decorateMethods(target, (fn, name) =>
                withCaching(fn, effectiveCache as DecoratorCache<string, unknown>, effectiveKeyFn)
            );
        });

        return this;
    }

    /**
     * Add logging to specified methods
     */
    withLogging(logger?: LoggerFn, level?: 'debug' | 'info'): this {
        const effectiveLogger = logger ?? this.options.logger ?? console.log.bind(console);
        const effectiveLevel = level ?? this.options.logLevel ?? 'debug';

        this.decorators.push((target) => {
            return this.decorateMethods(target, (fn, name) =>
                withLogging(fn, name, effectiveLogger, effectiveLevel)
            );
        });

        return this;
    }

    /**
     * Add metrics collection to specified methods
     */
    withMetrics(metrics?: MetricsCollector): this {
        const effectiveMetrics = metrics ?? this.options.metrics ?? new SimpleMetricsCollector();

        this.decorators.push((target) => {
            return this.decorateMethods(target, (fn, name) =>
                withMetrics(fn, name, effectiveMetrics)
            );
        });

        return this;
    }

    /**
     * Add timeout to async methods
     */
    withTimeout(timeoutMs?: number): this {
        const effectiveTimeout = timeoutMs ?? this.options.timeout ?? 30000;

        this.decorators.push((target) => {
            return this.decorateMethods(target, (fn, _name) => {
                // Wrap with timeout - the wrapper will handle both sync and async
                return withTimeout(
                    fn as (...args: unknown[]) => Promise<unknown>,
                    effectiveTimeout
                );
            });
        });

        return this;
    }

    /**
     * Build the decorated object
     */
    build(): T {
        let result = this.target;

        for (const decorator of this.decorators) {
            result = decorator(result);
        }

        return result;
    }

    // Private helper

    private decorateMethods(
        target: T,
        decorator: (fn: (...args: unknown[]) => unknown, name: string) => (...args: unknown[]) => unknown
    ): T {
        const methods = this.options.methods;
        const excludeMethods = this.options.excludeMethods ?? [];
        const result = Object.create(Object.getPrototypeOf(target));

        for (const key of Object.getOwnPropertyNames(target)) {
            const value = (target as Record<string, unknown>)[key];

            if (typeof value === 'function') {
                const shouldDecorate =
                    (!methods || methods.includes(key)) &&
                    !excludeMethods.includes(key);

                if (shouldDecorate) {
                    result[key] = decorator(value.bind(target), key);
                } else {
                    result[key] = value.bind(target);
                }
            } else {
                result[key] = value;
            }
        }

        return result as T;
    }
}

/**
 * Create a decorated version of an object
 */
export function decorate<T extends object>(
    target: T,
    options?: DecoratorOptions
): DecoratorBuilder<T> {
    return new DecoratorBuilder(target, options);
}
