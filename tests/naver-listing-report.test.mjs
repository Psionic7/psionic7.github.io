import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validRegionalListingReport} from '../src/naver-listing-report.mjs';
const snapshot=JSON.parse(fs.readFileSync(new URL('../public/listings/snapshot.json',import.meta.url),'utf8'));
const report=JSON.parse(fs.readFileSync(new URL('../public/listings/region-41465-report.json',import.meta.url),'utf8'));
test('published regional counts reconcile with actual saved advertisements and distinguish partial coverage',()=>{
  assert.equal(validRegionalListingReport(report,snapshot,'41465'),true);
  const changed=structuredClone(report);changed.summary.advertisementCount++;
  assert.equal(validRegionalListingReport(changed,snapshot,'41465'),false);
  changed.summary.advertisementCount--;changed.summary.unmatchedTargets++;
  assert.equal(validRegionalListingReport(changed,snapshot,'41465'),false);
  assert.equal(validRegionalListingReport(report,snapshot,'41135'),false);
});
test('missing ads, false full-coverage claims and changed observation times fail publication checks',()=>{
  const lost=structuredClone(snapshot),group=lost.groups.find(g=>g.favorite.region_code==='41465'&&g.articles.length);
  group.articles.pop();assert.equal(validRegionalListingReport(report,lost,'41465'),false);
  const changed=structuredClone(report);changed.results.find(r=>r.status==='partial').status='complete';assert.equal(validRegionalListingReport(changed,snapshot,'41465'),false);
  const retimed=structuredClone(report);retimed.results.find(r=>r.status==='complete').collectedAt='2026-01-01T00:00:00.000Z';assert.equal(validRegionalListingReport(retimed,snapshot,'41465'),false);
});
