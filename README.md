# Bookmark Folder Copier Chrome Extension

A simple Chrome extension that lets you copy bookmarks from folders in "Other Bookmarks" to your Bookmarks Bar.

## Features

- View a list of all folders in "Other Bookmarks"
- Copy all links from a selected folder (including nested folders/links) to the Bookmarks Bar
- Maintains folder structure
- Clears existing Bookmarks Bar items before copying

## Installation

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" in the top-right corner
4. Click "Load unpacked" and select the extension directory
5. The extension icon should now appear in your toolbar

## Usage

1. Click the extension icon in the Chrome toolbar
2. Select a folder from the list
3. All bookmarks from that folder will be copied to your Bookmarks Bar, preserving the folder structure
4. The Bookmarks Bar will be cleared before copying new bookmarks

## Files

- `manifest.json`: Extension configuration
- `popup.html`: UI for the extension popup
- `popup.js`: Logic for bookmark manipulation
- `icon16.png`, `icon48.png`, `icon128.png`: Extension icons

## Note

You'll need to create placeholder icons (16x16, 48x48, and 128x128 pixels) named `icon16.png`, `icon48.png`, and `icon128.png` or replace the icon references in the manifest with your own icons.