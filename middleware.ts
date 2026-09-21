import { clerkMiddleware } from "@clerk/nextjs/server";

// Makes the signed-in user available to auth() in route handlers.
// Nothing is blocked here; /api/token checks the user itself so it can
// answer with a clear JSON error instead of a redirect.
export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals and static files.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes.
    "/(api|trpc)(.*)",
  ],
};
