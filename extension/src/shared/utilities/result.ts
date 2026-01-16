/**
 * Result Type for Error Handling
 *
 * Rust-inspired Result type for explicit error handling without exceptions.
 * Makes error handling explicit and composable.
 */

/**
 * Result type - either Ok with a value or Err with an error
 */
export type Result<T, E = Error> = Ok<T, E> | Err<T, E>;

/**
 * Represents a successful result containing a value
 */
export class Ok<T, E = never> {
    readonly ok: true = true;
    readonly value: T;

    constructor(value: T) {
        this.value = value;
    }

    /**
     * Type guard for Ok
     */
    isOk(): this is Ok<T, E> {
        return true;
    }

    /**
     * Type guard for Err
     */
    isErr(): this is Err<T, E> {
        return false;
    }

    /**
     * Transform the value if Ok
     */
    map<U>(fn: (value: T) => U): Result<U, E> {
        return new Ok(fn(this.value));
    }

    /**
     * Transform the error if Err (no-op for Ok)
     */
    mapErr<F>(_fn: (error: E) => F): Result<T, F> {
        return new Ok(this.value);
    }

    /**
     * Chain another Result-returning operation
     */
    andThen<U>(fn: (value: T) => Result<U, E>): Result<U, E> {
        return fn(this.value);
    }

    /**
     * Provide alternative Result if Err (no-op for Ok)
     */
    orElse<F>(_fn: (error: E) => Result<T, F>): Result<T, F> {
        return new Ok(this.value);
    }

    /**
     * Get the value or throw if Err
     */
    unwrap(): T {
        return this.value;
    }

    /**
     * Get the value or return default if Err
     */
    unwrapOr(_defaultValue: T): T {
        return this.value;
    }

    /**
     * Get the value or compute default if Err
     */
    unwrapOrElse(_fn: (error: E) => T): T {
        return this.value;
    }

    /**
     * Get the value or throw with custom message if Err
     */
    expect(_message: string): T {
        return this.value;
    }

    /**
     * Get the error or throw if Ok
     */
    unwrapErr(): never {
        throw new Error('Called unwrapErr on Ok value');
    }

    /**
     * Match pattern - execute appropriate function based on Result type
     */
    match<U>(handlers: { ok: (value: T) => U; err: (error: E) => U }): U {
        return handlers.ok(this.value);
    }

    /**
     * Convert to optional value (undefined if Err)
     */
    toOptional(): T | undefined {
        return this.value;
    }

    /**
     * Convert to nullable value (null if Err)
     */
    toNullable(): T | null {
        return this.value;
    }
}

/**
 * Represents a failed result containing an error
 */
export class Err<T, E = Error> {
    readonly ok: false = false;
    readonly error: E;

    constructor(error: E) {
        this.error = error;
    }

    /**
     * Type guard for Ok
     */
    isOk(): this is Ok<T, E> {
        return false;
    }

    /**
     * Type guard for Err
     */
    isErr(): this is Err<T, E> {
        return true;
    }

    /**
     * Transform the value if Ok (no-op for Err)
     */
    map<U>(_fn: (value: T) => U): Result<U, E> {
        return new Err(this.error);
    }

    /**
     * Transform the error if Err
     */
    mapErr<F>(fn: (error: E) => F): Result<T, F> {
        return new Err(fn(this.error));
    }

    /**
     * Chain another Result-returning operation (no-op for Err)
     */
    andThen<U>(_fn: (value: T) => Result<U, E>): Result<U, E> {
        return new Err(this.error);
    }

    /**
     * Provide alternative Result if Err
     */
    orElse<F>(fn: (error: E) => Result<T, F>): Result<T, F> {
        return fn(this.error);
    }

    /**
     * Get the value or throw if Err
     */
    unwrap(): never {
        if (this.error instanceof Error) {
            throw this.error;
        }
        throw new Error(String(this.error));
    }

    /**
     * Get the value or return default if Err
     */
    unwrapOr(defaultValue: T): T {
        return defaultValue;
    }

    /**
     * Get the value or compute default if Err
     */
    unwrapOrElse(fn: (error: E) => T): T {
        return fn(this.error);
    }

    /**
     * Get the value or throw with custom message if Err
     */
    expect(message: string): never {
        throw new Error(`${message}: ${this.error}`);
    }

    /**
     * Get the error or throw if Ok
     */
    unwrapErr(): E {
        return this.error;
    }

    /**
     * Match pattern - execute appropriate function based on Result type
     */
    match<U>(handlers: { ok: (value: T) => U; err: (error: E) => U }): U {
        return handlers.err(this.error);
    }

    /**
     * Convert to optional value (undefined if Err)
     */
    toOptional(): T | undefined {
        return undefined;
    }

    /**
     * Convert to nullable value (null if Err)
     */
    toNullable(): T | null {
        return null;
    }
}

// ==================== Factory Functions ====================

/**
 * Create a successful Result
 */
