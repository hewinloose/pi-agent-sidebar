import assert from "node:assert/strict";
import test from "node:test";
import { loadBundledModule } from "../../helpers/load-bundled-module.mjs";

async function harness(t, { start = 1800, reduced = false } = {}) {
 const loaded = await loadBundledModule({ entry: "webview/transcript/scrollAnchor.ts", platform: "browser" });
 t.after(loaded.dispose);
 let scrollTop = start;
 const viewport = {
  get scrollTop() { return scrollTop; },
  set scrollTop(value) { scrollTop = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)); },
  scrollHeight: 3000, clientHeight: 400,
 };
 const frames = new Map();
 let nextId = 0;
 let now = 0;
 const motion = { reduced };
 const anchor = new loaded.module.ScrollAnchor({
  viewport,
  shouldAnimate: () => !motion.reduced,
  requestFrame: (callback) => { frames.set(++nextId, callback); return nextId; },
  cancelFrame: (id) => frames.delete(id),
 });
 const step = () => {
  const callbacks = [...frames.values()];
  frames.clear();
  now += 1000 / 60;
  for (const callback of callbacks) callback(now);
 };
 const drain = () => {
  let count = 0;
  while (frames.size && count++ < 100) step();
  assert.equal(frames.size, 0, "the animation finishes within a bounded frame count");
 };
 return { viewport, frames, motion, anchor, step, drain };
}

for (const [start, target] of [[1800, 400], [100, 1400]]) {
 test(`answer reveal eases from ${start} to ${target} and stays detached`, async (t) => {
  const { viewport, anchor, frames, step } = await harness(t, { start });
  const positions = [];
  anchor.revealTo(target, () => positions.push(viewport.scrollTop));
  assert.equal(viewport.scrollTop, start, "scheduling the trip does not teleport");
  assert.equal(anchor.isFollowing, false);
  let count = 0;
  while (frames.size && count++ < 100) {
   step();
   assert.equal(anchor.noteScroll(), false, "animation frames remain programmatic scrolls");
  }
  assert.equal(frames.size, 0);
  assert.ok(positions.length >= 14 && positions.length <= 41, "visible travel is bounded to about 240–650 ms");
  assert.ok(Math.abs(viewport.scrollTop - target) <= 1);
  const direction = Math.sign(target - start);
  const travel = [start, ...positions].map((position) => (position - start) * direction);
  assert.ok(travel.every((position, index) => position >= (travel[index - 1] ?? 0) && position <= Math.abs(target - start)), "no reversal or overshoot");
  const speeds = travel.slice(1).map((position, index) => position - travel[index]);
  assert.ok(Math.max(...speeds) > speeds[0] * 3, "the trip accelerates gently");
  assert.ok(Math.max(...speeds) > speeds.at(-1) * 3, "the trip slows before stopping");
  const landed = viewport.scrollTop;
  viewport.scrollHeight += 500;
  assert.equal(anchor.stickToBottomIfFollowing(), false);
  assert.equal(viewport.scrollTop, landed, "later layout growth does not resume following");
 });
}

for (const cancel of ["upward gesture", "downward gesture", "native scroll", "unreported scroll", "new send", "disclosure", "explicit cancel"]) {
 test(`${cancel} stops a reveal at the current reading position`, async (t) => {
  const { viewport, anchor, frames, step, drain } = await harness(t);
  anchor.revealTo(400);
  for (let index = 0; index < 7; index += 1) step();
  assert.ok(viewport.scrollTop < 1800 && viewport.scrollTop > 400);
  switch (cancel) {
   case "upward gesture": anchor.noteUserIntent(-30); break;
   case "downward gesture": anchor.noteUserIntent(30); break;
   case "native scroll": viewport.scrollTop -= 40; anchor.noteScroll(); break;
   case "unreported scroll": viewport.scrollTop -= 40; break;
   case "new send": anchor.follow({ smooth: true }); break;
   case "disclosure": anchor.detach(); break;
   case "explicit cancel": anchor.cancelReveal(); break;
  }
  const readerTop = viewport.scrollTop;
  drain();
  assert.equal(frames.size, 0);
  assert.equal(viewport.scrollTop, readerTop, "cancelled frames cannot pull the reader back");
  if (cancel === "new send") {
   assert.equal(anchor.isFollowing, true);
   anchor.stickToBottomIfFollowing();
   drain();
   assert.equal(anchor.distanceFromBottomPx, 0, "the next send can follow new output");
  }
 });
}

