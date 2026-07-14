import Link from "next/link";
import type { Metadata } from "next";

import { GoogleButton } from "@/components/auth/google-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in · Operato" };

export default function SignInPage() {
  const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Welcome back</CardTitle>
        <CardDescription>Sign in to your restaurant.</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <SignInForm />

        {googleEnabled ? (
          <>
            <div className="flex items-center gap-3">
              <span className="bg-border h-px flex-1" />
              <span className="text-muted-foreground text-xs">or</span>
              <span className="bg-border h-px flex-1" />
            </div>
            <GoogleButton label="Continue with Google" />
          </>
        ) : null}

        <p className="text-muted-foreground text-center text-sm">
          No account?{" "}
          <Link href="/sign-up" className="text-foreground font-medium underline-offset-4 hover:underline">
            Create one
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
