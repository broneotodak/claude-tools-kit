#!/usr/bin/env node

/**
 * Web Scraper Tool for Claude Tools Kit
 * 
 * This tool provides powerful web scraping capabilities using Puppeteer.
 * It can handle authentication, wait for dynamic content, and extract data.
 * 
 * Usage:
 *   node web-scraper.js <url> [options]
 * 
 * Options:
 *   --auth            Enable authentication mode
 *   --username <user> Username for authentication
 *   --password <pass> Password for authentication
 *   --screenshot      Take screenshot of the page
 *   --wait <selector> Wait for specific selector
 *   --timeout <ms>    Set navigation timeout (default: 30000)
 *   --headless        Run in headless mode (default: false)
 *   --output <file>   Output file for scraped data
 */

const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

// Parse command line arguments
function parseArgs(args) {
    const options = {
        url: null,
        auth: false,
        username: null,
        password: null,
        screenshot: false,
        wait: null,
        timeout: 30000,
        headless: false,
        output: null
    };

    for (let i = 2; i < args.length; i++) {
        const arg = args[i];
        
        if (!arg.startsWith('--') && !options.url) {
            options.url = arg;
        } else {
            switch (arg) {
                case '--auth':
                    options.auth = true;
                    break;
                case '--username':
                    options.username = args[++i];
                    break;
                case '--password':
                    options.password = args[++i];
                    break;
                case '--screenshot':
                    options.screenshot = true;
                    break;
                case '--wait':
                    options.wait = args[++i];
                    break;
                case '--timeout':
                    options.timeout = parseInt(args[++i]);
                    break;
                case '--headless':
                    options.headless = true;
                    break;
                case '--output':
                    options.output = args[++i];
                    break;
            }
        }
    }

    return options;
}

// Main scraping function
async function scrapeWebsite(options) {
    console.log('🔍 Starting web scraper...\n');
    
    if (!options.url) {
        console.error('❌ Error: URL is required');
        console.log('\nUsage: node web-scraper.js <url> [options]');
        process.exit(1);
    }

    const browser = await puppeteer.launch({
        headless: options.headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        defaultViewport: { width: 1920, height: 1080 }
    });

    try {
        const page = await browser.newPage();
        
        // Set user agent to avoid detection
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        console.log(`📄 Loading ${options.url}...`);
        await page.goto(options.url, {
            waitUntil: 'networkidle0',
            timeout: options.timeout
        });

        // Handle authentication if required
        if (options.auth && options.username && options.password) {
            console.log('🔐 Performing authentication...');
            
            // Try to find username/email field
            const usernameSelectors = [
                'input[type="email"]',
                'input[type="text"][name*="user"]',
                'input[type="text"][name*="email"]',
                'input[type="text"][name*="login"]',
                '#username',
                '#email',
                '#login'
            ];
            
            let usernameField = null;
            for (const selector of usernameSelectors) {
                usernameField = await page.$(selector);
                if (usernameField) break;
            }
            
            if (usernameField) {
                await usernameField.click();
                await page.keyboard.type(options.username);
            }

            // Try to find password input field
            const pwdSelector = 'input[type="password"]';
            const pwdField = await page.$(pwdSelector);
            if (pwdField) {
                await pwdField.click();
                await page.keyboard.type(options.password);
            }

            // Try to find and click submit button
            const submitSelectors = [
                'button[type="submit"]',
                'input[type="submit"]',
                'button:contains("Sign In")',
                'button:contains("Login")',
                'button:contains("Log In")'
            ];
            
            for (const selector of submitSelectors) {
                try {
                    await page.click(selector);
                    await page.waitForNavigation({ waitUntil: 'networkidle0' });
                    break;
                } catch (e) {
                    // Try next selector
                }
            }
        }

        // Wait for specific selector if provided
        if (options.wait) {
            console.log(`⏳ Waiting for selector: ${options.wait}`);
            await page.waitForSelector(options.wait, { timeout: options.timeout });
        }

        // Take screenshot if requested
        if (options.screenshot) {
            const screenshotPath = `screenshot-${Date.now()}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.log(`📸 Screenshot saved: ${screenshotPath}`);
        }

        // Extract page data
        console.log('📊 Extracting page data...');
        const pageData = await page.evaluate(() => {
            const data = {
                title: document.title,
                url: window.location.href,
                metadata: {},
                content: {},
                links: [],
                images: []
            };

            // Extract metadata
            const metaTags = document.querySelectorAll('meta');
            metaTags.forEach(tag => {
                const name = tag.getAttribute('name') || tag.getAttribute('property');
                const content = tag.getAttribute('content');
                if (name && content) {
                    data.metadata[name] = content;
                }
            });

            // Extract main content
            data.content.text = document.body.innerText;
            data.content.html = document.body.innerHTML;

            // Extract all links
            const links = document.querySelectorAll('a[href]');
            links.forEach(link => {
                data.links.push({
                    text: link.innerText.trim(),
                    href: link.href,
                    title: link.title
                });
            });

            // Extract all images
            const images = document.querySelectorAll('img[src]');
            images.forEach(img => {
                data.images.push({
                    src: img.src,
                    alt: img.alt,
                    title: img.title
                });
            });

            // Extract structured data if available
            const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
            data.structuredData = [];
            jsonLdScripts.forEach(script => {
                try {
                    data.structuredData.push(JSON.parse(script.textContent));
                } catch (e) {
                    // Ignore parsing errors
                }
            });

            return data;
        });

        // Save output if requested
        if (options.output) {
            await fs.writeFile(options.output, JSON.stringify(pageData, null, 2));
            console.log(`💾 Data saved to: ${options.output}`);
        }

        // Print summary
        console.log('\n✅ Scraping completed successfully!');
        console.log(`📄 Title: ${pageData.title}`);
        console.log(`🔗 Links found: ${pageData.links.length}`);
        console.log(`🖼️  Images found: ${pageData.images.length}`);
        console.log(`📝 Content length: ${pageData.content.text.length} characters`);

        return pageData;

    } catch (error) {
        console.error('❌ Error during scraping:', error.message);
        throw error;
    } finally {
        await browser.close();
    }
}

// Run the scraper
if (require.main === module) {
    const options = parseArgs(process.argv);
    scrapeWebsite(options)
        .then(() => {
            console.log('\n🎉 Done!');
            process.exit(0);
        })
        .catch(error => {
            console.error('\n💥 Fatal error:', error);
            process.exit(1);
        });
}

module.exports = { scrapeWebsite };