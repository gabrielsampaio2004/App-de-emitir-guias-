import { db } from "@/lib/db";

export async function GET() {
  const clients = await db.client.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, phoneE164: true },
  });
  return Response.json(clients);
}
