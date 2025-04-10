# Bookmark Set Manager (v2.0)

An enhanced Chrome extension that allows you to maintain multiple bookmark sets and easily switch between them, with automatic syncing across devices.

## Features

- **Switch between multiple bookmark sets**: Click on any folder from "Other Bookmarks" to set it as your active bookmark bar
- **Automatic syncing**: Any changes you make to your bookmark bar will be saved back to the original folder when you switch
- **Visual indication**: Active bookmark set is highlighted in the extension popup
- **Stability across devices**: Uses a GUID tracking system that works with Chrome Sync
- **Preserves your workflow**: Switch contexts without losing your bookmark organization

## How It Works

1. Each "bookmark set" (folder in Other Bookmarks) gets a unique identifier (GUID)
2. When you switch to a folder, its bookmarks are copied to your Bookmarks Bar
3. A special tracking bookmark is added to both locations to maintain the connection
4. When you switch sets, any changes to your Bookmarks Bar are saved back to the original folder
5. The system works across all your synced Chrome browsers

## Installation

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" in the top-right corner
4. Click "Load unpacked" and select the extension directory
5. The extension icon should now appear in your toolbar

## Usage

1. Click the extension icon in the Chrome toolbar
2. Select a folder to set as your active bookmark bar
3. Add, remove, or modify bookmarks as needed
4. When you want to switch to a different set, click the extension icon again and select another folder
5. Your changes will automatically be saved back to the original folder

## Technical Details

- The extension uses a hidden bookmark with a GUID prefix to track which folder is currently active
- This GUID system ensures that even when your bookmarks sync across devices, the extension can still identify the correct folder
- The tracking bookmark is visible but designed to be unobtrusive (with a 📋 icon)

## Files

- `manifest.json`: Extension configuration
- `popup.html`: UI for the extension popup
- `popup.js`: Enhanced logic for bookmark synchronization and management
- Various icon files

## Changelog from v1.0

- Complete rewrite of the bookmark handling system
- Added bidirectional syncing between bookmark bar and source folders
- Improved UI with active folder highlighting
- New GUID-based tracking system for cross-device stability
- Renamed to "Bookmark Set Manager" to better reflect functionality