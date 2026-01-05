# RubyMate Keyboard Shortcuts Reference

## Important Note About Shortcuts

**Many keyboard shortcuts were removed** to avoid conflicts with VS Code's default shortcuts. The extension now focuses on providing functionality through:
1. **VS Code's built-in shortcuts** (F12, Ctrl+Click, etc.)
2. **Command Palette** (Ctrl+Shift+P)
3. **Context menus** (right-click)
4. **Custom non-conflicting shortcuts** (Alt+Shift+...)

## Working Shortcuts

### 🎯 Built-in VS Code Shortcuts (Always Work)

These are **standard VS Code shortcuts** that work with RubyMate's features:

| Feature | Shortcut | Alternative |
|---------|----------|-------------|
| **Go to Definition** | `F12` | `Ctrl+Click` or `Cmd+Click` |
| **Peek Definition** | `Alt+F12` | - |
| **Go to Type Definition** | - | Right-click → "Go to Type Definition" |
| **Find All References** | `Shift+F12` | Right-click → "Find All References" |
| **Go Back** | `Alt+Left` | - |
| **Go Forward** | `Alt+Right` | - |
| **Symbol Search (File)** | `Ctrl+Shift+O` | `@` in search |
| **Symbol Search (Workspace)** | `Ctrl+T` | `#` in search |
| **Quick Open File** | `Ctrl+P` | - |
| **Command Palette** | `Ctrl+Shift+P` | `F1` |
| **Problems Panel** | `Ctrl+Shift+M` | - |
| **Format Document** | `Shift+Alt+F` | Right-click → "Format Document" |

### 🆕 RubyMate Custom Shortcuts (Only in Ruby files)

These shortcuts **only work in Ruby files**:

| Feature | Shortcut | Description |
|---------|----------|-------------|
| **Go to Class** | `Alt+Shift+G` | Quick pick to search classes |
| **Navigate to Related** | `Alt+Shift+R` | Find model/controller/view/spec |
| **Toggle Code/Spec** | `Alt+Shift+T` | Switch between code and test |
| **File Structure** | `Alt+Shift+F` | Show current file symbols |
| **Search Everywhere** | `Alt+Shift+S` | Search files and symbols |

## Removed Shortcuts (Conflicted with VS Code)

The following shortcuts were **removed** because they conflicted with VS Code defaults:

| Old Shortcut | Conflicted With | Use Instead |
|--------------|-----------------|-------------|
| `Ctrl+B` | Toggle Sidebar | `F12` (Go to Definition) |
| `Ctrl+Shift+B` | Run Build Task | Right-click → "Go to Type Definition" |
| `Ctrl+N` | New File | `Alt+Shift+G` (Go to Class) |
| `Ctrl+E` | Quick Open | `Ctrl+P` (VS Code Quick Open) |
| `Ctrl+Tab` | Switch Editor | VS Code default works fine |
| `Ctrl+Shift+L` | Add Cursors to Line Ends | `Shift+Alt+F` (Format) |
| `Shift+Shift` | Invalid keybinding | `Ctrl+P` or `Ctrl+T` |

## How to Use Features Without Shortcuts

### Command Palette (Recommended)

Press `Ctrl+Shift+P` or `F1`, then type:

```
# RubyMate commands:
> RubyMate: Go to Class
> RubyMate: Navigate to Related File
> RubyMate: Toggle Between Code and Spec
> RubyMate: File Structure
> RubyMate: Search Everywhere
> RubyMate: Re-index Workspace
> RubyMate: Show Index Statistics

# Rails commands:
> Rails: Navigate to Model
> Rails: Navigate to Controller
> Rails: Navigate to View
> Rails: Show Routes
> Rails: Generate Model
> Rails: Open Console
> Rails: Show Schema

# Database commands:
> Database: Show Schema
> Database: Go to Table Definition
> Database: Reload Schema
```

### Context Menu (Right-click)

