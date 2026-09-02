export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json({ service: "ompweb", ok: true });
}
