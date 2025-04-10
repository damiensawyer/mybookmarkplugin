// Constants for Chrome bookmarks
const BOOKMARKS_BAR_ID = '1';
const OTHER_BOOKMARKS_ID = '2';
const GUID_PREFIX = 'https://bookmark-tracker.extension/guid/';

// DOM elements
const foldersContainer = document.getElementById('folders');
const statusElement = document.getElementById('status');

// Global state
let activeFolderGuid = null;

// Initialize the popup
document.addEventListener('DOMContentLoaded', () => {
  performHealthCheck()
    .catch(error => {
      console.error('Error during health check:', error);
      statusElement.textContent = `Error during health check: ${error.message}`;
      // Try recovery
      return recoverFromErrors();
    })
    .then(() => checkActiveFolder())
    .catch(error => {
      console.error('Error checking active folder:', error);
      statusElement.textContent = `Error checking active folder: ${error.message}`;
      // We can continue without active folder
    })
    .then(() => loadFolders())
    .catch(error => {
      console.error('Error loading folders:', error);
      statusElement.textContent = `Error loading folders: ${error.message}`;
      // Show a simplified UI if we can't load folders
      foldersContainer.innerHTML = '<p>Error loading folders. Please try restarting the extension.</p>';
    });
});

// Perform health check to ensure extension integrity
const performHealthCheck = () => {
  console.log('Performing health check...');
  
  // First, ensure all folders in Other Bookmarks have GUID trackers
  return ensureAllFoldersHaveGuids()
    .then(() => {
      // Then, ensure bookmark bar has a GUID tracker
      return ensureBookmarkBarHasGuid();
    });
};

// Ensure all folders in Other Bookmarks have GUID trackers
const ensureAllFoldersHaveGuids = () => {
  return chrome.bookmarks.getSubTree(OTHER_BOOKMARKS_ID)
    .then(results => {
      const otherBookmarks = results[0];
      
      // Get all folders within Other Bookmarks
      const folders = otherBookmarks.children?.filter(node => !node.url) || [];
      
      // For each folder, ensure it has a GUID
      return Promise.all(folders.map(folder => getOrCreateFolderGuid(folder.id)));
    });
};

// Ensure bookmark bar has a GUID tracker, if not create one with a new folder
const ensureBookmarkBarHasGuid = () => {
  return chrome.bookmarks.getSubTree(BOOKMARKS_BAR_ID)
    .then(results => {
      const bookmarksBar = results[0];
      
      // Look for GUID bookmark
      return findGuidBookmark(bookmarksBar)
        .then(guid => {
          if (!guid) {
            console.log('No GUID found in bookmark bar, creating a default folder...');
            // No GUID found, create a default folder and set it as active
            return createDefaultFolder()
              .then(folderId => {
                return getOrCreateFolderGuid(folderId)
                  .then(guid => {
                    // Add the GUID bookmark to the bookmark bar
                    return chrome.bookmarks.create({
                      parentId: BOOKMARKS_BAR_ID,
                      title: '📋 Automatically Created',
                      url: GUID_PREFIX + guid
                    })
                    .then(() => guid);
                  });
              });
          }
          return guid;
        });
    });
};

// Add error recovery function to the initialization process
const recoverFromErrors = () => {
  console.log('Attempting to recover from initialization errors...');
  
  return new Promise((resolve) => {
    // Find and fix any invalid URLs in bookmark bar
    chrome.bookmarks.getSubTree(BOOKMARKS_BAR_ID)
      .then(results => {
        const bookmarksBar = results[0];
        
        if (bookmarksBar.children) {
          const fixPromises = bookmarksBar.children.map(child => {
            if (child.url && !isValidUrl(child.url)) {
              console.log(`Fixing invalid URL in bookmark bar: ${child.title}`);
              return fixInvalidBookmark(child);
            }
            return Promise.resolve();
          });
          
          return Promise.all(fixPromises);
        }
      })
      .then(() => {
        // Also check Other Bookmarks
        return chrome.bookmarks.getSubTree(OTHER_BOOKMARKS_ID);
      })
      .then(results => {
        const otherBookmarks = results[0];
        
        if (otherBookmarks.children) {
          const folders = otherBookmarks.children.filter(node => !node.url);
          
          const folderPromises = folders.map(folder => {
            if (folder.children) {
              const fixPromises = folder.children.map(child => {
                if (child.url && !isValidUrl(child.url)) {
                  console.log(`Fixing invalid URL in ${folder.title}: ${child.title}`);
                  return fixInvalidBookmark(child);
                }
                return Promise.resolve();
              });
              
              return Promise.all(fixPromises);
            }
            return Promise.resolve();
          });
          
          return Promise.all(folderPromises);
        }
      })
      .then(() => {
        console.log('Recovery process completed');
        resolve();
      })
      .catch(error => {
        console.error('Error during recovery:', error);
        resolve(); // Continue despite errors
      });
  });
};

