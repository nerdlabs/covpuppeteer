#!/usr/bin/env node

const puppeteer = require('puppeteer');
const { SourceMapConsumer } = require('source-map');
const fetch = require('node-fetch');
const prettyBytes = require('pretty-bytes');

const urlToProfile = process.argv[2];

const resolveUrl = (from, to) => {
  return (
    from.slice(
      0,
      to[0] === '/' ? from.slice(8).indexOf('/') : from.lastIndexOf('/')
    ) +
    '/' +
    to
  );
};

const smre = /\/\/[#@]\s*sourceMappingURL=(.*)\s*$/gm;

puppeteer
  .launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] })
  .then(async browser => {
    const page = await browser.newPage();

    await page.coverage.startJSCoverage();

    await page.goto(urlToProfile);

    const coverage = await page.coverage.stopJSCoverage();

    for (const entry of coverage) {
      const totalBytes = entry.text.length;
      const uncovered = [];
      let lastStop = 0;

      for (const range of entry.ranges) {
        if (lastStop !== range.start) {
          uncovered.push([lastStop, range.start]);
        }
        lastStop = range.end;
      }
      if (lastStop < totalBytes) {
        uncovered.push([lastStop, totalBytes]);
      }

      let match;
      let tmp;
      while ((tmp = smre.exec(entry.text)) != null) {
        match = tmp;
      }
      if (match) {
        const [, url] = match;
        const data = await fetch(resolveUrl(entry.url, url)).then(x =>
          x.text()
        );

        const uncoveredBytes = await SourceMapConsumer.with(
          data,
          null,
          consumer => {
            const x = uncovered.reduce((uncoveredBytes, [start, end]) => {
              const length = end - start;
              const location = consumer.originalPositionFor({
                line: 1,
                column: start,
              });
              if (!uncoveredBytes[location.source]) {
                uncoveredBytes[location.source] = length;
              } else {
                uncoveredBytes[location.source] += length;
              }
              return uncoveredBytes;
            }, {});

            return Object.entries(x)
              .sort(([, a], [, b]) => b - a)
              .map(([location, size]) => [size, location]);
          }
        );

        console.log(entry.url);
        uncoveredBytes.slice(0, 8).forEach(([bytes, location]) => {
          if (location && location !== 'null') {
            console.log(`${prettyBytes(bytes)} in ${location}`);
          }
        });
        console.log('');
      }
    }

    await browser.close();
  });
