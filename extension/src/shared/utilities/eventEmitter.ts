/**
 * Type-Safe Event Emitter
 *
 * A strongly-typed pub/sub implementation for component communication.
 * Provides compile-time type checking for event names and payloads.
 */

/**
 * Base type for event maps - maps event names to their payload types
 */
export type EventMap = Record<string, unknown>;

/**
 * Type-safe event listener function
 */
export type EventListener<T> = (data: T) => void;

/**
 * Unsubscribe function returned by on/once
 */
export type Unsubscribe = () => void;

/**
 * Interface for typed event emitters
 */
export interface TypedEventEmitter<Events extends EventMap> {
    on<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): Unsubscribe;
    once<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): Unsubscribe;
    off<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): void;
    emit<K extends keyof Events>(event: K, data: Events[K]): void;
}

/**
 * Internal listener wrapper for once functionality
 */
interface ListenerWrapper<T> {
    listener: EventListener<T>;
    once: boolean;
}

/**
 * Type-safe event emitter implementation
 *
 * @typeParam Events - Event map type defining event names and their payload types
 *
 * @example
 * ```typescript
 * interface MyEvents {
 *   'user:login': { userId: string; timestamp: number };
 *   'user:logout': { userId: string };
 *   'error': Error;
 * }
 *
 * const emitter = new EventEmitter<MyEvents>();
 *
 * emitter.on('user:login', (data) => {
 *   console.log(`User ${data.userId} logged in at ${data.timestamp}`);
 * });
 *
 * emitter.emit('user:login', { userId: '123', timestamp: Date.now() });
 * ```
 */
export class EventEmitter<Events extends EventMap> implements TypedEventEmitter<Events> {
    private listeners: Map<keyof Events, ListenerWrapper<unknown>[]> = new Map();
    private maxListeners: number = 10;

    /**
     * Create a new EventEmitter
     * @param options - Configuration options
     */
    constructor(options: { maxListeners?: number } = {}) {
        this.maxListeners = options.maxListeners ?? 10;
    }

