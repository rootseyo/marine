const { chromium } = require('playwright');

/**
 * Manages Playwright browser instances and contexts
 */
class BrowserManager {
    static async getBrowser() {
        return await chromium.launch({
            headless: false,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        });
    }

    static getDeviceConfig(device = 'desktop') {
        const configs = {
            desktop: {
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
                viewport: { width: 1440, height: 900 }
            },
            mobile: {
                userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
                viewport: { width: 390, height: 844 },
                isMobile: true,
                hasTouch: true
            }
        };
        return configs[device] || configs.desktop;
    }
}

module.exports = BrowserManager;
