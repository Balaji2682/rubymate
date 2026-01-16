/**
 * Utilities Module
 *
 * Common utility functions and classes for the RubyMate extension.
 */

// Debounce and Throttle
export {
    debounce,
    throttle,
    debounceAsync,
    Debouncer,
    Throttler,
    DebounceOptions,
    ThrottleOptions,
    DebouncedFunction,
    ThrottledFunction
} from './debounce';

// Result Type (Rust-style error handling)
export {
    Result,
    Ok,
    Err,
    ok,
    err,
    trySync,
    tryAsync,
    fromPromise,
    fromNullable,
    all,
    allSettled,
    any,
    partition,
    filterOk,
    filterErr,
    traverse,
    traverseAsync
} from './result';

// Event Emitter
export {
    EventEmitter,
    Signal,
    AbortSignal,
    EventMap,
    EventListener,
    Unsubscribe,
    TypedEventEmitter
} from './eventEmitter';

// Async Queue
export {
    AsyncQueue,
    RateLimitedQueue,
    BatchQueue,
    BatchItemResult,
    AsyncQueueOptions,
    EnqueueOptions,
    TaskCompleteEvent,
    TaskErrorEvent
} from './asyncQueue';
