// https://github.com/puppeteer/puppeteer/issues/3719

import { inspect } from 'util';

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  createWriteStream,
} from 'fs';

import { join } from 'path';

import puppeteer, { Browser, Page } from 'puppeteer';

import diskCacheDir from './utils/diskCacheDir';
import testResultsDir from './utils/testResultsDir';

const creds = JSON.parse(
  readFileSync(join(__dirname, '../config/avail-stories-creds.json'), {
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
  console.log('LOGIN');

  const emailSelector = '#email';
  const passwordSelector = '#password';

  await Promise.all([
    page.waitForSelector(emailSelector),
    page.waitForSelector(passwordSelector),
  ]);

  await page.waitForTimeout(1000);

  await page.type(emailSelector, creds.username, {
    delay: 50,
  });

  await page.waitForTimeout(1000);

  await page.type(passwordSelector, creds.password, {
    delay: 50,
  });
  await page.waitForTimeout(1000);

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

async function logNetworkActivity(page: Page) {
  const writer = createWriteStream(
    join(
      pageResultsDir,
      `network-activity.${Math.floor(Date.now() / 1000)}.log`,
    ),
  );

  page.on('close', () => writer.close());

  let paused = false;
  let pausedRequests: Array<() => Promise<void>> = [];

  const nextRequest = () => {
    // continue the next request or "unpause"
    if (pausedRequests.length === 0) {
      paused = false;
    } else {
      // continue first request in "queue"
      // @ts-ignore
      pausedRequests.shift()(); // calls the request.continue function
    }
  };

  await page.setRequestInterception(true);

  page.on('request', (request) => {
    console.log(inspect(request));

    if (paused) {
      pausedRequests.push(() => request.continue());
    } else {
      paused = true; // pause, as we are processing a request now
      request.continue();
    }
  });

  page.on('requestfinished', async (request) => {
    try {
      console.log(inspect(request));

      const response = request.response();

      if (response !== null) {
        const responseHeaders = response.headers();

        // body can only be access for non-redirect responses
        const responseBody =
          request.redirectChain().length === 0 &&
          /json/.test(response.headers()['content-type'])
            ? await response.json()
            : null;

        const information = {
          url: request.url(),
          requestHeaders: request.headers(),
          requestPostData: request.postData(),
          responseHeaders: responseHeaders,
          responseBody,
        };

        writer.write(`${JSON.stringify(information)}\n`);
      }
    } catch (err) {
      console.error(err);
    }

    nextRequest(); // continue with next request
  });

  page.on('requestfailed', (_request) => {
    // handle failed request
    nextRequest();
  });
}

async function main() {
  const browser = await createBrowser();

  const page = await createPage(browser);

  logNetworkActivity(page);

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

  console.log(page.url());

  await page.waitForNavigation({ waitUntil: 'networkidle2' });

  console.log('LOADED');

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
