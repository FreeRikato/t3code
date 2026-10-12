import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import * as HtmlPreviewStore from "./HtmlPreviewStore.ts";

const layerTest = HtmlPreviewStore.layer.pipe(Layer.provide(NodeServices.layer));

const threadX = ThreadId.make("thread-x");
const threadY = ThreadId.make("thread-y");

describe("HtmlPreviewStore", () => {
  it.effect("recalls the identical HTML for the thread that remembered it", () =>
    Effect.gen(function* () {
      const store = yield* HtmlPreviewStore.HtmlPreviewStore;
      const html = "<!doctype html><h1>Dashboard</h1>";
      const previewId = yield* store.remember(threadX, html);
      expect(yield* store.recall(threadX, previewId)).toEqual(Option.some(html));
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("answers another thread's recall like an id that was never issued", () =>
    Effect.gen(function* () {
      const store = yield* HtmlPreviewStore.HtmlPreviewStore;
      const previewId = yield* store.remember(threadX, "<h1>Private</h1>");
      expect(yield* store.recall(threadY, previewId)).toEqual(
        yield* store.recall(threadY, "never-issued"),
      );
      expect(yield* store.recall(threadY, previewId)).toEqual(Option.none());
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("keeps a page for 29 minutes and forgets it at 30", () =>
    Effect.gen(function* () {
      const store = yield* HtmlPreviewStore.HtmlPreviewStore;
      const previewId = yield* store.remember(threadX, "<h1>Timed</h1>");
      yield* TestClock.adjust(Duration.minutes(29));
      expect(yield* store.recall(threadX, previewId)).toEqual(Option.some("<h1>Timed</h1>"));
      yield* TestClock.adjust(Duration.minutes(1));
      expect(yield* store.recall(threadX, previewId)).toEqual(Option.none());
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("evicts a thread's oldest page when it remembers a 21st", () =>
    Effect.gen(function* () {
      const store = yield* HtmlPreviewStore.HtmlPreviewStore;
      const otherThreadId = yield* store.remember(threadY, "<h1>Other</h1>");
      const ids: Array<string> = [];
      for (let index = 1; index <= 21; index += 1) {
        ids.push(yield* store.remember(threadX, `<h1>Page ${index}</h1>`));
      }
      const [first, second] = ids;
      const last = ids.at(-1);
      if (first === undefined || second === undefined || last === undefined) {
        return yield* Effect.die("no pages");
      }
      expect(yield* store.recall(threadX, first)).toEqual(Option.none());
      expect(yield* store.recall(threadX, second)).toEqual(Option.some("<h1>Page 2</h1>"));
      expect(yield* store.recall(threadX, last)).toEqual(Option.some("<h1>Page 21</h1>"));
      expect(yield* store.recall(threadY, otherThreadId)).toEqual(Option.some("<h1>Other</h1>"));
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("evicts the oldest page of any thread once 100 pages are held", () =>
    Effect.gen(function* () {
      const store = yield* HtmlPreviewStore.HtmlPreviewStore;
      const remembered: Array<{ threadId: ThreadId; previewId: string }> = [];
      for (let threadIndex = 1; threadIndex <= 5; threadIndex += 1) {
        const threadId = ThreadId.make(`thread-${threadIndex}`);
        for (let page = 1; page <= 20; page += 1) {
          remembered.push({
            threadId,
            previewId: yield* store.remember(threadId, `<p>${page}</p>`),
          });
        }
      }
      const newest = yield* store.remember(ThreadId.make("thread-6"), "<p>Newest</p>");
      const [oldest, secondOldest] = remembered;
      if (oldest === undefined || secondOldest === undefined) return yield* Effect.die("no pages");
      expect(yield* store.recall(oldest.threadId, oldest.previewId)).toEqual(Option.none());
      expect(yield* store.recall(secondOldest.threadId, secondOldest.previewId)).toEqual(
        Option.some("<p>2</p>"),
      );
      expect(yield* store.recall(ThreadId.make("thread-6"), newest)).toEqual(
        Option.some("<p>Newest</p>"),
      );
    }).pipe(Effect.provide(layerTest)),
  );
});
