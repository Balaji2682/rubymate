/**
 * Inheritance Index
 *
 * Track Ruby class/module hierarchies for type inference,
 * navigation, and method resolution order (MRO).
 */

/**
 * Location reference for a source position
 */
export interface SourceLocation {
    uri: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
}

/**
 * Type of inheritance relation
 */
export type InheritanceType = 'extends' | 'includes' | 'prepends' | 'extends_singleton';

/**
 * Inheritance relation between classes/modules
 */
export interface InheritanceRelation {
    /** Child class/module name (fully qualified) */
    child: string;
    /** Parent class/module name (fully qualified) */
    parent: string;
    /** Type of relation */
    type: InheritanceType;
    /** Location in source code */
    location: SourceLocation;
}

/**
 * Class or module entry in the index
 */
export interface ClassEntry {
    name: string;
    kind: 'class' | 'module';
    parent?: string;
    includes: string[];
    prepends: string[];
    extendsSingleton: string[];
    location: SourceLocation;
}

/**
 * Statistics about the inheritance index
 */
export interface InheritanceStats {
    classCount: number;
    moduleCount: number;
    totalRelations: number;
    maxInheritanceDepth: number;
    mostIncludedModules: Array<{ name: string; count: number }>;
}

/**
 * Inheritance Index for tracking Ruby class/module hierarchies
 *
 * @example
 * ```typescript
 * const index = new InheritanceIndex();
 *
 * // Add relations from parsing
 * index.addInheritance('Admin::User', 'User', location);
 * index.addInclude('User', 'Comparable', location);
 * index.addInclude('User', 'ActiveModel::Validations', location);
 *
 * // Query hierarchy
 * const ancestors = index.getAncestors('Admin::User');
 * // ['User', 'Object', 'Kernel', 'BasicObject']
 *
 * const mro = index.getMethodResolutionOrder('Admin::User');
 * // ['Admin::User', 'User', 'Comparable', 'ActiveModel::Validations', 'Object', ...]
 * ```
 */
export class InheritanceIndex {
    private classes: Map<string, ClassEntry> = new Map();
    private relations: InheritanceRelation[] = [];

    // Reverse indexes for fast lookups
    private subclassIndex: Map<string, Set<string>> = new Map();
    private includerIndex: Map<string, Set<string>> = new Map();
    private prependIndex: Map<string, Set<string>> = new Map();

    // File to relations mapping for incremental updates
    private fileRelations: Map<string, InheritanceRelation[]> = new Map();

    /**
     * Add a class inheritance relation (class Foo < Bar)
     */
    addInheritance(child: string, parent: string, location: SourceLocation): void {
        this.ensureClassEntry(child, 'class', location);
        this.ensureClassEntry(parent, 'class');

        const classEntry = this.classes.get(child)!;
        classEntry.parent = parent;

        const relation: InheritanceRelation = { child, parent, type: 'extends', location };
        this.relations.push(relation);
        this.addFileRelation(location.uri, relation);

        // Update reverse index
        this.addToIndex(this.subclassIndex, parent, child);
    }

    /**
     * Add a module include relation (include SomeModule)
     */
    addInclude(target: string, included: string, location: SourceLocation): void {
        this.ensureClassEntry(target, 'class', location);
        this.ensureClassEntry(included, 'module');

        const classEntry = this.classes.get(target)!;
        if (!classEntry.includes.includes(included)) {
            classEntry.includes.push(included);
        }

        const relation: InheritanceRelation = {
            child: target,
            parent: included,
            type: 'includes',
            location
        };
        this.relations.push(relation);
        this.addFileRelation(location.uri, relation);

        // Update reverse index
        this.addToIndex(this.includerIndex, included, target);
    }

    /**
     * Add a module prepend relation (prepend SomeModule)
     */
    addPrepend(target: string, prepended: string, location: SourceLocation): void {
        this.ensureClassEntry(target, 'class', location);
        this.ensureClassEntry(prepended, 'module');

        const classEntry = this.classes.get(target)!;
        if (!classEntry.prepends.includes(prepended)) {
            classEntry.prepends.push(prepended);
        }

        const relation: InheritanceRelation = {
            child: target,
            parent: prepended,
            type: 'prepends',
            location
        };
        this.relations.push(relation);
        this.addFileRelation(location.uri, relation);

        // Update reverse index
        this.addToIndex(this.prependIndex, prepended, target);
    }

    /**
     * Add a singleton class extension (extend SomeModule)
     */
    addExtend(target: string, extended: string, location: SourceLocation): void {
        this.ensureClassEntry(target, 'class', location);
        this.ensureClassEntry(extended, 'module');

        const classEntry = this.classes.get(target)!;
        if (!classEntry.extendsSingleton.includes(extended)) {
            classEntry.extendsSingleton.push(extended);
        }

        const relation: InheritanceRelation = {
            child: target,
            parent: extended,
            type: 'extends_singleton',
            location
        };
        this.relations.push(relation);
        this.addFileRelation(location.uri, relation);
    }

