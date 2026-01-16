/**
 * Debounce and Throttle Utilities
 *
 * Rate-limiting utilities for controlling execution frequency.
 * Useful for file watchers, search input, and other high-frequency events.
 */

/**
 * Options for debounce function
 */
export interface DebounceOptions {
    /** Execute on the leading edge of the timeout. Default: false */
    leading?: boolean;

    /** Execute on the trailing edge of the timeout. Default: true */
    trailing?: boolean;

    /** Maximum time to wait before forcing execution. Default: undefined (no limit) */
    maxWait?: number;
}

/**
 * A debounced function with control methods
 */
export interface DebouncedFunction<T extends (...args: unknown[]) => unknown> {
    (...args: Parameters<T>): ReturnType<T> | undefined;
    /** Cancel any pending execution */
    cancel: () => void;
    /** Immediately execute if pending */
    flush: () => ReturnType<T> | undefined;
    /** Check if there's a pending execution */
    pending: () => boolean;
}

/**
 * Creates a debounced function that delays invoking `fn` until after `wait`
 * milliseconds have elapsed since the last time the debounced function was invoked.
 *
 * @param fn - The function to debounce
 * @param wait - The number of milliseconds to delay
 * @param options - Debounce options
 * @returns The debounced function
 *
 * @example
 * ```typescript
 * const search = debounce((query: string) => {
 *   console.log('Searching for:', query);
 * }, 300);
 *
 * search('a');
 * search('ab');
 * search('abc'); // Only this one executes after 300ms
 * ```
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
    fn: T,
    wait: number,
    options: DebounceOptions = {}
): DebouncedFunction<T> {
    const { leading = false, trailing = true, maxWait } = options;

    if (wait < 0) {
        throw new Error('wait must be non-negative');
    }

    if (maxWait !== undefined && maxWait < wait) {
        throw new Error('maxWait must be >= wait');
    }

    // Warn if both leading and trailing are false - function will never execute
    if (!leading && !trailing) {
        console.warn(
            'Debounce: Both leading and trailing are false. ' +
            'The debounced function will never execute.'
        );
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let maxTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let lastArgs: Parameters<T> | undefined;
    let lastThis: unknown;
    let result: ReturnType<T> | undefined;
    let lastCallTime: number | undefined;
    let lastInvokeTime = 0;

    const invokeFunc = (time: number): ReturnType<T> | undefined => {
        const args = lastArgs;
        const thisArg = lastThis;

        lastArgs = undefined;
        lastThis = undefined;
        lastInvokeTime = time;

        result = fn.apply(thisArg, args!) as ReturnType<T>;
        return result;
    };

    const startTimer = (pendingFunc: () => void, remainingWait: number): void => {
        timeoutId = setTimeout(pendingFunc, remainingWait);
    };

    const cancelTimer = (): void => {
        if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
            timeoutId = undefined;
        }
        if (maxTimeoutId !== undefined) {
            clearTimeout(maxTimeoutId);
            maxTimeoutId = undefined;
        }
    };

    const remainingWait = (time: number): number => {
        const timeSinceLastCall = time - (lastCallTime ?? 0);
        const timeSinceLastInvoke = time - lastInvokeTime;
        const timeWaiting = wait - timeSinceLastCall;

        return maxWait !== undefined
            ? Math.min(timeWaiting, maxWait - timeSinceLastInvoke)
            : timeWaiting;
    };

    const shouldInvoke = (time: number): boolean => {
        const timeSinceLastCall = time - (lastCallTime ?? 0);
        const timeSinceLastInvoke = time - lastInvokeTime;

        return (
            lastCallTime === undefined ||
            timeSinceLastCall >= wait ||
            timeSinceLastCall < 0 ||
            (maxWait !== undefined && timeSinceLastInvoke >= maxWait)
        );
    };

    const trailingEdge = (time: number): ReturnType<T> | undefined => {
        timeoutId = undefined;

        if (trailing && lastArgs) {
            return invokeFunc(time);
        }
        lastArgs = undefined;
        lastThis = undefined;
        return result;
    };

    const timerExpired = (): void => {
        const time = Date.now();
        if (shouldInvoke(time)) {
            trailingEdge(time);
            return;
        }
        // Restart the timer
        startTimer(timerExpired, remainingWait(time));
    };

    const leadingEdge = (time: number): ReturnType<T> | undefined => {
        lastInvokeTime = time;

        // Start the timer for trailing edge
        startTimer(timerExpired, wait);

        // Start max wait timer
        if (maxWait !== undefined) {
            maxTimeoutId = setTimeout(() => {
                if (lastArgs) {
                    invokeFunc(Date.now());
                    cancelTimer();
                    startTimer(timerExpired, wait);
                }
            }, maxWait);
        }

        return leading ? invokeFunc(time) : result;
    };

    const debounced = function (this: unknown, ...args: Parameters<T>): ReturnType<T> | undefined {
        const time = Date.now();
        const isInvoking = shouldInvoke(time);

        lastArgs = args;
        lastThis = this;
        lastCallTime = time;

        if (isInvoking) {
            if (timeoutId === undefined) {
                return leadingEdge(time);
            }
            if (maxWait !== undefined) {
                // Handle invocations in a tight loop
                cancelTimer();
                startTimer(timerExpired, wait);
                return invokeFunc(time);
            }
        }

        if (timeoutId === undefined) {
            startTimer(timerExpired, wait);
        }

        return result;
    } as DebouncedFunction<T>;

    debounced.cancel = (): void => {
        cancelTimer();
        lastInvokeTime = 0;
        lastArgs = undefined;
        lastCallTime = undefined;
        lastThis = undefined;
    };

    debounced.flush = (): ReturnType<T> | undefined => {
        if (timeoutId === undefined) {
            return result;
        }
        return trailingEdge(Date.now());
    };

    debounced.pending = (): boolean => {
        return timeoutId !== undefined;
    };

    return debounced;
}

/**
 * Options for throttle function
 */
