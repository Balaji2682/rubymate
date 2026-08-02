import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { RubyRuntime, buildShellCommand, formatRuntimeStatus } from '../../runtime/rubyRuntime';
import { buildRubyTestCommand } from '../../testExplorer';

suite('Ruby Runtime', () => {
    test('resolves a local context for an explicit cwd', async () => {
        const runtime = new RubyRuntime();
        const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'rubymate-runtime-'));

        const context = await runtime.resolveContext({ cwd });

        assert.strictEqual(context.cwd, cwd);
        assert.strictEqual(context.platform, process.platform);
        assert.ok(context.shell.length > 0);
    });

    test('detects Gemfile presence from the workspace host filesystem', async () => {
        const runtime = new RubyRuntime();
        const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'rubymate-gemfile-'));

        assert.strictEqual(await runtime.hasGemfile({ cwd }), false);

        await fs.writeFile(path.join(cwd, 'Gemfile'), 'source "https://rubygems.org"\n');

        assert.strictEqual(await runtime.hasGemfile({ cwd }), true);
    });

    test('captures stderr and non-zero exit results when allowed', async function() {
        this.timeout(5000);

        if (process.platform === 'win32') {
            this.skip();
        }

        const runtime = new RubyRuntime();
        const result = await runtime.exec('sh', ['-c', 'echo runtime-error >&2; exit 7'], {
            allowNonZeroExit: true
        });

        assert.strictEqual(result.exitCode, 7);
        assert.match(result.stderr, /runtime-error/);
    });

    test('reports command timeout details', async function() {
        this.timeout(5000);

        if (process.platform === 'win32') {
            this.skip();
        }

        const runtime = new RubyRuntime();

        try {
            await runtime.exec('sh', ['-c', 'sleep 1'], { timeout: 10 });
            assert.fail('Expected command to time out');
        } catch (error) {
            const result = (error as { result?: { timedOut?: boolean } }).result;
            assert.strictEqual(result?.timedOut, true);
        }
    });

    test('quotes terminal commands safely', () => {
        const command = buildShellCommand('bundle', ['exec', 'rspec', "/tmp/a file/user's spec.rb:12"], 'linux');

        assert.strictEqual(command, "bundle exec rspec '/tmp/a file/user'\\''s spec.rb:12'");
    });

    test('formats remote runtime status warnings', () => {
        const formatted = formatRuntimeStatus({
            extensionKind: 'ui',
            remoteName: 'ssh-remote',
            workspaceRoot: '/app',
            platform: 'linux',
            shell: '/bin/sh',
            tools: {
                ruby: 'ruby 3.3.0',
                bundle: 'Bundler version 2.5.0',
                rubocop: '1.60.0',
                rails: 'Rails 7.1.0',
                rdbg: 'rdbg 1.9.0',
                rspec: 'RSpec 3.13',
                minitest: '5.20.0',
                rake: '13.1.0',
                gem: '3.5.0'
            },
            warnings: ['RubyMate is running in the UI extension host while the workspace is remote (ssh-remote).']
        });

        assert.match(formatted, /Remote: ssh-remote/);
        assert.match(formatted, /Extension host: ui/);
        assert.match(formatted, /Warnings:/);
    });
});

suite('Ruby Test Command Builder', () => {
    test('builds RSpec file and line commands', () => {
        assert.deepStrictEqual(
            buildRubyTestCommand('/workspace/spec/user_spec.rb', 'does work', 12),
            { tool: 'rspec', args: ['/workspace/spec/user_spec.rb:12'] }
        );
    });

    test('builds Minitest file and test-name commands', () => {
        assert.deepStrictEqual(
            buildRubyTestCommand('/workspace/test/user_test.rb', 'test creates user', 8),
            { tool: 'ruby', args: ['/workspace/test/user_test.rb', '--name', 'test_creates_user'] }
        );
    });
});
