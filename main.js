const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const SteamUser = require('steam-user');
const SteamCommunity = require('steamcommunity');
const TradeOfferManager = require('steam-tradeoffer-manager');
const SteamTotp = require('steam-totp');

let mainWindow;
let steamUser, steamCommunity, tradeManager;
let isLoggedIn = false;
let autoAcceptGifts = true; // Default to auto-accepting gifts
let maFiles = []; // Store available maFiles

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'renderer/assets/icon.png'),
    titleBarStyle: 'default',
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  // Scan for maFiles when app starts
  scanMaFiles();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Steam functionality
function initializeSteam() {
  steamUser = new SteamUser();
  steamCommunity = new SteamCommunity();
  tradeManager = new TradeOfferManager({
    steam: steamUser,
    community: steamCommunity,
    language: 'en',
    pollInterval: 10000,
  });

  // Add error handling for Steam client
  steamUser.on('error', (error) => {
    console.error('Steam client error:', error);
    mainWindow.webContents.send('steam-error', { error: error.message });
    
    // Attempt to recover from certain errors
    if (error.eresult === SteamUser.EResult.RateLimitExceeded) {
      console.log('Rate limit exceeded, waiting before retry...');
      setTimeout(() => {
        if (isLoggedIn) {
          steamUser.webLogOn();
        }
      }, 60000); // Wait 1 minute
    }
  });

  steamUser.on('disconnected', (eresult, msg) => {
    console.log('Disconnected from Steam:', eresult, msg);
    mainWindow.webContents.send('steam-disconnected', { eresult, message: msg });
    
    if (isLoggedIn) {
      console.log('Attempting to reconnect...');
      setTimeout(() => {
        steamUser.webLogOn();
      }, 5000); // Wait 5 seconds before reconnecting
    }
  });

  // Wire up event handlers
  wireOfferHandlers();
}

// maFile functionality
function scanMaFiles() {
  const mafilesDir = path.join(__dirname, 'mafiles');
  maFiles = [];
  
  try {
    if (fs.existsSync(mafilesDir)) {
      const files = fs.readdirSync(mafilesDir);
      
      files.forEach(file => {
        if (file.toLowerCase().endsWith('.mafile')) {
          try {
            const filePath = path.join(mafilesDir, file);
            const content = fs.readFileSync(filePath, 'utf8');
            const maFile = JSON.parse(content);
            
            if (maFile.account_name && maFile.shared_secret) {
              maFiles.push({
                filename: file,
                accountName: maFile.account_name,
                steamId: maFile.SteamID || null,
                deviceId: maFile.device_id || null
              });
            }
          } catch (error) {
            console.error(`Error reading maFile ${file}:`, error);
          }
        }
      });
    }
  } catch (error) {
    console.error('Error scanning maFiles directory:', error);
  }
  
  console.log(`Found ${maFiles.length} maFiles`);
  return maFiles;
}

function getMaFileForAccount(accountName) {
  return maFiles.find(maFile => 
    maFile.accountName.toLowerCase() === accountName.toLowerCase()
  );
}

function generateSteamGuardCode(accountName) {
  const maFile = getMaFileForAccount(accountName);
  if (!maFile) {
    return null;
  }
  
  try {
    // Read the maFile again to get the shared secret
    const mafilesDir = path.join(__dirname, 'mafiles');
    const filePath = path.join(mafilesDir, maFile.filename);
    const content = fs.readFileSync(filePath, 'utf8');
    const maFileData = JSON.parse(content);
    
    if (maFileData.shared_secret) {
      return SteamTotp.generateAuthCode(maFileData.shared_secret);
    }
  } catch (error) {
    console.error('Error generating Steam Guard code:', error);
  }
  
  return null;
}

