// Global state
let currentUser = null;
let pendingOffers = [];
let activityLog = [];

// DOM elements
const loginSection = document.getElementById('loginSection');
const dashboardSection = document.getElementById('dashboardSection');
const loginForm = document.getElementById('loginForm');
const twoFactorGroup = document.getElementById('twoFactorGroup');
const statusIndicator = document.getElementById('statusIndicator');
const userDisplayName = document.getElementById('userDisplayName');
const logoutBtn = document.getElementById('logoutBtn');
const refreshOffersBtn = document.getElementById('refreshOffersBtn');
const offersList = document.getElementById('offersList');
const activityList = document.getElementById('activityList');
const loadingOverlay = document.getElementById('loadingOverlay');

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    setupElectronListeners();
});

function setupEventListeners() {
    // Login form submission
    loginForm.addEventListener('submit', handleLogin);
    
    // Logout button
    logoutBtn.addEventListener('click', handleLogout);
    
    // Refresh offers button
    refreshOffersBtn.addEventListener('click', refreshOffers);
    
    // Check connection button
    const checkConnectionBtn = document.getElementById('checkConnectionBtn');
    checkConnectionBtn.addEventListener('click', checkConnectionStatus);
    
    // Force reconnect button
    const forceReconnectBtn = document.getElementById('forceReconnectBtn');
    forceReconnectBtn.addEventListener('click', forceReconnect);
    
    // Auto-accept gifts toggle
    const autoAcceptToggle = document.getElementById('autoAcceptToggle');
    autoAcceptToggle.addEventListener('change', handleAutoAcceptToggle);
    
    // maFiles refresh button
    const refreshMaFilesBtn = document.getElementById('refreshMaFilesBtn');
    refreshMaFilesBtn.addEventListener('click', refreshMaFiles);
    
    // Switch to manual Steam Guard button
    const switchToManualBtn = document.getElementById('switchToManualBtn');
    if (switchToManualBtn) {
        switchToManualBtn.addEventListener('click', switchToManualSteamGuard);
    }
    
    // Real-time Steam Guard code validation
    const twoFactorInput = document.getElementById('twoFactorCode');
    twoFactorInput.addEventListener('input', validateSteamGuardCode);
    twoFactorInput.addEventListener('blur', validateSteamGuardCode);
    twoFactorInput.addEventListener('keypress', function(e) {
        // Allow letters and numbers
        if (!/[A-Za-z0-9]/.test(e.key)) {
            e.preventDefault();
        }
    });
    
    // Check for maFiles when username changes
    const usernameInput = document.getElementById('username');
    usernameInput.addEventListener('input', checkMaFileAvailability);
}

