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
  if (!bookmarksBar.children || bookmarksBar.children.length === 0) {
    return Promise.resolve();
  }
  
  // Process nodes recursively to remove children first, then parents
  const removeNode = (node) => {
    if (node.children && node.children.length > 0) {
      // Process all children first
      return Promise.all(node.children.map(removeNode))
        .then(() => chrome.bookmarks.removeTree(node.id));
    } else {
      // Leaf node (bookmark) or empty folder
      return chrome.bookmarks.remove(node.id);
    }
  };
  
  // Remove all children of the bookmarks bar
  return Promise.all(bookmarksBar.children.map(removeNode));
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