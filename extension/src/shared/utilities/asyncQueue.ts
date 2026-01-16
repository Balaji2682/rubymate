/**
 * Async Queue for Background Task Processing
 *
 * A queue for processing async tasks with concurrency control,
 * retries, timeouts, and priority support.
 */

/**
 * Options for configuring the async queue
 */
export interface AsyncQueueOptions {
    /** Maximum number of concurrent tasks. Default: 1 */
    concurrency?: number;

    /** Per-task timeout in milliseconds. Default: undefined (no timeout) */
    timeout?: number;

    /** Number of retry attempts on failure. Default: 0 */
    retries?: number;

    /** Delay between retries in milliseconds. Default: 1000 */
    retryDelay?: number;

    /** Whether to process tasks automatically. Default: true */
    autoStart?: boolean;
}

/**
 * Options for enqueueing a task
 */
export interface EnqueueOptions {
    /** Unique identifier for the task */
    id?: string;

    /** Priority (higher = processed first). Default: 0 */
    priority?: number;

    /** Override default timeout for this task */
    timeout?: number;

    /** Override default retries for this task */
    retries?: number;
}

/**
 * Internal task representation
 */
interface QueuedTask<T> {
    id: string;
    fn: () => Promise<T>;
    priority: number;
    timeout?: number;
    retries: number;
    retriesRemaining: number;
    resolve: (value: T) => void;
    reject: (error: Error) => void;
    addedAt: number;
}

/**
 * Task completion event data
 */
export interface TaskCompleteEvent<T> {
    taskId: string;
    result: T;
    duration: number;
}

/**
 * Task error event data
 */
export interface TaskErrorEvent {
    taskId: string;
    error: Error;
    willRetry: boolean;
    retriesRemaining: number;
}

/**
 * Async Queue for background task processing with concurrency control
 *
 * @typeParam T - Return type of tasks in the queue
 *
 * @example
 * ```typescript
 * const queue = new AsyncQueue<void>({ concurrency: 3 });
 *
 * // Add tasks
 * queue.enqueue(async () => {
 *   await processFile('file1.rb');
 * }, { id: 'file1', priority: 1 });
 *
 * // Wait for all tasks
 * await queue.drain();
 * ```
 */
export class AsyncQueue<T = void> {
    private queue: QueuedTask<T>[] = [];
    private running: Map<string, QueuedTask<T>> = new Map();
    private paused: boolean = false;
    private drainPromise?: { resolve: () => void; reject: (err: Error) => void };
    private taskIdCounter: number = 0;

    private readonly concurrency: number;
    private readonly defaultTimeout?: number;
    private readonly defaultRetries: number;
    private readonly retryDelay: number;
    private readonly autoStart: boolean;

    // Event callbacks
    private onCompleteCallbacks: Array<(event: TaskCompleteEvent<T>) => void> = [];
    private onErrorCallbacks: Array<(event: TaskErrorEvent) => void> = [];
    private onDrainCallbacks: Array<() => void> = [];

    constructor(options: AsyncQueueOptions = {}) {
        this.concurrency = Math.max(1, options.concurrency ?? 1);
        this.defaultTimeout = options.timeout;
        this.defaultRetries = Math.max(0, options.retries ?? 0);
        this.retryDelay = Math.max(0, options.retryDelay ?? 1000);
        this.autoStart = options.autoStart ?? true;
    }

    /**
     * Add a task to the queue
     * @param fn - Async function to execute
     * @param options - Task options
     * @returns Promise that resolves when the task completes
     */
    enqueue(fn: () => Promise<T>, options: EnqueueOptions = {}): Promise<T> {
        return new Promise((resolve, reject) => {
            const id = options.id ?? `task-${++this.taskIdCounter}`;
            const retries = options.retries ?? this.defaultRetries;

            const task: QueuedTask<T> = {
                id,
                fn,
                priority: options.priority ?? 0,
                timeout: options.timeout ?? this.defaultTimeout,
                retries,
                retriesRemaining: retries,
                resolve,
                reject,
                addedAt: Date.now()
            };

            // Insert in priority order (higher priority first)
            const insertIndex = this.queue.findIndex(t => t.priority < task.priority);
            if (insertIndex === -1) {
                this.queue.push(task);
            } else {
                this.queue.splice(insertIndex, 0, task);
            }

            if (this.autoStart && !this.paused) {
                this.processNext();
            }
        });
    }

