export default function LoggedOutPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">You have been signed out</h1>
      <p className="text-muted-foreground">You can close this window or sign in again.</p>
      <a href="/login" className="underline">Sign in</a>
    </main>
  );
}
