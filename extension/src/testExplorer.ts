import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';

const readFile = promisify(fs.readFile);

interface TestItem {
    id: string;
    label: string;
    uri: vscode.Uri;
    range?: vscode.Range;
    type: 'file' | 'suite' | 'test';
    framework: 'rspec' | 'minitest';
}

export class RubyTestExplorer {
    private testController: vscode.TestController;
    private outputChannel: vscode.OutputChannel;
    private watchers: vscode.FileSystemWatcher[] = [];
    private testFramework: 'rspec' | 'minitest' | 'auto';

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;

        // Create test controller
        this.testController = vscode.tests.createTestController(
            'rubymate-test-controller',
            'Ruby Tests'
        );

        // Get configured test framework
        const config = vscode.workspace.getConfiguration('rubymate');
        this.testFramework = config.get<'rspec' | 'minitest' | 'auto'>('testFramework', 'auto');

        // Set up test item creation and discovery
        this.setupTestController();

        // Initial discovery
        this.discoverTests();
    }

    private setupTestController() {
        // Create run profile for running tests
        this.testController.createRunProfile(
            'Run',
            vscode.TestRunProfileKind.Run,
            (request, token) => this.runTests(request, false, token),
            true
        );

        // Create debug profile for debugging tests
        this.testController.createRunProfile(
            'Debug',
            vscode.TestRunProfileKind.Debug,
            (request, token) => this.runTests(request, true, token),
            true
        );

        // Refresh handler
        this.testController.refreshHandler = () => {
            this.discoverTests();
        };

        // Watch for test file changes
        this.setupFileWatchers();
    }

    private setupFileWatchers() {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        // Watch RSpec files
        const rspecWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(workspaceFolder, '**/*_spec.rb')
        );
        rspecWatcher.onDidChange(uri => this.updateTestsForFile(uri));
        rspecWatcher.onDidCreate(uri => this.updateTestsForFile(uri));
        rspecWatcher.onDidDelete(uri => this.removeTestsForFile(uri));
        this.watchers.push(rspecWatcher);

        // Watch Minitest files
        const minitestWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(workspaceFolder, '**/*_test.rb')
        );
        minitestWatcher.onDidChange(uri => this.updateTestsForFile(uri));
        minitestWatcher.onDidCreate(uri => this.updateTestsForFile(uri));
        minitestWatcher.onDidDelete(uri => this.removeTestsForFile(uri));
        this.watchers.push(minitestWatcher);
    }

    private async discoverTests() {
        this.outputChannel.appendLine('Discovering tests...');

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            this.outputChannel.appendLine('No workspace folder found');
            return;
        }

        // Clear existing tests
        this.testController.items.replace([]);

        // Discover RSpec tests
        if (this.testFramework === 'auto' || this.testFramework === 'rspec') {
            const rspecFiles = await vscode.workspace.findFiles('**/*_spec.rb', '**/node_modules/**');
            for (const file of rspecFiles) {
                await this.parseRSpecFile(file);
            }
        }

        // Discover Minitest tests
        if (this.testFramework === 'auto' || this.testFramework === 'minitest') {
            const minitestFiles = await vscode.workspace.findFiles('**/*_test.rb', '**/node_modules/**');
            for (const file of minitestFiles) {
                await this.parseMinitestFile(file);
            }
        }

        this.outputChannel.appendLine('Test discovery complete');
    }

    private async updateTestsForFile(uri: vscode.Uri) {
        // Remove old tests for this file
        this.removeTestsForFile(uri);

        // Re-parse the file
        if (uri.fsPath.endsWith('_spec.rb')) {
            await this.parseRSpecFile(uri);
        } else if (uri.fsPath.endsWith('_test.rb')) {
            await this.parseMinitestFile(uri);
        }
    }

    private removeTestsForFile(uri: vscode.Uri) {
        // Find and remove test items for this file
        this.testController.items.forEach(item => {
            if (item.uri?.toString() === uri.toString()) {
                this.testController.items.delete(item.id);
            }
        });
    }

    private async parseRSpecFile(uri: vscode.Uri) {
        try {
            const content = await readFile(uri.fsPath, 'utf8');
            const lines = content.split('\n');

            // Create file-level test item
            const fileItem = this.testController.createTestItem(
                uri.toString(),
                path.basename(uri.fsPath),
                uri
            );
            fileItem.canResolveChildren = true;
            this.testController.items.add(fileItem);

            // Parse RSpec examples
            const stack: vscode.TestItem[] = [fileItem];
            let currentIndent = 0;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const trimmed = line.trim();

                // Match describe/context blocks
                const describeMatch = trimmed.match(/^(describe|context)\s+['"](.+?)['"]|^(describe|context)\s+(\S+)/);
                if (describeMatch) {
                    const name = describeMatch[2] || describeMatch[4];
                    const indent = line.search(/\S/);

                    // Adjust stack based on indentation
                    while (stack.length > 1 && indent <= currentIndent) {
                        stack.pop();
                        currentIndent -= 2;
                    }

                    const suiteId = `${uri.toString()}-${i}`;
                    const suiteItem = this.testController.createTestItem(
                        suiteId,
                        name,
                        uri
                    );
                    suiteItem.range = new vscode.Range(i, 0, i, line.length);
                    suiteItem.canResolveChildren = true;

                    stack[stack.length - 1].children.add(suiteItem);
                    stack.push(suiteItem);
                    currentIndent = indent;
                }

                // Match it/specify blocks
                const itMatch = trimmed.match(/^(it|specify)\s+['"](.+?)['"]/);
                if (itMatch) {
                    const name = itMatch[2];
                    const indent = line.search(/\S/);

                    // Adjust stack based on indentation
                    while (stack.length > 1 && indent <= currentIndent) {
                        stack.pop();
                        currentIndent -= 2;
                    }

                    const testId = `${uri.toString()}-${i}`;
                    const testItem = this.testController.createTestItem(
                        testId,
                        name,
                        uri
                    );
                    testItem.range = new vscode.Range(i, 0, i, line.length);

                    stack[stack.length - 1].children.add(testItem);
                }
            }

            this.outputChannel.appendLine(`Parsed RSpec file: ${uri.fsPath}`);
        } catch (error) {
            this.outputChannel.appendLine(`Error parsing RSpec file ${uri.fsPath}: ${error}`);
        }
    }

    private async parseMinitestFile(uri: vscode.Uri) {
        try {
            const content = await readFile(uri.fsPath, 'utf8');
            const lines = content.split('\n');

            // Create file-level test item
            const fileItem = this.testController.createTestItem(
                uri.toString(),
                path.basename(uri.fsPath),
                uri
            );
            fileItem.canResolveChildren = true;
            this.testController.items.add(fileItem);

            // Parse test classes and methods
            let currentClass: vscode.TestItem | null = null;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const trimmed = line.trim();

                // Match test class
                const classMatch = trimmed.match(/^class\s+(\w+)\s*<\s*.*Test/);
                if (classMatch) {
                    const className = classMatch[1];
                    const classId = `${uri.toString()}-class-${i}`;

                    currentClass = this.testController.createTestItem(
                        classId,
                        className,
                        uri
                    );
                    currentClass.range = new vscode.Range(i, 0, i, line.length);
                    currentClass.canResolveChildren = true;
                    fileItem.children.add(currentClass);
                }

                // Match test methods
                const testMatch = trimmed.match(/^def\s+(test_\w+)/);
                if (testMatch && currentClass) {
                    const testName = testMatch[1];
                    const testId = `${uri.toString()}-${i}`;

                    const testItem = this.testController.createTestItem(
                        testId,
                        testName.replace(/_/g, ' '),
                        uri
                    );
                    testItem.range = new vscode.Range(i, 0, i, line.length);
                    currentClass.children.add(testItem);
                }
            }

            this.outputChannel.appendLine(`Parsed Minitest file: ${uri.fsPath}`);
        } catch (error) {
            this.outputChannel.appendLine(`Error parsing Minitest file ${uri.fsPath}: ${error}`);
        }
    }

    private async runTests(
        request: vscode.TestRunRequest,
        debug: boolean,
        token: vscode.CancellationToken
    ) {
        const run = this.testController.createTestRun(request);
        const queue: vscode.TestItem[] = [];

        // Collect all tests to run
        if (request.include) {
            request.include.forEach(test => queue.push(test));
        } else {
            this.testController.items.forEach(test => queue.push(test));
        }

        for (const test of queue) {
            if (token.isCancellationRequested) {
                run.skipped(test);
                continue;
            }

            // Mark as started
            run.started(test);

            try {
                if (debug) {
                    await this.debugTest(test);
                    run.passed(test);
                } else {
                    await this.executeTest(test, run);
                }
            } catch (error) {
                run.failed(test, new vscode.TestMessage(`Test failed: ${error}`));
            }
        }

        run.end();
    }

    private async executeTest(test: vscode.TestItem, run: vscode.TestRun): Promise<void> {
        if (!test.uri) {
            return;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        // Determine if RSpec or Minitest
        const isRSpec = test.uri.fsPath.endsWith('_spec.rb');
        const filePath = test.uri.fsPath;

        let command: string;
        if (isRSpec) {
            // Run specific line if available
            if (test.range) {
                command = `bundle exec rspec ${filePath}:${test.range.start.line + 1}`;
            } else {
                command = `bundle exec rspec ${filePath}`;
            }
        } else {
            // Minitest
            if (test.range && test.label !== path.basename(filePath)) {
                const testName = test.label.replace(/ /g, '_');
                command = `bundle exec ruby ${filePath} --name ${testName}`;
            } else {
                command = `bundle exec ruby ${filePath}`;
            }
        }

        return new Promise((resolve, reject) => {
            const exec = require('child_process').exec;

            exec(command, { cwd: workspaceFolder.uri.fsPath }, (error: any, stdout: string, stderr: string) => {
                const output = stdout + stderr;

                if (error) {
                    // Parse output for failures
                    run.failed(test, new vscode.TestMessage(output));
                    reject(error);
                } else {
                    run.passed(test);
                    resolve();
                }

                // Append to output channel
                this.outputChannel.appendLine(output);
            });
        });
    }

    private async debugTest(test: vscode.TestItem): Promise<void> {
        if (!test.uri) {
            return;
        }

        const isRSpec = test.uri.fsPath.endsWith('_spec.rb');
        const filePath = test.uri.fsPath;

        let debugConfig: vscode.DebugConfiguration;
        if (isRSpec) {
            debugConfig = {
                type: 'ruby',
                request: 'launch',
                name: 'Debug Test',
                program: '${workspaceFolder}/bin/rspec',
                args: test.range
                    ? [`${filePath}:${test.range.start.line + 1}`]
                    : [filePath],
                cwd: '${workspaceFolder}',
                useBundler: true
            };
        } else {
            debugConfig = {
                type: 'ruby',
                request: 'launch',
                name: 'Debug Test',
                program: filePath,
                args: test.label !== path.basename(filePath)
                    ? ['--name', test.label.replace(/ /g, '_')]
                    : [],
                cwd: '${workspaceFolder}',
                useBundler: true
            };
        }

        await vscode.debug.startDebugging(undefined, debugConfig);
    }

    public dispose() {
        this.testController.dispose();
        this.watchers.forEach(watcher => watcher.dispose());
    }
}
