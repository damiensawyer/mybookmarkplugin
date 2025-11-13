// Constants for Chrome bookmarks
let BOOKMARKS_BAR_ID = null;
let OTHER_BOOKMARKS_ID = null;
const GUID_PREFIX = 'https://bookmark-tracker.extension/guid/';  // Changed from 'GUID_TRACKER:'

// Dynamically discover bookmark root IDs (Chrome 134+ uses folderType)
const discoverBookmarkRoots = () => {
  return chrome.bookmarks.getTree()
    .then(tree => {
      const roots = tree[0].children || [];

      // Find roots by folderType (Chrome 134+) or by title (fallback)
      for (const node of roots) {
        if (node.folderType === 'bookmarks-bar' || node.title === 'Bookmarks bar' || node.title === 'Bookmarks Bar') {
          BOOKMARKS_BAR_ID = node.id;
          console.log('[Background] Found Bookmarks Bar ID:', BOOKMARKS_BAR_ID);
        } else if (node.folderType === 'other' || node.title === 'Other bookmarks' || node.title === 'Other Bookmarks') {
          OTHER_BOOKMARKS_ID = node.id;
          console.log('[Background] Found Other Bookmarks ID:', OTHER_BOOKMARKS_ID);
        }
      }

      if (!BOOKMARKS_BAR_ID || !OTHER_BOOKMARKS_ID) {
        throw new Error('Could not find bookmark root folders');
      }

      return { bookmarksBarId: BOOKMARKS_BAR_ID, otherBookmarksId: OTHER_BOOKMARKS_ID };
    });
};

// Background script to handle bookmark errors
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed. Setting up error handlers...');

  // Discover bookmark roots first
  discoverBookmarkRoots()
    .then(() => {
      console.log('Bookmark roots discovered successfully');
      // Set up error handling
      setupErrorHandling();
    })
    .catch(error => {
      console.error('Failed to discover bookmark roots:', error);
    });
});

// Set up error handling for bookmarks API
const setupErrorHandling = () => {
  // Listen for errors from content scripts
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'ERROR') {
      console.error('Error in extension:', message.error);
      handleError(message.error);
      sendResponse({handled: true});
    }
  });
  
  console.log('Error handling set up successfully');
};

// Handle errors in the extension
const handleError = (error) => {
  // Check if it's an "Invalid URL" error
  if (error.includes('Invalid URL')) {
    console.warn('Invalid URL error detected. This will be handled in popup.js');
  }
  
  // Log error for debugging
  console.error('Extension error:', error);
};

// Perform a diagnostic check of bookmarks (can be triggered from popup)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'RUN_DIAGNOSTICS') {
    // Ensure bookmark roots are discovered before diagnostics
    const ensureRoots = BOOKMARKS_BAR_ID && OTHER_BOOKMARKS_ID
      ? Promise.resolve()
      : discoverBookmarkRoots();

    ensureRoots
      .then(() => performDiagnostics())
      .then(results => {
        sendResponse({success: true, results});
      })
      .catch(error => {
        sendResponse({success: false, error: error.message});
      });

    // Return true to indicate we'll respond asynchronously
    return true;
  }
});

// Perform diagnostics on the bookmark system
const performDiagnostics = () => {
  return new Promise((resolve, reject) => {
    const diagnostics = {
      bookmarksBarStatus: 'unknown',
      otherBookmarksStatus: 'unknown',
      guidCount: 0,
      errors: []
    };
    
    // Check bookmark bar
    chrome.bookmarks.getSubTree(BOOKMARKS_BAR_ID)
      .then(results => {
        const bookmarksBar = results[0];
        diagnostics.bookmarksBarStatus = 'ok';
        
        // Look for GUID bookmarks
        if (bookmarksBar.children) {
          for (const child of bookmarksBar.children) {
            if (child.url && child.url.startsWith(GUID_PREFIX)) {
              diagnostics.guidCount++;
            }
          }
        }
        
        // Check other bookmarks
        return chrome.bookmarks.getSubTree(OTHER_BOOKMARKS_ID);
      })
      .then(results => {
        const otherBookmarks = results[0];
        diagnostics.otherBookmarksStatus = 'ok';
        
        // Count folders without GUIDs
        let foldersWithoutGuids = 0;
        
        if (otherBookmarks.children) {
          const folders = otherBookmarks.children.filter(node => !node.url);
          
          const folderChecks = folders.map(folder => {
            return new Promise((resolveFolder) => {
              let hasGuid = false;
              
              if (folder.children) {
                for (const child of folder.children) {
                  if (child.url && child.url.startsWith(GUID_PREFIX)) {
                    hasGuid = true;
                    diagnostics.guidCount++;
                    break;
                  }
                }
              }
              
              if (!hasGuid) {
                foldersWithoutGuids++;
              }
              
              resolveFolder();
            });
          });
          
          return Promise.all(folderChecks)
            .then(() => {
              diagnostics.foldersWithoutGuids = foldersWithoutGuids;
              resolve(diagnostics);
            });
        } else {
          resolve(diagnostics);
        }
      })
      .catch(error => {
        diagnostics.errors.push(error.message);
        reject(error);
      });
  });
};