export function ok<T>(value: T): Ok<T, never> {
    return new Ok(value);
}

/**
 * Create a failed Result
 */
export function err<E>(error: E): Err<never, E> {
    return new Err(error);
}

// ==================== Utility Functions ====================

/**
 * Wrap a synchronous function that might throw into a Result
 *
 * @example
 * ```typescript
 * const result = trySync(() => JSON.parse('invalid'));
 * if (result.isErr()) {
 *   console.log('Parse error:', result.error);
 * }
 * ```
 */
export function trySync<T>(fn: () => T): Result<T, Error> {
    try {
        return ok(fn());
    } catch (e) {
        return err(e instanceof Error ? e : new Error(String(e)));
    }
}

/**
 * Wrap an async function that might throw into a Result
 *
 * @example
 * ```typescript
 * const result = await tryAsync(() => fetch('/api/data').then(r => r.json()));
 * if (result.isOk()) {
 *   console.log('Data:', result.value);
 * }
 * ```
 */
export async function tryAsync<T>(fn: () => Promise<T>): Promise<Result<T, Error>> {
    try {
        return ok(await fn());
    } catch (e) {
        return err(e instanceof Error ? e : new Error(String(e)));
    }
}

/**
 * Wrap a Promise into a Result
 */
export async function fromPromise<T>(promise: Promise<T>): Promise<Result<T, Error>> {
    try {
        return ok(await promise);
    } catch (e) {
        return err(e instanceof Error ? e : new Error(String(e)));
    }
}

/**
 * Combine multiple Results into a single Result containing an array
 * Returns Err if any Result is Err (returns first error)
 *
 * @example
 * ```typescript
 * const results = [ok(1), ok(2), ok(3)];
 * const combined = all(results); // Ok([1, 2, 3])
 * ```
 */
export function all<T, E>(results: Result<T, E>[]): Result<T[], E> {
    const values: T[] = [];

    for (const result of results) {
        if (result.isErr()) {
            return new Err(result.error);
        }
        values.push(result.value);
    }

    return ok(values);
}

/**
 * Combine multiple Results, collecting all errors
 * Returns Ok if all Results are Ok, otherwise returns all errors
 */
export function allSettled<T, E>(results: Result<T, E>[]): Result<T[], E[]> {
    const values: T[] = [];
    const errors: E[] = [];

    for (const result of results) {
        if (result.isErr()) {
            errors.push(result.error);
        } else {
            values.push(result.value);
        }
    }

    if (errors.length > 0) {
        return new Err(errors);
    }

    return ok(values);
}

/**
 * Return the first Ok Result, or all errors if all fail
 */
export function any<T, E>(results: Result<T, E>[]): Result<T, E[]> {
    const errors: E[] = [];

    for (const result of results) {
        if (result.isOk()) {
            return ok(result.value);
        }
        errors.push(result.error);
    }

    return new Err(errors);
}

/**
 * Convert a nullable value to a Result
 */
export function fromNullable<T>(value: T | null | undefined, error?: Error): Result<T, Error> {
    if (value === null || value === undefined) {
        return err(error ?? new Error('Value is null or undefined'));
    }
    return ok(value);
}

/**
 * Partition an array of Results into Ok and Err arrays
 */
export function partition<T, E>(results: Result<T, E>[]): { ok: T[]; err: E[] } {
    const okValues: T[] = [];
    const errValues: E[] = [];

    for (const result of results) {
        if (result.isOk()) {
            okValues.push(result.value);
        } else {
            errValues.push(result.error);
        }
    }

    return { ok: okValues, err: errValues };
}

/**
 * Filter an array keeping only Ok values
 */
export function filterOk<T, E>(results: Result<T, E>[]): T[] {
    return results.filter((r): r is Ok<T, E> => r.isOk()).map(r => r.value);
}

/**
 * Filter an array keeping only Err values
 */
export function filterErr<T, E>(results: Result<T, E>[]): E[] {
    return results.filter((r): r is Err<T, E> => r.isErr()).map(r => r.error);
}

/**
 * Map over an array with a function that returns Results
 * Short-circuits on first error
 */
export function traverse<T, U, E>(
    items: T[],
    fn: (item: T, index: number) => Result<U, E>
): Result<U[], E> {
    const results: U[] = [];

    for (let i = 0; i < items.length; i++) {
        const result = fn(items[i], i);
        if (result.isErr()) {
            return new Err(result.error);
        }
        results.push(result.value);
    }

    return ok(results);
}

/**
 * Async version of traverse
 */
export async function traverseAsync<T, U, E>(
    items: T[],
    fn: (item: T, index: number) => Promise<Result<U, E>>
): Promise<Result<U[], E>> {
    const results: U[] = [];

    for (let i = 0; i < items.length; i++) {
        const result = await fn(items[i], i);
        if (result.isErr()) {
            return new Err(result.error);
        }
        results.push(result.value);
    }

    return ok(results);
}
