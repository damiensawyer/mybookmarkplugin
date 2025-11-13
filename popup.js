// Constants for Chrome bookmarks
let BOOKMARKS_BAR_ID = null;
let OTHER_BOOKMARKS_ID = null;
const GUID_PREFIX = 'https://bookmark-tracker.extension/guid/';
const SYSTEM_FOLDER_NAME = 'Bookmark Set Manager Config';

// DOM elements
const foldersContainer = document.getElementById('folders');
const statusElement = document.getElementById('status');

// Global state
let activeFolderGuid = null;
let systemFolderId = null;

// Dynamically discover bookmark root IDs (Chrome 134+ uses folderType)
const discoverBookmarkRoots = () => {
  return chrome.bookmarks.getTree()
    .then(tree => {
      const roots = tree[0].children || [];

      // Find roots by folderType (Chrome 134+) or by title (fallback)
      for (const node of roots) {
        if (node.folderType === 'bookmarks-bar' || node.title === 'Bookmarks bar' || node.title === 'Bookmarks Bar') {
          BOOKMARKS_BAR_ID = node.id;
          console.log('Found Bookmarks Bar ID:', BOOKMARKS_BAR_ID);
        } else if (node.folderType === 'other' || node.title === 'Other bookmarks' || node.title === 'Other Bookmarks') {
          OTHER_BOOKMARKS_ID = node.id;
          console.log('Found Other Bookmarks ID:', OTHER_BOOKMARKS_ID);
        }
      }

      if (!BOOKMARKS_BAR_ID || !OTHER_BOOKMARKS_ID) {
        throw new Error('Could not find bookmark root folders');
      }

      return { bookmarksBarId: BOOKMARKS_BAR_ID, otherBookmarksId: OTHER_BOOKMARKS_ID };
    });
};

// Initialize the popup
document.addEventListener('DOMContentLoaded', () => {
  statusElement.textContent = 'Initializing...';

  // Global error handler for uncaught promises
  window.addEventListener('unhandledrejection', function(event) {
    console.error('Unhandled Promise Rejection:', event.reason);
    statusElement.textContent = `Error: ${event.reason.message || 'Unknown error'}`;
  });

  // First, discover the bookmark root IDs dynamically
  discoverBookmarkRoots()
    .then(() => {
      statusElement.textContent = 'Checking bookmarks...';
      return performHealthCheck();
    })
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
      // Try to create a default folder if needed
      return createDefaultFolder()
        .then(folderId => {
          console.log('Created default folder as recovery:', folderId);
          return getOrCreateFolderGuid(folderId)
            .then(guid => {
              activeFolderGuid = guid;
              statusElement.textContent = 'Created default bookmark set as recovery';
            });
        })
        .catch(recoveryError => {
          console.error('Recovery failed:', recoveryError);
          // We can continue without active folder
        });
    })
    .then(() => loadFolders())
    .catch(error => {
      console.error('Error loading folders:', error);
      statusElement.textContent = `Error loading folders: ${error.message}`;
      
      // Try one more aggressive recovery
      return chrome.bookmarks.getTree()
        .then(tree => {
          // If we can access bookmarks at all, try to show something
          foldersContainer.innerHTML = '<p>Error loading folders. Trying to recover...</p>';
          
          // Force create the "Automatically Created" folder
          return createDefaultFolder()
            .then(folderId => {
              statusElement.textContent = 'Created recovery folder. Please refresh.';
              
              // Try to load again after a delay
              setTimeout(() => {
                loadFolders()
                  .catch(finalError => {
                    // Show a simplified UI if we still can't load folders
                    foldersContainer.innerHTML = '<div class="folder">Default Recovery Folder</div>';
                    console.error('Final recovery attempt failed:', finalError);
                  });
              }, 1000);
            });
        })
        .catch(finalError => {
          // Show a simplified UI if we can't load folders
          foldersContainer.innerHTML = '<p>Error accessing bookmarks. Please try restarting the extension.</p>';
          console.error('Cannot access bookmarks API:', finalError);
        });
    })
    .finally(() => {
      // Clear loading message if we got this far successfully
      if (statusElement.textContent === 'Checking bookmarks...') {
        statusElement.textContent = '';
      }
    });
});

// Perform health check to ensure extension integrity
const performHealthCheck = () => {
  console.log('Performing health check...');
  
  // First, ensure the system folder exists in Other Bookmarks
  return ensureSystemFolderExists()
    .then(() => {
      // Then, ensure all folders in Other Bookmarks have GUID trackers
      return ensureAllFoldersHaveGuids();
    })
    .then(() => {
      // Verify the active folder still exists, repair if needed
      return verifyActiveFolder();
    });
};