    /**
     * Add multiple tasks and wait for all to complete
     * @param tasks - Array of async functions
     * @returns Promise that resolves with all results
     */
    enqueueAll(tasks: Array<() => Promise<T>>): Promise<T[]> {
        return Promise.all(tasks.map(fn => this.enqueue(fn)));
    }

    /**
     * Pause processing (tasks in progress will complete)
     */
    pause(): void {
        this.paused = true;
    }

    /**
     * Resume processing
     */
    resume(): void {
        this.paused = false;
        this.processNext();
    }

    /**
     * Clear all pending tasks (tasks in progress will complete)
     * Pending tasks will be rejected with a cancellation error
     */
    clear(): void {
        for (const task of this.queue) {
            task.reject(new Error('Task cancelled: queue cleared'));
        }
        this.queue = [];
    }

    /**
     * Get the number of pending tasks
     */
    get pending(): number {
        return this.queue.length;
    }

    /**
     * Get the number of currently running tasks
     */
    get runningCount(): number {
        return this.running.size;
    }

    /**
     * Check if the queue is paused
     */
    get isPaused(): boolean {
        return this.paused;
    }

    /**
     * Check if the queue is empty and no tasks are running
     */
    get isEmpty(): boolean {
        return this.queue.length === 0 && this.running.size === 0;
    }

    /**
     * Get the total number of tasks (pending + running)
     */
    get size(): number {
        return this.queue.length + this.running.size;
    }

    /**
     * Register a callback for task completion
     * @param callback - Function to call when a task completes
     * @returns Unsubscribe function
     */
    onTaskComplete(callback: (event: TaskCompleteEvent<T>) => void): () => void {
        this.onCompleteCallbacks.push(callback);
        return () => {
            const index = this.onCompleteCallbacks.indexOf(callback);
            if (index !== -1) {
                this.onCompleteCallbacks.splice(index, 1);
            }
        };
    }

    /**
     * Register a callback for task errors
     * @param callback - Function to call when a task fails
     * @returns Unsubscribe function
     */
    onTaskError(callback: (event: TaskErrorEvent) => void): () => void {
        this.onErrorCallbacks.push(callback);
        return () => {
            const index = this.onErrorCallbacks.indexOf(callback);
            if (index !== -1) {
                this.onErrorCallbacks.splice(index, 1);
            }
        };
    }

    /**
     * Register a callback for when the queue becomes empty
     * @param callback - Function to call when queue drains
     * @returns Unsubscribe function
     */
    onDrain(callback: () => void): () => void {
        this.onDrainCallbacks.push(callback);
        return () => {
            const index = this.onDrainCallbacks.indexOf(callback);
            if (index !== -1) {
                this.onDrainCallbacks.splice(index, 1);
            }
        };
    }

    /**
     * Wait for all tasks to complete
     * @returns Promise that resolves when the queue is empty
     */
    drain(): Promise<void> {
        if (this.isEmpty) {
            return Promise.resolve();
        }

        if (this.drainPromise) {
            return new Promise((resolve, reject) => {
                const existingResolve = this.drainPromise!.resolve;
                const existingReject = this.drainPromise!.reject;

                this.drainPromise = {
                    resolve: () => {
                        existingResolve();
                        resolve();
                    },
                    reject: (err) => {
                        existingReject(err);
                        reject(err);
                    }
                };
            });
        }

        return new Promise((resolve, reject) => {
            this.drainPromise = { resolve, reject };
        });
    }

    /**
     * Get IDs of all pending tasks
     */
    getPendingIds(): string[] {
        return this.queue.map(t => t.id);
    }

    /**
     * Get IDs of all running tasks
     */
    getRunningIds(): string[] {
        return Array.from(this.running.keys());
    }