test("reduced motion and clamped answers land immediately without padding", async (t) => {
 const { viewport, anchor, frames } = await harness(t, { reduced: true });
 anchor.revealTo(400);
 assert.equal(viewport.scrollTop, 400);
 assert.equal(frames.size, 0);
 assert.equal(anchor.isFollowing, false);
 anchor.revealTo(9999);
 assert.equal(viewport.scrollTop, 2600);
 assert.equal(viewport.scrollHeight, 3000);
 viewport.clientHeight = 4000;
 anchor.revealTo(9999);
 assert.equal(viewport.scrollTop, 0);
 assert.equal(frames.size, 0);
});

test("enabling reduced motion finishes an active reveal on its next frame", async (t) => {
 const { viewport, anchor, motion, frames, step } = await harness(t);
 anchor.revealTo(400);
 for (let index = 0; index < 7; index += 1) step();
 motion.reduced = true;
 step();
 assert.ok(Math.abs(viewport.scrollTop - 400) <= 1);
 assert.equal(frames.size, 0);
});

test("a newer reveal replaces the old destination", async (t) => {
 const { viewport, anchor, step, drain } = await harness(t);
 anchor.revealTo(400);
 for (let index = 0; index < 7; index += 1) step();
 const start = viewport.scrollTop;
 anchor.revealTo(900);
 assert.equal(viewport.scrollTop, start);
 drain();
 assert.ok(Math.abs(viewport.scrollTop - 900) <= 1);
});

for (const reduced of [false, true]) {
 test(`background completion defers target measurement until focus (reduced motion: ${reduced})`, async (t) => {
  const { viewport, anchor, frames, step, drain } = await harness(t, { reduced });
  let target = 400;
  let measurements = 0;
  anchor.suspend();
  anchor.revealTo(() => { measurements += 1; return target; });
  assert.equal(measurements, 0);
  assert.equal(viewport.scrollTop, 1800);
  assert.equal(frames.size, 0);
  target = 700;
  viewport.scrollTop = 1600;
  assert.equal(anchor.noteScroll(), false, "background layout does not discard the request");
  assert.equal(anchor.resume(), false, "resuming a reveal must not request bottom following");
  assert.equal(measurements, 1);
  assert.equal(viewport.scrollTop, reduced ? 700 : 1600);
  if (!reduced) {
   for (let index = 0; index < 3; index += 1) step();
   assert.ok(viewport.scrollTop < 1600 && viewport.scrollTop > 700);
  }
  drain();
  assert.ok(Math.abs(viewport.scrollTop - 700) <= 1);
  assert.equal(anchor.isFollowing, false);
  anchor.suspend();
  anchor.resume();
  assert.equal(measurements, 1, "a completed reveal is not replayed");
  assert.equal(frames.size, 0);
 });
}

test("blur pauses an active reveal and focus remeasures from the current reading position", async (t) => {
 const { viewport, anchor, frames, step, drain } = await harness(t);
 let target = 400;
 let measurements = 0;
 anchor.revealTo(() => { measurements += 1; return target; });
 for (let index = 0; index < 7; index += 1) step();
 const pausedAt = viewport.scrollTop;
 anchor.suspend();
 anchor.suspend();
 assert.equal(frames.size, 0);
 drain();
 assert.equal(viewport.scrollTop, pausedAt);
 viewport.scrollTop = 1500;
 target = 800;
 anchor.noteScroll();
 anchor.resume();
 anchor.resume();
 assert.equal(measurements, 2, "duplicate focus does not restart the animation");
 assert.equal(viewport.scrollTop, 1500, "resume does not teleport");
 for (let index = 0; index < 3; index += 1) step();
 assert.ok(viewport.scrollTop < 1500 && viewport.scrollTop > 800);
 drain();
 assert.ok(Math.abs(viewport.scrollTop - 800) <= 1);
 assert.equal(anchor.isFollowing, false);
});

for (const cancel of ["upward gesture", "downward gesture", "new send", "explicit cancel"]) {
 for (const started of [false, true]) {
  test(`${cancel} clears a ${started ? "paused" : "background"} reveal before focus`, async (t) => {
   const { viewport, anchor, frames, step, drain } = await harness(t);
   if (!started) anchor.suspend();
   anchor.revealTo(400);
   if (started) {
    for (let index = 0; index < 7; index += 1) step();
    anchor.suspend();
   }
   if (cancel === "upward gesture") anchor.noteUserIntent(-30);
   else if (cancel === "downward gesture") anchor.noteUserIntent(30);
   else if (cancel === "new send") anchor.follow({ smooth: true });
   else anchor.cancelReveal();
   const readerTop = viewport.scrollTop;
   anchor.resume();
   drain();
   assert.equal(viewport.scrollTop, readerTop);
   assert.equal(frames.size, 0);
   assert.equal(anchor.isFollowing, cancel === "new send");
  });
 }
}