    /**
     * Get the direct parent of a class
     */
    getParent(className: string): string | undefined {
        return this.classes.get(className)?.parent;
    }

    /**
     * Get all ancestors (inheritance chain up to Object)
     */
    getAncestors(className: string): string[] {
        const ancestors: string[] = [];
        const visited = new Set<string>();
        let current = className;

        while (current && !visited.has(current)) {
            visited.add(current);
            const parent = this.getParent(current);
            if (parent) {
                ancestors.push(parent);
                current = parent;
            } else {
                break;
            }
        }

        return ancestors;
    }

    /**
     * Get all descendants (subclasses)
     */
    getDescendants(className: string): string[] {
        const descendants: string[] = [];
        const queue = [className];
        const visited = new Set<string>();

        while (queue.length > 0) {
            const current = queue.shift()!;
            if (visited.has(current)) {
                continue;
            }
            visited.add(current);

            const subclasses = this.subclassIndex.get(current);
            if (subclasses) {
                for (const subclass of subclasses) {
                    descendants.push(subclass);
                    queue.push(subclass);
                }
            }
        }

        return descendants;
    }

    /**
     * Get direct subclasses
     */
    getSubclasses(parentName: string): string[] {
        return Array.from(this.subclassIndex.get(parentName) ?? []);
    }

    /**
     * Get modules included by a class
     */
    getIncludedModules(className: string): string[] {
        return this.classes.get(className)?.includes ?? [];
    }

    /**
     * Get modules prepended by a class
     */
    getPrependedModules(className: string): string[] {
        return this.classes.get(className)?.prepends ?? [];
    }

    /**
     * Get modules that extend the singleton class
     */
    getExtendedModules(className: string): string[] {
        return this.classes.get(className)?.extendsSingleton ?? [];
    }

    /**
     * Get classes/modules that include a module
     */
    getIncluders(moduleName: string): string[] {
        return Array.from(this.includerIndex.get(moduleName) ?? []);
    }

    /**
     * Get classes/modules that prepend a module
     */
    getPrependers(moduleName: string): string[] {
        return Array.from(this.prependIndex.get(moduleName) ?? []);
    }

    /**
     * Get the method resolution order (MRO) for a class
     * Follows Ruby's C3 linearization algorithm with circular dependency protection
     */
    getMethodResolutionOrder(className: string): string[] {
        const mro: string[] = [];
        const visited = new Set<string>();
        const inProgress = new Set<string>(); // Track current traversal path

        const processClass = (name: string): void => {
            // Skip if already fully processed
            if (visited.has(name)) {
                return;
            }

            // Detect circular dependency
            if (inProgress.has(name)) {
                console.warn(`Circular dependency detected in MRO for: ${name}`);
                return;
            }

            inProgress.add(name);

            const classEntry = this.classes.get(name);
            if (!classEntry) {
                mro.push(name);
                inProgress.delete(name);
                visited.add(name);
                return;
            }

            // Add prepended modules first (they take precedence)
            for (const prepended of classEntry.prepends) {
                processClass(prepended);
            }

            // Add the class itself
            mro.push(name);

            // Add included modules
            for (const included of classEntry.includes) {
                processClass(included);
            }

            // Add parent class
            if (classEntry.parent) {
                processClass(classEntry.parent);
            }

            inProgress.delete(name);
            visited.add(name);
        };

        processClass(className);
        return mro;
    }

    /**
     * Check if a class inherits from another (directly or indirectly)
     */
    isSubclassOf(child: string, parent: string): boolean {
        const ancestors = this.getAncestors(child);
        return ancestors.includes(parent);
    }

    /**
     * Check if a class includes a module (directly or indirectly)
     */
    includesModule(className: string, moduleName: string): boolean {
        const mro = this.getMethodResolutionOrder(className);
        return mro.includes(moduleName);
    }

    /**
     * Get all classes in the index
     */
    getAllClasses(): string[] {
        return Array.from(this.classes.entries())
            .filter(([_, entry]) => entry.kind === 'class')
            .map(([name]) => name);
    }

    /**
     * Get all modules in the index
     */
    getAllModules(): string[] {
        return Array.from(this.classes.entries())
            .filter(([_, entry]) => entry.kind === 'module')
            .map(([name]) => name);
    }

    /**
     * Get class/module entry
     */
    getEntry(name: string): ClassEntry | undefined {
        return this.classes.get(name);
    }

    /**
     * Get all relations for a class
     */
    getRelations(className: string): InheritanceRelation[] {
        return this.relations.filter(r => r.child === className || r.parent === className);
    }

