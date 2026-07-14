"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { slugify } from "@/lib/validations/auth";
import { createRestaurant, type OnboardingState } from "./actions";

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState<OnboardingState, FormData>(
    createRestaurant,
    {},
  );

  // The slug follows the name until the user takes it over — after that, typing the
  // name must not silently rewrite an address they deliberately chose.
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-2">
        <Label htmlFor="name">Restaurant name</Label>
        <Input
          id="name"
          name="name"
          placeholder="Spice Garden"
          autoComplete="organization"
          aria-invalid={Boolean(state.errors?.name)}
          onChange={(e) => {
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
          required
        />
        {state.errors?.name ? (
          <p className="text-destructive text-sm">{state.errors.name}</p>
        ) : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="slug">Address</Label>
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground text-sm">operato.app/</span>
          <Input
            id="slug"
            name="slug"
            value={slug}
            placeholder="spice-garden"
            aria-invalid={Boolean(state.errors?.slug)}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
            required
          />
        </div>
        {state.errors?.slug ? (
          <p className="text-destructive text-sm">{state.errors.slug}</p>
        ) : (
          <p className="text-muted-foreground text-xs">
            Lowercase letters, numbers and hyphens.
          </p>
        )}
      </div>

      {state.errors?.form ? (
        <p role="alert" className="text-destructive text-sm">
          {state.errors.form}
        </p>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating…" : "Create restaurant"}
      </Button>
    </form>
  );
}