function wireOfferHandlers() {
  // Monitor connection health - only check if we're actually having issues
  let connectionCheckInterval;
  
  function startConnectionMonitoring() {
    connectionCheckInterval = setInterval(async () => {
      if (steamUser && steamUser.steamID && isLoggedIn) {
        // Only check connection if we haven't received any offers recently
        // This prevents false positives when the connection is actually working
        const now = Date.now();
        const lastOfferTime = steamUser.lastOfferTime || 0;
        
        // If we received an offer in the last 5 minutes, connection is fine
        if (now - lastOfferTime < 300000) {
          return;
        }
        
        // Perform a more thorough connection check before deciding to reconnect
        try {
          const testResult = await new Promise((resolve) => {
            tradeManager.getOffers(TradeOfferManager.EOfferFilter.ActiveOnly, (err, sent, received) => {
              if (err) {
                resolve({ success: false, error: err.message });
              } else {
                resolve({ success: true, count: received.length });
              }
            });
          });
          
          // If we can get offers, connection is fine
          if (testResult.success) {
            return;
          }
        } catch (testError) {
          // Test failed, but don't immediately reconnect
          console.log('Connection test failed, but not reconnecting yet...');
          return;
        }
        
        // Only attempt reconnection if we're really disconnected and can't get offers
        if (!steamUser.connected) {
          console.log('Connection appears lost, attempting to reconnect...');
          mainWindow.webContents.send('connection-lost');
          try {
            steamUser.webLogOn();
          } catch (error) {
            console.error('Failed to reconnect:', error);
          }
        }
      }
    }, 120000); // Check every 2 minutes instead of 1 minute
  }
  
  function stopConnectionMonitoring() {
    if (connectionCheckInterval) {
      clearInterval(connectionCheckInterval);
      connectionCheckInterval = null;
    }
  }
  
  // Make stopConnectionMonitoring globally accessible
  global.stopConnectionMonitoring = stopConnectionMonitoring;
  
  // Start monitoring when we get our first offer
  let hasStartedMonitoring = false;
  
  tradeManager.on('newOffer', async (offer) => {
    // Mark that we received an offer (connection is working)
    if (steamUser) {
      steamUser.lastOfferTime = Date.now();
    }
    
    // Start connection monitoring after first offer
    if (!hasStartedMonitoring) {
      hasStartedMonitoring = true;
      startConnectionMonitoring();
    }
    
    const isGift = offer.itemsToGive.length === 0 && offer.itemsToReceive.length > 0;
    
    if (isGift) {
      mainWindow.webContents.send('new-gift-offer', {
        id: offer.id,
        partner: offer.partner.getSteamID64(),
        itemsToReceive: offer.itemsToReceive,
        message: offer.message
      });
      
      // Auto-accept gifts if enabled
      if (autoAcceptGifts) {
        try {
          // Use the tradeManager directly to avoid callback issues
          offer.accept((err, status) => {
            if (err) {
              console.error('Failed to auto-accept gift:', err);
            } else {
              console.log('Gift auto-accepted successfully:', status);
              mainWindow.webContents.send('offer-accepted', { id: offer.id, status });
            }
          });
        } catch (error) {
          console.error('Failed to auto-accept gift:', error);
        }
      }
      return;
    }

    mainWindow.webContents.send('new-trade-offer', {
      id: offer.id,
      partner: offer.partner.getSteamID64(),
      itemsToGive: offer.itemsToGive,
      itemsToReceive: offer.itemsToReceive,
      message: offer.message
    });
  });

  tradeManager.on('receivedOfferChanged', (offer, oldState) => {
    mainWindow.webContents.send('offer-state-changed', {
      id: offer.id,
      oldState: TradeOfferManager.ETradeOfferState[oldState],
      newState: TradeOfferManager.ETradeOfferState[offer.state]
    });
  });

  tradeManager.on('sessionExpired', () => {
    mainWindow.webContents.send('session-expired');
    console.log('Session expired, attempting to reconnect...');
    
    // Add retry logic with exponential backoff
    let retryCount = 0;
    const maxRetries = 5;
    
    function attemptReconnect() {
      if (retryCount >= maxRetries) {
        console.error('Max reconnection attempts reached');
        mainWindow.webContents.send('reconnection-failed');
        return;
      }
      
      retryCount++;
      console.log(`Reconnection attempt ${retryCount}/${maxRetries}`);
      
      try {
        steamUser.webLogOn();
      } catch (error) {
        console.error('Reconnection failed:', error);
        // Wait before retrying (exponential backoff)
        setTimeout(attemptReconnect, Math.pow(2, retryCount) * 1000);
      }
    }
    
    attemptReconnect();
  });
}

