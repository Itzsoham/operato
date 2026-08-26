"use client";

import {
  AlertTriangle,
  ChevronDown,
  Database,
  Loader2,
  RotateCcw,
  Send,
  Sparkles,
} from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useAiUsage, useAskAi, type AiAnswer, type AiUsage } from "@/hooks/use-ai";
import { aiQuestionSchema } from "@/lib/validations/ai";
import { cn } from "@/lib/utils";

/* A few starting points so the empty state is not a blank box; tap one and it asks it. */
const EXAMPLE_QUESTIONS = [
  "What were our top 5 dishes by revenue this month?",
  "How many orders did we take yesterday?",
  "Which customers have not visited in the last 30 days?",
  "What is our average order value this week?",
];

/* Session-only, per the page spec: a refresh losing it is fine, AiQuery is the durable log. */
const HISTORY_LIMIT = 5;

/**
 * `AiAnswer` carries no id — it's a server response, not a stored record — so each entry
 * pushed into session history gets one here, client-side. Without it, both the "current
 * answer" slot and the "earlier this session" list were keyed by array index (or not keyed
 * at all), and since `history` is most-recent-first, every new question reshuffles which
 * logical Q&A sits at each index. React then reuses the AnswerCard/Collapsible component
 * INSTANCE at that index for a different answer, carrying its open/closed "How this was
 * calculated" state along with it — a previous question's expanded SQL panel would render
 * already-open on a brand new answer the user never touched. Keying on this id instead
 * keys by the QUESTION, not its position, so remounts only happen when they should.
 */
type HistoryEntry = AiAnswer & { id: string };

