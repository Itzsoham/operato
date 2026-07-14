"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  // useState, not a module-level const: a module-level QueryClient is shared across ALL
  // requests on the server, so one user's cached data can be handed to the next. Per
  // component instance, it is per request.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Server Components already delivered fresh data on navigation; refetching
            // the instant the tab regains focus mostly just makes the UI flicker.
            refetchOnWindowFocus: false,
            staleTime: 30_000,
            retry: 1,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
