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
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Create an account · Operato" };

export default function SignUpPage() {
  const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>You&apos;ll set up your restaurant next.</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap">
        <SignUpForm />

        {googleEnabled ? (
          <>
            <div className="flex items-center gap-sm">
              <span className="bg-border h-px flex-1" />
              <span className="text-muted-foreground text-small">or</span>
              <span className="bg-border h-px flex-1" />
            </div>
            <GoogleButton label="Sign up with Google" />
          </>
        ) : null}

        <p className="text-muted-foreground text-body text-center">
          Already have an account?{" "}
          <Link href="/sign-in" className="text-foreground font-medium underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