export interface ThrottleOptions {
    /** Execute on the leading edge. Default: true */
    leading?: boolean;

    /** Execute on the trailing edge. Default: true */
    trailing?: boolean;
}

/**
 * A throttled function with control methods
 */
export interface ThrottledFunction<T extends (...args: unknown[]) => unknown> {
    (...args: Parameters<T>): ReturnType<T> | undefined;
    /** Cancel any pending execution */
    cancel: () => void;
}

/**
 * Creates a throttled function that only invokes `fn` at most once per
 * every `wait` milliseconds.
 *
 * @param fn - The function to throttle
 * @param wait - The number of milliseconds to throttle invocations to
 * @param options - Throttle options
 * @returns The throttled function
 *
 * @example
 * ```typescript
 * const onScroll = throttle(() => {
 *   console.log('Scroll event');
 * }, 100);
 *
 * window.addEventListener('scroll', onScroll);
 * ```
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
    fn: T,
    wait: number,
    options: ThrottleOptions = {}
): ThrottledFunction<T> {
    const { leading = true, trailing = true } = options;

    if (wait < 0) {
        throw new Error('wait must be non-negative');
    }

    return debounce(fn, wait, {
        leading,
        trailing,
        maxWait: wait
    }) as ThrottledFunction<T>;
}

/**
 * Creates an async-aware debounced function that handles Promise-returning functions.
 * Only the last invocation's promise will resolve; earlier ones are abandoned.
 *
 * @param fn - The async function to debounce
 * @param wait - The number of milliseconds to delay
 * @returns The debounced async function
 *
 * @example
 * ```typescript
 * const searchApi = debounceAsync(async (query: string) => {
 *   const response = await fetch(`/api/search?q=${query}`);
 *   return response.json();
 * }, 300);
 *
 * searchApi('test').then(results => console.log(results));
 * ```
 */