    /**
     * Check if a specific task is in the queue or running
     */
    hasTask(id: string): boolean {
        return this.queue.some(t => t.id === id) || this.running.has(id);
    }

    /**
     * Cancel a specific pending task by ID
     * @returns true if the task was found and cancelled
     */
    cancelTask(id: string): boolean {
        const index = this.queue.findIndex(t => t.id === id);
        if (index === -1) {
            return false;
        }

        const task = this.queue[index];
        this.queue.splice(index, 1);
        task.reject(new Error(`Task cancelled: ${id}`));
        return true;
    }

    private async processNext(): Promise<void> {
        if (this.paused || this.running.size >= this.concurrency || this.queue.length === 0) {
            return;
        }

        const task = this.queue.shift()!;
        this.running.set(task.id, task);

        try {
            const startTime = Date.now();
            const result = await this.executeWithTimeout(task);
            const duration = Date.now() - startTime;

            this.running.delete(task.id);
            task.resolve(result);

            // Notify completion callbacks
            for (const callback of this.onCompleteCallbacks) {
                try {
                    callback({ taskId: task.id, result, duration });
                } catch (err) {
                    console.error('Error in onTaskComplete callback:', err);
                }
            }
        } catch (error) {
            this.running.delete(task.id);
            const err = error instanceof Error ? error : new Error(String(error));

            if (task.retriesRemaining > 0) {
                // Retry the task
                task.retriesRemaining--;

                // Notify error callbacks with retry info
                for (const callback of this.onErrorCallbacks) {
                    try {
                        callback({
                            taskId: task.id,
                            error: err,
                            willRetry: true,
                            retriesRemaining: task.retriesRemaining
                        });
                    } catch (e) {
                        console.error('Error in onTaskError callback:', e);
                    }
                }

                // Schedule retry
                setTimeout(() => {
                    // Re-add to queue with same priority
                    const insertIndex = this.queue.findIndex(t => t.priority < task.priority);
                    if (insertIndex === -1) {
                        this.queue.push(task);
                    } else {
                        this.queue.splice(insertIndex, 0, task);
                    }

                    if (!this.paused) {
                        this.processNext();
                    }
                }, this.retryDelay);
            } else {
                // No more retries, reject
                task.reject(err);

                // Notify error callbacks
                for (const callback of this.onErrorCallbacks) {
                    try {
                        callback({
                            taskId: task.id,
                            error: err,
                            willRetry: false,
                            retriesRemaining: 0
                        });
                    } catch (e) {
                        console.error('Error in onTaskError callback:', e);
                    }
                }
            }
        }

        // Check if queue is now empty
        if (this.isEmpty) {
            // Notify drain callbacks
            for (const callback of this.onDrainCallbacks) {
                try {
                    callback();
                } catch (err) {
                    console.error('Error in onDrain callback:', err);
                }
            }

            if (this.drainPromise) {
                this.drainPromise.resolve();
                this.drainPromise = undefined;
            }
        }

        // Process next task
        this.processNext();
    }

    private executeWithTimeout(task: QueuedTask<T>): Promise<T> {
        if (!task.timeout) {
            return task.fn();
        }

        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error(`Task timed out after ${task.timeout}ms: ${task.id}`));
            }, task.timeout);

            task.fn()
                .then((result) => {
                    clearTimeout(timeoutId);
                    resolve(result);
                })
                .catch((error) => {
                    clearTimeout(timeoutId);
                    reject(error);
                });
        });
    }
}

/**
 * Create a simple rate-limited queue
 * Processes one task at a time with a minimum delay between tasks
 */
export class RateLimitedQueue<T = void> extends AsyncQueue<T> {
    private lastTaskTime: number = 0;
    private readonly minDelay: number;

    constructor(options: AsyncQueueOptions & { minDelay?: number } = {}) {
        super({ ...options, concurrency: 1 });
        this.minDelay = options.minDelay ?? 0;
    }

