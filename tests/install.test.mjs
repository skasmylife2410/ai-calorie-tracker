// install.test.mjs — telling iPhones from Android phones (and their browsers) for the
// "add to Home Screen" onboarding step.
import test from "node:test";
import assert from "node:assert/strict";

const { platform, browser } = await import("../js/install.js");

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const PIXEL = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
const SAMSUNG = "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0 Mobile Safari/537.36";
const MAC = IPAD;

test("iPhones and iPads are ios, whatever the browser", () => {
  assert.equal(platform(IPHONE_SAFARI, 5, "iPhone"), "ios");
  assert.equal(platform(IPHONE_CHROME, 5, "iPhone"), "ios");
  assert.equal(platform(IPAD, 5, "MacIntel"), "ios", "iPadOS says it's a Mac, but has touch");
  assert.equal(platform(MAC, 0, "MacIntel"), "other", "a real Mac has no touch points");
});

test("Android phones are android, and the browser is named for the right wording", () => {
  assert.equal(platform(PIXEL, 5, "Linux armv8l"), "android");
  assert.equal(platform(SAMSUNG, 5, "Linux armv8l"), "android");
  assert.equal(platform(PIXEL, 5, "MacIntel"), "android", "an Android user agent wins over a desktop platform");
  assert.equal(browser(PIXEL), "chrome");
  assert.equal(browser(SAMSUNG), "samsung");
  assert.equal(browser(IPHONE_SAFARI), "safari");
  assert.equal(browser(IPHONE_CHROME), "chrome");
});
