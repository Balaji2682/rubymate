/**
 * Call Graph Index
 *
 * Track method callers and callees for "Find References",
 * "Call Hierarchy", and code analysis.
 */

/**
 * Source location for a call
 */
export interface CallLocation {
    uri: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
}

/**
 * Method reference (caller or callee)
 */
export interface MethodReference {
    /** Method name */
    name: string;
    /** Container class/module name (if known) */
    containerName?: string;
    /** Location in source */
    location: CallLocation;
}

/**
 * A method call from one method to another
 */
export interface MethodCall {
    /** The calling method */
    caller: MethodReference;
    /** The called method */
    callee: {
        name: string;
        /** Receiver expression (e.g., "user" in user.save, "self" in self.class) */
        receiver?: string;
        /** Inferred receiver type (if known) */
        receiverType?: string;
    };
    /** Location of the call */
    callLocation: CallLocation;
    /** Call arguments (simplified) */
    arguments?: string[];
    /** Whether this is a block call (e.g., each { }) */
    hasBlock?: boolean;
}

/**
 * Method definition with call information
 */
export interface MethodDefinition {
    name: string;
    containerName?: string;
    location: CallLocation;
    /** Methods called by this method */
    callees: MethodCall[];
    /** Methods that call this method */
    callers: MethodCall[];
    /** Visibility (public, private, protected) */
    visibility?: 'public' | 'private' | 'protected';
    /** Whether this is a class method (def self.foo) */
    isClassMethod?: boolean;
}

/**
 * Call hierarchy item for VS Code compatibility
 */
export interface CallHierarchyItem {
    name: string;
    kind: string;
    uri: string;
    range: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
    };
    selectionRange: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
    };
    containerName?: string;
}

/**
 * Incoming call for call hierarchy
 */
export interface CallHierarchyIncomingCall {
    from: CallHierarchyItem;
    fromRanges: Array<{
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
    }>;
}

/**
 * Outgoing call for call hierarchy
 */
export interface CallHierarchyOutgoingCall {
    to: CallHierarchyItem;
    fromRanges: Array<{
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
    }>;
}

/**
 * Statistics about the call graph
 */
export interface CallGraphStats {
    methodCount: number;
    callCount: number;
    avgCallsPerMethod: number;
    maxCallsInMethod: number;
    unusedMethods: string[];
    hotspots: Array<{ method: string; callCount: number }>;
}

/**
 * Call Graph Index for tracking method calls
 *
 * @example
 * ```typescript
 * const index = new CallGraphIndex();
 *
 * // Add method definitions
 * index.addMethod({
 *   name: 'authenticate',
 *   containerName: 'User',
 *   location: { uri: '/app/models/user.rb', ... }
 * });
 *
 * // Add calls
 * index.addCall({
 *   caller: { name: 'login', containerName: 'SessionsController', location: ... },
 *   callee: { name: 'authenticate', receiver: 'user', receiverType: 'User' },
 *   callLocation: { ... }
 * });
 *
 * // Query
 * const callers = index.getCallers('authenticate', 'User');
 * const callees = index.getCallees('login', 'SessionsController');
 * ```
 */
export class CallGraphIndex {
    private methods: Map<string, MethodDefinition> = new Map();
    private callsByCallee: Map<string, MethodCall[]> = new Map();
    private callsByCaller: Map<string, MethodCall[]> = new Map();
    private fileMethods: Map<string, Set<string>> = new Map();
    private fileCalls: Map<string, MethodCall[]> = new Map();

    /**
     * Add a method definition
     */
    addMethod(
        name: string,
        containerName: string | undefined,
        location: CallLocation,
        options: {
            visibility?: 'public' | 'private' | 'protected';
            isClassMethod?: boolean;
        } = {}
    ): void {
        const key = this.getMethodKey(name, containerName);

        this.methods.set(key, {
            name,
            containerName,
            location,
            callees: [],
            callers: [],
            visibility: options.visibility ?? 'public',
            isClassMethod: options.isClassMethod ?? false
        });

        // Track file -> methods mapping
        this.addToFileIndex(this.fileMethods, location.uri, key);
    }