Right-click in a Ruby file to access:
- Go to Definition (`F12`)
- Peek Definition (`Alt+F12`)
- Find All References (`Shift+F12`)
- Rename Symbol (`F2`)
- Format Document (`Shift+Alt+F`)

## Feature-Specific Navigation

### 1. Require Statement Navigation

**How it works:**
- Click on any `require "test_helper"`
- Press `F12` or `Ctrl+Click`
- Navigates to the file

**Example:**
```ruby
require "test_helper"   # Click here → F12 → Opens test/test_helper.rb
require_relative "../models/user"  # F12 → Opens the relative file
```

**No special shortcut needed** - uses standard `F12` (Go to Definition)

### 2. Class/Symbol Navigation

**Method 1: Workspace Symbol Search**
```
Ctrl+T → Type class name → Enter
```

**Method 2: RubyMate Go to Class**
```
Alt+Shift+G → Type class name → Enter
```

**Method 3: VS Code Symbol Search**
```
Ctrl+P → Type @ or # → Search
```

### 3. Rails Navigation

**Navigate to Related Files:**
```
Alt+Shift+R → Shows model/controller/view/spec options
```

**Toggle Code/Spec:**
```
Alt+Shift+T → Switches between implementation and test
```

**Or use Command Palette:**
```
Ctrl+Shift+P → Rails: Navigate to Model/Controller/View
```

### 4. File Structure

**Show current file symbols:**
```
Alt+Shift+F
```

**Or use VS Code built-in:**
```
Ctrl+Shift+O → Shows file symbols
```

## VS Code Standard Shortcuts Reference

### Navigation
| Action | Shortcut |
|--------|----------|
| Go to File | `Ctrl+P` |
| Go to Symbol (Workspace) | `Ctrl+T` |
| Go to Symbol (File) | `Ctrl+Shift+O` |
| Go to Line | `Ctrl+G` |
| Go to Definition | `F12` |
| Go to Declaration | - |
| Go to Type Definition | - |
| Peek Definition | `Alt+F12` |
| Show References | `Shift+F12` |
| Go Back | `Alt+Left` |
| Go Forward | `Alt+Right` |

### Editing
| Action | Shortcut |
|--------|----------|
| Format Document | `Shift+Alt+F` |
| Format Selection | `Ctrl+K Ctrl+F` |
| Toggle Comment | `Ctrl+/` |
| Rename Symbol | `F2` |
| Change All Occurrences | `Ctrl+F2` |
| Find | `Ctrl+F` |
| Replace | `Ctrl+H` |
| Find in Files | `Ctrl+Shift+F` |

### Panels
| Action | Shortcut |
|--------|----------|
| Toggle Sidebar | `Ctrl+B` |
| Toggle Terminal | `Ctrl+`` |
| Problems Panel | `Ctrl+Shift+M` |
| Output Panel | `Ctrl+Shift+U` |
| Debug Console | `Ctrl+Shift+Y` |

## Customizing Shortcuts

You can customize any shortcut in VS Code:

1. Press `Ctrl+K Ctrl+S` to open Keyboard Shortcuts
2. Search for "rubymate"
3. Click on the shortcut you want to change
4. Press your desired key combination

### Example: Change Go to Class

1. `Ctrl+K Ctrl+S`
2. Search "RubyMate: Go to Class"
3. Click the `+` icon or existing shortcut
4. Press your preferred key combo (e.g., `Ctrl+Shift+C`)
5. Press Enter

## Recommended Custom Shortcuts

If you want to add your own shortcuts, here are some suggestions that don't conflict:

| Feature | Suggested Shortcut | How to Add |
|---------|-------------------|------------|
| Go to Class | `Ctrl+Shift+C` | Settings → Keybindings → Search "RubyMate: Go to Class" |
| Toggle Spec | `Ctrl+Shift+T` | Search "RubyMate: Toggle Between Code and Spec" |
| Rails Console | `Ctrl+Shift+R` | Search "Rails: Open Console" |

## Platform Differences

### Linux/Windows vs Mac

Replace:
- `Ctrl` → `Cmd` (on Mac)
- `Alt` → `Option` (on Mac)

Example:
- Linux/Windows: `Ctrl+P`
- Mac: `Cmd+P`

## Tips

### 1. Use Command Palette

The Command Palette (`Ctrl+Shift+P`) is the most reliable way to access all features:
- No shortcut conflicts
- Fuzzy search
- Shows all available commands
- Works everywhere

### 2. Mouse Navigation

For `require` statements:
- `Ctrl+Click` (or `Cmd+Click`) on the path
- Or right-click → "Go to Definition"

### 3. Quick Pick Patterns

In quick pick menus, you can use patterns:
- `@` - File symbols
- `#` - Workspace symbols
- `:` - Go to line number
- `>` - Command palette

