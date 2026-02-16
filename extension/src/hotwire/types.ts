/**
 * Hotwire Stack Types
 *
 * Shared interfaces for Stimulus, Turbo, and Turbo Drive support.
 */

import * as vscode from 'vscode';

// ============ Stimulus Types ============

export interface StimulusController {
    /** Controller name (e.g., "hello" from "hello_controller.js") */
    name: string;
    /** Full file path to the controller */
    filePath: string;
    /** File URI */
    uri: vscode.Uri;
    /** Static targets array */
    targets: string[];
    /** Static values object */
    values: StimulusValue[];
    /** Static outlets array */
    outlets: string[];
    /** Public action methods */
    actions: StimulusAction[];
    /** Static classes array (Stimulus 3.0+) */
    classes: string[];
    /** File modification time for cache invalidation */
    mtime: number;
}

export interface StimulusAction {
    /** Method name */
    name: string;
    /** Line number in the file (1-indexed) */
    line: number;
    /** Optional parameters */
    parameters?: string[];
}

export interface StimulusValue {
    /** Value name (e.g., "url" from "static values = { url: String }") */
    name: string;
    /** Value type (String, Number, Boolean, Array, Object) */
    type: StimulusValueType;
    /** Default value if specified */
    defaultValue?: string;
}

export type StimulusValueType = 'String' | 'Number' | 'Boolean' | 'Array' | 'Object';

// ============ Stimulus Index Types ============

export interface StimulusIndex {
    /** Version for cache invalidation */
    version: number;
    /** Timestamp of last full index */
    indexedAt: number;
    /** Map of controller name to controller data */
    controllers: Record<string, StimulusControllerData>;
}

export interface StimulusControllerData {
    filePath: string;
    targets: string[];
    values: StimulusValue[];
    outlets: string[];
    actions: StimulusActionData[];
    classes: string[];
    mtime: number;
}

export interface StimulusActionData {
    name: string;
    line: number;
}

// ============ Turbo Types ============

export interface TurboStreamAction {
    name: string;
    snippet: string;
    documentation: string;
}

export interface TurboFrameAttribute {
    name: string;
    values?: string[];
    documentation: string;
}

export interface TurboDataAttribute {
    name: string;
    values?: string[];
    documentation: string;
}

// ============ HTML Context Types ============

export interface DataAttributeContext {
    /** Type of data attribute being completed */
    type: 'controller' | 'action' | 'target' | 'value' | 'outlet' | 'turbo' | 'class' | 'param';
    /** Controller name if in context (e.g., "hello" when completing hello-target) */
    controllerName?: string;
    /** Current attribute value (partial) */
    currentValue: string;
    /** Position within the attribute value */
    position: number;
    /** Full attribute name (e.g., "data-hello-target") */
    attributeName: string;
}

export interface HtmlAttributeMatch {
    /** The full attribute (e.g., 'data-controller="hello"') */
    fullMatch: string;
    /** Attribute name */
    name: string;
    /** Attribute value */
    value: string;
    /** Start position in the line */
    start: number;
    /** End position in the line */
    end: number;
}

// ============ Provider Context ============

export interface HotwireCompletionContext {
    /** Document being edited */
    document: vscode.TextDocument;
    /** Current position */
    position: vscode.Position;
    /** Line prefix (text before cursor) */
    linePrefix: string;
    /** Full line text */
    lineText: string;
    /** Whether cursor is in HTML context (not inside <% %>) */
    isHtmlContext: boolean;
    /** Parsed data attribute context if applicable */
    dataAttributeContext?: DataAttributeContext;
}

// ============ Constants ============

export const STIMULUS_VALUE_TYPES: StimulusValueType[] = [
    'String', 'Number', 'Boolean', 'Array', 'Object'
];

export const TURBO_STREAM_ACTIONS = [
    'append', 'prepend', 'replace', 'update', 'remove',
    'before', 'after', 'morph', 'refresh'
] as const;

export const TURBO_DATA_ATTRIBUTES: TurboDataAttribute[] = [
    { name: 'data-turbo', values: ['true', 'false'], documentation: 'Enable/disable Turbo Drive for this element' },
    { name: 'data-turbo-action', values: ['advance', 'replace', 'restore'], documentation: 'Specify navigation action type' },
    { name: 'data-turbo-method', values: ['get', 'post', 'put', 'patch', 'delete'], documentation: 'HTTP method for link clicks' },
    { name: 'data-turbo-confirm', documentation: 'Show confirmation dialog before action' },
    { name: 'data-turbo-frame', documentation: 'Target frame ID for navigation' },
    { name: 'data-turbo-stream', values: ['true', 'false'], documentation: 'Enable Turbo Stream responses' },
    { name: 'data-turbo-permanent', values: ['true'], documentation: 'Preserve element across page loads' },
    { name: 'data-turbo-temporary', values: ['true'], documentation: 'Remove element on navigation' },
    { name: 'data-turbo-cache', values: ['true', 'false'], documentation: 'Control caching behavior' },
    { name: 'data-turbo-prefetch', values: ['true', 'false'], documentation: 'Control prefetching behavior' },
    { name: 'data-turbo-preload', values: ['true', 'false'], documentation: 'Preload linked page' },
    { name: 'data-turbo-submits-with', documentation: 'Text to show while form submitting' },
];

export const TURBO_FRAME_ATTRIBUTES: TurboFrameAttribute[] = [
    { name: 'id', documentation: 'Unique identifier for the frame' },
    { name: 'src', documentation: 'URL to load frame content from' },
    { name: 'loading', values: ['eager', 'lazy'], documentation: 'When to load the frame' },
    { name: 'disabled', values: ['true', 'false'], documentation: 'Disable frame navigation' },
    { name: 'target', values: ['_top', '_self'], documentation: 'Navigation target' },
    { name: 'autoscroll', values: ['true', 'false'], documentation: 'Scroll frame into view on navigation' },
];

export const STIMULUS_INDEX_VERSION = 1;
export const STIMULUS_INDEX_FILE = 'stimulus-index.json';
