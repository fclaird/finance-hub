"use client";

import type { XDigestPayload, XSymbolPayload } from "@/lib/x/types";

type DigestProps = {
  variant: "digest";
  payload: Pick<XDigestPayload, "sections" | "posts" | "generatedAt"> | null;
  emptyMessage?: string;
  /** When false, omit the outer “X digest” title row (e.g. when the parent supplies controls). */
  showTitle?: boolean;
};

type SymbolProps = {
  variant: "symbol";
  symbol: string;
  payload: (Partial<XSymbolPayload> & { disconnected?: boolean; ok?: boolean }) | null;
  /** When true and payload is null, show idle hint instead of “Loading…”. */
  idle?: boolean;
  showFetchedAt?: boolean;
};

type Props = DigestProps | SymbolProps;

function PostLinks({
  postIds,
  posts,
}: {
  postIds: string[];
  posts: XDigestPayload["posts"];
}) {
  if (!postIds.length) return null;
  return (
    <ul className="mt-1.5 flex flex-wrap gap-2">
      {postIds.map((id) => {
        const p = posts[id];
        if (!p) return null;
        return (
          <li key={id}>
            <a
              href={p.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-800 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
              title={p.text.length > 160 ? `${p.text.slice(0, 157)}…` : p.text}
            >
              @{p.author}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export function XNewsSection(props: Props) {
  if (props.variant === "symbol") {
    const { symbol, payload, idle, showFetchedAt = true } = props;
    if (!payload) {
      return (
        <div className="rounded-xl border border-zinc-300 bg-white/60 p-4 dark:border-white/20 dark:bg-black/20">
          <div className="text-sm font-semibold">X — {symbol}</div>
          <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            {idle ? "Not loaded. Use “Fetch from X” to search recent posts for this symbol." : "Loading…"}
          </div>
        </div>
      );
    }
    if (payload.disconnected) {
      return (
        <div className="rounded-xl border border-zinc-300 bg-white/60 p-4 dark:border-white/20 dark:bg-black/20">
          <div className="text-sm font-semibold">X — {symbol}</div>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{payload.summary ?? "Connect X under Connections to search cashtags."}</p>
        </div>
      );
    }
    return (
      <div className="rounded-xl border border-zinc-300 bg-white/60 p-4 dark:border-white/20 dark:bg-black/20">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold">X — {symbol}</div>
          {showFetchedAt && payload.generatedAt ? (
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{new Date(payload.generatedAt).toLocaleString()}</div>
          ) : null}
        </div>
        {payload.summary ? <p className="mt-2 text-sm leading-6 text-zinc-800 dark:text-zinc-200">{payload.summary}</p> : null}
        {payload.posts && payload.posts.length > 0 ? (
          <ul className="mt-3 grid gap-2">
            {payload.posts.map((p) => (
              <li key={p.id}>
                <a
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-lg border border-zinc-300 bg-white/80 px-3 py-2 text-sm hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:border-white/20 dark:bg-zinc-950 dark:hover:bg-white/5"
                >
                  <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">@{p.author}</div>
                  <div className="mt-0.5 text-zinc-900 dark:text-zinc-100">{p.text.length > 220 ? `${p.text.slice(0, 217)}…` : p.text}</div>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">No posts in the last week.</div>
        )}
      </div>
    );
  }

  const { payload, emptyMessage, showTitle = true } = props;
  if (!payload || !payload.sections?.length) {
    return (
      <div className="rounded-xl border border-zinc-300 bg-white/60 p-4 dark:border-white/20 dark:bg-black/20">
        {showTitle ? <div className="text-sm font-semibold">X digest</div> : null}
        <p className={"text-sm text-zinc-600 dark:text-zinc-400 " + (showTitle ? "mt-2" : "")}>
          {emptyMessage ??
            "No digest loaded. Use “Fetch from X” to pull your timeline and build a digest (requires X connected under Connections)."}
        </p>
      </div>
    );
  }

  const { sections, posts, generatedAt } = payload;

  return (
    <div className="rounded-xl border border-zinc-300 bg-white/60 p-4 dark:border-white/20 dark:bg-black/20">
      {showTitle ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold">X digest</div>
          {generatedAt ? <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{new Date(generatedAt).toLocaleString()}</div> : null}
        </div>
      ) : null}
      <div className={"grid gap-4 " + (showTitle ? "mt-3" : "")}>
        {sections.map((sec) => (
          <section key={sec.id} aria-labelledby={`x-sec-${sec.id}`}>
            <h3 id={`x-sec-${sec.id}`} className="text-xs font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {sec.heading}
            </h3>
            <ul className="mt-2 grid gap-3">
              {sec.ideas.map((idea, idx) => (
                <li key={`${sec.id}-${idx}`} className="rounded-lg border border-zinc-200 bg-white/80 px-3 py-2 dark:border-white/15 dark:bg-zinc-950/60">
                  <p className="text-sm text-zinc-900 dark:text-zinc-100">{idea.text}</p>
                  <PostLinks postIds={idea.postIds} posts={posts} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
