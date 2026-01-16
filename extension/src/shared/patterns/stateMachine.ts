/**
 * State Machine Pattern
 *
 * Finite state machine implementation for managing parse states,
 * editor modes, and workflow management.
 */

/**
 * State transition definition
 */
export interface StateTransition<S extends string, E extends string> {
    from: S;
    to: S;
    event: E;
}

/**
 * State definition with optional entry/exit actions
 */
export interface StateDefinition<S extends string, E extends string> {
    /** Transitions from this state */
    on?: Partial<Record<E, S>>;
    /** Action to run when entering this state */
    entry?: () => void;
    /** Action to run when leaving this state */
    exit?: () => void;
}

/**
 * Configuration for a state machine
 */
export interface StateConfig<S extends string, E extends string> {
    /** Initial state */
    initial: S;
    /** State definitions */
    states: Record<S, StateDefinition<S, E>>;
}

/**
 * Transition callback type
 */
export type TransitionCallback<S extends string, E extends string> = (
    from: S,
    to: S,
    event: E
) => void;

/**
 * State callback type
 */
export type StateCallback = () => void;

/**
 * Finite State Machine implementation
 *
 * @typeParam S - Union type of all state names
 * @typeParam E - Union type of all event names
 *
 * @example
 * ```typescript
 * type ParserState = 'idle' | 'parsing' | 'error' | 'complete';
 * type ParserEvent = 'start' | 'progress' | 'error' | 'complete' | 'reset';
 *
 * const machine = new StateMachine<ParserState, ParserEvent>({
 *   initial: 'idle',
 *   states: {
 *     idle: { on: { start: 'parsing' } },
 *     parsing: { on: { complete: 'complete', error: 'error' } },
 *     error: { on: { reset: 'idle' } },
 *     complete: { on: { reset: 'idle' } }
 *   }
 * });
 *
 * machine.send('start'); // Transitions to 'parsing'
 * ```
 */
export class StateMachine<S extends string, E extends string> {
    private _currentState: S;
    private _previousState?: S;
    private readonly config: StateConfig<S, E>;
    private readonly history: S[] = [];
    private readonly maxHistorySize: number;

    // Callbacks
    private transitionCallbacks: Array<TransitionCallback<S, E>> = [];
    private enterCallbacks: Map<S, StateCallback[]> = new Map();
    private exitCallbacks: Map<S, StateCallback[]> = new Map();

    constructor(config: StateConfig<S, E>, maxHistorySize: number = 100) {
        this.config = config;
        this._currentState = config.initial;
        this.maxHistorySize = maxHistorySize;
        this.history.push(config.initial);

        // Run initial state entry action
        const initialState = config.states[config.initial];
        if (initialState?.entry) {
            initialState.entry();
        }
    }

    /**
     * Get the current state
     */
    get currentState(): S {
        return this._currentState;
    }

    /**
     * Get the previous state (before the last transition)
     */
    get previousState(): S | undefined {
        return this._previousState;
    }

    /**
     * Send an event to trigger a transition
     * @returns The new state after the transition
     */
    send(event: E): S {
        const currentStateDef = this.config.states[this._currentState];
        const nextState = currentStateDef?.on?.[event];

        if (nextState === undefined) {
            // No transition defined for this event in current state
            return this._currentState;
        }

        // Execute transition
        this.transition(this._currentState, nextState, event);

        return this._currentState;
    }

    /**
     * Check if a transition is possible for the given event
     */
    can(event: E): boolean {
        const currentStateDef = this.config.states[this._currentState];
        return currentStateDef?.on?.[event] !== undefined;
    }

    /**
     * Get all possible events from the current state
     */
    getAvailableEvents(): E[] {
        const currentStateDef = this.config.states[this._currentState];
        if (!currentStateDef?.on) {
            return [];
        }
        return Object.keys(currentStateDef.on) as E[];
    }

    /**
     * Get all possible next states from the current state
     */
    getAvailableStates(): S[] {
        const currentStateDef = this.config.states[this._currentState];
        if (!currentStateDef?.on) {
            return [];
        }
        return Object.values(currentStateDef.on) as S[];
    }

    /**
     * Check if the machine is in a specific state
     */
    isIn(state: S): boolean {
        return this._currentState === state;
    }

    /**
     * Check if the machine is in any of the given states
     */
    isInAny(...states: S[]): boolean {
        return states.includes(this._currentState);
    }

    /**
     * Get the transition history
     */
    getHistory(): S[] {
        return [...this.history];
    }

    /**
     * Reset to the initial state
     */
    reset(): void {
        const oldState = this._currentState;
        const oldStateDef = this.config.states[oldState];

        // Exit current state
        if (oldStateDef?.exit) {
            oldStateDef.exit();
        }
        this.runExitCallbacks(oldState);

        // Reset to initial
        this._previousState = oldState;
        this._currentState = this.config.initial;
        this.history.length = 0;
        this.history.push(this.config.initial);

        // Enter initial state
        const initialStateDef = this.config.states[this.config.initial];
        if (initialStateDef?.entry) {
            initialStateDef.entry();
        }
        this.runEnterCallbacks(this.config.initial);
    }

    /**
     * Register a callback for any transition
     * @returns Unsubscribe function
     */
    onTransition(callback: TransitionCallback<S, E>): () => void {
        this.transitionCallbacks.push(callback);
        return () => {
            const index = this.transitionCallbacks.indexOf(callback);
            if (index !== -1) {
                this.transitionCallbacks.splice(index, 1);
            }
        };
    }

