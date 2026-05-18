/**
 * Call Flow Tracer - Core Types
 *
 * Types for the visual debugging tool that allows users to manually mark
 * methods and build focused mind maps of execution flow.
 */

import * as vscode from 'vscode';

/**
 * A node in the call flow tree representing a marked method
 */
export interface CallFlowNode {
    /** Unique identifier (UUID) */
    id: string;

    /** Method name */
    methodName: string;

    /** Container class/module name */
    containerName?: string;

    /** Source location */
    location: vscode.Location;

    /** User annotation/label */
    label?: string;

    /** Child node IDs (methods called by this method) */
    children: string[];

    /** Parent node IDs (methods that call this method) */
    parents: string[];

    /** How this node was added */
    type: 'manual' | 'auto';

    /** Edge types per child: nodeId -> connection type */
    connectionType: Map<string, 'auto' | 'manual'>;

    /** Whether this is a Rails callback (before_action, etc.) */
    isCallback?: boolean;

    /** Whether this is an HTTP endpoint (route entry) */
    isRouteEntry?: boolean;

    /** Confidence score for auto-detected connections (0-1) */
    confidence?: number;

    /** Creation timestamp */
    createdAt: number;

    /** Whether this node has circular references */
    hasCircularRef?: boolean;
}

/**
 * Serializable version of CallFlowNode for persistence
 */
export interface SerializedCallFlowNode {
    id: string;
    methodName: string;
    containerName?: string;
    location: {
        uri: string;
        range: {
            start: { line: number; character: number };
            end: { line: number; character: number };
        };
    };
    label?: string;
    children: string[];
    parents: string[];
    type: 'manual' | 'auto';
    connectionType: [string, 'auto' | 'manual'][];
    isCallback?: boolean;
    isRouteEntry?: boolean;
    confidence?: number;
    createdAt: number;
    hasCircularRef?: boolean;
}

/**
 * A call flow tree containing multiple marked methods
 */
export interface CallFlowTree {
    /** Unique identifier (UUID) */
    id: string;

    /** User-given name for the tree */
    name: string;

    /** Optional description */
    description?: string;

    /** All nodes in the tree, keyed by ID */
    nodes: Map<string, CallFlowNode>;

    /** Root/entry point node IDs */
    rootNodes: string[];

    /** Creation timestamp */
    createdAt: number;

    /** Last modification timestamp */
    updatedAt: number;

    /** Maximum depth for auto-expand (default: 3) */
    maxDepth: number;

    /** Whether to auto-connect nodes when added */
    autoConnect: boolean;
}

/**
 * Serializable version of CallFlowTree for persistence
 */
export interface SerializedCallFlowTree {
    id: string;
    name: string;
    description?: string;
    nodes: SerializedCallFlowNode[];
    rootNodes: string[];
    createdAt: number;
    updatedAt: number;
    maxDepth: number;
    autoConnect: boolean;
    schemaVersion: number;
}

/**
 * Result of analyzing connections between nodes
 */
export interface ConnectionAnalysis {
    /** Source node ID */
    fromNodeId: string;

    /** Target node ID */
    toNodeId: string;

    /** How the connection was detected */
    connectionType: 'auto' | 'manual';

    /** Confidence score (1.0 for manual, 0.6-0.9 for auto) */
    confidence: number;

    /** Why this connection exists */
    reason?: string;
}

/**
 * Options for auto-expanding nodes
 */
export interface AutoExpandOptions {
    /** Maximum depth to expand */
    maxDepth: number;

    /** Whether to include callbacks */
    includeCallbacks: boolean;

    /** Whether to include route entries */
    includeRoutes: boolean;

    /** Minimum confidence threshold for auto-detection */
    minConfidence: number;
}

/**
 * Export format options
 */
export type ExportFormat = 'mermaid' | 'json' | 'markdown';

/**
 * Export options
 */
export interface ExportOptions {
    /** Output format */
    format: ExportFormat;

    /** Whether to include confidence scores */
    includeConfidence?: boolean;

    /** Whether to include timestamps */
    includeTimestamps?: boolean;

    /** Whether to include file locations */
    includeLocations?: boolean;

    /** Custom title for the export */
    title?: string;
}

/**
 * Configuration for the Call Flow Tracer
 */
