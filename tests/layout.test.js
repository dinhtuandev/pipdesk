/* Checks the compositor's layout maths without a browser:
     node --test tests/
   offscreen/layout.js is a plain script in the page and exports itself when
   `module` exists, so the runner can require it directly. */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FULL_WIDTH,
  FULL_HEIGHT,
  TILE_WIDTH,
  TILE_HEIGHT,
  slots,
  frameRate,
} = require("../offscreen/layout.js");

const CENTRED_Y = Math.round((FULL_HEIGHT - TILE_HEIGHT) / 2);

test("a lone source fills the frame", () => {
  assert.deepEqual(slots(1, false), [
    { x: 0, y: 0, width: FULL_WIDTH, height: FULL_HEIGHT },
  ]);
});

test("an empty canvas still reports a frame to clear", () => {
  assert.deepEqual(slots(0, false), [
    { x: 0, y: 0, width: FULL_WIDTH, height: FULL_HEIGHT },
  ]);
});

test("a focused source fills the frame whatever the count", () => {
  for (const count of [2, 3, 4]) {
    assert.deepEqual(slots(count, true), [
      { x: 0, y: 0, width: FULL_WIDTH, height: FULL_HEIGHT },
    ]);
  }
});

test("two sources split the frame and sit centred", () => {
  const layout = slots(2, false);
  assert.equal(layout.length, 2);
  assert.deepEqual(layout[0], {
    x: 0,
    y: CENTRED_Y,
    width: TILE_WIDTH,
    height: TILE_HEIGHT,
  });
  assert.deepEqual(layout[1], {
    x: TILE_WIDTH,
    y: CENTRED_Y,
    width: TILE_WIDTH,
    height: TILE_HEIGHT,
  });
});

test("three and four sources use the two-by-two grid", () => {
  assert.deepEqual(
    slots(3, false).map((slot) => [slot.x, slot.y]),
    [
      [0, 0],
      [TILE_WIDTH, 0],
      [0, TILE_HEIGHT],
    ],
  );

  const four = slots(4, false);
  assert.equal(four.length, 4);
  assert.deepEqual(
    four.map((slot) => [slot.x, slot.y]),
    [
      [0, 0],
      [TILE_WIDTH, 0],
      [0, TILE_HEIGHT],
      [TILE_WIDTH, TILE_HEIGHT],
    ],
  );
});

test("the draw rate halves once a third source joins", () => {
  assert.equal(frameRate(1), 30);
  assert.equal(frameRate(2), 30);
  assert.equal(frameRate(3), 15);
  assert.equal(frameRate(4), 15);
});

test("the draw rate stays inside a usable range", () => {
  for (const count of [0, 1, 2, 3, 4]) {
    const rate = frameRate(count);
    assert.ok(rate > 0 && rate <= 60, `rate in range (${count})`);
  }
});

test("every slot stays inside the canvas", () => {
  for (const count of [0, 1, 2, 3, 4]) {
    for (const focused of [true, false]) {
      for (const slot of slots(count, focused)) {
        assert.ok(slot.x >= 0 && slot.y >= 0, `origin in range (${count})`);
        assert.ok(slot.x + slot.width <= FULL_WIDTH, `width fits (${count})`);
        assert.ok(slot.y + slot.height <= FULL_HEIGHT, `height fits (${count})`);
      }
    }
  }
});