    /**
     * Add a method call
     */
    addCall(call: MethodCall): void {
        const callerKey = this.getMethodKey(call.caller.name, call.caller.containerName);
        const calleeKey = this.getCalleeKey(call.callee.name, call.callee.receiverType);

        // Add to callee index
        let calleeList = this.callsByCallee.get(calleeKey);
        if (!calleeList) {
            calleeList = [];
            this.callsByCallee.set(calleeKey, calleeList);
        }
        calleeList.push(call);

        // Add to caller index
        let callerList = this.callsByCaller.get(callerKey);
        if (!callerList) {
            callerList = [];
            this.callsByCaller.set(callerKey, callerList);
        }
        callerList.push(call);

        // Update method definitions if they exist
        const callerMethod = this.methods.get(callerKey);
        if (callerMethod) {
            callerMethod.callees.push(call);
        }

        const calleeMethod = this.methods.get(calleeKey);
        if (calleeMethod) {
            calleeMethod.callers.push(call);
        }

        // Track file -> calls mapping
        this.addCallToFileIndex(call.callLocation.uri, call);
    }

    /**
     * Get all callers of a method
     */
    getCallers(methodName: string, containerName?: string): MethodCall[] {
        const key = this.getMethodKey(methodName, containerName);
        const directCallers = this.callsByCallee.get(key) ?? [];

        // Also check calls without container (might match)
        if (containerName) {
            const genericKey = this.getMethodKey(methodName, undefined);
            const genericCallers = this.callsByCallee.get(genericKey) ?? [];

            // Deduplicate by creating a Set based on unique call identifiers
            const seen = new Set<string>();
            const results: MethodCall[] = [];

            for (const call of [...directCallers, ...genericCallers]) {
                const callId = this.getCallId(call);
                if (!seen.has(callId)) {
                    seen.add(callId);
                    results.push(call);
                }
            }

            return results;
        }

        return directCallers;
    }

    /**
     * Generate a unique identifier for a call
     */
    private getCallId(call: MethodCall): string {
        return `${call.caller.location.uri}:${call.caller.location.startLine}:${call.caller.location.startColumn}->` +
            `${call.callLocation.uri}:${call.callLocation.startLine}:${call.callLocation.startColumn}`;
    }

    /**
     * Get all methods called by a method
     */
    getCallees(methodName: string, containerName?: string): MethodCall[] {
        const key = this.getMethodKey(methodName, containerName);
        return this.callsByCaller.get(key) ?? [];
    }

    /**
     * Get method definition
     */
    getMethod(methodName: string, containerName?: string): MethodDefinition | undefined {
        const key = this.getMethodKey(methodName, containerName);
        return this.methods.get(key);
    }

    /**
     * Find methods by name (across all containers)
     */
    findMethodsByName(methodName: string): MethodDefinition[] {
        const results: MethodDefinition[] = [];

        for (const [key, method] of this.methods) {
            if (method.name === methodName) {
                results.push(method);
            }
        }

        return results;
    }

    /**
     * Get all methods in a container (class/module)
     */
    getMethodsInContainer(containerName: string): MethodDefinition[] {
        const results: MethodDefinition[] = [];

        for (const method of this.methods.values()) {
            if (method.containerName === containerName) {
                results.push(method);
            }
        }

        return results;
    }

    /**
     * Prepare call hierarchy item at a position
     */
    prepareCallHierarchy(
        uri: string,
        line: number,
        column: number
    ): CallHierarchyItem | undefined {
        // Find method at position
        for (const method of this.methods.values()) {
            if (this.positionInRange(uri, line, column, method.location)) {
                return this.methodToHierarchyItem(method);
            }
        }

        return undefined;
    }

    /**
     * Get incoming calls (methods that call this method)
     */
    getIncomingCalls(item: CallHierarchyItem): CallHierarchyIncomingCall[] {
        const callers = this.getCallers(item.name, item.containerName);
        const grouped = this.groupCallsByMethod(callers, 'caller');

        return grouped.map(({ method, calls }) => ({
            from: this.methodToHierarchyItem(method),
            fromRanges: calls.map(c => ({
                startLine: c.callLocation.startLine,
                startColumn: c.callLocation.startColumn,
                endLine: c.callLocation.endLine,
                endColumn: c.callLocation.endColumn
            }))
        }));
    }