// Update the GUID bookmark in the system folder
const updateSystemFolderGuid = (guid, originalFolderId) => {
  if (!systemFolderId) {
    // Ensure system folder exists
    return ensureSystemFolderExists()
      .then(() => updateSystemFolderGuid(guid, originalFolderId));
  }
  
  return chrome.bookmarks.getSubTree(systemFolderId)
    .then(results => {
      const systemFolder = results[0];
      
      // First clean the system folder - it should only contain the config bookmark
      const cleanPromises = [];
      
      if (systemFolder.children) {
        for (const child of systemFolder.children) {
          // We'll recreate the config bookmark, so remove everything for now
          cleanPromises.push(
            chrome.bookmarks.remove(child.id)
              .catch(err => console.log(`Could not remove ${child.title}:`, err))
          );
        }
      }
      
      return Promise.all(cleanPromises)
        .then(() => {
          // Create new config bookmark
          return chrome.bookmarks.create({
            parentId: systemFolderId,
            title: 'Bookmark Set Configuration - DO NOT MODIFY',
            url: GUID_PREFIX + guid
          });
        });
    });
};

// Get a short name for a folder
const getShortName = (folderId) => {
  return chrome.bookmarks.get(folderId)
    .then(results => {
      if (!results || results.length === 0) {
        console.warn(`No bookmark found for ID: ${folderId}`);
        return 'Bookmark Bar';
      }
      const folder = results[0];
      return folder ? folder.title : 'Bookmark Bar';
    })
    .catch(error => {
      console.error(`Error getting bookmark name for ID ${folderId}:`, error);
      return 'Bookmark Bar';
    });
};

// Fix for the Invalid URL error - ensure URL is valid before creating bookmark
const createBookmarkSafely = (parentId, title, url) => {
  // If URL is undefined, this is likely a folder - this should never happen but just in case
  if (typeof url === 'undefined') {
    console.warn('createBookmarkSafely called with undefined URL - this should not happen');
    // Create a bookmark with a safe URL
    return chrome.bookmarks.create({
      parentId,
      title,
      url: 'about:blank#invalid-undefined'
    });
  }
  
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
    const safeUrl = 'about:blank#invalid-' + encodeURIComponent(url || '');
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
      
      // Process a node and return its structure
      const processNode = (node, isRoot = false) => {
        // Skip processing the root node itself, but process its children
        if (isRoot) {
          if (node.children) {
            // Process each child of the root folder
            node.children.forEach(child => {
              const processedChild = processNode(child);
              if (processedChild) {
                bookmarks.push(processedChild);
              }
            });
          }
          return null;
        }
        
        // Handle bookmark (leaf node)
        if (node.url) {
          // Skip GUID bookmarks
          if (!node.url.startsWith(GUID_PREFIX) && !node.url.startsWith('GUID_TRACKER:')) {
            return {
              url: node.url,
              title: node.title
            };
          }
          return null; // Skip GUID bookmarks
        }
        
        // Handle folder (has children)
        if (node.children) {
          const folderItem = {
            isFolder: true,
            title: node.title,
            children: []
          };
          
          // Process all children of this folder
          node.children.forEach(child => {
            const processedChild = processNode(child);
            if (processedChild) {
              folderItem.children.push(processedChild);
            }
          });
          
          // Only return the folder if it has children
          if (folderItem.children.length > 0) {
            return folderItem;
          }
        }
        
        return null; // Skip empty folders
      };
      
      // Start processing from the root folder
      processNode(folder, true);
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
  // Process bookmarks and folders one by one, adding them directly to the Bookmarks Bar
  return bookmarks.reduce((promise, item) => {
    return promise.then(() => {
      if (item.isFolder) {
        // This is a folder, create it first
        console.log(`Creating folder in bookmark bar: ${item.title} with ${item.children.length} children`);
        return chrome.bookmarks.create({
          parentId: BOOKMARKS_BAR_ID,
          title: item.title
        }).then(newFolder => {
          // Then add all its children
          return addBookmarksToFolder(item.children, newFolder.id);
        });
      } else {
        // This is a regular bookmark
        return createBookmarkSafely(
          BOOKMARKS_BAR_ID,
          item.title,
          item.url
        );
      }
    });
  }, Promise.resolve());
};

