import { useQuery } from "@tanstack/react-query";

export function Home() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: async () => (await fetch("/health")).json() as Promise<{ status: string; db: string }>,
  });
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-3xl font-bold">KiranaAI</h1>
      <p className="mt-2 text-stone-600">Agentic commerce for neighbourhood kirana stores, on Beckn / ONDC.</p>
      <p className="mt-6 text-sm">
        Server: <span className="font-mono">{health.data ? `${health.data.status} · db ${health.data.db}` : "…"}</span>
      </p>
    </main>
  );
}
