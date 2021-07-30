// https://github.com/puppeteer/puppeteer/issues/3719

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

import puppeteer, { Browser, Page } from 'puppeteer';

import diskCacheDir from './utils/diskCacheDir';
import testResultsDir from './utils/testResultsDir';

const creds = JSON.parse(
  readFileSync(join(__dirname, '../config/avail-creds.json'), {
    encoding: 'utf8',
  }),
);

const pageResultsDir = join(testResultsDir, 'avail-stories');

mkdirSync(pageResultsDir, { recursive: true });

const localStoragePath = join(pageResultsDir, 'localStorage.json');
const sessionStoragePath = join(pageResultsDir, 'sessionStorage.json');
const cookiesPath = join(pageResultsDir, 'cookies.json');

const localStorage = existsSync(localStoragePath)
  ? JSON.parse(readFileSync(localStoragePath, { encoding: 'utf8' }))
  : {};

const sessionStorage = existsSync(sessionStoragePath)
  ? JSON.parse(readFileSync(sessionStoragePath, { encoding: 'utf8' }))
  : {};

const cookies = existsSync(cookiesPath)
  ? JSON.parse(readFileSync(cookiesPath, { encoding: 'utf8' }))
  : [];

function createBrowser() {
  return puppeteer.launch({
    headless: false,
    ignoreHTTPSErrors: true,
    args: ['--no-sandbox', `--disk-cache-dir=${diskCacheDir}`],
  });
}

// https://stackoverflow.com/a/48035121/3970755
const createPage = async (browser: Browser): Promise<Page> => {
  let page = await browser.newPage();

  return page;
};

async function login(page: Page) {
  const emailSelector = '#email';
  const passwordSelector = '#password';

  await Promise.all([
    page.waitForSelector(emailSelector),
    page.waitForSelector(passwordSelector),
  ]);

  await page.focus(emailSelector);
  await page.keyboard.type(creds.username);

  await page.focus(passwordSelector);
  await page.keyboard.type(creds.password);

  await page.keyboard.press('Enter');
  await page.waitForNavigation({ waitUntil: 'networkidle0' });

  const cookies = await page.cookies();
  const localStorage = await page.evaluate(() => JSON.stringify(localStorage));
  const sessionStorage = await page.evaluate(() =>
    JSON.stringify(sessionStorage),
  );

  writeFileSync(cookiesPath, JSON.stringify(cookies));
  writeFileSync(localStoragePath, localStorage);
  writeFileSync(sessionStoragePath, sessionStorage);
}

async function main() {
  const browser = await createBrowser();

  const page = await createPage(browser);

  await page.setCookie(...cookies);

  await page.evaluateOnNewDocument(
    (d: Record<string, any>) => {
      console.log(d);

      localStorage.clear();
      Object.keys(d.localStorage).forEach((k) =>
        localStorage.setItem(k, d.localStorage[k]),
      );

      sessionStorage.clear();
      Object.keys(d.sessionStorage).forEach((k) =>
        sessionStorage.setItem(k, d.sessionStorage[k]),
      );
    },
    { localStorage, sessionStorage },
  );

  await page.goto(creds.url);

  await page.waitForNavigation({ waitUntil: 'networkidle0' });

  const url = page.url();

  if (/login$/.test(url)) {
    console.log(url);

    await login(page);

    console.log(page.url());
  } else {
    console.log(url);
  }

  await page.close();
  await browser.close();
  console.log('done');
}

(async () => main())();
// main();
