import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import sharp from "sharp";
import { mergeRequiredComingSoonItems } from "../public/coming-soon-items.mjs";

const source = readFileSync(new URL("../app/api/pmb-products/route.js", import.meta.url), "utf8");

function loadFunction(name, globals = {}) {
  const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`));
  assert.ok(match, `${name} exists`);
  const context = vm.createContext({ URL, ...globals });
  vm.runInContext(`${match[0]}; this.loaded = ${name};`, context);
  return context.loaded;
}

test("PMB products without image fields resolve to their exact PLU artwork", () => {
  const resolve = loadFunction("getCloneImageUrl", { clean: (value) => String(value ?? "").trim() });
  assert.equal(resolve({ plu: 136485 }, "http://pmb.local:8585"), "http://pmb.local:8585/components/prod_img/136485");
  assert.equal(resolve({ plu: 57658 }, "http://pmb.local:8585"), "http://pmb.local:8585/components/prod_img/57658");
  assert.equal(resolve({ plu: 0 }, "http://pmb.local:8585"), "");
  assert.equal(resolve({ plu: "../other" }, "http://pmb.local:8585"), "");
  assert.equal(resolve({ plu: 1, image_url: "/actual.png" }, "http://pmb.local:8585"), "http://pmb.local:8585/actual.png");
});

test("saved substitute image sources cannot override the required Main-wall counterpart", () => {
  const items = mergeRequiredComingSoonItems([
    { id: "beer:triple-jam-2", kind: "beer", name: "Triple Jam Cider 2", cloneSourceName: "Wrong cider", plu: 121584 },
    { id: "recipe:vodka-cran-2", kind: "recipe", name: "Vodka Cran 2", cloneSourceName: "", plu: 147896 },
  ]);
  assert.equal(items.find((item) => item.plu === 121584).cloneSourceName, "TRIPLE JAM CIDER 1");
  assert.equal(items.find((item) => item.plu === 147896).cloneSourceName, "VODKA CRAN (TITO'S) 1");
});

test("tall uploaded artwork retains both ends inside PMB's 676 by 540 canvas", async () => {
  const fixture = await sharp(Buffer.from('<svg width="370" height="500"><rect width="370" height="500" fill="#00ff00"/><rect width="370" height="60" fill="#ff0000"/><rect y="440" width="370" height="60" fill="#0000ff"/></svg>')).png().toBuffer();
  const build = loadFunction("buildPmbImageFile", {
    sharp,
    readImageSourceBuffer: async () => fixture,
    getSafeImageBasename: () => "fixture",
    PRODUCT_IMAGE_WIDTH: 676,
    PRODUCT_IMAGE_HEIGHT: 540,
    PRODUCT_IMAGE_MAX_BYTES: 5 * 1024 * 1024,
  });
  const image = await build("fixture", "Tall artwork");
  const { data, info } = await sharp(image.buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 676);
  assert.equal(info.height, 540);
  const pixel = (x, y) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
  const top = pixel(338, 20);
  const bottom = pixel(338, 520);
  assert.ok(top[0] > 200 && top[1] < 40 && top[2] < 40, "top of the original remains visible");
  assert.ok(bottom[2] > 200 && bottom[0] < 40 && bottom[1] < 40, "bottom of the original remains visible");
  assert.ok(pixel(20, 270).every((channel) => channel > 240), "side margin prevents cropping");
});