    /**
     * Override enqueue to add rate limiting
     */
    enqueue(fn: () => Promise<T>, options: EnqueueOptions = {}): Promise<T> {
        const wrappedFn = async (): Promise<T> => {
            const now = Date.now();
            const timeSinceLastTask = now - this.lastTaskTime;

            if (timeSinceLastTask < this.minDelay) {
                await this.delay(this.minDelay - timeSinceLastTask);
            }

            this.lastTaskTime = Date.now();
            return fn();
        };

        return super.enqueue(wrappedFn, options);
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

/**
 * Result type for individual batch item processing
 */
export type BatchItemResult<TOutput> =
    | { success: true; value: TOutput }
    | { success: false; error: Error };

/**
 * Create a batch processing queue
 * Collects tasks and processes them in batches
 */
export class BatchQueue<TInput, TOutput> {
    private batch: Array<{
        input: TInput;
        resolve: (value: TOutput) => void;
        reject: (error: Error) => void;
    }> = [];
    private timeoutId?: ReturnType<typeof setTimeout>;

    private readonly batchSize: number;
    private readonly maxWait: number;
    private readonly processor: (inputs: TInput[]) => Promise<TOutput[]>;
    private readonly itemProcessor?: (input: TInput) => Promise<TOutput>;

    constructor(options: {
        /** Maximum batch size before processing */
        batchSize: number;
        /** Maximum time to wait before processing a partial batch */
        maxWait: number;
        /**
         * Function to process a batch of inputs.
         * Must return an array with the same length as inputs.
         */
        processor?: (inputs: TInput[]) => Promise<TOutput[]>;
        /**
         * Alternative: Function to process individual items.
         * If provided, items are processed individually with individual error handling.
         */
        itemProcessor?: (input: TInput) => Promise<TOutput>;
    }) {
        this.batchSize = options.batchSize;
        this.maxWait = options.maxWait;
        this.processor = options.processor ?? (async (inputs) => {
            if (!this.itemProcessor) {
                throw new Error('Either processor or itemProcessor must be provided');
            }
            // Process items individually and collect results
            const results: TOutput[] = [];
            for (const input of inputs) {
                results.push(await this.itemProcessor(input));
            }
            return results;
        });
        this.itemProcessor = options.itemProcessor;
    }

    /**
     * Add an item to be processed
     */
    add(input: TInput): Promise<TOutput> {
        return new Promise((resolve, reject) => {
            this.batch.push({ input, resolve, reject });

            if (this.batch.length >= this.batchSize) {
                this.flush();
            } else if (!this.timeoutId) {
                this.timeoutId = setTimeout(() => this.flush(), this.maxWait);
            }
        });
    }

    /**
     * Process the current batch immediately
     */
    async flush(): Promise<void> {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = undefined;
        }

        if (this.batch.length === 0) {
            return;
        }

        const currentBatch = this.batch;
        this.batch = [];

        // If itemProcessor is provided, process each item individually with error isolation
        if (this.itemProcessor) {
            await this.processIndividually(currentBatch);
            return;
        }

        // Otherwise use batch processor
        try {
            const inputs = currentBatch.map(item => item.input);
            const outputs = await this.processor(inputs);

            if (outputs.length !== currentBatch.length) {
                throw new Error('Processor returned wrong number of results');
            }

            for (let i = 0; i < currentBatch.length; i++) {
                currentBatch[i].resolve(outputs[i]);
            }
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            for (const item of currentBatch) {
                item.reject(err);
            }
        }
    }

    /**
     * Process items individually with error isolation
     */
    private async processIndividually(
        batch: Array<{
            input: TInput;
            resolve: (value: TOutput) => void;
            reject: (error: Error) => void;
        }>
    ): Promise<void> {
        const promises = batch.map(async (item) => {
            try {
                const result = await this.itemProcessor!(item.input);
                item.resolve(result);
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                item.reject(err);
            }
        });

        await Promise.all(promises);
    }

    /**
     * Get the current batch size
     */
    get pendingCount(): number {
        return this.batch.length;
    }

    /**
     * Cancel all pending items
     */
    cancel(): void {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = undefined;
        }

        const error = new Error('Batch cancelled');
        for (const item of this.batch) {
            item.reject(error);
        }
        this.batch = [];
    }
}