    /**
     * Get outgoing calls (methods called by this method)
     */
    getOutgoingCalls(item: CallHierarchyItem): CallHierarchyOutgoingCall[] {
        const callees = this.getCallees(item.name, item.containerName);
        const results: CallHierarchyOutgoingCall[] = [];

        // Group by callee
        const grouped = new Map<string, MethodCall[]>();
        for (const call of callees) {
            const key = this.getCalleeKey(call.callee.name, call.callee.receiverType);
            let list = grouped.get(key);
            if (!list) {
                list = [];
                grouped.set(key, list);
            }
            list.push(call);
        }

        for (const [key, calls] of grouped) {
            // Try to find actual method definition
            const method = this.methods.get(key);
            const first = calls[0];

            results.push({
                to: method
                    ? this.methodToHierarchyItem(method)
                    : {
                        name: first.callee.name,
                        kind: 'method',
                        uri: first.callLocation.uri,
                        range: {
                            startLine: first.callLocation.startLine,
                            startColumn: first.callLocation.startColumn,
                            endLine: first.callLocation.endLine,
                            endColumn: first.callLocation.endColumn
                        },
                        selectionRange: {
                            startLine: first.callLocation.startLine,
                            startColumn: first.callLocation.startColumn,
                            endLine: first.callLocation.endLine,
                            endColumn: first.callLocation.endColumn
                        },
                        containerName: first.callee.receiverType
                    },
                fromRanges: calls.map(c => ({
                    startLine: c.callLocation.startLine,
                    startColumn: c.callLocation.startColumn,
                    endLine: c.callLocation.endLine,
                    endColumn: c.callLocation.endColumn
                }))
            });
        }

        return results;
    }

    /**
     * Get methods that are never called (potentially unused)
     */
    getUnusedMethods(): MethodDefinition[] {
        const unused: MethodDefinition[] = [];

        for (const method of this.methods.values()) {
            const callers = this.getCallers(method.name, method.containerName);
            if (callers.length === 0) {
                // Exclude common entry points
                if (!this.isLikelyEntryPoint(method)) {
                    unused.push(method);
                }
            }
        }

        return unused;
    }

    /**
     * Get methods with the most callers (hotspots)
     */
    getHotspots(limit: number = 10): Array<{ method: MethodDefinition; callCount: number }> {
        const counts: Array<{ method: MethodDefinition; callCount: number }> = [];

        for (const method of this.methods.values()) {
            const callCount = this.getCallers(method.name, method.containerName).length;
            counts.push({ method, callCount });
        }

        return counts
            .sort((a, b) => b.callCount - a.callCount)
            .slice(0, limit);
    }

    /**
     * Get methods with the most callees (complex methods)
     */
    getComplexMethods(limit: number = 10): Array<{ method: MethodDefinition; calleeCount: number }> {
        const counts: Array<{ method: MethodDefinition; calleeCount: number }> = [];

        for (const method of this.methods.values()) {
            const calleeCount = this.getCallees(method.name, method.containerName).length;
            counts.push({ method, calleeCount });
        }

        return counts
            .sort((a, b) => b.calleeCount - a.calleeCount)
            .slice(0, limit);
    }

    /**
     * Remove all calls and methods from a file
     */
    removeFileCalls(uri: string): void {
        // Remove methods
        const methods = this.fileMethods.get(uri);
        if (methods) {
            for (const key of methods) {
                const method = this.methods.get(key);
                if (method) {
                    // Remove from callee index
                    this.callsByCallee.delete(key);

                    // Remove calls made by this method
                    const calls = this.callsByCaller.get(key);
                    if (calls) {
                        for (const call of calls) {
                            const calleeKey = this.getCalleeKey(
                                call.callee.name,
                                call.callee.receiverType
                            );
                            const calleeCalls = this.callsByCallee.get(calleeKey);
                            if (calleeCalls) {
                                const idx = calleeCalls.indexOf(call);
                                if (idx !== -1) {
                                    calleeCalls.splice(idx, 1);
                                }
                            }
                        }
                    }
                    this.callsByCaller.delete(key);
                }
                this.methods.delete(key);
            }
            this.fileMethods.delete(uri);
        }

        // Remove calls from this file
        const calls = this.fileCalls.get(uri);
        if (calls) {
            for (const call of calls) {
                // Already handled above for caller methods
                // Handle calls to methods in other files
                const calleeKey = this.getCalleeKey(
                    call.callee.name,
                    call.callee.receiverType
                );
                const calleeCalls = this.callsByCallee.get(calleeKey);
                if (calleeCalls) {
                    const idx = calleeCalls.indexOf(call);
                    if (idx !== -1) {
                        calleeCalls.splice(idx, 1);
                    }
                }
            }
            this.fileCalls.delete(uri);
        }
    }

