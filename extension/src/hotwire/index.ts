/**
 * Hotwire Stack Support Module
 *
 * Provides IntelliSense, navigation, and documentation for the Hotwire stack:
 * - Stimulus: Controller discovery, data-* attribute completions, go-to-definition
 * - Turbo Streams: Action completions, broadcast helpers
 * - Turbo Frames: HTML attribute completions
 * - Turbo Drive: data-turbo-* attribute completions
 *
 * Optimizations:
 * - Trie for O(k) prefix search on controller names
 * - BloomFilter for O(1) "definitely not a controller" checks
 * - Debounced file watcher to batch rapid changes
 * - Shared HTML context detection with controller-in-scope analysis
 */

export * from './types';
export { StimulusParser } from './stimulusParser';
export { StimulusIndexer } from './stimulusIndexer';
export { StimulusCompletionProvider } from './stimulusCompletionProvider';
export { StimulusDefinitionProvider } from './stimulusDefinitionProvider';
export { TurboCompletionProvider } from './turboCompletionProvider';
export { HotwireHoverProvider } from './hotwireHoverProvider';
export { HtmlContextDetector, htmlContextDetector } from './htmlContextDetector';