function setupElectronListeners() {
    // Login events
    window.electronAPI.onLoginSuccess((event, data) => {
        currentUser = data;
        userDisplayName.textContent = data.username;
        addActivity(`Logged in as ${data.username}`, 'success');
        updateStatus('online');
    });

    window.electronAPI.onWebSessionReady((event, data) => {
        showDashboard();
        addActivity('Web session ready - Trade offers monitoring active', 'info');
    });

    window.electronAPI.onNeedsTwoFactor((event, data) => {
        // Steam Guard field is already visible by default
        showNotification('Two-Factor Required', 'Please enter your Steam Guard code and try again', 'warning');
        showLoading(false);
    });

    window.electronAPI.onLoggedOut((event, data) => {
        showLogin();
        currentUser = null;
        pendingOffers = [];
        activityLog = [];
        updateStatus('offline');
        addActivity('Logged out', 'info');
    });

    // Trade offer events
    window.electronAPI.onNewTradeOffer((event, offer) => {
        addActivity(`New trade offer received from ${offer.partner}`, 'info');
        pendingOffers.push(offer);
        updateOffersList();
        showNotification('New Trade Offer', `Received trade offer from ${offer.partner}`, 'info');
    });

    window.electronAPI.onNewGiftOffer((event, offer) => {
        const autoAcceptToggle = document.getElementById('autoAcceptToggle');
        const isAutoAcceptEnabled = autoAcceptToggle ? autoAcceptToggle.checked : false;
        
        if (isAutoAcceptEnabled) {
            addActivity(`Gift offer received from ${offer.partner} - Auto-accepting`, 'success');
            showNotification('Gift Offer', `Gift offer from ${offer.partner} - Auto-accepted!`, 'success');
        } else {
            addActivity(`Gift offer received from ${offer.partner} - Auto-accept disabled`, 'info');
            showNotification('Gift Offer', `Gift offer from ${offer.partner} - Auto-accept is disabled`, 'info');
        }
    });

    window.electronAPI.onOfferStateChanged((event, data) => {
        addActivity(`Offer ${data.id} state changed: ${data.oldState} → ${data.newState}`, 'info');
        updateOffersList();
    });

    window.electronAPI.onOfferAccepted((event, data) => {
        addActivity(`Offer ${data.id} accepted successfully`, 'success');
        showNotification('Offer Accepted', `Trade offer ${data.id} has been accepted`, 'success');
        updateOffersList();
    });

    window.electronAPI.onOfferDeclined((event, data) => {
        addActivity(`Offer ${data.id} declined`, 'warning');
        showNotification('Offer Declined', `Trade offer ${data.id} has been declined`, 'warning');
        updateOffersList();
    });

    window.electronAPI.onSessionExpired((event, data) => {
        addActivity('Session expired - attempting to renew', 'warning');
        showNotification('Session Expired', 'Steam session expired, attempting to renew...', 'warning');
    });

    window.electronAPI.onConnectionLost((event, data) => {
        addActivity('Connection lost - attempting to reconnect', 'warning');
        showNotification('Connection Lost', 'Steam connection lost, attempting to reconnect...', 'warning');
        updateStatus('reconnecting');
    });

    window.electronAPI.onSteamError((event, data) => {
        addActivity(`Steam error: ${data.error}`, 'error');
        showNotification('Steam Error', `Error: ${data.error}`, 'error');
        updateStatus('error');
    });

    window.electronAPI.onSteamDisconnected((event, data) => {
        addActivity(`Disconnected from Steam: ${data.message}`, 'warning');
        showNotification('Disconnected', `Disconnected from Steam: ${data.message}`, 'warning');
        updateStatus('offline');
    });

    window.electronAPI.onReconnectionFailed((event, data) => {
        addActivity('Reconnection failed - manual intervention required', 'error');
        showNotification('Reconnection Failed', 'Failed to reconnect to Steam. Please try logging in again.', 'error');
        updateStatus('error');
    });
}

async function handleLogin(event) {
    event.preventDefault();
    
    const formData = new FormData(loginForm);
    const credentials = {
        username: formData.get('username'),
        password: formData.get('password'),
        twoFactorCode: formData.get('twoFactorCode')
    };

    if (!credentials.username) {
        showNotification('Error', 'Please fill in username', 'error');
        return;
    }
    
    // Check if we have a maFile selected - if so, password is not required
    const selectedMaFileStatus = document.getElementById('selectedMaFileStatus');
    const isMaFileSelected = selectedMaFileStatus && selectedMaFileStatus.style.display !== 'none';
    
    if (isMaFileSelected) {
        // Use maFile authentication - get the auto-generated Steam Guard code
        try {
            const maFileResult = await window.electronAPI.loginWithMaFile(credentials.username);
            if (maFileResult.success && maFileResult.steamGuardCode) {
                credentials.twoFactorCode = maFileResult.steamGuardCode;
                addActivity(`Using auto-generated Steam Guard code from maFile for ${credentials.username}`, 'info');
            } else {
                showNotification('Error', 'Failed to generate Steam Guard code from maFile', 'error');
                return;
            }
        } catch (error) {
            showNotification('Error', 'Failed to access maFile for authentication', 'error');
            return;
        }
        
        // For maFile authentication, password is still required
        if (!credentials.password) {
            showNotification('Error', 'Please enter your Steam password', 'error');
            return;
        }
    } else {
        // Manual authentication - password is required
        if (!credentials.password) {
            showNotification('Error', 'Please fill in password', 'error');
            return;
        }
        
        // Manual Steam Guard code entry - validate format if provided
        if (credentials.twoFactorCode && !/^[A-Za-z0-9]{5}$/.test(credentials.twoFactorCode)) {
            showNotification('Error', 'Steam Guard code must be exactly 5 characters (letters or numbers)', 'error');
            // Highlight the field with error styling
            const twoFactorInput = document.getElementById('twoFactorCode');
            twoFactorInput.classList.add('invalid');
            return;
        }
        
        // Steam Guard code is required if no maFile is selected
        if (!credentials.twoFactorCode) {
            showNotification('Error', 'Please enter Steam Guard code or select a maFile for auto-authentication', 'error');
            return;
        }
    }

    showLoading(true);
    
    try {
        const result = await window.electronAPI.login(credentials);
        
        if (result.success) {
            // Login successful, wait for events
            addActivity('Login attempt successful, establishing connection...', 'info');
        } else if (result.needsTwoFactor) {
            // Show two-factor input
            twoFactorGroup.style.display = 'block';
            showNotification('Two-Factor Required', 'Please enter your Steam Guard code', 'warning');
            showLoading(false);
        } else {
            // Login failed
            showNotification('Login Failed', result.error || 'Unknown error occurred', 'error');
            showLoading(false);
            
            // If it's a timeout error, suggest retrying
            if (result.error && result.error.includes('timeout')) {
                addActivity('Login timeout - you can retry or enter Steam Guard code', 'warning');
            }
        }
    } catch (error) {
        showNotification('Error', 'Failed to connect to Steam', 'error');
        showLoading(false);
    }
}

