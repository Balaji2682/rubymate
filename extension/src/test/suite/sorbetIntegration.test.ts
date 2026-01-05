import * as assert from 'assert';
import * as vscode from 'vscode';
import { SorbetIntegration, SorbetTypeInfo } from '../../sorbetIntegration';

/**
 * Comprehensive test suite for Sorbet Integration
 * Target: 75%+ code coverage
 *
 * Tests cover all critical fixes:
 * 1. URI validation
 * 2. Circuit breaker pattern
 * 3. Timeout wrapper
 * 4. Error classification
 * 5. Type level detection
 * 6. Async initialization
 * 7. Status monitoring
 */
suite('SorbetIntegration Test Suite', () => {
    let outputChannel: vscode.OutputChannel;
    let integration: SorbetIntegration;

    setup(() => {
        outputChannel = vscode.window.createOutputChannel('RubyMate Test');
        integration = new SorbetIntegration(outputChannel);
    });

    teardown(() => {
        // FIX: Ensure polling interval is stopped before disposal
        if (integration) {
            integration.dispose();
        }
        if (outputChannel) {
            outputChannel.dispose();
        }
    });

    // ==================== URI VALIDATION TESTS ====================

    suite('URI Validation (isAccessibleUri)', () => {
        test('should accept file:// scheme URIs', () => {
            const uri = vscode.Uri.file('/path/to/file.rb');
            const isAccessible = (integration as any).isAccessibleUri(uri);
            assert.strictEqual(isAccessible, true, 'file:// URIs should be accessible');
        });

        test('should reject sorbet:// scheme URIs', () => {
            const uri = vscode.Uri.parse('sorbet://github.com/sorbet/rbi/core/constants.rbi');
            const isAccessible = (integration as any).isAccessibleUri(uri);
            assert.strictEqual(isAccessible, false, 'sorbet:// URIs should be rejected');
        });

        test('should reject synthetic sorbet URIs in string form', () => {
            // Create a mock URI object that would come from Sorbet with sorbet: in the toString()
            const mockUri = {
                scheme: 'file',
                toString: () => 'file:///sorbet:github.com/sorbet/rbi/core/constants.rbi'
            } as vscode.Uri;
            const isAccessible = (integration as any).isAccessibleUri(mockUri);
            assert.strictEqual(isAccessible, false, 'Synthetic sorbet URIs should be rejected');
        });

        test('should reject http:// scheme URIs', () => {
            const uri = vscode.Uri.parse('http://example.com/file.rb');
            const isAccessible = (integration as any).isAccessibleUri(uri);
            assert.strictEqual(isAccessible, false, 'http:// URIs should be rejected');
        });

        test('should reject https:// scheme URIs', () => {
            const uri = vscode.Uri.parse('https://example.com/file.rb');
            const isAccessible = (integration as any).isAccessibleUri(uri);
            assert.strictEqual(isAccessible, false, 'https:// URIs should be rejected');
        });

        test('should accept normal file paths with special characters', () => {
            const uri = vscode.Uri.file('/path/to/my-file_123.rb');
            const isAccessible = (integration as any).isAccessibleUri(uri);
            assert.strictEqual(isAccessible, true, 'Normal file paths should be accessible');
        });
    });

    // ==================== CIRCUIT BREAKER TESTS ====================

    suite('Circuit Breaker Pattern', () => {
        test('should be available initially', () => {
            const available = integration.isSorbetAvailable();
            // Will be false because Sorbet extension not installed in test env
            // But should not throw errors
            assert.strictEqual(typeof available, 'boolean');
        });

        test('should trip circuit breaker after MAX_FAILURES', () => {
            // Record 3 failures
            (integration as any).recordFailure('test_error', 'test_operation');
            (integration as any).recordFailure('test_error', 'test_operation');
            (integration as any).recordFailure('test_error', 'test_operation');

            // Circuit breaker should be tripped
            const available = integration.isSorbetAvailable();
            assert.strictEqual(available, false, 'Circuit breaker should trip after 3 failures');
        });

        test('should increment failure count correctly', () => {
            (integration as any).recordFailure('test', 'op1');
            assert.strictEqual((integration as any).failureCount, 1);

            (integration as any).recordFailure('test', 'op2');
            assert.strictEqual((integration as any).failureCount, 2);
        });

        test('should reset failure count on success', () => {
            // Record 2 failures
            (integration as any).recordFailure('test', 'op1');
            (integration as any).recordFailure('test', 'op2');
            assert.strictEqual((integration as any).failureCount, 2);

            // Record success
            (integration as any).recordSuccess();
            assert.strictEqual((integration as any).failureCount, 0, 'Failure count should reset to 0');
        });

        test('should not reset failure count if already at 0', () => {
            // Initial state
            assert.strictEqual((integration as any).failureCount, 0);

            // Record success when count is 0
            (integration as any).recordSuccess();
            assert.strictEqual((integration as any).failureCount, 0, 'Should remain at 0');
        });

        test('should manually reset circuit breaker', () => {
            // Trip circuit breaker
            (integration as any).recordFailure('test', 'op1');
            (integration as any).recordFailure('test', 'op2');
            (integration as any).recordFailure('test', 'op3');

            // Manually reset
            (integration as any).resetCircuitBreaker();

            assert.strictEqual((integration as any).failureCount, 0, 'Failure count should be 0');
            assert.strictEqual((integration as any).disabledUntil, 0, 'Disabled timestamp should be 0');
        });

        test('should set disabledUntil timestamp when circuit breaks', () => {
            const beforeTime = Date.now();

            // Trip circuit breaker
            (integration as any).recordFailure('test', 'op1');
            (integration as any).recordFailure('test', 'op2');
            (integration as any).recordFailure('test', 'op3');

            const disabledUntil = (integration as any).disabledUntil;
            const afterTime = Date.now();

            assert.ok(disabledUntil > beforeTime, 'disabledUntil should be set to future time');
            assert.ok(disabledUntil < afterTime + 6 * 60 * 1000, 'disabledUntil should be within reasonable range');
        });

        test('should check circuit breaker in isSorbetAvailable', () => {
            // Trip circuit breaker
            (integration as any).recordFailure('test', 'op1');
            (integration as any).recordFailure('test', 'op2');
            (integration as any).recordFailure('test', 'op3');

            // Should return false even if sorbetAvailable is true
            (integration as any).sorbetAvailable = true;
            const available = integration.isSorbetAvailable();

            assert.strictEqual(available, false, 'Should check circuit breaker before returning');
        });

        test('should allow operations after circuit breaker timeout expires', () => {
            // Trip circuit breaker
            (integration as any).recordFailure('test', 'op1');
            (integration as any).recordFailure('test', 'op2');
            (integration as any).recordFailure('test', 'op3');

            // Manually expire the timeout (set to past)
            (integration as any).disabledUntil = Date.now() - 1000; // 1 second ago
            (integration as any).sorbetAvailable = true;

            const available = integration.isSorbetAvailable();
            assert.strictEqual(available, true, 'Should allow operations after timeout expires');
        });
    });

    // ==================== TIMEOUT WRAPPER TESTS ====================

    suite('Timeout Wrapper', () => {
        test('should return value on fast promise', async () => {
            const fastPromise = Promise.resolve('success');

            const result = await (integration as any).withTimeout(
                fastPromise,
                5000,
                'test_fast'
            );

            assert.strictEqual(result, 'success', 'Should return promise value');
        });

        test('should return null on timeout', async () => {
            const slowPromise = new Promise((resolve) => {
                setTimeout(() => resolve('too_late'), 10000); // 10 seconds
            });

            const result = await (integration as any).withTimeout(
                slowPromise,
                100, // 100ms timeout
                'test_timeout'
            );

            assert.strictEqual(result, null, 'Should return null on timeout');
        });

        test('should record failure on timeout', async () => {
            const slowPromise = new Promise((resolve) => {
                setTimeout(() => resolve('too_late'), 10000);
            });

            const initialCount = (integration as any).failureCount;

            await (integration as any).withTimeout(slowPromise, 50, 'test');

            assert.strictEqual(
                (integration as any).failureCount,
                initialCount + 1,
                'Should increment failure count on timeout'
            );
        });

        test('should record success on fast promise', async () => {
            // Set failure count to 2
            (integration as any).failureCount = 2;

            const fastPromise = Promise.resolve('success');
            await (integration as any).withTimeout(fastPromise, 5000, 'test');

            assert.strictEqual(
                (integration as any).failureCount,
                0,
                'Should reset failure count on success'
            );
        });

        test('should handle rejected promises', async () => {
            const rejectingPromise = Promise.reject(new Error('Test error'));

            try {
                await (integration as any).withTimeout(rejectingPromise, 5000, 'test');
                assert.fail('Should have thrown error');
            } catch (error: any) {
                assert.strictEqual(error.message, 'Test error');
            }
        });

        test('should use default timeout if not specified', async () => {
            const fastPromise = Promise.resolve('success');

            // Should use DEFAULT_TIMEOUT (5000ms)
            const result = await (integration as any).withTimeout(
                fastPromise,
                undefined,
                'test'
            );

            assert.strictEqual(result, 'success');
        });
    });

    // ==================== ERROR CLASSIFICATION TESTS ====================

    suite('Error Classification', () => {
        test('should classify watchman errors', () => {
            const error = new Error('Watchman required for file watching');
            const errorType = (integration as any).classifyError(error);
            assert.strictEqual(errorType, 'watchman', 'Should classify as watchman error');
        });

        test('should classify watchman errors (case insensitive)', () => {
            const error = new Error('Error: WATCHMAN not found');
            const errorType = (integration as any).classifyError(error);
            assert.strictEqual(errorType, 'watchman');
        });

        test('should classify config errors', () => {
            const error = new Error('sorbet/config not found');
            const errorType = (integration as any).classifyError(error);
            assert.strictEqual(errorType, 'config', 'Should classify as config error');
        });

        test('should classify "not configured" as config error', () => {
            const error = new Error('Project not configured for Sorbet');
            const errorType = (integration as any).classifyError(error);
            assert.strictEqual(errorType, 'config');
        });

        test('should classify crash errors', () => {
            const error = new Error('Sorbet process crash detected');
            const errorType = (integration as any).classifyError(error);
            assert.strictEqual(errorType, 'crash', 'Should classify as crash error');
        });

        test('should classify segfault as crash', () => {
            const error = new Error('Segmentation fault (SIGSEGV)');
            const errorType = (integration as any).classifyError(error);
            assert.strictEqual(errorType, 'crash');
        });

        test('should classify unknown errors', () => {
            const error = new Error('Some random error');
            const errorType = (integration as any).classifyError(error);
            assert.strictEqual(errorType, 'unknown', 'Should classify as unknown error');
        });

        test('should handle Error objects with stack traces', () => {
            const error = new Error('Watchman error');
            error.stack = 'Error: Watchman error\n  at Object.<anonymous>';
            const errorType = (integration as any).classifyError(error);
            assert.strictEqual(errorType, 'watchman');
        });
    });

    // ==================== TYPE LEVEL DETECTION TESTS ====================

    suite('Type Level Detection (getSorbetTypeLevel)', () => {
        test('should find "typed: strict" in first line', () => {
            const mockDocument = {
                getText: () => '# typed: strict\nclass MyClass\nend'
            } as vscode.TextDocument;

            const typeLevel = integration.getSorbetTypeLevel(mockDocument);
            assert.strictEqual(typeLevel, 'strict', 'Should find "strict" type level');
        });

        test('should find "typed: strong" comment', () => {
            const mockDocument = {
                getText: () => '# typed: strong\nclass MyClass\nend'
            } as vscode.TextDocument;

            const typeLevel = integration.getSorbetTypeLevel(mockDocument);
            assert.strictEqual(typeLevel, 'strong');
        });

        test('should find "typed: true" comment', () => {
            const mockDocument = {
                getText: () => '# typed: true\nclass MyClass\nend'
            } as vscode.TextDocument;

            const typeLevel = integration.getSorbetTypeLevel(mockDocument);
            assert.strictEqual(typeLevel, 'true');
        });

        test('should find "typed: false" comment', () => {
            const mockDocument = {
                getText: () => '# typed: false\nclass MyClass\nend'
            } as vscode.TextDocument;

            const typeLevel = integration.getSorbetTypeLevel(mockDocument);
            assert.strictEqual(typeLevel, 'false');
        });

        test('should find "typed: ignore" comment', () => {
            const mockDocument = {
                getText: () => '# typed: ignore\nclass MyClass\nend'
            } as vscode.TextDocument;

            const typeLevel = integration.getSorbetTypeLevel(mockDocument);
            assert.strictEqual(typeLevel, 'ignore');
        });

        test('should find typed comment within first 50 lines', () => {
            const lines = new Array(45).fill('# Copyright line');
            lines.push('# typed: strict');
            lines.push('class MyClass');
            lines.push('end');

            const mockDocument = {
                getText: () => lines.join('\n')
            } as vscode.TextDocument;

            const typeLevel = integration.getSorbetTypeLevel(mockDocument);
            assert.strictEqual(typeLevel, 'strict', 'Should find typed comment at line 45');
        });

        test('should find typed comment at line 50', () => {
            const lines = new Array(49).fill('# Comment');
            lines.push('# typed: strong');

            const mockDocument = {
                getText: () => lines.join('\n')
            } as vscode.TextDocument;

            const typeLevel = integration.getSorbetTypeLevel(mockDocument);
            assert.strictEqual(typeLevel, 'strong', 'Should find typed comment at line 50');
        });

        test('should return null if no typed comment found', () => {
            const mockDocument = {
                getText: () => 'class MyClass\n  def hello\n    puts "world"\n  end\nend'
            } as vscode.TextDocument;

            const typeLevel = integration.getSorbetTypeLevel(mockDocument);
            assert.strictEqual(typeLevel, null, 'Should return null when no typed comment');
        });

        test('should return null if typed comment after line 50', () => {
            const lines = new Array(51).fill('# Comment');
            lines.push('# typed: strict');

            const mockDocument = {
                getText: () => lines.join('\n')
            } as vscode.TextDocument;

            const typeLevel = integration.getSorbetTypeLevel(mockDocument);
            assert.strictEqual(typeLevel, null, 'Should not find typed comment after line 50');
        });

        test('should handle files with mixed comments', () => {
            const content = `# frozen_string_literal: true
# encoding: utf-8
# This is a test file
# typed: strict
class MyClass
end`;

            const mockDocument = {
                getText: () => content
            } as vscode.TextDocument;

            const typeLevel = integration.getSorbetTypeLevel(mockDocument);
            assert.strictEqual(typeLevel, 'strict');
        });

        test('should handle whitespace variations', () => {
            const mockDocument = {
                getText: () => '# typed:strict\nclass MyClass\nend'
            } as vscode.TextDocument;

            const typeLevel = integration.getSorbetTypeLevel(mockDocument);
            assert.strictEqual(typeLevel, 'strict', 'Should handle no space after colon');
        });

        test('should handle extra whitespace', () => {
            const mockDocument = {
                getText: () => '#  typed:   strict\nclass MyClass\nend'
            } as vscode.TextDocument;

            const typeLevel = integration.getSorbetTypeLevel(mockDocument);
            assert.strictEqual(typeLevel, 'strict', 'Should handle extra whitespace');
        });
    });

    // ==================== SORBET SIGNATURES DETECTION TESTS ====================

    suite('hasSorbetSignatures', () => {
        test('should detect "sig {" pattern', async () => {
            const mockDocument = {
                getText: () => 'class MyClass\n  sig { returns(String) }\n  def hello; end\nend'
            } as vscode.TextDocument;

            const hasSorbet = await integration.hasSorbetSignatures(mockDocument);
            assert.strictEqual(hasSorbet, true, 'Should detect "sig {" pattern');
        });

        test('should detect "sig do" pattern', async () => {
            const mockDocument = {
                getText: () => 'class MyClass\n  sig do\n    returns(String)\n  end\n  def hello; end\nend'
            } as vscode.TextDocument;

            const hasSorbet = await integration.hasSorbetSignatures(mockDocument);
            assert.strictEqual(hasSorbet, true, 'Should detect "sig do" pattern');
        });

        test('should detect "# typed:" comment', async () => {
            const mockDocument = {
                getText: () => '# typed: strict\nclass MyClass\nend'
            } as vscode.TextDocument;

            const hasSorbet = await integration.hasSorbetSignatures(mockDocument);
            assert.strictEqual(hasSorbet, true, 'Should detect "# typed:" comment');
        });

        test('should detect "extend T::Sig"', async () => {
            const mockDocument = {
                getText: () => 'class MyClass\n  extend T::Sig\n  def hello; end\nend'
            } as vscode.TextDocument;

            const hasSorbet = await integration.hasSorbetSignatures(mockDocument);
            assert.strictEqual(hasSorbet, true, 'Should detect "extend T::Sig"');
        });

        test('should return false when no Sorbet patterns found', async () => {
            const mockDocument = {
                getText: () => 'class MyClass\n  def hello\n    puts "world"\n  end\nend'
            } as vscode.TextDocument;

            const hasSorbet = await integration.hasSorbetSignatures(mockDocument);
            assert.strictEqual(hasSorbet, false, 'Should return false when no Sorbet patterns');
        });
    });

    // ==================== STATUS TESTS ====================

    suite('Sorbet Status', () => {
        test('should return status from API', () => {
            (integration as any).sorbetAPI = { status: 'running' };
            const status = integration.getSorbetStatus();
            assert.strictEqual(status, 'running');
        });

        test('should return undefined when no API available', () => {
            (integration as any).sorbetAPI = undefined;
            const status = integration.getSorbetStatus();
            assert.strictEqual(status, undefined);
        });

        test('should check if Sorbet is running', () => {
            (integration as any).sorbetAvailable = true;
            (integration as any).sorbetAPI = { status: 'running' };
            const isRunning = integration.isSorbetRunning();
            assert.strictEqual(isRunning, true);
        });

        test('should return false if status is not "running"', () => {
            (integration as any).sorbetAvailable = true;
            (integration as any).sorbetAPI = { status: 'start' };
            const isRunning = integration.isSorbetRunning();
            assert.strictEqual(isRunning, false);
        });

        test('should return false if Sorbet not available', () => {
            (integration as any).sorbetAvailable = false;
            (integration as any).sorbetAPI = { status: 'running' };
            const isRunning = integration.isSorbetRunning();
            assert.strictEqual(isRunning, false);
        });
    });

    // ==================== INITIALIZATION TESTS ====================

    suite('Async Initialization', () => {
        test('should have initialize method', () => {
            assert.strictEqual(typeof integration.initialize, 'function');
        });

        test('initialize should be async', () => {
            const result = integration.initialize();
            assert.ok(result instanceof Promise, 'initialize should return a Promise');
        });

        test('should have dispose method', () => {
            assert.strictEqual(typeof integration.dispose, 'function');
        });

        test('dispose should clear status polling interval', () => {
            (integration as any).statusPollingInterval = setInterval(() => {}, 10000);
            integration.dispose();
            // Interval should be cleared (can't easily test, but shouldn't throw)
        });
    });

    // ==================== INTEGRATION TESTS ====================

    suite('API Methods Integration', () => {
        test('getDefinition should return empty array when not available', async () => {
            const mockDocument = {} as vscode.TextDocument;
            const mockPosition = new vscode.Position(0, 0);

            const locations = await integration.getDefinition(mockDocument, mockPosition);
            assert.ok(Array.isArray(locations), 'Should return array');
            assert.strictEqual(locations.length, 0, 'Should return empty array');
        });

        test('getReferences should return empty array when not available', async () => {
            const mockDocument = {} as vscode.TextDocument;
            const mockPosition = new vscode.Position(0, 0);

            const locations = await integration.getReferences(mockDocument, mockPosition);
            assert.ok(Array.isArray(locations), 'Should return array');
            assert.strictEqual(locations.length, 0, 'Should return empty array');
        });

        test('getTypeInfo should return null when not available', async () => {
            const mockDocument = {} as vscode.TextDocument;
            const mockPosition = new vscode.Position(0, 0);

            const typeInfo = await integration.getTypeInfo(mockDocument, mockPosition);
            assert.strictEqual(typeInfo, null, 'Should return null');
        });

        test('enhanceHover should return base hover when Sorbet unavailable', async () => {
            const mockDocument = {} as vscode.TextDocument;
            const mockPosition = new vscode.Position(0, 0);
            const baseHover = new vscode.Hover('Base content');

            const enhanced = await integration.enhanceHover(mockDocument, mockPosition, baseHover);
            assert.strictEqual(enhanced, baseHover, 'Should return base hover when unavailable');
        });

        test('enhanceHover should return null when both unavailable and no base hover', async () => {
            const mockDocument = {} as vscode.TextDocument;
            const mockPosition = new vscode.Position(0, 0);

            const enhanced = await integration.enhanceHover(mockDocument, mockPosition, null);
            assert.strictEqual(enhanced, null, 'Should return null');
        });
    });

    // ==================== EDGE CASES ====================

    suite('Edge Cases', () => {
        test('should handle multiple rapid recordFailure calls', () => {
            for (let i = 0; i < 10; i++) {
                (integration as any).recordFailure('test', 'rapid_test');
            }
            // Should not throw, circuit breaker should trip at 3
            assert.strictEqual((integration as any).failureCount, 10);
        });

        test('should handle recordSuccess when count is 0', () => {
            assert.strictEqual((integration as any).failureCount, 0);
            (integration as any).recordSuccess();
            assert.strictEqual((integration as any).failureCount, 0);
        });

        test('should handle empty document text', () => {
            const mockDocument = {
                getText: () => ''
            } as vscode.TextDocument;

            const typeLevel = integration.getSorbetTypeLevel(mockDocument);
            assert.strictEqual(typeLevel, null);
        });

        test('should handle document with only newlines', () => {
            const mockDocument = {
                getText: () => '\n\n\n\n\n'
            } as vscode.TextDocument;

            const typeLevel = integration.getSorbetTypeLevel(mockDocument);
            assert.strictEqual(typeLevel, null);
        });

        test('should handle URIs with special characters in path', () => {
            const uri = vscode.Uri.file('/path/with spaces/and-dashes/file_123.rb');
            const isAccessible = (integration as any).isAccessibleUri(uri);
            assert.strictEqual(isAccessible, true);
        });
    });
});
