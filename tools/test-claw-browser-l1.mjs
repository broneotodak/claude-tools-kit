// L1 smoke: prove antigravity profile loads IG + FB logged-in.
import { ClawBrowserSession } from './claw-browser-session.mjs';

const session = await ClawBrowserSession.acquire({
  profile: '.gemini/antigravity-browser-profile',
  pinRect: { w: 1440, h: 900 },
});

async function check(label, url, loggedInSelector, loggedOutSelector) {
  console.error(`[test] -> ${label}: ${url}`);
  await session.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // Race: whichever selector shows up first wins.
  const loggedInP = session.page.locator(loggedInSelector).first().waitFor({ state: 'visible', timeout: 15000 }).then(() => 'in').catch(() => null);
  const loggedOutP = session.page.locator(loggedOutSelector).first().waitFor({ state: 'visible', timeout: 15000 }).then(() => 'out').catch(() => null);
  const winner = await Promise.race([loggedInP, loggedOutP, new Promise(r => setTimeout(() => r('timeout'), 16000))]);
  const shot = await session.screenshot({ name: `${label}-l1` });
  return { label, url: session.page.url(), winner, shot };
}

const results = [];
results.push(await check(
  'ig',
  'https://www.instagram.com/',
  'svg[aria-label="Home"], svg[aria-label="New post"]',
  'input[name="username"]'
));
results.push(await check(
  'fb',
  'https://www.facebook.com/',
  'div[role="feed"], a[aria-label="Home"], div[aria-label="Create a post"]',
  'input[name="email"][id="email"], button[name="login"]'
));

console.log(JSON.stringify(results, null, 2));
await session.release({ keepAlive: true });

const allIn = results.every(r => r.winner === 'in');
process.exit(allIn ? 0 : 2);
