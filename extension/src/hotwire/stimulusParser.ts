/**
 * Stimulus Controller Parser
 *
 * Regex-based extraction of Stimulus controller metadata from JS/TS files.
 * Extracts: targets, values, outlets, classes, and action methods.
 */

import {
    StimulusController,
    StimulusAction,
    StimulusValue,
    StimulusValueType,
    STIMULUS_VALUE_TYPES
} from './types';
import * as vscode from 'vscode';
import * as path from 'path';

export class StimulusParser {
    /**
     * Parse a Stimulus controller file and extract metadata
     */
    parseController(content: string, filePath: string, mtime: number): StimulusController | null {
        const controllerName = this.extractControllerName(filePath);
        if (!controllerName) {
            return null;
        }

        const targets = this.extractTargets(content);
        const values = this.extractValues(content);
        const outlets = this.extractOutlets(content);
        const classes = this.extractClasses(content);
        const actions = this.extractActions(content);

        return {
            name: controllerName,
            filePath,
            uri: vscode.Uri.file(filePath),
            targets,
            values,
            outlets,
            classes,
            actions,
            mtime
        };
    }

    /**
     * Extract controller name from file path
     * e.g., "hello_controller.js" -> "hello"
     *       "nested/modal_controller.ts" -> "nested--modal"
     */
    extractControllerName(filePath: string): string | null {
        const basename = path.basename(filePath);
        const match = basename.match(/^(.+)_controller\.(js|ts)$/);
        if (!match) {
            return null;
        }

        // Get the relative path from controllers directory
        const controllersMatch = filePath.match(/controllers[\/\\](.+)_controller\.(js|ts)$/);
        if (controllersMatch) {
            const relativePath = controllersMatch[1];
            // Convert path separators to -- for namespaced controllers
            // e.g., "nested/modal" -> "nested--modal"
            return relativePath.replace(/[\/\\]/g, '--').replace(/_/g, '-');
        }

        // Fallback: just use the basename
        return match[1].replace(/_/g, '-');
    }

    /**
     * Extract static targets = [...] array
     */
    extractTargets(content: string): string[] {
        const targets: string[] = [];

        // Match: static targets = ["name1", "name2", ...]
        const arrayMatch = content.match(/static\s+targets\s*=\s*\[([^\]]*)\]/s);
        if (arrayMatch) {
            const arrayContent = arrayMatch[1];
            const stringMatches = arrayContent.matchAll(/["']([^"']+)["']/g);
            for (const match of stringMatches) {
                targets.push(match[1]);
            }
        }