export function AssistantClient({ restaurantId }: { restaurantId: string }) {
  const { data: usage, isPending: usagePending } = useAiUsage(restaurantId);
  const ask = useAskAi(restaurantId);

  const [question, setQuestion] = useState("");
  // Most recent first. history[0] is rendered as THE answer; the rest as session history.
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const current = history[0];
  const atLimit = usage ? usage.remaining <= 0 : false;

  function submit(raw: string) {
    if (ask.isPending || atLimit) return;
    const parsed = aiQuestionSchema.safeParse(raw);
    if (!parsed.success) return;

    ask.mutate(parsed.data, {
      onSuccess: (answer) => {
        const entry: HistoryEntry = { ...answer, id: crypto.randomUUID() };
        setHistory((prev) => [entry, ...prev].slice(0, HISTORY_LIMIT));
        setQuestion("");
      },
    });
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    submit(question);
  }

  const canAsk = aiQuestionSchema.safeParse(question).success && !ask.isPending && !atLimit;

  return (
    // `wrap` is the page column (--measure, centred); px-page / py-lg are the palette's own
    // gutter and rhythm, so a palette switch actually moves these edges. It used to be
    // max-w-3xl + p-4, four stock steps that never changed with the theme.
    <div className="wrap flex w-full flex-1 flex-col gap-lg px-page py-lg">
      {/* THE ASK CARD — the main event, so it leads the page, and the one surface in the
          whole product allowed to wear --grad-ai (every palette declares that wash for
          "the Ask AI card, and only that card"). Crema pours caramel over ceramic, Forno a
          sauce wash, Lievito flattens it to flat paper, Saffron to candlelit card. */}
      <Card
        className="rise bg-[image:var(--grad-ai)]"
        style={{ "--i": 0 } as React.CSSProperties}
      >
        <CardHeader>
          <div className="flex items-center gap-sm">
            {/* The mark is painted with --grad-brand, the same text-bearing ramp the
                wordmark tile uses, so it re-cuts per palette instead of being a tint. */}
            <div className="flex size-tap-sm shrink-0 items-center justify-center rounded-lg bg-[image:var(--grad-brand)] text-brand-foreground shadow-xs">
              <Sparkles className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <CardTitle>Ask a question about your business</CardTitle>
              <CardDescription>
                Plain English in, a real answer out, the assistant writes the SQL against
                your live data.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-sm">
          <form onSubmit={onSubmit} className="flex flex-col gap-xs">
            <Textarea
              data-testid="ai-question-input"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. What was our busiest day last week?"
              maxLength={500}
              disabled={ask.isPending}
              aria-label="Ask a question"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(question);
                }
              }}
            />

            <div className="flex flex-wrap items-center justify-between gap-sm">
              <UsageIndicator usage={usage} isPending={usagePending} />
              {/* The one primary CTA on this screen, so it is the one control allowed
                  --sh-brand. Nothing else here may carry a coloured cast. */}
              <Button
                type="submit"
                data-testid="ai-ask-button"
                className="shadow-brand"
                disabled={!canAsk}
              >
                {ask.isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Thinking...
                  </>
                ) : (
                  <>
                    <Send className="size-4" aria-hidden="true" />
                    Ask
                  </>
                )}
              </Button>
            </div>
          </form>

          {history.length === 0 ? (
            <div className="flex flex-col gap-xs pt-1">
              <p className="text-label tracking-label text-muted-foreground uppercase">
                Try one of these
              </p>
              <div className="flex flex-wrap gap-xs">
                {EXAMPLE_QUESTIONS.map((q, i) => (
                  <Button
                    key={q}
                    type="button"
                    variant="outline"
                    size="sm"
                    // `rise` staggered by --i: the suggestions arrive after the card, one
                    // beat apart. Never rounded-full — rounded-lg is --r, which Lievito
                    // sets to 3px on purpose.
                    className="rise h-auto min-h-tap-sm rounded-lg py-2 text-left whitespace-normal"
                    style={{ "--i": i + 1 } as React.CSSProperties}
                    disabled={ask.isPending || atLimit}
                    onClick={() => {
                      setQuestion(q);
                      submit(q);
                    }}
                  >
                    {q}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* THE ERROR STATE. Additive — it sits above the answer area rather than replacing
          it, so a failed follow-up never wipes the answer already on screen. Painted with
          the destructive -subtle triple (opaque wash, text measured >=5.5:1 on it, opaque
          edge), never an alpha guess over an unknown ground. Announced, and carrying an
          icon plus a heading, so the failure is never signalled by colour alone. */}
      {!ask.isPending && ask.isError ? (
        <ErrorState
          message={ask.error.message}
          canRetry={Boolean(ask.variables) && !atLimit}
          onRetry={() => {
            if (ask.variables) submit(ask.variables);
          }}
        />
      ) : null}

      {/* The current answer, prominent, per the spec: this is the thing the whole
          feature exists to show. */}
      {ask.isPending ? (
        <ThinkingState />
      ) : current ? (
        // Keyed on the answer's own id, not its position: asking a new question must mount
        // a FRESH card (and a collapsed-by-default panel), not reuse the previous one's.
        <AnswerCard key={current.id} answer={current} />
      ) : (
        <EmptyState />
      )}

      {/* A session-only running list of the last few Q&As. Client state, not persisted;
          AiQuery is the durable log. Keyed on id, not array index — history is
          most-recent-first, so the index of any given answer shifts every time a new
          question is asked, which previously reattached one answer's expanded/collapsed
          SQL panel onto a completely different one. */}
      {history.length > 1 ? (
        <section className="flex flex-col gap-sm">
          {/* The mockups' section head: an eyebrow label and a hairline running to the
              far edge. The rule is --border, the only ink a divider is allowed. */}
          <div className="flex items-center gap-sm">
            <p className="text-label tracking-label text-muted-foreground uppercase">
              Earlier this session
            </p>
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
          </div>
          {history.slice(1).map((item, i) => (
            <AnswerCard
              key={item.id}
              answer={item}
              compact
              className="rise"
              style={{ "--i": i } as React.CSSProperties}
            />
          ))}
        </section>
      ) : null}
    </div>
  );
}

function UsageIndicator({
  usage,
  isPending,
}: {
  usage: AiUsage | undefined;
  isPending: boolean;
}) {
  // The loading rung of the quota line. h-4/w-36 are the skeleton's own geometry, not
  // page rhythm — Skeleton itself carries --sh-less bg-muted and animate-shimmer.
  if (isPending) return <Skeleton className="h-4 w-36" />;
  if (!usage) return <span />;

  const atLimit = usage.remaining <= 0;
  return (
    <span
      data-testid="ai-usage-indicator"
      className={cn(
        "font-num tabular-nums",
        atLimit
          ? "text-small font-semibold text-destructive"
          : "text-small text-muted-foreground"
      )}
    >
      {atLimit
        ? `Used all ${usage.limit} questions today, more tomorrow.`
        : `${usage.remaining} of ${usage.limit} questions left today`}
    </span>
  );
}

/**
 * THE EMPTY STATE. A dashed hairline, deliberately un-elevated (shadow-none): an empty
 * slot is not a card that has arrived, so it must not sit on the resting-card cast.
 */
function EmptyState() {
  return (
    <Card className="animate-rise border-dashed shadow-none">
      <CardContent className="flex flex-col items-center gap-xs py-lg text-center">
        <div className="flex size-tap items-center justify-center rounded-lg bg-brand-subtle text-brand-subtle-foreground">
          <Sparkles className="size-5" aria-hidden="true" />
        </div>
        <p className="font-heading text-h2">Nothing asked yet</p>
        <p className="max-w-measure text-body text-muted-foreground">
          Ask anything about sales, stock, or customers, or tap one of the examples above.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * THE THINKING STATE. A status line the assistive layer can read (aria-live) over three
 * shimmering rules — not a bare grey box. The status is spelled out in words, because a
 * moving skeleton on its own is not a message.
 */
function ThinkingState() {
  return (
    <Card className="animate-rise" aria-busy="true">
      <CardContent className="flex flex-col gap-sm">
        <p
          className="flex items-center gap-xs text-label tracking-label text-muted-foreground uppercase"
          aria-live="polite"
        >
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Writing the query and reading your data
        </p>
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-4/5" />
      </CardContent>
    </Card>
  );
}

function ErrorState({
  message,
  canRetry,
  onRetry,
}: {
  message: string;
  canRetry: boolean;
  onRetry: () => void;
}) {
  return (
    <Card
      role="alert"
      data-testid="ai-error-card"
      className="animate-rise border-destructive-border bg-destructive-subtle text-destructive-subtle-foreground"
    >
      <CardContent className="flex flex-wrap items-start gap-sm">
        <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-col gap-xs">
          <p className="font-heading text-h2">That question did not go through</p>
          <p className="text-body">{message}</p>
          <p className="text-small">
            Every attempt spends from today&apos;s quota, so it is worth rephrasing before
            asking again.
          </p>
        </div>
        {canRetry ? (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Try again
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function AnswerCard({
  answer,
  compact = false,
  className,
  style,
}: {
  answer: AiAnswer;
  compact?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <Card
      data-testid={compact ? "ai-history-answer" : "ai-answer-card"}
      // The fresh answer arrives on its own; the history rows are staggered by the caller.
      className={cn(!compact && "animate-rise", className)}
      style={style}
    >
      <CardContent className="flex flex-col gap-sm">
        {/* The question read back as an eyebrow — uppercase --t-label at
            --label-tracking, the one place Lievito's .24em caps show up on this page. */}
        <p className="text-label tracking-label text-muted-foreground uppercase">
          {answer.question}
        </p>

        {/* The answer is the whole point of the screen, so it is set in the palette's
            DISPLAY face: Crema's Iowan serif, Forno's Arial Black 900, Lievito's Futura
            200, Saffron's Palatino. This is the line that proves a palette switch changes
            form and not just hue. */}
        <p
          data-testid="ai-answer-text"
          className={
            compact
              ? "text-body text-card-foreground"
              : "font-heading text-h2 text-balance text-card-foreground"
          }
        >
          {answer.answer}
        </p>

        {answer.truncated ? (
          <Badge data-testid="ai-truncated-badge" variant="secondary" className="w-fit">
            <span data-slot="badge-dot" aria-hidden="true" />
            Based on a sample of the data
          </Badge>
        ) : null}

        {/* The transparency feature that makes a text-to-SQL answer trustworthy, never
            buried behind another page, just collapsed by default. */}
        <Collapsible defaultOpen={false}>
          <CollapsibleTrigger
            render={
              <Button
                type="button"
                data-testid="ai-explanation-toggle"
                variant="ghost"
                size="sm"
                className="group w-fit gap-xs px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
              >
                <Database className="size-3.5" aria-hidden="true" />
                How this was calculated
                <ChevronDown
                  className="size-3.5 transition-transform duration-(--dur) ease-quint group-data-[panel-open]:rotate-180"
                  aria-hidden="true"
                />
              </Button>
            }
          />
          <CollapsibleContent className="flex flex-col gap-sm pt-sm">
            <p data-testid="ai-explanation-text" className="text-small text-muted-foreground">
              {answer.explanation}
            </p>

            {/* Monospace, read-only: a pre element never accepts input, so there is
                nothing to guard against editing. --t-code is the one type step reserved
                for exactly this block and the inventory ledger IDs — in Forno it is the
                kitchen-ticket voice at weight 600. */}
            <pre className="overflow-x-auto rounded-md border border-border bg-muted p-card-sm font-mono text-code text-foreground">
              <code data-testid="ai-sql-text">{answer.sql}</code>
            </pre>

            {answer.rows.length > 0 ? <RowsTable rows={answer.rows} /> : null}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

/* Generic result-row rendering: the columns are whatever the model's SELECT projected,
   so there is no fixed shape to key off. Values are stringified for display only, this
   is a transparency view of raw query output, not a place that computes with them. */
function RowsTable({ rows }: { rows: Record<string, unknown>[] }) {
  const columns = Object.keys(rows[0] ?? {});
  const visible = rows.slice(0, 20);

  return (
    // max-h-64 is a scroll viewport cap, not page rhythm — the padding, the radius and
    // the rule around it are all tokens.
    <div
      data-testid="ai-rows-table"
      className="max-h-64 overflow-auto rounded-md border border-border"
    >
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col}>{col}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((row, i) => (
            <TableRow key={i}>
              {columns.map((col) => (
                <TableCell key={col} className="font-mono text-code tabular-nums">
                  {formatCell(row[col])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length > visible.length ? (
        <p className="border-t border-border px-3 py-2 text-small text-muted-foreground tabular-nums">
          Showing {visible.length} of {rows.length} rows.
        </p>
      ) : null}
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