export function debounceAsync<T extends (...args: unknown[]) => Promise<unknown>>(
    fn: T,
    wait: number
): T & { cancel: () => void } {
    if (wait < 0) {
        throw new Error('wait must be non-negative');
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let pendingPromise: {
        resolve: (value: unknown) => void;
        reject: (error: unknown) => void;
    } | undefined;

    const debounced = function (this: unknown, ...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> {
        return new Promise((resolve, reject) => {
            // Cancel previous pending execution
            if (timeoutId !== undefined) {
                clearTimeout(timeoutId);
            }

            // Store the new promise handlers
            pendingPromise = { resolve: resolve as (v: unknown) => void, reject };

            timeoutId = setTimeout(async () => {
                timeoutId = undefined;
                const currentPromise = pendingPromise;

                if (!currentPromise) {
                    return;
                }

                try {
                    const result = await fn.apply(this, args);
                    // Only resolve if this is still the current promise
                    if (currentPromise === pendingPromise) {
                        currentPromise.resolve(result);
                    }
                } catch (error) {
                    if (currentPromise === pendingPromise) {
                        currentPromise.reject(error);
                    }
                }
            }, wait);
        });
    } as T & { cancel: () => void };

    debounced.cancel = (): void => {
        if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
            timeoutId = undefined;
        }
        pendingPromise = undefined;
    };

    return debounced;
}

/**
 * Class-based debouncer for more control over debouncing behavior
 */
export class Debouncer<T> {
    private timeoutId: ReturnType<typeof setTimeout> | undefined;
    private lastResult: T | undefined;
    private readonly fn: () => T;
    private readonly wait: number;
    private readonly options: DebounceOptions;

    constructor(fn: () => T, wait: number, options: DebounceOptions = {}) {
        if (wait < 0) {
            throw new Error('wait must be non-negative');
        }

        this.fn = fn;
        this.wait = wait;
        this.options = { trailing: true, ...options };
    }

    /**
     * Trigger the debounced function
     */
    trigger(): void {
        const { leading, trailing } = this.options;

        if (this.timeoutId === undefined && leading) {
            this.lastResult = this.fn();
        }

        if (this.timeoutId !== undefined) {
            clearTimeout(this.timeoutId);
        }

        if (trailing) {
            this.timeoutId = setTimeout(() => {
                this.timeoutId = undefined;
                this.lastResult = this.fn();
            }, this.wait);
        } else {
            this.timeoutId = setTimeout(() => {
                this.timeoutId = undefined;
            }, this.wait);
        }
    }

    /**
     * Cancel any pending execution
     */
    cancel(): void {
        if (this.timeoutId !== undefined) {
            clearTimeout(this.timeoutId);
            this.timeoutId = undefined;
        }
    }

    /**
     * Immediately execute if pending and return result
     */
    flush(): T | undefined {
        if (this.timeoutId !== undefined) {
            clearTimeout(this.timeoutId);
            this.timeoutId = undefined;
            this.lastResult = this.fn();
        }
        return this.lastResult;
    }

    /**
     * Check if there's a pending execution
     */
    get pending(): boolean {
        return this.timeoutId !== undefined;
    }

    /**
     * Get the last result (may be undefined if never executed)
     */
    get result(): T | undefined {
        return this.lastResult;
    }
}

/**
 * Class-based throttler for controlling execution rate
 */
export class Throttler<T> {
    private timeoutId: ReturnType<typeof setTimeout> | undefined;
    private lastResult: T | undefined;
    private lastExecuteTime = 0;
    private pendingExecution = false;
    private readonly fn: () => T;
    private readonly interval: number;

    constructor(fn: () => T, interval: number) {
        if (interval < 0) {
            throw new Error('interval must be non-negative');
        }

        this.fn = fn;
        this.interval = interval;
    }

    /**
     * Trigger the throttled function
     */
    trigger(): void {
        const now = Date.now();
        const timeSinceLastExecute = now - this.lastExecuteTime;

        if (timeSinceLastExecute >= this.interval) {
            // Execute immediately
            this.execute();
        } else if (!this.pendingExecution) {
            // Schedule execution
            this.pendingExecution = true;
            const remaining = this.interval - timeSinceLastExecute;

            this.timeoutId = setTimeout(() => {
                this.execute();
                this.pendingExecution = false;
            }, remaining);
        }
    }

    /**
     * Cancel any pending execution
     */
    cancel(): void {
        if (this.timeoutId !== undefined) {
            clearTimeout(this.timeoutId);
            this.timeoutId = undefined;
        }
        this.pendingExecution = false;
    }

    /**
     * Get the last result
     */
    get lastResultValue(): T | undefined {
        return this.lastResult;
    }

    /**
     * Check if there's a pending execution
     */
    get pending(): boolean {
        return this.pendingExecution;
    }

    private execute(): void {
        this.lastExecuteTime = Date.now();
        this.lastResult = this.fn();
    }
}
