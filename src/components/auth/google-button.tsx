"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { signIn } from "@/lib/auth-client";

export function GoogleButton({ label }: { label: string }) {
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    const { error } = await signIn.social({ provider: "google", callbackURL: "/" });
    // On success the browser navigates to Google, so this only runs on failure.
    if (error) {
      toast.error(error.message ?? "Could not reach Google. Try again.");
      setPending(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      onClick={onClick}
      disabled={pending}
    >
      <svg className="size-4" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
        />
      </svg>
      {label}
    </Button>
  );
}