    /**
     * Register a callback for entering a specific state
     * @returns Unsubscribe function
     */
    onEnter(state: S, callback: StateCallback): () => void {
        let callbacks = this.enterCallbacks.get(state);
        if (!callbacks) {
            callbacks = [];
            this.enterCallbacks.set(state, callbacks);
        }
        callbacks.push(callback);

        return () => {
            const cbs = this.enterCallbacks.get(state);
            if (cbs) {
                const index = cbs.indexOf(callback);
                if (index !== -1) {
                    cbs.splice(index, 1);
                }
            }
        };
    }

    /**
     * Register a callback for exiting a specific state
     * @returns Unsubscribe function
     */
    onExit(state: S, callback: StateCallback): () => void {
        let callbacks = this.exitCallbacks.get(state);
        if (!callbacks) {
            callbacks = [];
            this.exitCallbacks.set(state, callbacks);
        }
        callbacks.push(callback);

        return () => {
            const cbs = this.exitCallbacks.get(state);
            if (cbs) {
                const index = cbs.indexOf(callback);
                if (index !== -1) {
                    cbs.splice(index, 1);
                }
            }
        };
    }

    /**
     * Get a visualization of the state machine in DOT format
     */
    toDot(): string {
        const lines: string[] = ['digraph StateMachine {'];
        lines.push('  rankdir=LR;');
        lines.push('  node [shape=circle];');

        // Mark initial state
        lines.push(`  ${this.config.initial} [style=bold];`);

        // Add transitions
        for (const [state, definition] of Object.entries(this.config.states)) {
            const def = definition as StateDefinition<S, E>;
            if (def.on) {
                for (const [event, nextState] of Object.entries(def.on)) {
                    lines.push(`  ${state} -> ${nextState} [label="${event}"];`);
                }
            }
        }

        lines.push('}');
        return lines.join('\n');
    }

    // Private methods

    private transition(from: S, to: S, event: E): void {
        const fromStateDef = this.config.states[from];
        const toStateDef = this.config.states[to];

        // Exit old state
        if (fromStateDef?.exit) {
            fromStateDef.exit();
        }
        this.runExitCallbacks(from);

        // Update state
        this._previousState = from;
        this._currentState = to;

        // Add to history
        this.history.push(to);
        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
        }

        // Enter new state
        if (toStateDef?.entry) {
            toStateDef.entry();
        }
        this.runEnterCallbacks(to);

        // Notify transition callbacks
        for (const callback of this.transitionCallbacks) {
            try {
                callback(from, to, event);
            } catch (error) {
                console.error('Error in transition callback:', error);
            }
        }
    }

    private runEnterCallbacks(state: S): void {
        const callbacks = this.enterCallbacks.get(state);
        if (callbacks) {
            for (const callback of callbacks) {
                try {
                    callback();
                } catch (error) {
                    console.error(`Error in onEnter callback for state ${state}:`, error);
                }
            }
        }
    }

    private runExitCallbacks(state: S): void {
        const callbacks = this.exitCallbacks.get(state);
        if (callbacks) {
            for (const callback of callbacks) {
                try {
                    callback();
                } catch (error) {
                    console.error(`Error in onExit callback for state ${state}:`, error);
                }
            }
        }
    }
}

// Pre-defined state machine types for common use cases

/**
 * Parser state machine states
 */
export type ParserState = 'idle' | 'parsing' | 'error' | 'complete';

/**
 * Parser state machine events
 */
export type ParserEvent = 'start' | 'progress' | 'error' | 'complete' | 'reset';

/**
 * Create a parser state machine
 */
export function createParserStateMachine(): StateMachine<ParserState, ParserEvent> {
    return new StateMachine<ParserState, ParserEvent>({
        initial: 'idle',
        states: {
            idle: {
                on: { start: 'parsing' }
            },
            parsing: {
                on: {
                    complete: 'complete',
                    error: 'error'
                }
            },
            error: {
                on: { reset: 'idle' }
            },
            complete: {
                on: { reset: 'idle' }
            }
        }
    });
}

/**
 * Indexer state machine states
 */
export type IndexerState = 'idle' | 'indexing' | 'updating' | 'error' | 'ready';

/**
 * Indexer state machine events
 */
export type IndexerEvent = 'start' | 'update' | 'complete' | 'error' | 'reset';

/**
 * Create an indexer state machine
 */
export function createIndexerStateMachine(): StateMachine<IndexerState, IndexerEvent> {
    return new StateMachine<IndexerState, IndexerEvent>({
        initial: 'idle',
        states: {
            idle: {
                on: { start: 'indexing' }
            },
            indexing: {
                on: {
                    complete: 'ready',
                    error: 'error'
                }
            },
            updating: {
                on: {
                    complete: 'ready',
                    error: 'error'
                }
            },
            ready: {
                on: {
                    update: 'updating',
                    reset: 'idle'
                }
            },
            error: {
                on: { reset: 'idle' }
            }
        }
    });
}

/**
 * Connection state machine states
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

/**
 * Connection state machine events
 */
export type ConnectionEvent = 'connect' | 'connected' | 'disconnect' | 'error' | 'retry';

/**
 * Create a connection state machine (e.g., for LSP client)
 */
export function createConnectionStateMachine(): StateMachine<ConnectionState, ConnectionEvent> {
    return new StateMachine<ConnectionState, ConnectionEvent>({
        initial: 'disconnected',
        states: {
            disconnected: {
                on: { connect: 'connecting' }
            },
            connecting: {
                on: {
                    connected: 'connected',
                    error: 'error'
                }
            },
            connected: {
                on: {
                    disconnect: 'disconnected',
                    error: 'reconnecting'
                }
            },
            reconnecting: {
                on: {
                    connected: 'connected',
                    error: 'error',
                    disconnect: 'disconnected'
                }
            },
            error: {
                on: {
                    retry: 'connecting',
                    disconnect: 'disconnected'
                }
            }
        }
    });
}
