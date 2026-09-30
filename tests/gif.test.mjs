// gif.test.mjs — GIFs are stored as {id, w, h}, and only ever shown from GIPHY's own servers.
import test from "node:test";
import assert from "node:assert/strict";
import { cleanGif, gifUrl, gifImgHtml, gifsFromGiphy, GIF_TOPICS } from "../js/gif.js";
import { cleanItem } from "../api/shares.js";

test("a GIF id must be plain letters and digits", () => {
  assert.deepEqual(cleanGif({ id: "3o7abKhOpu0NwenH3O", w: 200, h: 150 }), { id: "3o7abKhOpu0NwenH3O", w: 200, h: 150 });
  assert.equal(cleanGif({ id: "../../evil" }), null);
  assert.equal(cleanGif({ id: 'abc" onerror="x' }), null);
  assert.equal(cleanGif("3o7abKhOpu0NwenH3O"), null);
  assert.deepEqual(cleanGif({ id: "abcdef", w: "nope", h: 99999 }), { id: "abcdef", w: 200, h: 2000 });
});

test("URLs are built from the id and always point at GIPHY", () => {
  assert.equal(gifUrl({ id: "abcdef" }), "https://media.giphy.com/media/abcdef/200w.webp");
  assert.equal(gifUrl({ id: "abcdef" }, "large"), "https://media.giphy.com/media/abcdef/giphy.webp");
  assert.equal(gifUrl({ id: "x/y" }), "");
  const html = gifImgHtml({ id: "abcdef", w: 200, h: 100 }, { alt: '"><script>' });
  assert.match(html, /aspect-ratio:200\/100/);
  assert.doesNotMatch(html, /<script>/);
});

test("GIPHY's answer is reduced to id and size", () => {
  const gifs = gifsFromGiphy({ data: [
    { id: "abcdef", images: { fixed_width: { width: "200", height: "112" } } },
    { id: "bad id!", images: {} },
  ] });
  assert.deepEqual(gifs, [{ id: "abcdef", w: 200, h: 112 }]);
  assert.deepEqual(gifsFromGiphy(null), []);
  assert.equal(GIF_TOPICS[0].q, ""); // the first chip is trending
});

test("a post keeps a GIF, but not alongside a photo", () => {
  assert.deepEqual(cleanItem("post", { text: "", gif: { id: "abcdef", w: 200, h: 150 } }), { text: "", photo: null, gif: { id: "abcdef", w: 200, h: 150 } });
  assert.equal(cleanItem("post", { text: "hi", gif: { id: "no/pe" } }).gif, undefined);
  const photo = "data:image/jpeg;base64,AAAA";
  const both = cleanItem("post", { text: "", photo, gif: { id: "abcdef" } });
  assert.equal(both.photo, photo);
  assert.equal(both.gif, undefined);
});
