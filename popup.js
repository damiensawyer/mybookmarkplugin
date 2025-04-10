// Constants for Chrome bookmarks
const BOOKMARKS_BAR_ID = '1';
const OTHER_BOOKMARKS_ID = '2';
const GUID_PREFIX = 'GUID_TRACKER:';

// DOM elements
const foldersContainer = document.getElementById('folders');
const statusElement = document.getElementById('status');

// Global state
let activeFolderGuid = null;

// Initialize the popup
document.addEventListener('DOMContentLoaded', () => {
  checkActiveFolder()
    .then(() => loadFolders())
    .catch(error => {
      console.error('Error during initialization:', error);
      statusElement.textContent = `Error during initialization: ${error.message}`;
    });
});

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
    if (child.url && child.url.startsWith(GUID_PREFIX)) {
      return Promise.resolve(child.url.substring(GUID_PREFIX.length));
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
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
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
      return chrome.bookmarks.create({
        parentId: folderId,
        title: bookmark.title,
        url: bookmark.url
      });
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
                  return chrome.bookmarks.create({
                    parentId: BOOKMARKS_BAR_ID,
                    title: '📋 ' + getShortName(folderId),
                    url: GUID_PREFIX + guid
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
      return chrome.bookmarks.create({
        parentId: BOOKMARKS_BAR_ID,
        title: bookmark.title,
        url: bookmark.url
      });
    });
  }, Promise.resolve());
};