export interface CallFlowTracerConfig {
    /** Default max depth for auto-expand */
    maxAutoExpandDepth: number;

    /** Whether to auto-connect nodes by default */
    autoConnect: boolean;

    /** Whether to show confidence scores in UI */
    showConfidence: boolean;

    /** Storage directory (relative to workspace) */
    storageDirectory: string;
}

/**
 * Schema version for storage migration
 */
export const CALL_FLOW_SCHEMA_VERSION = 1;

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: CallFlowTracerConfig = {
    maxAutoExpandDepth: 3,
    autoConnect: true,
    showConfidence: false,
    storageDirectory: '.rubymate/call-flow-trees'
};

/**
 * Generate a UUID v4
 */
export function generateId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Serialize a CallFlowNode for persistence
 */
export function serializeNode(node: CallFlowNode): SerializedCallFlowNode {
    return {
        id: node.id,
        methodName: node.methodName,
        containerName: node.containerName,
        location: {
            uri: node.location.uri.toString(),
            range: {
                start: {
                    line: node.location.range.start.line,
                    character: node.location.range.start.character
                },
                end: {
                    line: node.location.range.end.line,
                    character: node.location.range.end.character
                }
            }
        },
        label: node.label,
        children: node.children,
        parents: node.parents,
        type: node.type,
        connectionType: Array.from(node.connectionType.entries()),
        isCallback: node.isCallback,
        isRouteEntry: node.isRouteEntry,
        confidence: node.confidence,
        createdAt: node.createdAt,
        hasCircularRef: node.hasCircularRef
    };
}

/**
 * Deserialize a CallFlowNode from storage
 */
export function deserializeNode(serialized: SerializedCallFlowNode): CallFlowNode {
    return {
        id: serialized.id,
        methodName: serialized.methodName,
        containerName: serialized.containerName,
        location: new vscode.Location(
            vscode.Uri.parse(serialized.location.uri),
            new vscode.Range(
                new vscode.Position(
                    serialized.location.range.start.line,
                    serialized.location.range.start.character
                ),
                new vscode.Position(
                    serialized.location.range.end.line,
                    serialized.location.range.end.character
                )
            )
        ),
        label: serialized.label,
        children: serialized.children,
        parents: serialized.parents,
        type: serialized.type,
        connectionType: new Map(serialized.connectionType),
        isCallback: serialized.isCallback,
        isRouteEntry: serialized.isRouteEntry,
        confidence: serialized.confidence,
        createdAt: serialized.createdAt,
        hasCircularRef: serialized.hasCircularRef
    };
}

/**
 * Serialize a CallFlowTree for persistence
 */
export function serializeTree(tree: CallFlowTree): SerializedCallFlowTree {
    return {
        id: tree.id,
        name: tree.name,
        description: tree.description,
        nodes: Array.from(tree.nodes.values()).map(serializeNode),
        rootNodes: tree.rootNodes,
        createdAt: tree.createdAt,
        updatedAt: tree.updatedAt,
        maxDepth: tree.maxDepth,
        autoConnect: tree.autoConnect,
        schemaVersion: CALL_FLOW_SCHEMA_VERSION
    };
}

/**
 * Deserialize a CallFlowTree from storage
 */
export function deserializeTree(serialized: SerializedCallFlowTree): CallFlowTree {
    const nodes = new Map<string, CallFlowNode>();
    for (const nodeData of serialized.nodes) {
        nodes.set(nodeData.id, deserializeNode(nodeData));
    }

    return {
        id: serialized.id,
        name: serialized.name,
        description: serialized.description,
        nodes,
        rootNodes: serialized.rootNodes,
        createdAt: serialized.createdAt,
        updatedAt: serialized.updatedAt,
        maxDepth: serialized.maxDepth,
        autoConnect: serialized.autoConnect
    };
}

/**
 * Get display name for a node
 */
export function getNodeDisplayName(node: CallFlowNode): string {
    if (node.label) {
        return node.label;
    }
    if (node.containerName) {
        return `${node.containerName}#${node.methodName}`;
    }
    return node.methodName;
}

/**
 * Check if two nodes represent the same method
 */
export function nodesEqual(a: CallFlowNode, b: CallFlowNode): boolean {
    return a.methodName === b.methodName &&
           a.containerName === b.containerName &&
           a.location.uri.toString() === b.location.uri.toString();
}