// Check if a URL is valid
const isValidUrl = (url) => {
  try {
    new URL(url);
    return true;
  } catch (error) {
    return false;
  }
};

// Fix an invalid bookmark
const fixInvalidBookmark = (bookmark) => {
  const safeUrl = 'about:blank#invalid-' + encodeURIComponent(bookmark.url || '');
  return chrome.bookmarks.update(bookmark.id, {
    title: bookmark.title + ' [INVALID URL]',
    url: safeUrl
  }).catch(err => console.error('Error fixing invalid bookmark:', err));
};

// Create a default folder for automatically created bookmark sets
const createDefaultFolder = () => {
  return chrome.bookmarks.create({
    parentId: OTHER_BOOKMARKS_ID,
    title: 'Automatically Created'
  })
  .then(newFolder => {
    console.log('Created default folder:', newFolder.title);
    
    // Copy current bookmark bar contents to this folder
    return chrome.bookmarks.getSubTree(BOOKMARKS_BAR_ID)
      .then(results => {
        const bookmarksBar = results[0];
        let bookmarks = [];
        
        if (bookmarksBar.children) {
          for (const child of bookmarksBar.children) {
            if (child.url && !child.url.startsWith(GUID_PREFIX)) {
              bookmarks.push({
                url: child.url,
                title: child.title
              });
            }
          }
        }
        
        // Add bookmarks to the new folder
        return Promise.all(bookmarks.map(bookmark => {
          return chrome.bookmarks.create({
            parentId: newFolder.id,
            title: bookmark.title,
            url: bookmark.url
          });
        }))
        .then(() => newFolder.id);
      });
  });
};

// Load all folders from "Other Bookmarks"
const loadFolders = () => {
  chrome.bookmarks.getSubTree(OTHER_BOOKMARKS_ID, (results) => {
    const otherBookmarks = results[0];
    
    // Get all folders within Other Bookmarks
    const folders = otherBookmarks.children?.filter(node => !node.url) || [];
    
    if (folders.length === 0) {
      foldersContainer.innerHTML = '<p>No folders found in Other Bookmarks</p>';
      return;
    }
    
    // Create folder elements
    const folderElements = folders.map(folder => {
      const element = document.createElement('div');
      element.className = 'folder';
      element.textContent = folder.title;
      
      // Check if this is the active folder
      getOrCreateFolderGuid(folder.id)
        .then(guid => {
          if (guid === activeFolderGuid) {
            element.classList.add('active');
          }
        });
      
      element.addEventListener('click', () => switchToFolder(folder.id));
      return element;
    });
    
    // Add folders to the container
    folderElements.forEach(element => foldersContainer.appendChild(element));
  });
};

// Check if there's an active folder in the bookmark bar
const checkActiveFolder = () => {
  return chrome.bookmarks.getSubTree(BOOKMARKS_BAR_ID)
    .then(results => {
      const bookmarksBar = results[0];
      
      // Look for GUID bookmark
      return findGuidBookmark(bookmarksBar);
    })
    .then(guid => {
      if (guid) {
        activeFolderGuid = guid;
        console.log('Active folder GUID:', activeFolderGuid);
      }
    });
};

// Find GUID bookmark within a folder
const findGuidBookmark = (folder) => {
  if (!folder.children || folder.children.length === 0) {
    return Promise.resolve(null);
  }
  
  for (const child of folder.children) {
    if (child.url) {
      // Check if it uses the new format
      if (child.url.startsWith(GUID_PREFIX)) {
        return Promise.resolve(child.url.substring(GUID_PREFIX.length));
      }
      
      // Check for legacy format (for backward compatibility)
      if (child.url.startsWith('GUID_TRACKER:')) {
        const guid = child.url.substring('GUID_TRACKER:'.length);
        
        // Update to the new format
        chrome.bookmarks.update(child.id, {
          url: GUID_PREFIX + guid
        }).catch(err => console.error('Error updating legacy GUID format:', err));
        
        return Promise.resolve(guid);
      }
    }
  }
  
  return Promise.resolve(null);
};

