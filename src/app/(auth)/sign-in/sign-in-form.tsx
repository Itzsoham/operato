"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "@/lib/auth-client";
import { signInSchema } from "@/lib/validations/auth";

type FieldErrors = Partial<Record<"email" | "password" | "form", string>>;

export function SignInForm() {
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});

    const form = new FormData(event.currentTarget);
    // Same schema the server uses — see src/lib/validations/auth.ts. This copy only
    // saves a round trip; it is not a security control.
    const parsed = signInSchema.safeParse({
      email: form.get("email"),
      password: form.get("password"),
    });

    if (!parsed.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === "email" || key === "password") fieldErrors[key] ??= issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    setPending(true);
    const { error } = await signIn.email(parsed.data);

    if (error) {
      // Deliberately vague: saying "no such account" would let anyone enumerate which
      // emails are registered. Wrong password and unknown user read identically.
      setErrors({ form: "That email and password don't match an account." });
      setPending(false);
      return;
    }

    // refresh() BEFORE push(), not after. The sign-in page renders a <Link href="/">,
    // so Next prefetched `/` while this user was still signed OUT — and `/` when signed
    // out is a redirect back to /sign-in. Navigating first would consume that stale
    // entry and bounce the user straight back to the page they just left.
    router.refresh();
    router.push("/");
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap" noValidate data-testid="sign-in-form">
      <div className="grid gap-xs">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@restaurant.com"
          aria-invalid={Boolean(errors.email)}
          data-testid="sign-in-email"
          required
        />
        {errors.email ? <p className="text-destructive text-small">{errors.email}</p> : null}
      </div>

      <div className="grid gap-xs">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={Boolean(errors.password)}
          data-testid="sign-in-password"
          required
        />
        {errors.password ? <p className="text-destructive text-small">{errors.password}</p> : null}
      </div>

      {errors.form ? (
        <p role="alert" className="text-destructive text-small" data-testid="sign-in-error">
          {errors.form}
        </p>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending} data-testid="sign-in-submit">
        {pending ? "Signing in…" : "Sign in"}
      </Button>

      <div className="relative my-2 text-center text-body after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t after:border-border">
        <span className="relative z-10 bg-background px-2 text-muted-foreground">Or</span>
      </div>

      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => {
          const emailInput = document.getElementById("email") as HTMLInputElement;
          const passwordInput = document.getElementById("password") as HTMLInputElement;
          if (emailInput && passwordInput) {
            emailInput.value = "owner@spicegarden.test";
            passwordInput.value = "operato-demo-1234";
          }
        }}
      >
        Load Demo Credentials
      </Button>
    </form>
  );
}