// Set a new active folder
const setNewActiveFolder = (newFolderId) => {
  // First verify the folder exists to prevent issues
  chrome.bookmarks.get(newFolderId)
    .then(results => {
      if (!results || results.length === 0) {
        throw new Error('Selected folder no longer exists');
      }
      
      return getOrCreateFolderGuid(newFolderId);
    })
    .then(guid => {
      activeFolderGuid = guid;
      
      // Get all bookmarks in the selected folder
      return getAllBookmarksInFolder(newFolderId)
        .catch(error => {
          console.error('Error getting bookmarks:', error);
          // If we can't get the bookmarks, use an empty array as fallback
          statusElement.textContent = 'Warning: Using empty bookmark set due to error';
          return [];
        })
        .then(newBookmarks => {
          // Clear the bookmarks bar
          return chrome.bookmarks.getSubTree(BOOKMARKS_BAR_ID)
            .then(results => {
              const bookmarksBar = results[0];
              return clearBookmarksBar(bookmarksBar)
                .then(() => {
                  // Update the GUID in the system folder
                  return updateSystemFolderGuid(guid, newFolderId);
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
      chrome.bookmarks.get(newFolderId)
        .then(results => {
          if (results && results.length > 0) {
            const folder = results[0];
            document.querySelectorAll('.folder').forEach(el => {
              if (el.textContent === folder.title) {
                el.classList.add('active');
              }
            });
          }
        })
        .catch(error => {
          console.warn('Could not mark active folder in UI:', error);
          // Continue without marking active folder in UI
        });
    })
    .catch(error => {
      statusElement.textContent = `Error switching bookmarks: ${error.message}`;
      console.error('Error switching bookmarks:', error);
      
      // Attempt to recover by recreating automatic folder
      if (error.message.includes('no longer exists')) {
        setTimeout(() => {
          statusElement.textContent = 'Attempting to create default folder...';
          createDefaultFolder()
            .then(newFolderId => {
              // Try to switch to the new folder
              return getOrCreateFolderGuid(newFolderId)
                .then(() => {
                  statusElement.textContent = 'Created new default folder. Please try again.';
                  // Refresh the folder list
                  loadFolders();
                });
            })
            .catch(recoveryError => {
              statusElement.textContent = 'Recovery failed. Please restart extension.';
              console.error('Recovery error:', recoveryError);
            });
        }, 2000);
      }
    });
};

// Create a recovery folder when the original folder is not found
const createRecoveryFolder = (guid, bookmarks) => {
  const folderName = `Recovered Set (${new Date().toLocaleDateString()})`;
  console.log(`Creating recovery folder: ${folderName}`);
  
  // Create a new folder in Other Bookmarks
  return chrome.bookmarks.create({
    parentId: OTHER_BOOKMARKS_ID,
    title: folderName
  })
  .then(newFolder => {
    statusElement.textContent = `Created recovery folder: ${folderName}`;
    
    // Add the GUID bookmark to maintain continuity
    return chrome.bookmarks.create({
      parentId: newFolder.id,
      title: 'Bookmark Set Configuration - DO NOT MODIFY',
      url: GUID_PREFIX + guid
    })
    .then(() => {
      // Add all the bookmarks
      return addBookmarksToFolder(bookmarks, newFolder.id)
        .then(() => {
          // Show success message
          statusElement.textContent = `Bookmarks saved to recovery folder: ${folderName}`;
          setTimeout(() => {
            if (statusElement.textContent.includes('recovery folder')) {
              statusElement.textContent = '';
            }
          }, 5000);
          return newFolder.id;
        });
    });
  });
};

// Save orphaned bookmarks to a timestamped folder under the system folder
const saveOrphanedBookmarks = (bookmarks) => {
  // First ensure system folder exists
  return ensureSystemFolderExists()
    .then(() => {
      if (!systemFolderId) {
        // Try to find it directly
        return chrome.bookmarks.getSubTree(OTHER_BOOKMARKS_ID)
          .then(results => {
            const otherBookmarks = results[0];
            
            // Look for existing system folder
            if (otherBookmarks.children) {
              for (const child of otherBookmarks.children) {
                if (!child.url && child.title === SYSTEM_FOLDER_NAME) {
                  systemFolderId = child.id;
                  break;
                }
              }
            }
            
            if (!systemFolderId) {
              // Create it if still not found
              return chrome.bookmarks.create({
                parentId: OTHER_BOOKMARKS_ID,
                title: SYSTEM_FOLDER_NAME
              })
              .then(newFolder => {
                systemFolderId = newFolder.id;
              });
            }
          });
      }
    })
    .then(() => {
      // Verify systemFolderId is set
      if (!systemFolderId) {
        return Promise.reject(new Error('Failed to get or create system folder'));
      }
      
      // Create a timestamp for the folder name
      const timestamp = new Date().toISOString()
        .replace(/[-:]/g, '')
        .replace('T', '')
        .substring(0, 14); // Format: YYYYMMDDHHMMSS
      
      const folderName = `Orphan Links ${timestamp}`;
      
      // Create a new folder in the system folder
      return chrome.bookmarks.create({
        parentId: systemFolderId,
        title: folderName
      })
      .then(newFolder => {
        statusElement.textContent = `Saving orphaned bookmarks to: ${folderName}`;
        
        // Add all the bookmarks
        return addBookmarksToFolder(bookmarks, newFolder.id)
          .then(() => {
            // Show success message
            statusElement.textContent = `Orphaned bookmarks saved to: ${folderName}`;
            setTimeout(() => {
              if (statusElement.textContent.includes('Orphaned bookmarks saved')) {
                statusElement.textContent = '';
              }
            }, 5000);
            return newFolder.id;
          });
      });
    })
    .catch(error => {
      console.error('Error saving orphaned bookmarks:', error);
      // Return a resolved promise to continue the flow
      return Promise.resolve();
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
      
      // Check each folder in Other Bookmarks
      for (const folder of otherBookmarks.children) {
        // Skip bookmarks, only check folders
        if (folder.url) {
          continue;
        }
        
        // Skip the system folder - we don't want to find GUIDs in the system folder
        if (folder.title === SYSTEM_FOLDER_NAME) {
          continue;
        }
        
        // Check if this folder has the GUID bookmark
        if (folder.children) {
          for (const child of folder.children) {
            if (child.url) {
              if (child.url === GUID_PREFIX + guid || child.url === 'GUID_TRACKER:' + guid) {
                return folder.id;
              }
            }
          }
        }
      }
      
      return null;
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
  console.log(`Adding ${bookmarks.length} bookmarks/folders to folder ${folderId}`);
  
  if (bookmarks.length === 0) {
    console.log('No bookmarks to add');
    return Promise.resolve();
  }
  
  // Process each bookmark or folder sequentially to maintain order
  return bookmarks.reduce((promise, bookmark) => {
    return promise.then(() => {
      if (bookmark.isFolder) {
        // This is a folder, create it first - IMPORTANT: Do NOT include url property for folders
        console.log(`Creating folder: ${bookmark.title} with ${bookmark.children.length} children`);
        return chrome.bookmarks.create({
          parentId: folderId,
          title: bookmark.title
        }).then(newFolder => {
          // Then add all its children
          return addBookmarksToFolder(bookmark.children, newFolder.id);
        }).catch(error => {
          console.error(`Error creating folder "${bookmark.title}":`, error);
          // Continue with other bookmarks even if one fails
          return Promise.resolve();
        });
      } else {
        // This is a regular bookmark
        return createBookmarkSafely(
          folderId,
          bookmark.title,
          bookmark.url
        ).catch(error => {
          console.error(`Error creating bookmark "${bookmark.title}":`, error);
          // Continue with other bookmarks even if one fails
          return Promise.resolve();
        });
      }
    });
  }, Promise.resolve())
    .then(() => {
      console.log(`Successfully added all bookmarks/folders to folder ${folderId}`);
      return Promise.resolve();
    });
};

// Ensure the system folder exists in Other Bookmarks
const ensureSystemFolderExists = () => {
  return chrome.bookmarks.getSubTree(OTHER_BOOKMARKS_ID)
    .then(results => {
      const otherBookmarks = results[0];
      
      // Look for existing system folder
      if (otherBookmarks.children) {
        for (const child of otherBookmarks.children) {
          if (!child.url && child.title === SYSTEM_FOLDER_NAME) {
            systemFolderId = child.id;
            
            // Clean up the system folder - it should only contain the GUID
            return cleanSystemFolder(child)
              .then(() => Promise.resolve());
          }
        }
      }
      
      // If not found, create it
      return chrome.bookmarks.create({
        parentId: OTHER_BOOKMARKS_ID,
        title: SYSTEM_FOLDER_NAME
      })
      .then(newFolder => {
        systemFolderId = newFolder.id;
        console.log('Created system folder in Other Bookmarks');
      });
    })
    .then(() => {
      // Look for and migrate any system folder in bookmark bar
      return checkAndMigrateFromBookmarkBar();
    });
};

// Check for and migrate system folder from bookmark bar to Other Bookmarks
const checkAndMigrateFromBookmarkBar = () => {
  return chrome.bookmarks.getSubTree(BOOKMARKS_BAR_ID)
    .then(results => {
      const bookmarksBar = results[0];
      
      if (!bookmarksBar.children) {
        return Promise.resolve();
      }
      
      // Look for system folder in bookmark bar
      let barSystemFolder = null;
      
      for (const child of bookmarksBar.children) {
        if (!child.url && 
            (child.title === 'System Config (Do Not Delete)' || 
             child.title === SYSTEM_FOLDER_NAME)) {
          barSystemFolder = child;
          break;
        }
      }
      
      if (!barSystemFolder) {
        // Also check for legacy GUID bookmarks directly in bookmark bar
        return findLegacyGuidBookmark(bookmarksBar)
          .then(legacyInfo => {
            if (legacyInfo) {
              // Migrate legacy GUID bookmark to the system folder
              return migrateLegacyGuid(legacyInfo);
            }
            return Promise.resolve();
          });
      }
      
      // Migrate the system folder contents to Other Bookmarks system folder
      console.log('Found system folder in bookmark bar, migrating to Other Bookmarks');
      
      return migrateSystemFolder(barSystemFolder.id)
        .then(() => {
          // Remove the old system folder from bookmark bar
          return chrome.bookmarks.removeTree(barSystemFolder.id)
            .catch(error => {
              console.log('Error removing old system folder:', error);
              // Continue even if removal fails
            });
        });
    });
};

// Migrate contents from old system folder to new one
const migrateSystemFolder = (oldFolderId) => {
  return chrome.bookmarks.getSubTree(oldFolderId)
    .then(results => {
      const oldFolder = results[0];
      
      if (!oldFolder.children || oldFolder.children.length === 0) {
        return Promise.resolve();
      }
      
      // Only look for the GUID bookmark to migrate
      let guidBookmark = null;
      
      for (const child of oldFolder.children) {
        if (child.url && 
           (child.url.startsWith(GUID_PREFIX) || child.url.startsWith('GUID_TRACKER:'))) {
          guidBookmark = child;
          break;
        }
      }
      
      if (!guidBookmark) {
        return Promise.resolve();
      }
      
      // Create the GUID bookmark in the new system folder
      return chrome.bookmarks.create({
        parentId: systemFolderId,
        title: 'Bookmark Set Configuration - DO NOT MODIFY',
        url: guidBookmark.url.startsWith(GUID_PREFIX) 
          ? guidBookmark.url 
          : GUID_PREFIX + guidBookmark.url.substring('GUID_TRACKER:'.length)
      });
    });
};

// Migrate a legacy GUID bookmark to the system folder
const migrateLegacyGuid = (legacyInfo) => {
  console.log('Found legacy GUID bookmark in bookmark bar, migrating to system folder');
  
  // First clean the system folder
  return cleanSystemFolder({ id: systemFolderId, children: [] })
    .then(() => {
      // Create a new bookmark in the system folder
      return chrome.bookmarks.create({
        parentId: systemFolderId,
        title: 'Bookmark Set Configuration - DO NOT MODIFY',
        url: GUID_PREFIX + legacyInfo.guid
      })
      .then(() => {
        // Try to remove the old bookmark
        return chrome.bookmarks.remove(legacyInfo.id)
          .catch(error => {
            console.log('Error removing legacy GUID bookmark:', error);
            // Continue even if removal fails
          });
      });
    });
};

// Clean the system folder to ensure it only contains GUID configuration
const cleanSystemFolder = (folder) => {
  if (!folder.children || folder.children.length === 0) {
    return Promise.resolve();
  }
  
  // Find the GUID bookmark to preserve
  let guidBookmark = null;
  
  for (const child of folder.children) {
    if (child.url && 
       (child.url.startsWith(GUID_PREFIX) || child.url.startsWith('GUID_TRACKER:'))) {
      guidBookmark = child;
      break;
    }
  }
  
  // Remove all non-GUID bookmarks from the folder
  const removePromises = [];
  
  for (const child of folder.children) {
    // Skip the GUID bookmark if found
    if (guidBookmark && child.id === guidBookmark.id) {
      continue;
    }
    
    removePromises.push(
      chrome.bookmarks.remove(child.id)
        .catch(error => {
          console.log(`Error removing ${child.title} from system folder:`, error);
          // Continue with other removals
        })
    );
  }
  
  return Promise.all(removePromises);
};

// Verify that the active folder exists, repair if not
const verifyActiveFolder = () => {
  if (!activeFolderGuid) {
    return Promise.resolve(); // No active folder to verify
  }
  
  console.log(`Verifying active folder with GUID: ${activeFolderGuid}`);
  
  return findFolderByGuid(activeFolderGuid)
    .then(folderId => {
      if (!folderId) {
        console.log('Active folder not found but GUID exists - initiating recovery');
        
        // Get current bookmarks to preserve them
        return chrome.bookmarks.getSubTree(BOOKMARKS_BAR_ID)
          .then(results => {
            const bookmarksBar = results[0];
            const currentBookmarks = [];
            
            if (bookmarksBar.children) {
              for (const child of bookmarksBar.children) {
                if (child.url && 
                    !child.url.startsWith(GUID_PREFIX) && 
                    !child.url.startsWith('GUID_TRACKER:')) {
                  currentBookmarks.push({
                    url: child.url,
                    title: child.title
                  });
                }
              }
            }
            
            console.log(`Found ${currentBookmarks.length} bookmarks to recover`);
            
            // Create a recovery folder with the active GUID
            return createRecoveryFolder(activeFolderGuid, currentBookmarks)
              .then(() => {
                statusElement.textContent = 'Created recovery folder for missing bookmark set';
                console.log('Created recovery folder for missing active set');
              });
          });
      }
      
      console.log(`Active folder verified, ID: ${folderId}`);
      return Promise.resolve(); // Active folder exists, continue
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

// Ensure bookmark bar has a system folder with GUID tracker
const ensureBookmarkBarHasSystemFolder = () => {
  return chrome.bookmarks.getSubTree(BOOKMARKS_BAR_ID)
    .then(results => {
      const bookmarksBar = results[0];
      
      // First look for existing system folder
      return findSystemFolder(bookmarksBar)
        .then(folderId => {
          if (folderId) {
            systemFolderId = folderId;
            return chrome.bookmarks.getSubTree(folderId);
          } else {
            // Create system folder if not found
            return chrome.bookmarks.create({
              parentId: BOOKMARKS_BAR_ID,
              title: SYSTEM_FOLDER_NAME
            }).then(newFolder => {
              systemFolderId = newFolder.id;
              return chrome.bookmarks.getSubTree(systemFolderId);
            });
          }
        })
        .then(results => {
          const systemFolder = results[0];
          // Look for GUID bookmark within system folder
          return findGuidBookmark(systemFolder)
            .then(guid => {
              if (!guid) {
                console.log('No GUID found in system folder, creating a default folder...');
                // No GUID found, create a default folder and set it as active
                return createDefaultFolder()
                  .then(folderId => {
                    return getOrCreateFolderGuid(folderId)
                      .then(guid => {
                        // Add the GUID bookmark to the system folder
                        return chrome.bookmarks.create({
                          parentId: systemFolderId,
                          title: 'Bookmark Set Configuration - DO NOT MODIFY',
                          url: GUID_PREFIX + guid
                        })
                        .then(() => guid);
                      });
                  });
              }
              return guid;
            });
        });
    });
};

// Find system folder within bookmark bar
const findSystemFolder = (bookmarksBar) => {
  if (!bookmarksBar.children || bookmarksBar.children.length === 0) {
    return Promise.resolve(null);
  }
  
  // Look for system folder
  for (const child of bookmarksBar.children) {
    if (!child.url && child.title === SYSTEM_FOLDER_NAME) {
      return Promise.resolve(child.id);
    }
  }
  
  // Also check for legacy GUID bookmark to migrate
  return findLegacyGuidBookmark(bookmarksBar)
    .then(legacyInfo => {
      if (legacyInfo) {
        // Create new system folder
        return chrome.bookmarks.create({
          parentId: BOOKMARKS_BAR_ID,
          title: SYSTEM_FOLDER_NAME
        }).then(folder => {
          // Move legacy GUID bookmark into the folder with updated title
          return chrome.bookmarks.update(legacyInfo.id, {
            title: 'Bookmark Set Configuration - DO NOT MODIFY'
          }).then(() => {
            return chrome.bookmarks.move(legacyInfo.id, {
              parentId: folder.id
            }).then(() => folder.id);
          });
        });
      }
      return null;
    });
};

// Find legacy GUID bookmark (for migration)
const findLegacyGuidBookmark = (folder) => {
  if (!folder.children || folder.children.length === 0) {
    return Promise.resolve(null);
  }
  
  for (const child of folder.children) {
    if (child.url) {
      // Check for any format of GUID bookmark
      if (child.url.startsWith(GUID_PREFIX) || child.url.startsWith('GUID_TRACKER:')) {
        return Promise.resolve({
          id: child.id,
          guid: child.url.startsWith(GUID_PREFIX) 
            ? child.url.substring(GUID_PREFIX.length)
            : child.url.substring('GUID_TRACKER:'.length)
        });
      }
    }
  }
  
  return Promise.resolve(null);
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
  const folderName = 'Automatically Created';
  
  // First check if folder already exists
  return chrome.bookmarks.getSubTree(OTHER_BOOKMARKS_ID)
    .then(results => {
      const otherBookmarks = results[0];
      let existingFolder = null;
      
      if (otherBookmarks.children) {
        for (const child of otherBookmarks.children) {
          if (!child.url && child.title === folderName) {
            existingFolder = child;
            break;
          }
        }
      }
      
      if (existingFolder) {
        console.log('Found existing default folder:', existingFolder.title);
        return existingFolder.id;
      }
      
      // Create a new folder if none exists
      return chrome.bookmarks.create({
        parentId: OTHER_BOOKMARKS_ID,
        title: folderName
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
                // Skip system folder
                if (child.title !== SYSTEM_FOLDER_NAME) {
                  if (child.url) {
                    bookmarks.push({
                      url: child.url,
                      title: child.title
                    });
                  }
                }
              }
            }
            
            // Add bookmarks to the new folder
            return Promise.all(bookmarks.map(bookmark => {
              return createBookmarkSafely(
                newFolder.id,
                bookmark.title,
                bookmark.url
              );
            }))
            .then(() => newFolder.id);
          });
      });
    });
};

// Load all folders from "Other Bookmarks"
const loadFolders = () => {
  chrome.bookmarks.getSubTree(OTHER_BOOKMARKS_ID)
    .then(results => {
      if (!results || results.length === 0) {
        console.error('No results returned from getSubTree');
        foldersContainer.innerHTML = '<p>Error loading folders: No results</p>';
        return;
      }

      const otherBookmarks = results[0];

      // Get all folders within Other Bookmarks, excluding the system folder and recovered sets
      const folders = otherBookmarks.children?.filter(node =>
        !node.url &&
        node.title !== SYSTEM_FOLDER_NAME &&
        !node.title.startsWith('Recovered Set')
      ) || [];

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
    })
    .catch(error => {
      console.error('Error loading folders:', error);
      foldersContainer.innerHTML = '<p>Error loading folders. Please try again.</p>';
    });
};

// Check if there's an active folder
const checkActiveFolder = () => {
  // If we have a system folder, check it first
  if (systemFolderId) {
    return chrome.bookmarks.getSubTree(systemFolderId)
      .then(results => {
        const systemFolder = results[0];
        
        // Look for GUID bookmark
        return findGuidBookmark(systemFolder)
          .then(guid => {
            if (guid) {
              activeFolderGuid = guid;
              console.log('Active folder GUID from system folder:', activeFolderGuid);
              return;
            }
            
            // If not found in system folder, check bookmark bar (legacy)
            return chrome.bookmarks.getSubTree(BOOKMARKS_BAR_ID)
              .then(results => {
                const bookmarksBar = results[0];
                return findGuidBookmark(bookmarksBar);
              })
              .then(barGuid => {
                if (barGuid) {
                  activeFolderGuid = barGuid;
                  console.log('Legacy active folder GUID found in bookmark bar:', activeFolderGuid);
                  
                  // Migrate this GUID to the system folder for future use
                  return chrome.bookmarks.create({
                    parentId: systemFolderId,
                    title: 'Bookmark Set Configuration - DO NOT MODIFY',
                    url: GUID_PREFIX + barGuid
                  });
                }
              });
          });
      });
  }
  
  // Fallback to checking bookmark bar directly
  return chrome.bookmarks.getSubTree(BOOKMARKS_BAR_ID)
    .then(results => {
      const bookmarksBar = results[0];
      
      // Look for GUID bookmark
      return findGuidBookmark(bookmarksBar)
        .then(guid => {
          if (guid) {
            activeFolderGuid = guid;
            console.log('Active folder GUID from bookmark bar (legacy):', activeFolderGuid);
          }
        });
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
            title: 'Bookmark Set Configuration - DO NOT MODIFY',
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
  // Show status indicator
  statusElement.textContent = 'Saving current bookmarks...';
  
  // If there's an active folder, save its state first
  if (activeFolderGuid) {

    // First get the current bookmark bar state
    chrome.bookmarks.getSubTree(BOOKMARKS_BAR_ID)
      .then(results => {
        const bookmarksBar = results[0];
        let currentBookmarks = [];
        
        // Process a node and its children recursively
        const processBarNode = (node) => {
          if (node.url) {
            // Skip GUID bookmarks
            if (!node.url.startsWith(GUID_PREFIX) && !node.url.startsWith('GUID_TRACKER:')) {
              return {
                url: node.url,
                title: node.title
              };
            }
            return null;
          } else if (node.children) {
            // This is a folder
            const folderItem = {
              isFolder: true,
              title: node.title,
              children: []
            };
            
            // Process all children
            node.children.forEach(child => {
              const processedChild = processBarNode(child);
              if (processedChild) {
                folderItem.children.push(processedChild);
              }
            });
            
            // Only return folders with children
            if (folderItem.children.length > 0) {
              return folderItem;
            }
          }
          return null;
        };
        
        // Process all children of the bookmarks bar
        if (bookmarksBar.children) {
          bookmarksBar.children.forEach(child => {
            const processedItem = processBarNode(child);
            if (processedItem) {
              currentBookmarks.push(processedItem);
            }
          });
        }
        
        // Find the original folder with the active GUID
        return findFolderByGuid(activeFolderGuid)
          .then(folderId => {
            if (!folderId) {
              // This is a recovery situation, not an error
              statusElement.textContent = 'Bookmark set folder missing - saving orphaned bookmarks';
              
              // First save to orphaned bookmarks folder
              return saveOrphanedBookmarks(currentBookmarks)
                .then(() => {
                  // Then create a recovery folder
                  return createRecoveryFolder(activeFolderGuid, currentBookmarks);
                })
                .catch(error => {
                  // Continue with recovery folder even if orphaned bookmarks fails
                  return createRecoveryFolder(activeFolderGuid, currentBookmarks);
                });
            }
            
            // Clear and update the original folder
            return chrome.bookmarks.getSubTree(folderId)
              .then(results => {
                const folder = results[0];
                return clearFolderExceptGuid(folder)
                  .then(() => addBookmarksToFolder(currentBookmarks, folderId));
              });
          })
          .then(() => {
            // After saving is complete, set the new active folder
            return setNewActiveFolder(newFolderId);
          });
      })
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
  return new Promise((resolve, reject) => {
    chrome.bookmarks.getSubTree(BOOKMARKS_BAR_ID)
      .then(results => {
        const bookmarksBar = results[0];
        let currentBookmarks = [];
        
        // Process a node and its children recursively
        const processBarNode = (node) => {
          if (node.url) {
            // Skip GUID bookmarks
            if (!node.url.startsWith(GUID_PREFIX) && !node.url.startsWith('GUID_TRACKER:')) {
              return {
                url: node.url,
                title: node.title
              };
            }
            return null;
          } else if (node.children) {
            // This is a folder
            const folderItem = {
              isFolder: true,
              title: node.title,
              children: []
            };
            
            // Process all children
            node.children.forEach(child => {
              const processedChild = processBarNode(child);
              if (processedChild) {
                folderItem.children.push(processedChild);
              }
            });
            
            // Only return folders with children
            if (folderItem.children.length > 0) {
              return folderItem;
            }
          }
          return null;
        };
        
        // Process all children of the bookmarks bar
        if (bookmarksBar.children) {
          bookmarksBar.children.forEach(child => {
            const processedItem = processBarNode(child);
            if (processedItem) {
              currentBookmarks.push(processedItem);
            }
          });
        }
        
        console.log(`Saving ${currentBookmarks.length} bookmarks/folders to active folder`);
        
        // Find the original folder with the active GUID
        findFolderByGuid(activeFolderGuid)
          .then(folderId => {
            if (!folderId) {
              // This is a recovery situation, not an error
              statusElement.textContent = 'Bookmark set folder missing - saving orphaned bookmarks';
              console.log('Bookmark set folder not found - saving orphaned bookmarks');
              
              // First save to orphaned bookmarks folder
              saveOrphanedBookmarks(currentBookmarks)
                .then(() => {
                  // Then create a recovery folder
                  return createRecoveryFolder(activeFolderGuid, currentBookmarks);
                })
                .then(resolve)
                .catch(reject);
            } else {
              // Clear and update the original folder
              chrome.bookmarks.getSubTree(folderId)
                .then(results => {
                  const folder = results[0];
                  clearFolderExceptGuid(folder)
                    .then(() => {
                      // Add all bookmarks to the folder
                      addBookmarksToFolder(currentBookmarks, folderId)
                        .then(() => {
                          console.log(`Successfully saved bookmarks to folder ID: ${folderId}`);
                          resolve(folderId);
                        })
                        .catch(error => {
                          console.error('Error adding bookmarks to folder:', error);
                          reject(error);
                        });
                    })
                    .catch(error => {
                      console.error('Error clearing folder:', error);
                      reject(error);
                    });
                })
                .catch(error => {
                  console.error('Error getting folder subtree:', error);
                  reject(error);
                });
            }
          })
          .catch(error => {
            console.error('Error finding folder by GUID:', error);
            reject(error);
          });
      })
      .catch(error => {
        console.error('Error getting bookmarks bar:', error);
        reject(error);
      });
  });
};