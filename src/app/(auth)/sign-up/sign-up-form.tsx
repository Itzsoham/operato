"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUp } from "@/lib/auth-client";
import { signUpSchema } from "@/lib/validations/auth";

type Field = "name" | "email" | "password";
type FieldErrors = Partial<Record<Field | "form", string>>;

export function SignUpForm() {
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});

    const form = new FormData(event.currentTarget);
    const parsed = signUpSchema.safeParse({
      name: form.get("name"),
      email: form.get("email"),
      password: form.get("password"),
    });

    if (!parsed.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as Field;
        if (key === "name" || key === "email" || key === "password") {
          fieldErrors[key] ??= issue.message;
        }
      }
      setErrors(fieldErrors);
      return;
    }

    setPending(true);
    const { error } = await signUp.email(parsed.data);

    if (error) {
      // Map known codes; never render error.message. That string is a library internal
      // and can carry wording we neither wrote nor reviewed. A duplicate email IS worth
      // naming — the person is trying to claim that address and has to be told — but
      // everything else gets one fixed sentence.
      const message =
        error.code === "USER_ALREADY_EXISTS"
          ? "An account with that email already exists."
          : "Could not create the account. Try again.";
      setErrors({ form: message });
      setPending(false);
      return;
    }

    // Better Auth signs the new user straight in. They have no restaurant yet, so the
    // root route will send them to onboarding. refresh() first — `/` was prefetched
    // while signed out, and that cached copy redirects back to sign-in.
    router.refresh();
    router.push("/");
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div className="grid gap-2">
        <Label htmlFor="name">Your name</Label>
        <Input
          id="name"
          name="name"
          autoComplete="name"
          placeholder="Ravi Menon"
          aria-invalid={Boolean(errors.name)}
          required
        />
        {errors.name ? <p className="text-destructive text-sm">{errors.name}</p> : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@restaurant.com"
          aria-invalid={Boolean(errors.email)}
          required
        />
        {errors.email ? <p className="text-destructive text-sm">{errors.email}</p> : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          aria-invalid={Boolean(errors.password)}
          required
        />
        <p className="text-muted-foreground text-xs">At least 8 characters.</p>
        {errors.password ? <p className="text-destructive text-sm">{errors.password}</p> : null}
      </div>

      {errors.form ? (
        <p role="alert" className="text-destructive text-sm">
          {errors.form}
        </p>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
