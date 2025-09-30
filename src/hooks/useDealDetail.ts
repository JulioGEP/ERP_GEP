import { useQuery } from '@tanstack/react-query'

export function useDealDetail(dealId: string) {
  return useQuery({
    queryKey: ['dealDetail', dealId],
    queryFn: async () => {
      const res = await fetch(`/.netlify/functions/deals/${dealId}`)
      const json = await res.json()
      if (!res.ok || json.ok === false) throw json
      return json.deal
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
  })
}
