// https://github.com/puppeteer/puppeteer/issues/3719

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  symlinkSync,
  watch,
} from 'fs';

import { join } from 'path';

import puppeteer, { Browser, Page, ElementHandle } from 'puppeteer';

import diskCacheDir from './utils/diskCacheDir';
import testResultsDir from './utils/testResultsDir';

const creds = JSON.parse(
  readFileSync(join(__dirname, '../config/transit-admin-511.json'), {
    encoding: 'utf8',
  }),
);

const OPTIONS = {
  windowWidth: 1680,
  windowHeight: 1050,
  viewportWidth: 1650,
  viewportHeight: 1000,
};

const loginPageUrlRE = /login$/;

enum PageElementSelectors {
  LoginEmailField = 'input[name=email]',
  LoginPasswordField = 'input[name=password]',
  PublicOnlyFeedsButton = 'a[value=PUBLIC]',
  AgenciesList = '.list-group-item',
  AgencyFeedDownloadButton = 'button[data-test-id=download-feed-version-button]',
}

const nysdotAgencyRE = /^NYSDOT \/ /;

const pageResultsDir = join(testResultsDir, 'transit-admin-511');
const downloadsDir = join(
  pageResultsDir,
  'downloads',
  `${Math.round(Date.now() / 1000)}`,
);

mkdirSync(downloadsDir, { recursive: true });

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
    args: [
      '--disable-dev-shm-usage',
      `--disk-cache-dir=${diskCacheDir}`,
      `--window-size=${OPTIONS.windowWidth},${OPTIONS.windowHeight}`,
    ],
  });
}

// https://stackoverflow.com/a/48035121/3970755
const createPage = async (browser: Browser): Promise<Page> => {
  let page = await browser.newPage();

  page.setViewport({
    width: OPTIONS.viewportWidth,
    height: OPTIONS.viewportHeight,
  });

  return page;
};

async function login(page: Page) {
  // https://community.auth0.com/t/scripting-with-puppeteer/12662/2
  await page.waitForTimeout(1000);

  await page.waitForSelector(PageElementSelectors.LoginEmailField);
  await page.waitForTimeout(1000);

  await page.type(PageElementSelectors.LoginEmailField, creds.username, {
    delay: 50,
  });

  await page.waitForTimeout(1000);

  await page.type(PageElementSelectors.LoginPasswordField, creds.password, {
    delay: 50,
  });
  await page.waitForTimeout(1000);

  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);

  await page.waitForNavigation({ waitUntil: 'networkidle2' });

  const cookies = await page.cookies();
  const localStorage = await page.evaluate(() => JSON.stringify(localStorage));
  const sessionStorage = await page.evaluate(() =>
    JSON.stringify(sessionStorage),
  );

  console.log(
    JSON.stringify({ cookies, localStorage, sessionStorage }, null, 4),
  );

  writeFileSync(cookiesPath, JSON.stringify(cookies));
  writeFileSync(localStoragePath, localStorage);
  writeFileSync(sessionStoragePath, sessionStorage);
}

async function clickPublicFeedsOnlyButton(page: Page) {
  await page.waitForSelector(PageElementSelectors.PublicOnlyFeedsButton);

  await page.waitForTimeout(1500);

  const button = await page.$(PageElementSelectors.PublicOnlyFeedsButton);

  if (button) {
    await button.click();
  }

  await page.waitForTimeout(1500);
}

async function getNysdotAgenciesLinks(page: Page) {
  console.log('getNysdotAgenciesLinks');

  const items = await page.$$(PageElementSelectors.AgenciesList);

  page.waitForTimeout(1500);

  const linksByAgency = {};

  for (const item of items) {
    try {
      const a = await item.$('a');

      const title = await a?.evaluate((el) => el.getAttribute('title'));

      if (!title) {
        continue;
      }

      if (!nysdotAgencyRE.test(title)) {
        continue;
      }

      const agency = title
        .replace(nysdotAgencyRE, '')
        .toLowerCase()
        .replace(/'/, '')
        .replace(/[^0-9a-z]{1,}/g, '_');

      linksByAgency[agency] = a;
    } catch (err) {
      console.error(err);
    }
  }

  return linksByAgency;
}

async function scrapeGtfs(
  browser: Browser,
  linksByAgency: Record<string, ElementHandle>,
) {
  const agencyNames = Object.keys(linksByAgency);

  for (const agency_name of agencyNames) {
    await new Promise((resolve) => setTimeout(resolve, 3000));

    console.log('downloading', agency_name);

    const a = linksByAgency[agency_name];

    const agencyPagePromise: Promise<Page> = new Promise((x) =>
      browser.once('targetcreated', (target) => x(target.page())),
    );

    console.log('clicking agency link');

    await a.click({ button: 'middle' });

    const agencyPage = await agencyPagePromise;

    await agencyPage.bringToFront();

    await agencyPage.waitForSelector(
      PageElementSelectors.AgencyFeedDownloadButton,
    );
    await agencyPage.waitForTimeout(3000);

    const agencyDownloadDir = join(downloadsDir, agency_name);

    mkdirSync(agencyDownloadDir, { recursive: true });

    // https://www.scrapingbee.com/blog/download-file-puppeteer/
    // @ts-ignore
    await agencyPage._client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: agencyDownloadDir,
    });

    const button = await agencyPage.$(
      PageElementSelectors.AgencyFeedDownloadButton,
    );

    console.time('download');
    const download_timestamp = Math.floor(Date.now() / 1000);
    await button?.click();

    await new Promise<void>((resolve) => {
      const watcher = watch(agencyDownloadDir, (eventType, filename) => {
        if (eventType !== 'change') {
          console.log(JSON.stringify({ eventType, filename }, null, 4));
        }

        // Until download complete, file matches /.zip.crdownload$/
        if (/.zip$/.test(filename)) {
          watcher.close();

          // Create a symlink for the download GTFS Feed zip archive
          const linkPath = join(agencyDownloadDir, 'gtfs.zip');

          symlinkSync(filename, linkPath);

          writeFileSync(
            join(agencyDownloadDir, 'download_metadata.json'),
            JSON.stringify({
              agency_name,
              download_timestamp,
            }),
          );

          return resolve();
        }
      });
    });
    console.timeEnd('download');

    await agencyPage.waitForTimeout(3000);
    await agencyPage.close();
  }
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

  if (loginPageUrlRE.test(url)) {
    await login(page);
  }

  await clickPublicFeedsOnlyButton(page);

  const linksByAgency = await getNysdotAgenciesLinks(page);

  await scrapeGtfs(browser, linksByAgency);

  await page.waitForTimeout(1500);

  await page.close();
  await browser.close();
}

main();