    /**
     * Subscribe to an event
     * @param event - Event name
     * @param listener - Callback function
     * @returns Unsubscribe function
     */
    on<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): Unsubscribe {
        return this.addListener(event, listener, false);
    }

    /**
     * Subscribe to an event, automatically unsubscribe after first emission
     * @param event - Event name
     * @param listener - Callback function
     * @returns Unsubscribe function
     */
    once<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): Unsubscribe {
        return this.addListener(event, listener, true);
    }

    /**
     * Unsubscribe from an event
     * @param event - Event name
     * @param listener - The callback to remove
     */
    off<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): void {
        const eventListeners = this.listeners.get(event);
        if (!eventListeners) {
            return;
        }

        const index = eventListeners.findIndex(w => w.listener === listener);
        if (index !== -1) {
            eventListeners.splice(index, 1);
        }

        if (eventListeners.length === 0) {
            this.listeners.delete(event);
        }
    }

    /**
     * Emit an event to all subscribers
     * @param event - Event name
     * @param data - Event payload
     */
    emit<K extends keyof Events>(event: K, data: Events[K]): void {
        const eventListeners = this.listeners.get(event);
        if (!eventListeners) {
            return;
        }

        // Create a copy to avoid issues if listeners modify the list
        const listenersToCall = [...eventListeners];
        const toRemove: ListenerWrapper<unknown>[] = [];

        for (const wrapper of listenersToCall) {
            try {
                (wrapper.listener as EventListener<Events[K]>)(data);
            } catch (error) {
                console.error(`Error in event listener for '${String(event)}':`, error);
            }

            if (wrapper.once) {
                toRemove.push(wrapper);
            }
        }

        // Remove once listeners
        for (const wrapper of toRemove) {
            const index = eventListeners.indexOf(wrapper);
            if (index !== -1) {
                eventListeners.splice(index, 1);
            }
        }

        if (eventListeners.length === 0) {
            this.listeners.delete(event);
        }
    }

    /**
     * Emit an event asynchronously (listeners run in next tick)
     * @param event - Event name
     * @param data - Event payload
     */
    emitAsync<K extends keyof Events>(event: K, data: Events[K]): void {
        setImmediate(() => this.emit(event, data));
    }

    /**
     * Remove all listeners for an event, or all listeners if no event specified
     * @param event - Optional event name
     */
    removeAllListeners(event?: keyof Events): void {
        if (event !== undefined) {
            this.listeners.delete(event);
        } else {
            this.listeners.clear();
        }
    }

    /**
     * Get the number of listeners for an event
     * @param event - Event name
     */
    listenerCount(event: keyof Events): number {
        return this.listeners.get(event)?.length ?? 0;
    }

    /**
     * Get all event names that have listeners
     */
    eventNames(): (keyof Events)[] {
        return Array.from(this.listeners.keys());
    }

    /**
     * Wait for an event to be emitted
     * @param event - Event name
     * @param timeout - Optional timeout in milliseconds. If not provided, a warning is logged
     *                  as the promise may hang indefinitely if the event is never emitted.
     * @returns Promise that resolves with the event data
     */
    waitFor<K extends keyof Events>(event: K, timeout?: number): Promise<Events[K]> {
        // Warn if no timeout is provided - could hang forever
        if (timeout === undefined) {
            console.warn(
                `EventEmitter.waitFor('${String(event)}'): No timeout specified. ` +
                'Promise may hang indefinitely if event is never emitted.'
            );
        }

        return new Promise((resolve, reject) => {
            let timeoutId: ReturnType<typeof setTimeout> | undefined;

            const unsubscribe = this.once(event, (data) => {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                resolve(data);
            });

            if (timeout !== undefined && timeout > 0) {
                timeoutId = setTimeout(() => {
                    unsubscribe();
                    reject(new Error(`Timeout waiting for event '${String(event)}'`));
                }, timeout);
            }
        });
    }

    /**
     * Create a filtered view of this emitter that only sees specific events
     * @param events - Array of event names to include
     */
    filter<K extends keyof Events>(...events: K[]): Pick<EventEmitter<Pick<Events, K>>, 'on' | 'once' | 'off'> {
        const eventSet = new Set(events);

        return {
            on: <E extends K>(event: E, listener: EventListener<Events[E]>): Unsubscribe => {
                if (!eventSet.has(event)) {
                    throw new Error(`Event '${String(event)}' is not in the filtered set`);
                }
                return this.on(event, listener);
            },
            once: <E extends K>(event: E, listener: EventListener<Events[E]>): Unsubscribe => {
                if (!eventSet.has(event)) {
                    throw new Error(`Event '${String(event)}' is not in the filtered set`);
                }
                return this.once(event, listener);
            },
            off: <E extends K>(event: E, listener: EventListener<Events[E]>): void => {
                this.off(event, listener);
            }
        };
    }

    /**
     * Pipe all events to another emitter
     * @param target - Target emitter
     * @returns Unsubscribe function to stop piping
     */
    pipe(target: EventEmitter<Events>): Unsubscribe {
        const unsubscribes: Unsubscribe[] = [];

        for (const event of this.listeners.keys()) {
            const unsub = this.on(event, (data) => {
                target.emit(event, data);
            });
            unsubscribes.push(unsub);
        }

        return () => {
            for (const unsub of unsubscribes) {
                unsub();
            }
        };
    }

    private addListener<K extends keyof Events>(
        event: K,
        listener: EventListener<Events[K]>,
        once: boolean
    ): Unsubscribe {
        if (typeof listener !== 'function') {
            throw new TypeError('Listener must be a function');
        }

        let eventListeners = this.listeners.get(event);
        if (!eventListeners) {
            eventListeners = [];
            this.listeners.set(event, eventListeners);
        }

        // Warn if too many listeners (possible memory leak)
        if (eventListeners.length >= this.maxListeners) {
            console.warn(
                `EventEmitter: Possible memory leak. ` +
                `${eventListeners.length + 1} listeners for event '${String(event)}'`
            );
        }

        const wrapper: ListenerWrapper<Events[K]> = { listener, once };
        eventListeners.push(wrapper as ListenerWrapper<unknown>);

        return () => this.off(event, listener);
    }
}

/**
 * Create a simple one-time signal emitter
 * Useful for completion/cancellation signals
 */
export class Signal {
    private emitted = false;
    private listeners: Array<() => void> = [];

    /**
     * Check if the signal has been emitted
     */
    get isEmitted(): boolean {
        return this.emitted;
    }

    /**
     * Emit the signal (can only be called once)
     */
    emit(): void {
        if (this.emitted) {
            return;
        }

        this.emitted = true;

        for (const listener of this.listeners) {
            try {
                listener();
            } catch (error) {
                console.error('Error in signal listener:', error);
            }
        }

        // Clear listeners after emission
        this.listeners = [];
    }

    /**
     * Subscribe to the signal
     * @returns Unsubscribe function
     */
    subscribe(listener: () => void): Unsubscribe {
        if (this.emitted) {
            // Already emitted, call immediately
            listener();
            return () => { };
        }

        this.listeners.push(listener);

        return () => {
            const index = this.listeners.indexOf(listener);
            if (index !== -1) {
                this.listeners.splice(index, 1);
            }
        };
    }

    /**
     * Wait for the signal to be emitted
     */
    wait(): Promise<void> {
        if (this.emitted) {
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            this.subscribe(resolve);
        });
    }
}

/**
 * Create an abort signal that can be used for cancellation
 */
export class AbortSignal extends Signal {
    private reason?: Error;

    /**
     * Get the abort reason if aborted
     */
    get abortReason(): Error | undefined {
        return this.reason;
    }

    /**
     * Abort with an optional reason
     */
    abort(reason?: Error | string): void {
        if (this.isEmitted) {
            return;
        }

        this.reason = typeof reason === 'string'
            ? new Error(reason)
            : reason ?? new Error('Aborted');

        this.emit();
    }

    /**
     * Throw if aborted
     */
    throwIfAborted(): void {
        if (this.isEmitted) {
            throw this.reason ?? new Error('Aborted');
        }
    }
}