async function handleLogout() {
    try {
        await window.electronAPI.logout();
        showLogin();
    } catch (error) {
        showNotification('Error', 'Failed to logout', 'error');
    }
}

async function refreshOffers() {
    showLoading(true);
    
    try {
        const result = await window.electronAPI.getPendingOffers();
        
        if (result.success) {
            // Update our local list with fresh data from Steam
            pendingOffers = result.offers;
            updateOffersList();
            addActivity(`Refreshed offers - ${pendingOffers.length} pending`, 'info');
        } else {
            showNotification('Error', 'Failed to refresh offers', 'error');
            addActivity(`Failed to refresh offers: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('Error refreshing offers:', error);
        showNotification('Error', 'Failed to refresh offers', 'error');
        addActivity(`Error refreshing offers: ${error.message}`, 'error');
    } finally {
        showLoading(false);
    }
}

async function checkConnectionStatus() {
    try {
        const result = await window.electronAPI.checkConnectionStatus();
        
        if (result.success) {
            if (result.connected) {
                let statusMessage = 'Steam connection is working properly';
                let activityMessage = 'Connection check: Steam is connected and responsive';
                
                // Add more detailed status information
                if (result.connectionStatus) {
                    switch (result.connectionStatus) {
                        case 'steam_client_connected':
                            statusMessage = 'Steam client connected, web session active';
                            activityMessage = 'Connection check: Steam client connected';
                            break;
                        case 'web_session_active':
                            statusMessage = 'Web session active, trade offers accessible';
                            activityMessage = 'Connection check: Web session active';
                            break;
                        case 'fully_connected':
                            statusMessage = 'Fully connected - all services working';
                            activityMessage = 'Connection check: Fully connected';
                            break;
                    }
                }
                
                showNotification('Connection Status', statusMessage, 'success');
                addActivity(activityMessage, 'success');
                updateStatus('online');
            } else {
                let statusMessage = 'Steam connection appears to be down';
                let activityMessage = 'Connection check: Steam connection is down';
                
                if (result.connectionStatus === 'connection_test_failed') {
                    statusMessage = 'Connection test failed - may need reconnection';
                    activityMessage = 'Connection check: Test failed, reconnection may be needed';
                }
                
                showNotification('Connection Status', statusMessage, 'warning');
                addActivity(activityMessage, 'warning');
                updateStatus('offline');
            }
        } else {
            showNotification('Connection Status', `Connection check failed: ${result.error}`, 'error');
            addActivity(`Connection check failed: ${result.error}`, 'error');
        }
    } catch (error) {
        showNotification('Connection Status', 'Failed to check connection status', 'error');
        addActivity('Connection check failed', 'error');
    }
}

async function acceptOffer(offerId) {
    try {
        // Check if the offer still exists in our local list
        const offerExists = pendingOffers.find(offer => offer.id === offerId);
        if (!offerExists) {
            showNotification('Error', 'Trade offer no longer exists or has expired', 'error');
            addActivity(`Trade offer ${offerId} not found - may have expired`, 'warning');
            // Refresh offers to get current state
            refreshOffers();
            return;
        }

        const result = await window.electronAPI.acceptOffer(offerId);
        
        if (result.success) {
            addActivity(`Accepted offer ${offerId}`, 'success');
            showNotification('Offer Accepted', `Trade offer ${offerId} has been accepted`, 'success');
            // Refresh the offers list to update the UI
            refreshOffers();
        } else {
            showNotification('Error', `Failed to accept offer: ${result.error}`, 'error');
            addActivity(`Failed to accept trade offer ${offerId}: ${result.error}`, 'error');
            
            // If the offer is not found, refresh the offers list
            if (result.error && result.error.includes('not found')) {
                refreshOffers();
            }
        }
    } catch (error) {
        console.error('Error accepting offer:', error);
        showNotification('Error', 'Failed to accept offer - please try refreshing', 'error');
        addActivity(`Error accepting trade offer ${offerId}: ${error.message}`, 'error');
        
        // Refresh offers to get current state
        refreshOffers();
    }
}

async function declineOffer(offerId) {
    try {
        const result = await window.electronAPI.declineOffer(offerId);
        
        if (result.success) {
            addActivity(`Declined offer ${offerId}`, 'warning');
        } else {
            showNotification('Error', `Failed to decline offer: ${result.error}`, 'error');
        }
    } catch (error) {
        showNotification('Error', 'Failed to decline offer', 'error');
    }
}

function showDashboard() {
    loginSection.style.display = 'none';
    dashboardSection.style.display = 'block';
    refreshOffers();
    initializeAutoAcceptSetting();
}

function showLogin() {
    dashboardSection.style.display = 'none';
    loginSection.style.display = 'flex';
    loginForm.reset();
    
    // Clear any HTML5 validation messages
    document.querySelectorAll('.form-group input').forEach(input => {
        input.classList.remove('valid', 'invalid');
        input.setCustomValidity('');
    });
    
    // Reset maFile selection status
    const selectedMaFileStatus = document.getElementById('selectedMaFileStatus');
    if (selectedMaFileStatus) {
        selectedMaFileStatus.style.display = 'none';
    }
    
    // Reset maFile status
    const maFileStatus = document.getElementById('maFileStatus');
    if (maFileStatus) {
        maFileStatus.style.display = 'none';
    }
    
    // Reset visual selection on maFile items
    const allMaFileItems = document.querySelectorAll('.mafile-item');
    allMaFileItems.forEach(item => {
        item.style.background = 'rgba(16, 185, 129, 0.1)';
        item.style.border = '1px solid rgba(16, 185, 129, 0.3)';
        item.style.transform = 'scale(1)';
    });
    
    // Restore Steam Guard code field and password field
    const twoFactorGroup = document.getElementById('twoFactorGroup');
    const passwordGroup = document.querySelector('.form-group:has(#password)');
    if (twoFactorGroup) {
        twoFactorGroup.classList.remove('mafile-selected');
    }
    if (passwordGroup) {
        passwordGroup.style.display = 'block';
    }
    
    // Restore password field label
    const passwordLabel = document.querySelector('label[for="password"]');
    if (passwordLabel) {
        passwordLabel.innerHTML = '<i class="fas fa-lock"></i> Password';
    }
    
    // Remove the auto-login event listener
    const passwordInput = document.getElementById('password');
    if (passwordInput) {
        passwordInput.removeEventListener('keypress', handlePasswordEnter);
    }
}

function updateStatus(status) {
    const statusDot = statusIndicator.querySelector('.status-dot');
    const statusText = statusIndicator.querySelector('.status-text');
    
    statusDot.className = `status-dot ${status}`;
    statusText.textContent = status.charAt(0).toUpperCase() + status.slice(1);
}

function updateOffersList() {
    if (pendingOffers.length === 0) {
        offersList.innerHTML = `
            <div class="no-offers">
                <i class="fas fa-inbox"></i>
                <p>No pending trade offers</p>
            </div>
        `;
        return;
    }

    offersList.innerHTML = pendingOffers.map(offer => {
        const isGift = offer.itemsToGive.length === 0 && offer.itemsToReceive.length > 0;
        
        return `
            <div class="offer-item ${isGift ? 'gift-offer' : ''}">
                <div class="offer-header">
                    <div>
                        <div class="offer-id">#${offer.id}</div>
                        <div class="offer-partner">${offer.partner}</div>
                        ${isGift ? '<span class="gift-badge">Gift</span>' : ''}
                    </div>
                    <div class="offer-state">${offer.state || 'Pending'}</div>
                </div>
                
                <div class="offer-items">
                    <div class="items-column">
                        <h4>You Give</h4>
                        <div class="items-list">
                            ${offer.itemsToGive.length > 0 
                                ? offer.itemsToGive.map(item => 
                                    `${item.appid}/${item.contextid}/${item.assetid}`
                                  ).join('<br>')
                                : '(nothing)'
                            }
                        </div>
                    </div>
                    <div class="items-column">
                        <h4>You Receive</h4>
                        <div class="items-list">
                            ${offer.itemsToReceive.length > 0 
                                ? offer.itemsToReceive.map(item => 
                                    `${item.appid}/${item.contextid}/${item.assetid}`
                                  ).join('<br>')
                                : '(nothing)'
                            }
                        </div>
                    </div>
                </div>
                
                ${offer.message ? `<div class="offer-message">${offer.message}</div>` : ''}
                
                ${!isGift ? `
                    <div class="offer-actions">
                        <button class="action-btn accept-btn" onclick="acceptOffer('${offer.id}')">
                            <i class="fas fa-check"></i>
                            Accept
                        </button>
                        <button class="action-btn decline-btn" onclick="declineOffer('${offer.id}')">
                            <i class="fas fa-times"></i>
                            Decline
                        </button>
                    </div>
                ` : `
                    <div class="offer-actions">
                        <button class="action-btn accept-btn" onclick="acceptGiftOffer('${offer.id}')">
                            <i class="fas fa-gift"></i>
                            Accept Gift
                        </button>
                    </div>
                `}
            </div>
        `;
    }).join('');
}

function addActivity(text, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const activity = { text, type, timestamp };
    
    activityLog.unshift(activity);
    
    // Keep only last 50 activities
    if (activityLog.length > 50) {
        activityLog = activityLog.slice(0, 50);
    }
    
    updateActivityList();
}

function updateActivityList() {
    if (activityLog.length === 0) {
        activityList.innerHTML = `
            <div class="no-activity">
                <i class="fas fa-clock"></i>
                <p>No recent activity</p>
            </div>
        `;
        return;
    }

    activityList.innerHTML = activityLog.map(activity => `
        <div class="activity-item">
            <div class="activity-text">${activity.text}</div>
            <div class="activity-time">${activity.timestamp}</div>
        </div>
    `).join('');
}

function showNotification(title, message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    
    const icon = getNotificationIcon(type);
    
    notification.innerHTML = `
        <i class="${icon}"></i>
        <div>
            <div style="font-weight: 600; margin-bottom: 0.2rem;">${title}</div>
            <div style="font-size: 0.9rem; opacity: 0.8;">${message}</div>
        </div>
    `;
    
    const notificationsContainer = document.getElementById('notifications');
    notificationsContainer.appendChild(notification);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 5000);
}

function getNotificationIcon(type) {
    switch (type) {
        case 'success': return 'fas fa-check-circle';
        case 'error': return 'fas fa-exclamation-circle';
        case 'warning': return 'fas fa-exclamation-triangle';
        case 'info': return 'fas fa-info-circle';
        default: return 'fas fa-info-circle';
    }
}

function showLoading(show) {
    loadingOverlay.style.display = show ? 'flex' : 'none';
}

// Utility functions
function formatSteamId(steamId) {
    if (!steamId) return 'Unknown';
    return steamId.length > 17 ? steamId.substring(0, 17) + '...' : steamId;
}

function formatItems(items) {
    if (!items || items.length === 0) return '(nothing)';
    return items.map(item => `${item.appid}/${item.contextid}/${item.assetid}`).join(', ');
}

// Toggle two-factor help explanation
function toggleTwoFactorHelp() {
    const helpText = document.querySelector('#twoFactorGroup small:last-child');
    if (helpText.style.display === 'none') {
        helpText.style.display = 'block';
    } else {
        helpText.style.display = 'none';
    }
}

// Real-time Steam Guard code validation
function validateSteamGuardCode() {
    const input = this;
    const value = input.value.trim();
    
    // Remove all validation classes
    input.classList.remove('valid', 'invalid');
    
    // If empty, that's fine (optional field)
    if (!value) {
        return;
    }
    
    // Check if it's exactly 5 alphanumeric characters
    if (/^[A-Za-z0-9]{5}$/.test(value)) {
        // Valid format
        input.classList.add('valid');
    } else {
        // Invalid format
        input.classList.add('invalid');
    }
}

// Force reconnect function
async function forceReconnect() {
    try {
        showNotification('Reconnecting', 'Attempting to force reconnect to Steam...', 'warning');
        addActivity('Force reconnection initiated', 'warning');
        
        // This will trigger a reconnection attempt
        const result = await window.electronAPI.forceReconnect();
        
        if (result.success) {
            showNotification('Reconnecting', 'Reconnection attempt initiated', 'info');
            addActivity('Force reconnection attempt started', 'info');
        } else {
            showNotification('Reconnection Failed', result.error || 'Failed to initiate reconnection', 'error');
            addActivity(`Force reconnection failed: ${result.error}`, 'error');
        }
    } catch (error) {
        showNotification('Error', 'Failed to force reconnect', 'error');
        addActivity('Force reconnection failed', 'error');
    }
}

// Handle auto-accept gifts toggle
async function handleAutoAcceptToggle() {
    try {
        const result = await window.electronAPI.toggleAutoAcceptGifts();
        if (result.success) {
            const isEnabled = result.autoAcceptGifts;
            showNotification(
                'Auto-Accept Gifts', 
                `Gift auto-accept is now ${isEnabled ? 'enabled' : 'disabled'}`, 
                isEnabled ? 'success' : 'warning'
            );
            addActivity(`Gift auto-accept ${isEnabled ? 'enabled' : 'disabled'}`, isEnabled ? 'success' : 'warning');
        } else {
            showNotification('Error', 'Failed to update auto-accept setting', 'error');
            // Revert the toggle if it failed
            const autoAcceptToggle = document.getElementById('autoAcceptToggle');
            autoAcceptToggle.checked = !autoAcceptToggle.checked;
        }
    } catch (error) {
        showNotification('Error', 'Failed to update auto-accept setting', 'error');
        // Revert the toggle if it failed
        const autoAcceptToggle = document.getElementById('autoAcceptToggle');
        autoAcceptToggle.checked = !autoAcceptToggle.checked;
    }
}

// Initialize auto-accept setting from main process
async function initializeAutoAcceptSetting() {
    try {
        const result = await window.electronAPI.getAutoAcceptSetting();
        if (result.success) {
            const autoAcceptToggle = document.getElementById('autoAcceptToggle');
            autoAcceptToggle.checked = result.autoAcceptGifts;
        }
    } catch (error) {
        console.error('Failed to get auto-accept setting:', error);
    }
}

// Manually accept a gift offer (useful when auto-accept was disabled)
async function acceptGiftOffer(offerId) {
    try {
        // Check if the offer still exists in our local list
        const offerExists = pendingOffers.find(offer => offer.id === offerId);
        if (!offerExists) {
            showNotification('Error', 'Gift offer no longer exists or has expired', 'error');
            addActivity(`Gift offer ${offerId} not found - may have expired`, 'warning');
            // Refresh offers to get current state
            refreshOffers();
            return;
        }

        const result = await window.electronAPI.acceptOffer(offerId);
        if (result.success) {
            addActivity(`Manually accepted gift offer ${offerId}`, 'success');
            showNotification('Gift Accepted', `Gift offer ${offerId} has been manually accepted`, 'success');
            refreshOffers();
        } else {
            showNotification('Error', `Failed to accept gift: ${result.error}`, 'error');
            addActivity(`Failed to accept gift offer ${offerId}: ${result.error}`, 'error');
            
            // If the offer is not found, refresh the offers list
            if (result.error && result.error.includes('not found')) {
                refreshOffers();
            }
        }
    } catch (error) {
        console.error('Error accepting gift offer:', error);
        showNotification('Error', 'Failed to accept gift offer - please try refreshing', 'error');
        addActivity(`Error accepting gift offer ${offerId}: ${error.message}`, 'error');
        
        // Refresh offers to get current state
        refreshOffers();
    }
}

// maFile functions
async function refreshMaFiles() {
    try {
        const result = await window.electronAPI.scanMaFiles();
        if (result.success) {
            updateMaFilesList(result.maFiles);
            showNotification('maFiles Refreshed', `Found ${result.maFiles.length} authenticator files`, 'success');
        } else {
            showNotification('Error', 'Failed to refresh maFiles', 'error');
        }
    } catch (error) {
        showNotification('Error', 'Failed to refresh maFiles', 'error');
    }
}

function updateMaFilesList(maFiles) {
    const maFilesList = document.getElementById('maFilesList');
    
    if (!maFiles || maFiles.length === 0) {
        maFilesList.innerHTML = `
            <div class="no-mafiles">
                <i class="fas fa-key"></i>
                <p>No maFiles found in /mafiles directory</p>
                <small style="color: #10b981;">
                    Place your Steam Guard authenticator files (.mafile) in the /mafiles folder for automatic authentication
                </small>
            </div>
        `;
        return;
    }
    
    maFilesList.innerHTML = maFiles.map(maFile => `
        <div class="mafile-item" data-account-name="${maFile.accountName}" style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 1rem; margin-bottom: 0.5rem; cursor: pointer; transition: all 0.3s ease;" onclick="selectMaFile('${maFile.accountName}')">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <div style="font-weight: 600; color: #10b981; margin-bottom: 0.2rem;">
                        <i class="fas fa-user"></i>
                        ${maFile.accountName}
                    </div>
                    <div style="font-size: 0.8rem; color: #10b981; opacity: 0.8;">
                        <i class="fas fa-file"></i>
                        ${maFile.filename}
                    </div>
                    ${maFile.steamId ? `<div style="font-size: 0.8rem; color: #10b981; opacity: 0.8;">
                        <i class="fas fa-id-card"></i>
                        ${maFile.steamId}
                    </div>` : ''}
                </div>
                <div style="color: #10b981; font-size: 1.5rem;">
                    <i class="fas fa-check-circle"></i>
                </div>
            </div>
        </div>
    `).join('');
}

async function checkMaFileAvailability() {
    const username = document.getElementById('username').value.trim();
    const maFileStatus = document.getElementById('maFileStatus');
    const selectedMaFileStatus = document.getElementById('selectedMaFileStatus');
    
    if (!username) {
        maFileStatus.style.display = 'none';
        selectedMaFileStatus.style.display = 'none';
        return;
    }
    
    try {
        const result = await window.electronAPI.checkMaFileAvailable(username);
        if (result.success && result.available) {
            maFileStatus.style.display = 'block';
            document.getElementById('maFileStatusText').textContent = `maFile found for ${username} - auto-authentication available`;
            maFileStatus.style.background = 'rgba(16, 185, 129, 0.1)';
            maFileStatus.style.border = '1px solid rgba(16, 185, 129, 0.3)';
        } else {
            maFileStatus.style.display = 'none';
            selectedMaFileStatus.style.display = 'none';
        }
    } catch (error) {
        maFileStatus.style.display = 'none';
        selectedMaFileStatus.style.display = 'none';
    }
}

// Function to select a maFile and auto-fill the login form
async function selectMaFile(accountName) {
    try {
        // Fill in the username
        document.getElementById('username').value = accountName;
        
        // Clear any existing Steam Guard code
        document.getElementById('twoFactorCode').value = '';
        
        // Check if maFile is available and generate Steam Guard code
        const result = await window.electronAPI.checkMaFileAvailable(accountName);
        if (result.success && result.available) {
            // Clear any existing Steam Guard code
            document.getElementById('twoFactorCode').value = '';
            
            // Show notification that maFile was selected
            showNotification('maFile Selected', `Selected ${accountName} for authentication. Steam Guard code will be auto-generated.`, 'info');
            
            // Update the maFile status
            const maFileStatus = document.getElementById('maFileStatus');
            maFileStatus.style.display = 'block';
            document.getElementById('maFileStatusText').textContent = `maFile selected for ${accountName} - ready for login`;
            maFileStatus.style.background = 'rgba(16, 185, 129, 0.2)';
            maFileStatus.style.border = '1px solid rgba(16, 185, 129, 0.5)';
            
            // Show the selected maFile status indicator
            const selectedMaFileStatus = document.getElementById('selectedMaFileStatus');
            const selectedMaFileInfo = document.getElementById('selectedMaFileInfo');
            selectedMaFileStatus.style.display = 'block';
            selectedMaFileInfo.textContent = `Selected: ${accountName} - Ready for login with auto-generated Steam Guard code`;
            
            // Add visual feedback to the selected maFile
            const allMaFileItems = document.querySelectorAll('.mafile-item');
            allMaFileItems.forEach(item => {
                item.style.background = 'rgba(16, 185, 129, 0.1)';
                item.style.border = '1px solid rgba(16, 185, 129, 0.3)';
            });
            
            const selectedItem = document.querySelector(`[data-account-name="${accountName}"]`);
            if (selectedItem) {
                selectedItem.style.background = 'rgba(16, 185, 129, 0.2)';
                selectedItem.style.border = '1px solid rgba(16, 185, 129, 0.6)';
                selectedItem.style.transform = 'scale(1.02)';
            }
            
            // Automatically trigger login with maFile authentication
            await autoLoginWithMaFile(accountName);
            
            // Immediately start the authentication process
            await startMaFileAuthentication(accountName);
        } else {
            showNotification('Error', `No maFile found for ${accountName}`, 'error');
        }
    } catch (error) {
        showNotification('Error', 'Failed to select maFile', 'error');
    }
}

// Function to automatically login using maFile authentication
async function autoLoginWithMaFile(accountName) {
    try {
        // Check if maFile is available and get Steam Guard code
        const result = await window.electronAPI.loginWithMaFile(accountName);
        
        if (result.success) {
            // Hide the Steam Guard code field by adding a class that maintains layout
            const twoFactorGroup = document.getElementById('twoFactorGroup');
            twoFactorGroup.classList.add('mafile-selected');
            
            // Update the status to show that maFile authentication is starting
            const selectedMaFileInfo = document.getElementById('selectedMaFileInfo');
            selectedMaFileInfo.innerHTML = `
                <div style="margin-bottom: 1rem;">
                    <strong>${accountName}</strong> selected for maFile authentication
                </div>
                <div style="font-size: 0.8rem; opacity: 0.9;">
                    Steam Guard code will be auto-generated from your maFile.<br>
                    <strong>Authentication starting automatically...</strong>
                </div>
            `;
            
            showNotification('maFile Ready', `${accountName} maFile loaded. Starting automatic authentication...`, 'success');
            addActivity(`maFile authentication ready for ${accountName}`, 'info');
        } else {
            showNotification('maFile Error', result.error || 'Failed to load maFile', 'error');
            addActivity(`maFile error for ${accountName}: ${result.error}`, 'error');
        }
    } catch (error) {
        showNotification('maFile Error', 'Failed to load maFile', 'error');
        addActivity(`maFile error for ${accountName}: ${error.message}`, 'error');
    }
}

// Function to automatically start authentication when maFile is clicked
async function startMaFileAuthentication(accountName) {
    try {
        showNotification('Password Required', `Please enter your Steam password for ${accountName}`, 'info');
        addActivity(`maFile selected for ${accountName} - password required`, 'info');
        
        // Password field is always visible, no need to change display
        
        // Update the status to show that password is needed
        const selectedMaFileInfo = document.getElementById('selectedMaFileInfo');
        selectedMaFileInfo.innerHTML = `
            <div style="margin-bottom: 1rem;">
                <strong>${accountName}</strong> selected for maFile authentication
            </div>
            <div style="font-size: 0.8rem; opacity: 0.9;">
                Steam Guard code will be auto-generated from your maFile.<br>
                <strong>Enter your Steam password and click Login!</strong>
            </div>
        `;
        
        // Focus on password field
        const passwordInput = document.getElementById('password');
        if (passwordInput) {
            passwordInput.focus();
        }
        
    } catch (error) {
        showNotification('Error', 'Failed to prepare maFile authentication', 'error');
        addActivity(`Failed to prepare authentication for ${accountName}: ${error.message}`, 'error');
    }
}

// Handle Enter key press in password field for auto-login
function handlePasswordEnter(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        
        // Trigger login automatically
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.dispatchEvent(new Event('submit'));
        }
    }
}

// Function to switch back to manual Steam Guard authentication
function switchToManualSteamGuard() {
    try {
        // Remove maFile selection
        const selectedMaFileStatus = document.getElementById('selectedMaFileStatus');
        if (selectedMaFileStatus) {
            selectedMaFileStatus.style.display = 'none';
        }
        
        // Reset maFile status
        const maFileStatus = document.getElementById('maFileStatus');
        if (maFileStatus) {
            maFileStatus.style.display = 'none';
        }
        
        // Reset visual selection on maFile items
        const allMaFileItems = document.querySelectorAll('.mafile-item');
        allMaFileItems.forEach(item => {
            item.style.background = 'rgba(16, 185, 129, 0.1)';
            item.style.border = '1px solid rgba(16, 185, 129, 0.3)';
            item.style.transform = 'scale(1)';
        });
        
        // Restore Steam Guard code field
        const twoFactorGroup = document.getElementById('twoFactorGroup');
        if (twoFactorGroup) {
            twoFactorGroup.classList.remove('mafile-selected');
        }
        
        // Clear username and password
        document.getElementById('username').value = '';
        document.getElementById('password').value = '';
        document.getElementById('twoFactorCode').value = '';
        
        // Show notification
        showNotification('Switched to Manual', 'Now using manual Steam Guard code entry', 'info');
        addActivity('Switched from maFile to manual Steam Guard authentication', 'info');
        
    } catch (error) {
        showNotification('Error', 'Failed to switch to manual authentication', 'error');
        addActivity(`Failed to switch to manual: ${error.message}`, 'error');
    }
}

// Initialize maFiles on page load
document.addEventListener('DOMContentLoaded', () => {
    refreshMaFiles();
});
