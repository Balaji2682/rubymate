/**
 * Cross-platform Ruby path detection and resolution
 * Supports Windows, macOS, and Linux
 *
 * Supported package managers:
 * - Windows: RubyInstaller, Chocolatey, Scoop, winget, msys2, Cygwin
 * - macOS: Homebrew, MacPorts, pkgsrc
 * - Linux: apt, yum/dnf, pacman, zypper, apk, snap, Nix, Linuxbrew
 *
 * Supported version managers:
 * - rbenv, rvm, asdf, mise, chruby, frum, uru (Windows)
 *
 * Supported Ruby implementations:
 * - MRI/CRuby, JRuby, TruffleRuby
 */

import * as child_process from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as vscode from 'vscode';
import { promisify } from 'util';

const execAsync = promisify(child_process.exec);
const readdirAsync = promisify(fs.readdir);
const statAsync = promisify(fs.stat);
const realpathAsync = promisify(fs.realpath);

export interface RubyInfo {
    path: string;
    version: string;
    source: 'config' | 'auto-detected' | 'path';
}

// Cache for detected Ruby path (session-scoped)
let cachedRubyPath: string | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION_MS = 300000; // 5 minutes

// Cache for WSL detection
let isWSLCached: boolean | null = null;

/**
 * Detect if running inside WSL (Windows Subsystem for Linux)
 */
function isWSL(): boolean {
    if (isWSLCached !== null) {
        return isWSLCached;
    }

    if (process.platform !== 'linux') {
        isWSLCached = false;
        return false;
    }

    try {
        // Check for WSL-specific indicators
        const release = os.release().toLowerCase();
        if (release.includes('microsoft') || release.includes('wsl')) {
            isWSLCached = true;
            return true;
        }

        // Check /proc/version for WSL signature
        if (fs.existsSync('/proc/version')) {
            const version = fs.readFileSync('/proc/version', 'utf8').toLowerCase();
            if (version.includes('microsoft') || version.includes('wsl')) {
                isWSLCached = true;
                return true;
            }
        }

        // Check for WSL interop
        if (fs.existsSync('/proc/sys/fs/binfmt_misc/WSLInterop')) {
            isWSLCached = true;
            return true;
        }
    } catch {
        // Ignore errors
    }

    isWSLCached = false;
    return false;
}

/**
 * Resolve symlinks and normalize path
 * Returns the original path if symlink resolution fails
 */
async function resolvePath(filePath: string): Promise<string> {
    try {
        return await realpathAsync(filePath);
    } catch {
        return filePath;
    }
}

/**
 * Safely check if a path exists (handles permission errors)
 */
