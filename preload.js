const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Login methods
  login: (credentials) => ipcRenderer.invoke('login', credentials),
  logout: () => ipcRenderer.invoke('logout'),
  
  // Trade offer methods
  acceptOffer: (offerId) => ipcRenderer.invoke('accept-offer', offerId),
  declineOffer: (offerId) => ipcRenderer.invoke('decline-offer', offerId),
  getPendingOffers: () => ipcRenderer.invoke('get-pending-offers'),
  toggleAutoAcceptGifts: () => ipcRenderer.invoke('toggle-auto-accept-gifts'),
  getAutoAcceptSetting: () => ipcRenderer.invoke('get-auto-accept-setting'),
  checkConnectionStatus: () => ipcRenderer.invoke('check-connection-status'),
  forceReconnect: () => ipcRenderer.invoke('force-reconnect'),
  
  // maFile methods
  scanMaFiles: () => ipcRenderer.invoke('scan-mafiles'),
  getMaFiles: () => ipcRenderer.invoke('get-mafiles'),
  checkMaFileAvailable: (accountName) => ipcRenderer.invoke('check-mafile-available', accountName),
  loginWithMaFile: (accountName) => ipcRenderer.invoke('login-with-mafile', accountName),
  
  // Event listeners
  onLoginSuccess: (callback) => ipcRenderer.on('login-success', callback),
  onWebSessionReady: (callback) => ipcRenderer.on('web-session-ready', callback),
  onLoggedOut: (callback) => ipcRenderer.on('logged-out', callback),
  onNeedsTwoFactor: (callback) => ipcRenderer.on('needs-two-factor', callback),
  onNewTradeOffer: (callback) => ipcRenderer.on('new-trade-offer', callback),
  onNewGiftOffer: (callback) => ipcRenderer.on('new-gift-offer', callback),
  onOfferStateChanged: (callback) => ipcRenderer.on('offer-state-changed', callback),
  onOfferAccepted: (callback) => ipcRenderer.on('offer-accepted', callback),
  onOfferDeclined: (callback) => ipcRenderer.on('offer-declined', callback),
  onSessionExpired: (callback) => ipcRenderer.on('session-expired', callback),
  onConnectionLost: (callback) => ipcRenderer.on('connection-lost', callback),
  onSteamError: (callback) => ipcRenderer.on('steam-error', callback),
  onSteamDisconnected: (callback) => ipcRenderer.on('steam-disconnected', callback),
  onReconnectionFailed: (callback) => ipcRenderer.on('reconnection-failed', callback),
  
  // Remove event listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});
