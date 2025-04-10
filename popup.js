// Constants for Chrome bookmarks
const BOOKMARKS_BAR_ID = '1';
const OTHER_BOOKMARKS_ID = '2';

// DOM elements
const foldersContainer = document.getElementById('folders');
const statusElement = document.getElementById('status');

// Initialize the popup
document.addEventListener('DOMContentLoaded', () => {
  loadFolders();
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
      element.addEventListener('click', () => copyFolderToBookmarksBar(folder.id));
      return element;
    });
    
    // Add folders to the container
    folderElements.forEach(element => foldersContainer.appendChild(element));
  });
};

// Copy a folder's contents to Bookmarks Bar
const copyFolderToBookmarksBar = (folderId) => {
  // First, get all bookmarks in the selected folder (including nested ones)
  getAllBookmarksInFolder(folderId)
    .then(newBookmarks => {
      // Then get all bookmarks in the Bookmarks Bar
      return chrome.bookmarks.getSubTree(BOOKMARKS_BAR_ID)
        .then(results => {
          const bookmarksBar = results[0];
          return clearBookmarksBar(bookmarksBar)
            .then(() => addNewBookmarks(newBookmarks));
        });
    })
    .then(() => {
      statusElement.textContent = 'Bookmarks copied successfully!';
      setTimeout(() => {
        statusElement.textContent = '';
      }, 3000);
    })
    .catch(error => {
      statusElement.textContent = `Error: ${error.message}`;
      console.error('Error copying bookmarks:', error);
    });
};

// Get all bookmarks in a folder, including those in nested folders
const getAllBookmarksInFolder = (folderId) => {
  return chrome.bookmarks.getSubTree(folderId)
    .then(results => {
      const folder = results[0];
      let bookmarks = [];
      
      const processNode = (node, path = '') => {
        const currentPath = path ? `${path}/${node.title}` : node.title;
        
        if (node.url) {
          // This is a bookmark
          bookmarks.push({
            url: node.url,
            title: node.title,
            path: currentPath
          });
        } else if (node.children) {
          // This is a folder, process its children
          node.children.forEach(child => processNode(child, currentPath));
        }
      };
      
      processNode(folder);
      return bookmarks;
    });
};

// Clear the Bookmarks Bar
const clearBookmarksBar = (bookmarksBar) => {
  const promises = bookmarksBar.children
    ? bookmarksBar.children.map(node => chrome.bookmarks.remove(node.id))
    : [];
  
  return Promise.all(promises);
};

// Add new bookmarks to the Bookmarks Bar
const addNewBookmarks = (bookmarks) => {
  // Create a map to track folders we need to create
  const folderMap = new Map();
  folderMap.set('', BOOKMARKS_BAR_ID); // Root folder is the bookmarks bar
  
  // Process bookmarks one by one, creating necessary folders
  return bookmarks.reduce((promise, bookmark) => {
    return promise.then(() => {
      // Parse the path to determine folder structure
      const parts = bookmark.path.split('/');
      const bookmarkTitle = parts.pop(); // Last part is the bookmark name
      
      // Build the folder path progressively
      let currentPath = '';
      
      // Create all necessary folders in the path
      return parts.reduce((folderPromise, folderName) => {
        return folderPromise.then(() => {
          // Update the current path
          currentPath = currentPath ? `${currentPath}/${folderName}` : folderName;
          
          // Check if we've already created this folder
          if (folderMap.has(currentPath)) {
            return Promise.resolve(folderMap.get(currentPath));
          }
          
          // Get the parent folder ID
          const parentPath = currentPath.split('/').slice(0, -1).join('/');
          const parentId = folderMap.get(parentPath);
          
          // Create the folder
          return chrome.bookmarks.create({
            parentId,
            title: folderName
          }).then(newFolder => {
            folderMap.set(currentPath, newFolder.id);
            return newFolder.id;
          });
        });
      }, Promise.resolve())
      .then(() => {
        // Now create the bookmark in the appropriate folder
        const parentPath = parts.join('/');
        const parentId = folderMap.get(parentPath);
        
        return chrome.bookmarks.create({
          parentId,
          title: bookmarkTitle,
          url: bookmark.url
        });
      });
    });
  }, Promise.resolve());
};