function safeExistsSync(filePath: string): boolean {
    try {
        fs.accessSync(filePath, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

/**
 * Dynamically scan a directory for Ruby installations
 * Useful for version managers that install multiple Ruby versions
 */
async function scanDirectoryForRuby(baseDir: string, pattern: RegExp): Promise<string[]> {
    const results: string[] = [];

    try {
        if (!safeExistsSync(baseDir)) {
            return results;
        }

        const entries = await readdirAsync(baseDir);
        for (const entry of entries) {
            if (pattern.test(entry)) {
                const rubyPath = process.platform === 'win32'
                    ? path.join(baseDir, entry, 'bin', 'ruby.exe')
                    : path.join(baseDir, entry, 'bin', 'ruby');

                if (safeExistsSync(rubyPath)) {
                    results.push(rubyPath);
                }
            }
        }

        // Sort by version (newest first) - assumes version is in directory name
        results.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    } catch {
        // Ignore errors (permission denied, etc.)
    }

    return results;
}

/**
 * Get platform-appropriate shell options for child_process.exec
 * Fixes the issue where /bin/bash was hardcoded (doesn't exist on Windows)
 */
export function getShellOptions(): { shell: string } {
    if (process.platform === 'win32') {
        // On Windows, use cmd.exe (COMSPEC env var) or default to cmd.exe
        return { shell: process.env.COMSPEC || 'cmd.exe' };
    }
    // On Unix-like systems, use SHELL env var or fallback to /bin/sh (POSIX standard)
    // Note: /bin/sh is more portable than /bin/bash
    return { shell: process.env.SHELL || '/bin/sh' };
}

/**
 * Get the resolved Ruby executable path
 * Uses caching to avoid repeated filesystem checks
 */
export async function getRubyPath(): Promise<string> {
    // Check cache first
    if (cachedRubyPath && Date.now() - cacheTimestamp < CACHE_DURATION_MS) {
        return cachedRubyPath;
    }

    const rubyInfo = await detectRubyInstallation();
    if (rubyInfo) {
        cachedRubyPath = rubyInfo.path;
        cacheTimestamp = Date.now();
        return rubyInfo.path;
    }

    // Fallback to 'ruby' and let the system resolve it
    return 'ruby';
}

/**
 * Clear the cached Ruby path
 * Call this when rubymate.rubyPath config changes
 */
export function clearRubyPathCache(): void {
    cachedRubyPath = null;
    cacheTimestamp = 0;
}

/**
 * Detect Ruby installation across platforms
 * Returns RubyInfo with path, version, and detection source
 */
export async function detectRubyInstallation(): Promise<RubyInfo | null> {
    // 1. Check user configuration first
    const config = vscode.workspace.getConfiguration('rubymate');
    const configuredPath = config.get<string>('rubyPath', '');

    if (configuredPath && configuredPath !== 'ruby') {
        // Resolve symlinks and expand paths
        const resolvedPath = await resolvePath(configuredPath);
        const validated = await validateRubyPath(resolvedPath);
        if (validated) {
            const version = await getRubyVersion(resolvedPath);
            return {
                path: resolvedPath,
                version: version || 'unknown',
                source: 'config'
            };
        }
    }

    // 2. Try to find Ruby in PATH using platform-appropriate command
    const pathRuby = await findRubyInPath();
    if (pathRuby) {
        const resolvedPath = await resolvePath(pathRuby);
        const version = await getRubyVersion(resolvedPath);
        return {
            path: resolvedPath,
            version: version || 'unknown',
            source: 'path'
        };
    }

    // 3. Check platform-specific common installation paths
    const commonPaths = getCommonRubyPaths();
    for (const rubyPath of commonPaths) {
        if (safeExistsSync(rubyPath)) {
            const validated = await validateRubyPath(rubyPath);
            if (validated) {
                const resolvedPath = await resolvePath(rubyPath);
                const version = await getRubyVersion(resolvedPath);
                return {
                    path: resolvedPath,
                    version: version || 'unknown',
                    source: 'auto-detected'
                };
            }
        }
    }

    // 4. Dynamic scanning for version managers (find newest version)
    const dynamicPaths = await getDynamicRubyPaths();
    for (const rubyPath of dynamicPaths) {
        const validated = await validateRubyPath(rubyPath);
        if (validated) {
            const resolvedPath = await resolvePath(rubyPath);
            const version = await getRubyVersion(resolvedPath);
            return {
                path: resolvedPath,
                version: version || 'unknown',
                source: 'auto-detected'
            };
        }
    }

    return null;
}

/**
 * Get dynamically discovered Ruby paths by scanning version manager directories
 */
async function getDynamicRubyPaths(): Promise<string[]> {
    const homeDir = os.homedir();
    const results: string[] = [];

    // rbenv versions directory
    const rbenvVersions = path.join(homeDir, '.rbenv', 'versions');
    results.push(...await scanDirectoryForRuby(rbenvVersions, /^[\d.]+(-p\d+)?$/));

    // rvm rubies directory
    const rvmRubies = path.join(homeDir, '.rvm', 'rubies');
    results.push(...await scanDirectoryForRuby(rvmRubies, /^ruby-[\d.]+/));

    // asdf Ruby installs
    const asdfRubies = path.join(homeDir, '.asdf', 'installs', 'ruby');
    results.push(...await scanDirectoryForRuby(asdfRubies, /^[\d.]+/));

    // mise Ruby installs
    const miseRubies = path.join(homeDir, '.local', 'share', 'mise', 'installs', 'ruby');
    results.push(...await scanDirectoryForRuby(miseRubies, /^[\d.]+/));

    // chruby/ruby-install
    const chrubyRubies = path.join(homeDir, '.rubies');
    results.push(...await scanDirectoryForRuby(chrubyRubies, /^ruby-[\d.]+/));

    // frum versions
    const frumVersions = path.join(homeDir, '.frum', 'versions');
    results.push(...await scanDirectoryForRuby(frumVersions, /^[\d.]+/));

    // Windows: RubyInstaller dynamic scan
    if (process.platform === 'win32') {
        results.push(...await scanDirectoryForRuby('C:\\', /^Ruby\d+(-x64)?$/i));
    }

    return results;
}

/**
 * Find Ruby executable in system PATH
 */
async function findRubyInPath(): Promise<string | null> {
    try {
        const command = process.platform === 'win32' ? 'where ruby' : 'which ruby';
        const { stdout } = await execAsync(command, {
            ...getShellOptions(),
            timeout: 5000
        });

        const rubyPath = stdout.trim().split('\n')[0]; // Take first result
        if (rubyPath && fs.existsSync(rubyPath)) {
            return rubyPath;
        }
    } catch {
        // Ruby not found in PATH
    }
    return null;
}

/**
 * Get common Ruby installation paths for the current platform
 * Includes support for various package managers and version managers
 */
function getCommonRubyPaths(): string[] {
    const homeDir = os.homedir();
    const paths: string[] = [];

    // Common version managers (cross-platform where applicable)
    const addVersionManagerPaths = () => {
        // rbenv (most popular)
        paths.push(path.join(homeDir, '.rbenv', 'shims', 'ruby'));

        // rvm
        paths.push(path.join(homeDir, '.rvm', 'rubies', 'default', 'bin', 'ruby'));
        paths.push(path.join(homeDir, '.rvm', 'bin', 'ruby'));

        // asdf (multi-language version manager)
        paths.push(path.join(homeDir, '.asdf', 'shims', 'ruby'));

        // mise (formerly rtx, modern alternative to asdf)
        paths.push(path.join(homeDir, '.local', 'share', 'mise', 'shims', 'ruby'));
        paths.push(path.join(homeDir, '.mise', 'shims', 'ruby'));

        // chruby (lightweight version manager)
        // chruby doesn't use shims, it modifies PATH - check common install locations
        paths.push(path.join(homeDir, '.rubies', 'ruby', 'bin', 'ruby'));

        // frum (fast Ruby version manager written in Rust)
        paths.push(path.join(homeDir, '.frum', 'versions', 'default', 'bin', 'ruby'));
        const frumCurrentPath = process.platform === 'win32'
            ? path.join(process.env.APPDATA || '', 'frum', 'versions')
            : path.join(homeDir, '.frum', 'versions');
        paths.push(path.join(frumCurrentPath, 'default', 'bin', process.platform === 'win32' ? 'ruby.exe' : 'ruby'));

        // ruby-install + chruby typical locations
        paths.push(path.join(homeDir, '.rubies', 'ruby-3.3.0', 'bin', 'ruby'));
        paths.push(path.join(homeDir, '.rubies', 'ruby-3.2.0', 'bin', 'ruby'));
        paths.push(path.join(homeDir, '.rubies', 'ruby-3.1.0', 'bin', 'ruby'));

        // Nix package manager
        paths.push(path.join(homeDir, '.nix-profile', 'bin', 'ruby'));
        paths.push('/run/current-system/sw/bin/ruby'); // NixOS system-wide
    };

    switch (process.platform) {
        case 'win32':
            // RubyInstaller default locations (most common on Windows)
            // Check newer versions first
            for (const version of ['34', '33', '32', '31', '30', '27', '26']) {
                paths.push(`C:\\Ruby${version}-x64\\bin\\ruby.exe`);
                paths.push(`C:\\Ruby${version}\\bin\\ruby.exe`);
            }

            // Chocolatey (C:\tools\ruby*)
            const chocoBase = 'C:\\tools';
            for (const version of ['34', '33', '32', '31', '30']) {
                paths.push(path.join(chocoBase, `ruby${version}`, 'bin', 'ruby.exe'));
            }

            // Scoop
            const scoopBase = process.env.SCOOP || path.join(homeDir, 'scoop');
            paths.push(path.join(scoopBase, 'apps', 'ruby', 'current', 'bin', 'ruby.exe'));
            paths.push(path.join(scoopBase, 'shims', 'ruby.exe'));

            // winget (typically installs to Program Files or user profile)
            const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
            const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
            const localAppData = process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');

            for (const version of ['33', '32', '31']) {
                paths.push(path.join(programFiles, `Ruby${version}-x64`, 'bin', 'ruby.exe'));
                paths.push(path.join(programFilesX86, `Ruby${version}`, 'bin', 'ruby.exe'));
            }

            // msys2/mingw (common for native gem compilation)
            paths.push('C:\\msys64\\mingw64\\bin\\ruby.exe');
            paths.push('C:\\msys64\\ucrt64\\bin\\ruby.exe');
            paths.push('C:\\msys64\\usr\\bin\\ruby.exe');

            // Cygwin
            paths.push('C:\\cygwin64\\bin\\ruby.exe');
            paths.push('C:\\cygwin\\bin\\ruby.exe');

            // uru (Ruby version manager for Windows)
            paths.push(path.join(homeDir, '.uru', 'rubies', 'default', 'bin', 'ruby.exe'));

            // pik (legacy Windows Ruby manager)
            paths.push(path.join(homeDir, '.pik', 'rubies', 'default', 'bin', 'ruby.exe'));

            // Add version manager paths
            addVersionManagerPaths();
            break;

        case 'darwin': // macOS
            // Homebrew (Apple Silicon - M1/M2/M3)
            paths.push('/opt/homebrew/opt/ruby/bin/ruby');
            paths.push('/opt/homebrew/bin/ruby');
            // Homebrew versioned rubies
            for (const version of ['3.3', '3.2', '3.1', '3.0']) {
                paths.push(`/opt/homebrew/opt/ruby@${version}/bin/ruby`);
            }

            // Homebrew (Intel Macs)
            paths.push('/usr/local/opt/ruby/bin/ruby');
            paths.push('/usr/local/bin/ruby');
            for (const version of ['3.3', '3.2', '3.1', '3.0']) {
                paths.push(`/usr/local/opt/ruby@${version}/bin/ruby`);
            }

            // MacPorts
            paths.push('/opt/local/bin/ruby');
            for (const version of ['3.3', '3.2', '3.1', '3.0']) {
                paths.push(`/opt/local/bin/ruby${version.replace('.', '')}`);
            }

            // pkgsrc (NetBSD package manager, works on macOS)
            paths.push('/usr/pkg/bin/ruby');

            // Add version manager paths
            addVersionManagerPaths();

            // System Ruby (macOS built-in - usually outdated)
            paths.push('/usr/bin/ruby');
            break;

        case 'linux':
        default:
            // Add version manager paths first (user preference)
            addVersionManagerPaths();

            // Distribution package manager paths
            // Debian/Ubuntu (apt)
            paths.push('/usr/bin/ruby');
            paths.push('/usr/local/bin/ruby');

            // Fedora/RHEL/CentOS (dnf/yum)
            paths.push('/usr/bin/ruby');

            // Arch Linux (pacman)
            paths.push('/usr/bin/ruby');

            // openSUSE (zypper)
            paths.push('/usr/bin/ruby');

            // Alpine Linux (apk)
            paths.push('/usr/bin/ruby');

            // Gentoo (portage)
            paths.push('/usr/bin/ruby');

            // Snap
            paths.push('/snap/bin/ruby');

            // Flatpak (unlikely for Ruby, but check anyway)
            paths.push(path.join(homeDir, '.local', 'share', 'flatpak', 'exports', 'bin', 'ruby'));

            // Linuxbrew/Homebrew on Linux
            paths.push(path.join(homeDir, '.linuxbrew', 'bin', 'ruby'));
            paths.push('/home/linuxbrew/.linuxbrew/bin/ruby');
            paths.push(path.join(homeDir, '.linuxbrew', 'opt', 'ruby', 'bin', 'ruby'));

            // Nix on Linux (in addition to version manager paths)
            paths.push('/nix/var/nix/profiles/default/bin/ruby');

            // Docker/devcontainer common paths
            paths.push('/usr/local/bundle/bin/ruby');

            // JRuby common location
            paths.push('/opt/jruby/bin/jruby');
            paths.push(path.join(homeDir, 'jruby', 'bin', 'jruby'));

            // TruffleRuby
            paths.push('/opt/truffleruby/bin/ruby');
            paths.push(path.join(homeDir, 'truffleruby', 'bin', 'ruby'));

            // WSL-specific: Windows Ruby accessible from WSL
            if (isWSL()) {
                // Windows drives are mounted under /mnt
                for (const version of ['34', '33', '32', '31', '30']) {
                    paths.push(`/mnt/c/Ruby${version}-x64/bin/ruby.exe`);
                    paths.push(`/mnt/c/Ruby${version}/bin/ruby.exe`);
                }
                // Chocolatey in WSL
                paths.push('/mnt/c/tools/ruby33/bin/ruby.exe');
                paths.push('/mnt/c/tools/ruby32/bin/ruby.exe');
                // Scoop in WSL (Windows user profile)
                const windowsUser = process.env.WSLENV?.split(':').find(e => e.startsWith('USERPROFILE'));
                if (windowsUser) {
                    paths.push(`/mnt/c/Users/${path.basename(homeDir)}/scoop/apps/ruby/current/bin/ruby.exe`);
                }
            }
            break;
    }

    // Remove duplicates while preserving order
    return [...new Set(paths)];
}

/**
 * Validate that a Ruby path is executable and working
 */
export async function validateRubyPath(rubyPath: string): Promise<boolean> {
    try {
        // Quote the path to handle spaces
        const quotedPath = process.platform === 'win32'
            ? `"${rubyPath}"`
            : `'${rubyPath.replace(/'/g, "'\\''")}'`;

        await execAsync(`${quotedPath} --version`, {
            ...getShellOptions(),
            timeout: 5000
        });
        return true;
    } catch {
        return false;
    }
}

/**
 * Get Ruby version string from executable
 */
async function getRubyVersion(rubyPath: string): Promise<string | null> {
    try {
        const quotedPath = process.platform === 'win32'
            ? `"${rubyPath}"`
            : `'${rubyPath.replace(/'/g, "'\\''")}'`;

        const { stdout } = await execAsync(`${quotedPath} --version`, {
            ...getShellOptions(),
            timeout: 5000
        });

        // Parse version from output like "ruby 3.2.0 (2022-12-25 revision a528908271) [x86_64-linux]"
        const match = stdout.match(/ruby (\d+\.\d+\.\d+)/);
        return match ? match[1] : stdout.trim();
    } catch {
        return null;
    }
}

/**
 * Get platform-specific Ruby installation instructions
 */
export function getInstallationInstructions(): { message: string; url?: string; command?: string } {
    switch (process.platform) {
        case 'win32':
            return {
                message: 'Install Ruby using RubyInstaller',
                url: 'https://rubyinstaller.org'
            };
        case 'darwin':
            return {
                message: 'Install Ruby using Homebrew',
                command: 'brew install ruby'
            };
        case 'linux':
        default:
            return {
                message: 'Install Ruby using your package manager or rbenv',
                command: 'sudo apt install ruby-full  # Debian/Ubuntu\n# or use rbenv: https://github.com/rbenv/rbenv'
            };
    }
}

/**
 * Show platform-specific installation help dialog
 */
export async function showInstallationHelp(outputChannel?: vscode.OutputChannel): Promise<void> {
    const instructions = getInstallationInstructions();

    const actions: string[] = [];
    if (instructions.url) {
        actions.push('Open Download Page');
    }
    if (instructions.command) {
        actions.push('Copy Command');
    }
    actions.push('Open Settings');

    const selection = await vscode.window.showErrorMessage(
        `Ruby executable not found. ${instructions.message}`,
        ...actions
    );

    if (selection === 'Open Download Page' && instructions.url) {
        vscode.env.openExternal(vscode.Uri.parse(instructions.url));
    } else if (selection === 'Copy Command' && instructions.command) {
        await vscode.env.clipboard.writeText(instructions.command);
        vscode.window.showInformationMessage('Installation command copied to clipboard');
    } else if (selection === 'Open Settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'rubymate.rubyPath');
    }

    if (outputChannel) {
        outputChannel.appendLine('Ruby not found. Checked locations:');
        getCommonRubyPaths().forEach(p => {
            outputChannel.appendLine(`  - ${p}: ${fs.existsSync(p) ? 'exists but invalid' : 'not found'}`);
        });
    }
}