    /**
     * Get statistics about the call graph
     */
    getStats(): CallGraphStats {
        let totalCalls = 0;
        let maxCalls = 0;

        for (const method of this.methods.values()) {
            const callCount = method.callees.length;
            totalCalls += callCount;
            maxCalls = Math.max(maxCalls, callCount);
        }

        const methodCount = this.methods.size;
        const unused = this.getUnusedMethods();
        const hotspots = this.getHotspots(10);

        return {
            methodCount,
            callCount: totalCalls,
            avgCallsPerMethod: methodCount > 0 ? totalCalls / methodCount : 0,
            maxCallsInMethod: maxCalls,
            unusedMethods: unused.map(m =>
                m.containerName ? `${m.containerName}#${m.name}` : m.name
            ),
            hotspots: hotspots.map(h => ({
                method: h.method.containerName
                    ? `${h.method.containerName}#${h.method.name}`
                    : h.method.name,
                callCount: h.callCount
            }))
        };
    }

    /**
     * Clear all data
     */
    clear(): void {
        this.methods.clear();
        this.callsByCallee.clear();
        this.callsByCaller.clear();
        this.fileMethods.clear();
        this.fileCalls.clear();
    }

    // Private helper methods

    private getMethodKey(name: string, containerName?: string): string {
        return containerName ? `${containerName}#${name}` : name;
    }

    private getCalleeKey(name: string, receiverType?: string): string {
        return receiverType ? `${receiverType}#${name}` : name;
    }

    private addToFileIndex(index: Map<string, Set<string>>, uri: string, key: string): void {
        let set = index.get(uri);
        if (!set) {
            set = new Set();
            index.set(uri, set);
        }
        set.add(key);
    }

    private addCallToFileIndex(uri: string, call: MethodCall): void {
        let calls = this.fileCalls.get(uri);
        if (!calls) {
            calls = [];
            this.fileCalls.set(uri, calls);
        }
        calls.push(call);
    }

    private positionInRange(
        uri: string,
        line: number,
        column: number,
        location: CallLocation
    ): boolean {
        if (uri !== location.uri) {
            return false;
        }

        if (line < location.startLine || line > location.endLine) {
            return false;
        }

        if (line === location.startLine && column < location.startColumn) {
            return false;
        }

        if (line === location.endLine && column > location.endColumn) {
            return false;
        }

        return true;
    }

    private methodToHierarchyItem(method: MethodDefinition): CallHierarchyItem {
        return {
            name: method.name,
            kind: method.isClassMethod ? 'class_method' : 'method',
            uri: method.location.uri,
            range: {
                startLine: method.location.startLine,
                startColumn: method.location.startColumn,
                endLine: method.location.endLine,
                endColumn: method.location.endColumn
            },
            selectionRange: {
                startLine: method.location.startLine,
                startColumn: method.location.startColumn,
                endLine: method.location.endLine,
                endColumn: method.location.endColumn
            },
            containerName: method.containerName
        };
    }

    private groupCallsByMethod(
        calls: MethodCall[],
        type: 'caller' | 'callee'
    ): Array<{ method: MethodDefinition; calls: MethodCall[] }> {
        const grouped = new Map<string, MethodCall[]>();

        for (const call of calls) {
            const ref = type === 'caller' ? call.caller : {
                name: call.callee.name,
                containerName: call.callee.receiverType,
                location: call.callLocation
            };
            const key = this.getMethodKey(ref.name, ref.containerName);

            let list = grouped.get(key);
            if (!list) {
                list = [];
                grouped.set(key, list);
            }
            list.push(call);
        }

        const results: Array<{ method: MethodDefinition; calls: MethodCall[] }> = [];

        for (const [key, callList] of grouped) {
            const method = this.methods.get(key);
            if (method) {
                results.push({ method, calls: callList });
            }
        }

        return results;
    }

    private isLikelyEntryPoint(method: MethodDefinition): boolean {
        const entryPointPatterns = [
            /^(index|show|create|update|destroy|new|edit)$/, // Rails actions
            /^(call|perform|run|execute)$/, // Service objects
            /^(up|down|change)$/, // Migrations
            /^test_/, // Test methods
            /^(before|after|around)_/, // Callbacks
            /^initialize$/ // Constructor
        ];

        return entryPointPatterns.some(pattern => pattern.test(method.name));
    }
}
