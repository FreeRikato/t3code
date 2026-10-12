import type { ThreadId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

const PREVIEW_TTL_MS = 30 * 60_000;
const MAX_PREVIEWS_PER_THREAD = 20;
const MAX_PREVIEWS = 100;

interface StoredPreview {
  readonly threadId: ThreadId;
  readonly html: string;
  readonly expiresAtMs: number;
}

const unexpired = (previews: ReadonlyMap<string, StoredPreview>, now: number) =>
  new Map(Array.from(previews).filter(([, preview]) => preview.expiresAtMs > now));

const dropOldest = (
  previews: Map<string, StoredPreview>,
  previewIds: ReadonlyArray<string>,
  keep: number,
) => {
  for (const previewId of previewIds.slice(0, Math.max(0, previewIds.length - keep))) {
    previews.delete(previewId);
  }
};

export class HtmlPreviewStore extends Context.Service<
  HtmlPreviewStore,
  {
    readonly remember: (threadId: ThreadId, html: string) => Effect.Effect<string>;
    readonly recall: (
      threadId: ThreadId,
      previewId: string,
    ) => Effect.Effect<Option.Option<string>>;
  }
>()("t3/htmlRender/HtmlPreviewStore") {}

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const previews = yield* Ref.make<ReadonlyMap<string, StoredPreview>>(new Map());

  const remember: HtmlPreviewStore["Service"]["remember"] = (threadId, html) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const previewId = yield* crypto.randomUUIDv4.pipe(Effect.orDie);
      yield* Ref.update(previews, (current) => {
        const next = unexpired(current, now);
        dropOldest(
          next,
          Array.from(next)
            .filter(([, preview]) => preview.threadId === threadId)
            .map(([id]) => id),
          MAX_PREVIEWS_PER_THREAD - 1,
        );
        dropOldest(next, Array.from(next.keys()), MAX_PREVIEWS - 1);
        next.set(previewId, { threadId, html, expiresAtMs: now + PREVIEW_TTL_MS });
        return next;
      });
      return previewId;
    });

  const recall: HtmlPreviewStore["Service"]["recall"] = (threadId, previewId) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      return yield* Ref.modify(previews, (current) => {
        const next = unexpired(current, now);
        const preview = next.get(previewId);
        return [
          preview?.threadId === threadId ? Option.some(preview.html) : Option.none<string>(),
          next,
        ] as const;
      });
    });

  return HtmlPreviewStore.of({ remember, recall });
});

export const layer = Layer.effect(HtmlPreviewStore, make);