// Get or create a GUID for a folder
const getOrCreateFolderGuid = (folderId) => {
  return chrome.bookmarks.getSubTree(folderId)
    .then(results => {
      const folder = results[0];
      
      // Look for existing GUID bookmark
      return findGuidBookmark(folder)
        .then(guid => {
          if (guid) {
            return guid;
          }
          
          // No GUID found, create a new one
          const newGuid = generateGuid();
          
          // Create GUID bookmark in the folder
          return chrome.bookmarks.create({
            parentId: folderId,
            title: '📋 Bookmark Bar Config',
            url: GUID_PREFIX + newGuid
          })
          .then(() => newGuid);
        });
    });
};

// Generate a GUID
const generateGuid = () => {
  // This creates a version 4 UUID (random)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

// Helper function to add diagnostics to the status element
const addDiagnosticMessage = (message) => {
  console.log(message);
  if (statusElement.textContent) {
    statusElement.textContent += '\n' + message;
  } else {
    statusElement.textContent = message;
  }
};

// Switch to a new bookmark folder
const switchToFolder = (newFolderId) => {
  // If there's an active folder, save its state first
  if (activeFolderGuid) {
    saveActiveBookmarksState()
      .then(() => setNewActiveFolder(newFolderId))
      .catch(error => {
        statusElement.textContent = `Error saving current bookmarks: ${error.message}`;
        console.error('Error saving bookmarks:', error);
      });
  } else {
    // No active folder, just set the new one
    setNewActiveFolder(newFolderId);
  }
};

// Save current bookmark bar state back to the original folder
const saveActiveBookmarksState = () => {
  return chrome.bookmarks.getSubTree(BOOKMARKS_BAR_ID)
    .then(results => {
      const bookmarksBar = results[0];
      const currentBookmarks = [];
      
      // Skip the GUID bookmark
      if (bookmarksBar.children) {
        for (const child of bookmarksBar.children) {
          if (child.url && !child.url.startsWith(GUID_PREFIX)) {
            currentBookmarks.push({
              url: child.url,
              title: child.title
            });
          }
        }
      }
      
      // Find the original folder with the active GUID
      return findFolderByGuid(activeFolderGuid)
        .then(folderId => {
          if (!folderId) {
            throw new Error('Original folder not found');
          }
          
          // Clear and update the original folder
          return chrome.bookmarks.getSubTree(folderId)
            .then(results => {
              const folder = results[0];
              return clearFolderExceptGuid(folder)
                .then(() => addBookmarksToFolder(currentBookmarks, folderId));
            });
        });
    });
};

// Find a folder by its GUID
const findFolderByGuid = (guid) => {
  // This will search in Other Bookmarks for a folder containing the GUID
  return chrome.bookmarks.getSubTree(OTHER_BOOKMARKS_ID)
    .then(results => {
      const otherBookmarks = results[0];
      
      if (!otherBookmarks.children) {
        return null;
      }
      
      // Only check folders
      const folders = otherBookmarks.children.filter(node => !node.url);
      
      // Check each folder for the GUID
      return Promise.all(folders.map(folder => {
        return findGuidBookmark(folder)
          .then(folderGuid => {
            if (folderGuid === guid) {
              return folder.id;
            }
            return null;
          });
      }))
      .then(results => {
        // Filter out nulls and return the first match
        const matches = results.filter(id => id !== null);
        return matches.length > 0 ? matches[0] : null;
      });
    });
};

// Clear a folder except for the GUID bookmark
const clearFolderExceptGuid = (folder) => {
  if (!folder.children || folder.children.length === 0) {
    return Promise.resolve();
  }
  
  const removePromises = [];
  
  for (const child of folder.children) {
    if (!child.url || !child.url.startsWith(GUID_PREFIX)) {
      removePromises.push(
        child.children && child.children.length > 0
          ? chrome.bookmarks.removeTree(child.id)
          : chrome.bookmarks.remove(child.id)
      );
    }
  }
  
  return Promise.all(removePromises);
};

// Add bookmarks to a folder
const addBookmarksToFolder = (bookmarks, folderId) => {
  // Process bookmarks one by one
  return bookmarks.reduce((promise, bookmark) => {
    return promise.then(() => {
      return createBookmarkSafely(
        folderId,
        bookmark.title,
        bookmark.url
      );
    });
  }, Promise.resolve());
};

// Set a new active folder
const setNewActiveFolder = (folderId) => {
  getOrCreateFolderGuid(folderId)
    .then(guid => {
      activeFolderGuid = guid;
      
      // Get all bookmarks in the selected folder
      return getAllBookmarksInFolder(folderId)
        .then(newBookmarks => {
          // Clear the bookmarks bar and add the new bookmarks
          return chrome.bookmarks.getSubTree(BOOKMARKS_BAR_ID)
            .then(results => {
              const bookmarksBar = results[0];
              return clearBookmarksBar(bookmarksBar)
                .then(() => {
                  // Add the GUID bookmark to the bookmark bar
                  return getShortName(folderId)
                    .then(folderName => {
                      return chrome.bookmarks.create({
                        parentId: BOOKMARKS_BAR_ID,
                        title: '📋 ' + folderName,
                        url: GUID_PREFIX + guid
                      });
                    });
                })
                .then(() => addNewBookmarks(newBookmarks));
            });
        });
    })
    .then(() => {
      statusElement.textContent = 'Bookmarks switched successfully!';
      setTimeout(() => {
        statusElement.textContent = '';
      }, 3000);
      
      // Update UI to show active folder
      document.querySelectorAll('.folder').forEach(el => {
        el.classList.remove('active');
      });
      
      // Find and mark the active folder
      chrome.bookmarks.get(folderId, (results) => {
        const folder = results[0];
        document.querySelectorAll('.folder').forEach(el => {
          if (el.textContent === folder.title) {
            el.classList.add('active');
          }
        });
      });
    })
    .catch(error => {
      statusElement.textContent = `Error switching bookmarks: ${error.message}`;
      console.error('Error switching bookmarks:', error);
    });
};

// Get a short name for a folder
const getShortName = (folderId) => {
  return new Promise(resolve => {
    chrome.bookmarks.get(folderId, (results) => {
      const folder = results[0];
      resolve(folder ? folder.title : 'Bookmark Bar');
    });
  });
};

// Fix for the Invalid URL error - ensure URL is valid before creating bookmark
const createBookmarkSafely = (parentId, title, url) => {
  // Check if URL is valid
  try {
    // Try to create a URL object to validate it
    new URL(url);
    
    // URL is valid, create the bookmark
    return chrome.bookmarks.create({
      parentId,
      title,
      url
    });
  } catch (error) {
    console.error(`Invalid URL detected: ${url}`);
    
    // Create a placeholder bookmark instead
    const safeUrl = 'about:blank#invalid-' + encodeURIComponent(url);
    return chrome.bookmarks.create({
      parentId,
      title: title + ' [INVALID URL]',
      url: safeUrl
    });
  }
};

// Get all bookmarks in a folder, excluding the GUID bookmark
const getAllBookmarksInFolder = (folderId) => {
  return chrome.bookmarks.getSubTree(folderId)
    .then(results => {
      const folder = results[0];
      let bookmarks = [];
      
      const processNode = (node) => {
        if (node.url) {
          // Skip GUID bookmarks
          if (!node.url.startsWith(GUID_PREFIX)) {
            // This is a bookmark
            bookmarks.push({
              url: node.url,
              title: node.title
            });
          }
        } else if (node.children) {
          // This is a folder, process its children
          node.children.forEach(processNode);
        }
      };
      
      processNode(folder);
      return bookmarks;
    });
};

// Clear the Bookmarks Bar
const clearBookmarksBar = (bookmarksBar) => {
  if (!bookmarksBar.children || bookmarksBar.children.length === 0) {
    return Promise.resolve();
  }
  
  // Remove all children of the bookmarks bar
  const removePromises = bookmarksBar.children.map(node => {
    if (node.children && node.children.length > 0) {
      return chrome.bookmarks.removeTree(node.id);
    } else {
      return chrome.bookmarks.remove(node.id);
    }
  });
  
  return Promise.all(removePromises);
};

// Add new bookmarks to the Bookmarks Bar
const addNewBookmarks = (bookmarks) => {
  // Process bookmarks one by one, adding them directly to the Bookmarks Bar
  return bookmarks.reduce((promise, bookmark) => {
    return promise.then(() => {
      // Add the bookmark directly to the Bookmarks Bar
      return createBookmarkSafely(
        BOOKMARKS_BAR_ID,
        bookmark.title,
        bookmark.url
      );
    });
  }, Promise.resolve());
};