        return targets;
    }

    /**
     * Extract static values = { name: Type, ... } object
     */
    extractValues(content: string): StimulusValue[] {
        const values: StimulusValue[] = [];

        // Match: static values = { ... }
        const objectMatch = content.match(/static\s+values\s*=\s*\{([^}]*)\}/s);
        if (objectMatch) {
            const objectContent = objectMatch[1];

            // Match: name: Type or name: { type: Type, default: value }
            // Simple form: url: String
            const simpleMatches = objectContent.matchAll(/(\w+)\s*:\s*(String|Number|Boolean|Array|Object)(?![^{]*})/g);
            for (const match of simpleMatches) {
                const name = match[1];
                const type = match[2] as StimulusValueType;
                if (STIMULUS_VALUE_TYPES.includes(type)) {
                    values.push({ name, type });
                }
            }

            // Complex form: url: { type: String, default: "https://example.com" }
            const complexMatches = objectContent.matchAll(/(\w+)\s*:\s*\{\s*type\s*:\s*(String|Number|Boolean|Array|Object)(?:\s*,\s*default\s*:\s*([^}]+))?\s*\}/g);
            for (const match of complexMatches) {
                const name = match[1];
                const type = match[2] as StimulusValueType;
                const defaultValue = match[3]?.trim();
                if (STIMULUS_VALUE_TYPES.includes(type)) {
                    values.push({ name, type, defaultValue });
                }
            }
        }

        return values;
    }

    /**
     * Extract static outlets = [...] array
     */
    extractOutlets(content: string): string[] {
        const outlets: string[] = [];

        // Match: static outlets = ["controller-name", ...]
        const arrayMatch = content.match(/static\s+outlets\s*=\s*\[([^\]]*)\]/s);
        if (arrayMatch) {
            const arrayContent = arrayMatch[1];
            const stringMatches = arrayContent.matchAll(/["']([^"']+)["']/g);
            for (const match of stringMatches) {
                outlets.push(match[1]);
            }
        }

        return outlets;
    }

    /**
     * Extract static classes = [...] array
     */
    extractClasses(content: string): string[] {
        const classes: string[] = [];

        // Match: static classes = ["loading", "active", ...]
        const arrayMatch = content.match(/static\s+classes\s*=\s*\[([^\]]*)\]/s);
        if (arrayMatch) {
            const arrayContent = arrayMatch[1];
            const stringMatches = arrayContent.matchAll(/["']([^"']+)["']/g);
            for (const match of stringMatches) {
                classes.push(match[1]);
            }
        }

        return classes;
    }

    /**
     * Extract public action methods (non-lifecycle, non-private methods)
     */
    extractActions(content: string): StimulusAction[] {
        const actions: StimulusAction[] = [];
        const lines = content.split('\n');

        // Lifecycle methods and built-in methods to exclude
        const excludedMethods = new Set([
            'constructor',
            'connect',
            'disconnect',
            'initialize',
            // Getters/setters for targets, values, outlets, classes
            // These are auto-generated by Stimulus
        ]);

        // Track getter/setter patterns to exclude them
        const getterSetterPattern = /^\s*(get|set)\s+(\w+)\s*\(/;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNumber = i + 1;

            // Skip getters and setters
            if (getterSetterPattern.test(line)) {
                continue;
            }

            // Match method definitions:
            // - methodName() { ... }
            // - methodName(event) { ... }
            // - async methodName() { ... }
            // - methodName = () => { ... } (arrow function)
            // - methodName = (event) => { ... }
            const methodPatterns = [
                // Standard method: methodName() or async methodName()
                /^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/,
                // Arrow function property: methodName = () => or methodName = (event) =>
                /^\s*(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/,
                // TypeScript method with return type: methodName(): void {
                /^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*:\s*\w+\s*\{/,
            ];

            for (const pattern of methodPatterns) {
                const match = line.match(pattern);
                if (match) {
                    const methodName = match[1];

                    // Skip if:
                    // - Starts with underscore (private by convention)
                    // - Is a lifecycle method
                    // - Ends with "Target", "Targets", "Value", "Outlet", etc. (auto-generated)
                    if (
                        methodName.startsWith('_') ||
                        excludedMethods.has(methodName) ||
                        methodName.endsWith('Target') ||
                        methodName.endsWith('Targets') ||
                        methodName.endsWith('Value') ||
                        methodName.endsWith('Values') ||
                        methodName.endsWith('Outlet') ||
                        methodName.endsWith('Outlets') ||
                        methodName.endsWith('Class') ||
                        methodName.endsWith('Classes') ||
                        methodName.startsWith('has') // hasXTarget, hasXValue, etc.
                    ) {
                        continue;
                    }

                    // Extract parameters if present
                    const paramMatch = line.match(/\(([^)]*)\)/);
                    const parameters = paramMatch && paramMatch[1].trim()
                        ? paramMatch[1].split(',').map(p => p.trim().split(':')[0].trim())
                        : undefined;

                    actions.push({
                        name: methodName,
                        line: lineNumber,
                        parameters
                    });
                    break; // Only match once per line
                }
            }
        }

        return actions;
    }

    /**
     * Check if content is a valid Stimulus controller
     */
    isValidController(content: string): boolean {
        // Check for Stimulus controller pattern
        const patterns = [
            /extends\s+(?:Stimulus\.)?Controller/,
            /import\s+.*Controller.*from\s+["']@hotwired\/stimulus["']/,
            /import\s+.*Controller.*from\s+["']stimulus["']/,
        ];

        return patterns.some(pattern => pattern.test(content));
    }
}
