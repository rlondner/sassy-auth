/**
 * bug-0207: shared loading state for every admin route under the
 * (admin) group. Next.js renders this while the server component
 * fetches data on navigation — previously the UI froze on the last
 * page's content until the new page's data landed. A skeleton row
 * matches the shape of the tables that follow so the visual shift
 * on hydration is minimal.
 */
export default function AdminLoading() {
  return (
    <div className="flex flex-col gap-4 p-6" aria-busy="true" aria-live="polite">
      <div className="h-8 w-48 animate-pulse rounded bg-muted" />
      <div className="h-4 w-72 animate-pulse rounded bg-muted" />
      <div className="mt-4 flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 w-full animate-pulse rounded bg-muted" />
        ))}
      </div>
    </div>
  )
}