### 4. Check Conflicts

If a shortcut doesn't work:
1. Press `Ctrl+K Ctrl+S` to open Keyboard Shortcuts
2. Search for the key combination
3. See if multiple commands use it
4. Disable conflicts or choose a different shortcut

## FAQ

### Q: Why were so many shortcuts removed?

**A:** They conflicted with VS Code's default shortcuts, causing issues. For example:
- `Ctrl+B` is "Toggle Sidebar" (used constantly)
- `Ctrl+N` is "New File" (very common)
- `Ctrl+Tab` is "Switch Editor" (core navigation)

Overriding these would break users' muscle memory.

### Q: How do I navigate to `test_helper` now?

**A:** Click on `"test_helper"` in the require statement and press `F12`. This is the standard "Go to Definition" shortcut.

### Q: Can I get the old shortcuts back?

**A:** Yes, but not recommended. Add them manually in Settings → Keyboard Shortcuts. However, they will conflict with VS Code defaults.

### Q: What's the fastest way to navigate?

**A:**
1. For require statements: `Ctrl+Click` or `F12`
2. For classes: `Ctrl+T` (workspace symbols)
3. For files: `Ctrl+P` (quick open)
4. For anything else: `Ctrl+Shift+P` (command palette)

### Q: Why doesn't `Alt+Shift+G` work?

**A:** Make sure:
1. You're in a Ruby file (check bottom right: "Ruby")
2. The extension is activated (check Output → RubyMate)
3. No other extension is using that shortcut

### Q: Can I use Vim/Emacs keybindings?

**A:** Yes! Install the Vim or Emacs Keybindings extension. RubyMate's features will still work through:
- Command palette
- Context menus
- Custom keybindings you set up

## Summary

### ✅ What Works
- All VS Code standard shortcuts (`F12`, `Ctrl+T`, etc.)
- RubyMate custom shortcuts (`Alt+Shift+...`)
- Command Palette for all features
- Context menus
- Mouse navigation (Ctrl+Click)

### ❌ What Doesn't Work
- Old conflicting shortcuts (`Ctrl+B`, `Ctrl+N`, etc.)
- Invalid shortcuts (`Shift+Shift`)

### 💡 Best Practices
1. **Use F12** for "Go to Definition" (works for require statements)
2. **Use Ctrl+T** for finding classes/symbols
3. **Use Ctrl+Shift+P** for RubyMate commands
4. **Customize** shortcuts that fit your workflow
5. **Learn VS Code defaults** - they're well designed!

---

**Quick Reference Card:**

| Need to... | Press | Or |
|------------|-------|-----|
| Go to file in `require` | `F12` | `Ctrl+Click` |
| Find class | `Ctrl+T` | `Alt+Shift+G` |
| Switch code/test | `Alt+Shift+T` | Cmd Palette |
| Find anything | `Ctrl+P` | `Ctrl+Shift+P` |
| Format code | `Shift+Alt+F` | Right-click |
| Show problems | `Ctrl+Shift+M` | - |

**For full RubyMate features, use Command Palette: `Ctrl+Shift+P` → Type "RubyMate"**
