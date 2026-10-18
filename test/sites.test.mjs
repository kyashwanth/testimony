import assert from 'node:assert/strict';
import { patternForUrl, normalizePattern, webOrigins, label, isWebUrl } from '../sites.js';

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

console.log('sites tests passed');
