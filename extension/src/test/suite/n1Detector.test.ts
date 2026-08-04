import * as assert from 'assert';
import * as vscode from 'vscode';
import { NPlusOneDetector, N1Issue } from '../../database/n+1Detector';
import { SchemaParser } from '../../database/schemaParser';

/**
 * Behaviour of the N+1 detector's pure analysis (analyzeSource). Runs without a
 * loaded schema, so association detection uses the plural-name heuristic.
 */
suite('RubyMate N+1 Detector', () => {
    let outputChannel: vscode.OutputChannel;
    let detector: NPlusOneDetector;

    const MODEL_PATH = '/app/models/user.rb';

    setup(() => {
        outputChannel = vscode.window.createOutputChannel('RubyMate N+1 Tests');
        detector = new NPlusOneDetector(new SchemaParser(outputChannel));
    });

    teardown(() => {
        outputChannel.dispose();
    });

    const analyze = (src: string, path = MODEL_PATH): N1Issue[] => detector.analyzeSource(src, path);
    const messages = (issues: N1Issue[]): string => issues.map(i => i.message).join(' | ');

    test('commented-out iteration is not flagged', () => {
        const issues = analyze(`
            # users.each do |user|
            #   user.posts.each { |p| p.title }
            # end
        `);
        assert.strictEqual(issues.length, 0, messages(issues));
    });

    test('multiline .includes chain suppresses the warning', () => {
        const issues = analyze(`
            users = User
              .includes(:posts)
              .where(active: true)
            users.each do |user|
              user.posts.size
            end
        `);
        assert.strictEqual(issues.length, 0, messages(issues));
    });

    test('per-row finder inside a loop is flagged', () => {
        const issues = analyze(`
            users.each do |user|
              Post.find_by(user_id: user.id)
            end
        `);
        assert.ok(issues.some(i => i.message.includes('Post.find_by')), messages(issues));
    });

    test('inner if/end does not hide a later association access', () => {
        const issues = analyze(`
            users.each do |user|
              if user.active?
                log(user)
              end
              puts user.comments.size
            end
        `);
        assert.ok(issues.some(i => i.message.includes("accessing 'comments'")), messages(issues));
    });

    test('brace block is analysed', () => {
        const issues = analyze(`
            users.each { |user| Post.where(owner: user).load }
        `);
        assert.ok(issues.some(i => i.message.includes('Post.where')), messages(issues));
    });

    test('Enumerable find on a constant is not treated as a query', () => {
        const issues = analyze(`
            users.each do |user|
              status = STATUSES.find { |s| s == user.state }
            end
        `);
        assert.ok(!messages(issues).includes('STATUSES'), messages(issues));
    });

    test('terminal bulk statement outside a loop is not flagged', () => {
        const issues = analyze(`
            def cleanup
              User.where(active: false).delete_all
            end
        `);
        assert.strictEqual(issues.length, 0, messages(issues));
    });

    test('load-then-count is flagged', () => {
        const issues = analyze(`
            users = User.all.load
            total = users.count
        `);
        assert.ok(issues.some(i => i.message.includes("'.count' on already-loaded")), messages(issues));
    });

    test('file-level disable suppresses everything', () => {
        const issues = analyze(`
            # rubymate:disable-file
            users.each do |user|
              user.posts.size
            end
        `);
        assert.strictEqual(issues.length, 0, messages(issues));
    });

    test('block-level disable suppresses the enclosed range', () => {
        const issues = analyze(`
            # rubymate:disable
            users.each do |user|
              user.posts.size
            end
            # rubymate:enable
        `);
        assert.strictEqual(issues.length, 0, messages(issues));
    });

    test('non-Rails file with no AR indicators is skipped', () => {
        const issues = analyze(`
            items.each do |item|
              item.widgets.size
            end
        `, '/lib/plain_ruby.rb');
        assert.strictEqual(issues.length, 0, messages(issues));
    });
});