// IPC handlers
ipcMain.handle('login', async (event, credentials) => {
  try {
    return await performLogin(credentials);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('logout', async () => {
  try {
    if (steamUser) {
      steamUser.logOff();
    }
    isLoggedIn = false;
    // Stop connection monitoring when logging out
    if (global.stopConnectionMonitoring) {
      global.stopConnectionMonitoring();
    }
    mainWindow.webContents.send('logged-out');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('accept-offer', async (event, offerId) => {
  try {
    const offer = tradeManager.getOffer(offerId);
    if (!offer) {
      throw new Error('Offer not found');
    }
    return await acceptOffer(offerId);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('decline-offer', async (event, offerId) => {
  try {
    const offer = tradeManager.getOffer(offerId);
    if (!offer) {
      throw new Error('Offer not found');
    }
    return await declineOffer(offerId);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-pending-offers', async () => {
  try {
    return await getPendingOffers();
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('toggle-auto-accept-gifts', async () => {
  try {
    autoAcceptGifts = !autoAcceptGifts;
    return { success: true, autoAcceptGifts };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-auto-accept-setting', async () => {
  try {
    return { success: true, autoAcceptGifts };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('check-connection-status', async () => {
  try {
    if (!steamUser || !isLoggedIn) {
      return { success: false, connected: false, error: 'Not logged in' };
    }
    
    // More accurate connection detection
    let connectionStatus = 'unknown';
    let isConnected = false;
    
    // Check Steam client connection
    if (steamUser.connected) {
      connectionStatus = 'steam_client_connected';
      isConnected = true;
    }
    
    // Check if we have a valid web session (this is more important for trade offers)
    if (steamUser.webLogOn && steamUser.steamID) {
      connectionStatus = 'web_session_active';
      isConnected = true;
    }
    
    // Check if we can actually get offers (this proves the connection is working)
    try {
      const testResult = await new Promise((resolve) => {
        tradeManager.getOffers(TradeOfferManager.EOfferFilter.ActiveOnly, (err, sent, received) => {
          if (err) {
            resolve({ success: false, error: err.message });
          } else {
            resolve({ success: true, count: received.length });
          }
        });
      });
      
      if (testResult.success) {
        connectionStatus = 'fully_connected';
        isConnected = true;
      }
    } catch (testError) {
      // If we can't get offers, connection might be down
      connectionStatus = 'connection_test_failed';
      isConnected = false;
    }
    
    return { 
      success: true, 
      connected: isConnected,
      connectionStatus: connectionStatus,
      lastActivity: steamUser.lastOfferTime ? new Date(steamUser.lastOfferTime).toISOString() : null
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('force-reconnect', async () => {
  try {
    if (!steamUser || !isLoggedIn) {
      return { success: false, error: 'Not logged in' };
    }
    
    console.log('Force reconnection requested by user...');
    
    // Attempt to reconnect
    try {
      steamUser.webLogOn();
      return { success: true, message: 'Reconnection attempt initiated' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// maFile IPC handlers
ipcMain.handle('scan-mafiles', async () => {
  try {
    const files = scanMaFiles();
    return { success: true, maFiles: files };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-mafiles', async () => {
  try {
    return { success: true, maFiles: maFiles };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('check-mafile-available', async (event, accountName) => {
  try {
    const maFile = getMaFileForAccount(accountName);
    return { 
      success: true, 
      available: !!maFile,
      maFile: maFile || null
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// New IPC handler for maFile-based authentication
ipcMain.handle('login-with-mafile', async (event, accountName) => {
  try {
    const maFile = getMaFileForAccount(accountName);
    if (!maFile) {
      return { success: false, error: 'No maFile found for this account' };
    }
    
    // Generate Steam Guard code from maFile
    const steamGuardCode = generateSteamGuardCode(accountName);
    if (!steamGuardCode) {
      return { success: false, error: 'Failed to generate Steam Guard code from maFile' };
    }
    
    // For maFile-based login, we need the user to provide password
    // but we can auto-generate the Steam Guard code
    return { 
      success: true, 
      message: 'maFile ready for authentication',
      steamGuardCode: steamGuardCode,
      requiresPassword: true
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Steam functions
async function performLogin(credentials) {
  return new Promise((resolve, reject) => {
    if (!steamUser) {
      initializeSteam();
    }

    // Check if we have a maFile for this account
    let twoFactorCode = credentials.twoFactorCode;
    
    // If no Steam Guard code provided, try to generate one from maFile
    if (!twoFactorCode) {
      const autoCode = generateSteamGuardCode(credentials.username);
      if (autoCode) {
        twoFactorCode = autoCode;
        console.log(`Auto-generated Steam Guard code for ${credentials.username}`);
      }
    }

    // Log the login attempt for debugging
    console.log(`Attempting login for ${credentials.username} with Steam Guard code: ${twoFactorCode ? 'Yes' : 'No'}`);

    steamUser.logOn({
      accountName: credentials.username,
      password: credentials.password,
      twoFactorCode: twoFactorCode
    });

    steamUser.once('error', async (error) => {
      console.log(`Login error for ${credentials.username}:`, error.eresult, error.message);
      
      if (error.eresult === SteamUser.EResult.AccountLogonDenied || 
          error.eresult === SteamUser.EResult.AccountLoginDeniedNeedTwoFactor) {
        // Send notification to renderer about 2FA requirement
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('needs-two-factor');
        }
        resolve({ 
          success: false, 
          needsTwoFactor: true, 
          error: 'Two-factor authentication required. Please enter your Steam Guard code.' 
        });
      } else {
        resolve({ 
          success: false, 
          error: error.message || 'Login failed' 
        });
      }
    });

    steamUser.once('loggedOn', (details) => {
      console.log(`Successfully logged on to Steam for ${credentials.username}`);
      mainWindow.webContents.send('login-success', {
        username: credentials.username,
        steamId: details.client_supplied_steamid || steamUser.steamID.getSteamID64()
      });
    });

    steamUser.once('webSession', (sessionID, cookies) => {
      console.log(`Web session established for ${credentials.username}`);
      tradeManager.setCookies(cookies, (err) => {
        if (err) {
          console.error('Failed to set cookies for trade manager:', err);
          resolve({ success: false, error: 'Failed to set cookies' });
          return;
        }
        
        steamCommunity.setCookies(cookies);
        isLoggedIn = true;
        mainWindow.webContents.send('web-session-ready');
        resolve({ success: true });
      });
    });
  });
}

async function acceptOffer(offerId) {
  return new Promise((resolve, reject) => {
    const offer = tradeManager.getOffer(offerId);
    if (!offer) {
      resolve({ success: false, error: 'Offer not found' });
      return;
    }

    offer.accept((err, status) => {
      if (err) {
        resolve({ success: false, error: err.message });
      } else {
        mainWindow.webContents.send('offer-accepted', { id: offerId, status });
        resolve({ success: true, status });
      }
    });
  });
}

async function declineOffer(offerId) {
  return new Promise((resolve, reject) => {
    const offer = tradeManager.getOffer(offerId);
    if (!offer) {
      resolve({ success: false, error: 'Offer not found' });
      return;
    }

    offer.decline((err) => {
      if (err) {
        resolve({ success: false, error: err.message });
      } else {
        mainWindow.webContents.send('offer-declined', { id: offerId });
        resolve({ success: true });
      }
    });
  });
}

async function getPendingOffers() {
  return new Promise((resolve, reject) => {
    tradeManager.getOffers(TradeOfferManager.EOfferFilter.ActiveOnly, (err, sent, received) => {
      if (err) {
        resolve({ success: false, error: err.message });
        return;
      }
      
      const offers = received.map(offer => ({
        id: offer.id,
        partner: offer.partner.getSteamID64(),
        itemsToGive: offer.itemsToGive,
        itemsToReceive: offer.itemsToReceive,
        message: offer.message,
        state: TradeOfferManager.ETradeOfferState[offer.state]
      }));
      
      resolve({ success: true, offers });
    });
  });
}