    /**
     * Remove all relations from a file (for incremental updates)
     */
    removeFileRelations(uri: string): void {
        const relations = this.fileRelations.get(uri);
        if (!relations) {
            return;
        }

        for (const relation of relations) {
            // Remove from main relations array
            const index = this.relations.indexOf(relation);
            if (index !== -1) {
                this.relations.splice(index, 1);
            }

            // Remove from reverse indexes
            this.removeFromIndex(this.subclassIndex, relation.parent, relation.child);
            this.removeFromIndex(this.includerIndex, relation.parent, relation.child);
            this.removeFromIndex(this.prependIndex, relation.parent, relation.child);

            // Update class entry
            const classEntry = this.classes.get(relation.child);
            if (classEntry) {
                switch (relation.type) {
                    case 'extends':
                        if (classEntry.parent === relation.parent) {
                            classEntry.parent = undefined;
                        }
                        break;
                    case 'includes':
                        classEntry.includes = classEntry.includes.filter(m => m !== relation.parent);
                        break;
                    case 'prepends':
                        classEntry.prepends = classEntry.prepends.filter(m => m !== relation.parent);
                        break;
                    case 'extends_singleton':
                        classEntry.extendsSingleton = classEntry.extendsSingleton.filter(m => m !== relation.parent);
                        break;
                }
            }
        }

        this.fileRelations.delete(uri);
    }

    /**
     * Get statistics about the index
     */
    getStats(): InheritanceStats {
        let classCount = 0;
        let moduleCount = 0;
        let maxDepth = 0;
        const includeCounts = new Map<string, number>();

        for (const [name, entry] of this.classes) {
            if (entry.kind === 'class') {
                classCount++;
                const depth = this.getAncestors(name).length;
                maxDepth = Math.max(maxDepth, depth);
            } else {
                moduleCount++;
            }
        }

        // Count module inclusions
        for (const relation of this.relations) {
            if (relation.type === 'includes') {
                includeCounts.set(
                    relation.parent,
                    (includeCounts.get(relation.parent) ?? 0) + 1
                );
            }
        }

        // Get most included modules
        const mostIncluded = Array.from(includeCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([name, count]) => ({ name, count }));

        return {
            classCount,
            moduleCount,
            totalRelations: this.relations.length,
            maxInheritanceDepth: maxDepth,
            mostIncludedModules: mostIncluded
        };
    }

    /**
     * Clear all data
     */
    clear(): void {
        this.classes.clear();
        this.relations = [];
        this.subclassIndex.clear();
        this.includerIndex.clear();
        this.prependIndex.clear();
        this.fileRelations.clear();
    }

    /**
     * Export to a simple object for serialization
     */
    toJSON(): object {
        return {
            classes: Array.from(this.classes.entries()),
            relations: this.relations
        };
    }

    /**
     * Import from serialized data
     */
    fromJSON(data: { classes: Array<[string, ClassEntry]>; relations: InheritanceRelation[] }): void {
        this.clear();

        for (const [name, entry] of data.classes) {
            this.classes.set(name, entry);
        }

        for (const relation of data.relations) {
            this.relations.push(relation);
            this.addFileRelation(relation.location.uri, relation);

            // Rebuild reverse indexes
            switch (relation.type) {
                case 'extends':
                    this.addToIndex(this.subclassIndex, relation.parent, relation.child);
                    break;
                case 'includes':
                    this.addToIndex(this.includerIndex, relation.parent, relation.child);
                    break;
                case 'prepends':
                    this.addToIndex(this.prependIndex, relation.parent, relation.child);
                    break;
            }
        }
    }

    // Private helper methods

    private ensureClassEntry(name: string, kind: 'class' | 'module', location?: SourceLocation): void {
        if (!this.classes.has(name)) {
            this.classes.set(name, {
                name,
                kind,
                includes: [],
                prepends: [],
                extendsSingleton: [],
                location: location ?? {
                    uri: '',
                    startLine: 0,
                    startColumn: 0,
                    endLine: 0,
                    endColumn: 0
                }
            });
        }
    }

    private addFileRelation(uri: string, relation: InheritanceRelation): void {
        let relations = this.fileRelations.get(uri);
        if (!relations) {
            relations = [];
            this.fileRelations.set(uri, relations);
        }
        relations.push(relation);
    }

    private addToIndex(index: Map<string, Set<string>>, key: string, value: string): void {
        let set = index.get(key);
        if (!set) {
            set = new Set();
            index.set(key, set);
        }
        set.add(value);
    }

    private removeFromIndex(index: Map<string, Set<string>>, key: string, value: string): void {
        const set = index.get(key);
        if (set) {
            set.delete(value);
            if (set.size === 0) {
                index.delete(key);
            }
        }
    }
}
