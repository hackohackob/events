'use client'

import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      // Refetch whenever the dashboard tab regains focus so stale data
      // (event/POI edits made elsewhere) refreshes without a manual reload.
      queries: { retry: 1, refetchOnWindowFocus: true },
    },
  }))

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}
