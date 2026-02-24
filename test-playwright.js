const { chromium } = require('playwright');

(async () => {
    console.log('Testing Playwright on mini-sean...');
    let browser;
    try {
        console.log('1. Launching browser (Chromium)...');
        browser = await chromium.launch({ 
            headless: true 
        });
        
        const context = await browser.newContext();
        const page = await context.newPage();
        
        const testUrl = 'https://www.google.com';
        console.log(`2. Navigating to: ${testUrl}`);
        await page.goto(testUrl, { waitUntil: 'networkidle' });
        
        const title = await page.title();
        console.log(`3. Successfully got title: "${title}"`);
        
        console.log('4. Capturing screenshot...');
        await page.screenshot({ path: 'test-screenshot.png' });
        console.log('Check test-screenshot.png in the current directory.');
        
        console.log('\nSuccess! Playwright is working correctly on x86.');
    } catch (error) {
        console.error('\nError running Playwright:');
        console.error(error);
    } finally {
        if (browser) await browser.close();
    }
})();
