"use client";

import { ChevronDown, Database, Loader2, Send, Sparkles } from "lucide-react";
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
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-4">
      {/* The ask card, the main event, so it leads the page. */}
      <Card className="border-primary/20 bg-gradient-to-b from-primary/5 to-transparent">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
              <Sparkles className="size-5" />
            </div>
            <div>
              <CardTitle>Ask a question about your business</CardTitle>
              <CardDescription>
                Plain English in, a real answer out, the assistant writes the SQL against
                your live data.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          <form onSubmit={onSubmit} className="flex flex-col gap-2">
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

            <div className="flex flex-wrap items-center justify-between gap-3">
              <UsageIndicator usage={usage} isPending={usagePending} />
              <Button type="submit" data-testid="ai-ask-button" disabled={!canAsk}>
                {ask.isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Thinking...
                  </>
                ) : (
                  <>
                    <Send className="size-4" />
                    Ask
                  </>
                )}
              </Button>
            </div>
          </form>

          {history.length === 0 ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {EXAMPLE_QUESTIONS.map((q) => (
                <Button
                  key={q}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-auto whitespace-normal text-left"
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
          ) : null}
        </CardContent>
      </Card>

      {/* The current answer, prominent, per the spec: this is the thing the whole
          feature exists to show. */}
      {ask.isPending ? (
        <AnswerSkeleton />
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
        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground text-xs font-medium">Earlier this session</p>
          {history.slice(1).map((item) => (
            <AnswerCard key={item.id} answer={item} compact />
          ))}
        </div>
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
  if (isPending) return <Skeleton className="h-4 w-36" />;
  if (!usage) return <span />;

  const atLimit = usage.remaining <= 0;
  return (
    <span
      data-testid="ai-usage-indicator"
      className={cn("text-xs", atLimit ? "text-destructive font-medium" : "text-muted-foreground")}
    >
      {atLimit
        ? `Used all ${usage.limit} questions today, more tomorrow.`
        : `${usage.remaining} of ${usage.limit} questions left today`}
    </span>
  );
}

function EmptyState() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
        <div className="bg-muted text-muted-foreground flex size-11 items-center justify-center rounded-lg">
          <Sparkles className="size-5" />
        </div>
        <p className="text-muted-foreground text-sm">
          Ask anything about sales, stock, or customers, or tap one of the examples above.
        </p>
      </CardContent>
    </Card>
  );
}

function AnswerSkeleton() {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-4/5" />
      </CardContent>
    </Card>
  );
}

function AnswerCard({ answer, compact = false }: { answer: AiAnswer; compact?: boolean }) {
  return (
    <Card data-testid={compact ? "ai-history-answer" : "ai-answer-card"}>
      <CardContent className="flex flex-col gap-3 p-5">
        <p className="text-muted-foreground text-sm">{answer.question}</p>

        <p
          data-testid="ai-answer-text"
          className={compact ? "text-base leading-relaxed" : "text-lg leading-relaxed font-medium"}
        >
          {answer.answer}
        </p>

        {answer.truncated ? (
          <Badge data-testid="ai-truncated-badge" variant="secondary" className="w-fit">
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
                className="group text-muted-foreground hover:text-foreground w-fit gap-1.5 px-0 hover:bg-transparent"
              >
                <Database className="size-3.5" />
                How this was calculated
                <ChevronDown className="size-3.5 transition-transform group-data-[panel-open]:rotate-180" />
              </Button>
            }
          />
          <CollapsibleContent className="flex flex-col gap-3 pt-3">
            <p data-testid="ai-explanation-text" className="text-muted-foreground text-sm">
              {answer.explanation}
            </p>

            {/* Monospace, read-only: a pre element never accepts input, so there is
                nothing to guard against editing. */}
            <pre className="bg-muted overflow-x-auto rounded-md border p-3 font-mono text-xs">
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
    <div data-testid="ai-rows-table" className="max-h-64 overflow-auto rounded-md border">
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
                <TableCell key={col} className="font-mono text-xs">
                  {formatCell(row[col])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length > visible.length ? (
        <p className="text-muted-foreground border-t px-2 py-1.5 text-xs">
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
