import assert from 'node:assert/strict';
import { patternForUrl, normalizePattern, webOrigins, label, isWebUrl, samePage } from '../sites.js';

// patternForUrl
assert.equal(patternForUrl('https://uat.example.com/app?x=1#y'), 'https://uat.example.com/*');
assert.equal(patternForUrl('http://localhost:3000/login'), 'http://localhost/*'); // port dropped
assert.equal(patternForUrl('chrome://extensions'), null);
assert.equal(patternForUrl('file:///tmp/a.html'), null);
assert.equal(patternForUrl('not a url'), null);
assert.equal(patternForUrl(undefined), null);

// normalizePattern
assert.equal(normalizePattern('uat.example.com'), '*://uat.example.com/*');
assert.equal(normalizePattern('  UAT.Example.com  '), '*://uat.example.com/*');
assert.equal(normalizePattern('*.example.com'), '*://*.example.com/*');
assert.equal(normalizePattern('https://uat.example.com/some/path'), 'https://uat.example.com/*');
assert.equal(normalizePattern('https://uat.example.com:8443'), 'https://uat.example.com/*');
assert.equal(normalizePattern('*://*.example.com/*'), '*://*.example.com/*');
assert.equal(normalizePattern('http://localhost:3000'), 'http://localhost/*');
for (const bad of ['', '   ', null, 'ftp://x.com', 'exa*mple.com', '*', '*://*/*x', '*.com', '*.*.example.com', 'a b.com', 'https://', 'exa_mple.com']) {
  assert.equal(normalizePattern(bad), null, `should reject ${JSON.stringify(bad)}`);
}

// webOrigins
assert.deepEqual(
  webOrigins(['https://a.com/*', '*://*.b.com/*', '<all_urls>', 'chrome://x/*', 'file:///*']),
  ['https://a.com/*', '*://*.b.com/*'],
);

// label / isWebUrl
assert.equal(label('https://uat.example.com/*'), 'uat.example.com');
assert.equal(label('*://*.example.com/*'), '*.example.com');
assert.equal(label('http://localhost/*'), 'http://localhost');
assert.ok(isWebUrl('https://x.com') && !isWebUrl('chrome://x') && !isWebUrl(''));

// samePage: only origin + path matter
assert.ok(samePage('https://a.com/orders', 'https://a.com/orders'));
assert.ok(samePage('https://a.com/orders', 'https://a.com/orders#row-5'), 'a hash change is the same page');
assert.ok(samePage('https://a.com/orders?tab=open', 'https://a.com/orders?tab=closed&sort=asc'), 'a query change is the same page');
assert.ok(!samePage('https://a.com/orders', 'https://a.com/customers'), 'a different path is a different page');
assert.ok(!samePage('https://a.com/orders', 'https://b.com/orders'), 'a different host is a different page');
assert.ok(!samePage('https://a.com/orders', 'http://a.com/orders'), 'a different scheme is a different page');
assert.ok(samePage('not a url', 'not a url') && !samePage('not a url', 'another'), 'unparseable values fall back to equality');

console.log('sites tests passed');
