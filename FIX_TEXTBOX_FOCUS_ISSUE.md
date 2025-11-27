# Textbox Focus Issue Fix - Windows 11 Frameless Window

## Problem
On Windows 11, clicking on textboxes in the Marviano POS app sometimes wouldn't activate them. Users had to Alt+Tab to another app and then back to the POS app before textboxes would become clickable and accept typing.

## Root Cause
This is a known issue with Electron frameless windows (`frame: false`) on Windows 11. The window doesn't automatically receive focus when clicked, especially for input elements, causing them to be non-interactive until the window is explicitly focused.

## Solution Implemented

### 1. **Electron Main Process Changes** (`electron/main.ts`)
   - Added IPC handler `focus-window` that explicitly focuses the main window when requested
   - Changed window focus behavior to always focus on startup (not just in dev mode)
   - The handler also restores the window if it's minimized

### 2. **Preload Script Changes** (`electron/preload.ts`)
   - Added `focusWindow()` method to the electronAPI bridge
   - This allows the renderer process to request window focus from the main process

### 3. **TypeScript Type Definitions** (`src/types/electron.d.ts`)
   - Added type definition for `focusWindow()` method
   - Returns `Promise<{ success: boolean; error?: string }>`

### 4. **React App Changes** (`src/components/WindowFocusHandler.tsx`)
   - Created new global window focus handler component
   - Listens for mousedown events on the entire document
   - Automatically requests window focus from Electron when user clicks
   - Includes debouncing to avoid excessive IPC calls
   - Special handling for input elements - refocuses them after window activation
   - Only runs in Electron environment (not in browser)

### 5. **Layout Integration** (`src/app/layout.tsx`)
   - Added WindowFocusHandler component to the root layout
   - Runs on every page automatically

## How It Works

1. User clicks anywhere in the app
2. WindowFocusHandler detects the mousedown event
3. If window is not focused, it calls `window.electronAPI.focusWindow()`
4. Electron main process receives the request and focuses the window
5. For input elements specifically, the handler refocuses them after a short delay
6. User can now type in the textbox

## Testing the Fix

1. Rebuild the Electron app:
   ```bash
   npm run build
   ```

2. Start the app:
   ```bash
   npm run electron
   ```

3. Test scenarios:
   - Click on various textboxes (payment amounts, custom notes, etc.)
   - Try clicking inputs after the window has been inactive
   - Test with Alt+Tab switching between apps
   - Verify textboxes are immediately interactive without needing Alt+Tab

## Files Modified

- `electron/main.ts` - Added IPC handler and window focus logic
- `electron/preload.ts` - Exposed focusWindow method to renderer
- `src/types/electron.d.ts` - Added TypeScript definitions
- `src/components/WindowFocusHandler.tsx` - NEW: Global focus handler
- `src/app/layout.tsx` - Integrated WindowFocusHandler

## Performance Considerations

- The focus handler includes debouncing (100ms) to prevent excessive IPC calls
- Only activates when window is not focused (tracked via blur/focus events)
- Minimal performance impact as it only responds to user interactions

## Compatibility

- ✅ Windows 11 (primary target)
- ✅ Windows 10
- ✅ macOS (no-op, not needed)
- ✅ Linux (untested but should work)

## Rollback

If issues occur, you can temporarily disable the fix by commenting out this line in `src/app/layout.tsx`:

```tsx
// <WindowFocusHandler />
```

The app will function but the original textbox focus issue will return.

