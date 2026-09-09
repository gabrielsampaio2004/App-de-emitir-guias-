import { createHash, randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { putObject } from "@/lib/storage";

const KINDS = ["DAS", "DARF", "DCTF", "FGTS", "GPS", "GARE", "ISS", "BOLETO", "INSS"];

/**
 * Etapa 2 — "enviar agora": recebe o PDF direto (sem matching automático,
 * isso é Etapa 3), cria o Document e um Delivery já SCHEDULED pra agora. O
 * envio de verdade acontece no próximo tick do worker (`enqueueDue`, até 60s
 * depois) — este endpoint só grava, não fala com a Meta.
 */
export async function POST(request: Request) {
  const form = await request.formData();

  const file = form.get("file");
  const clientId = form.get("clientId");
  const kind = form.get("kind");
  const competencia = form.get("competencia");
  const dueDateRaw = form.get("dueDate");

  if (!(file instanceof File)) {
    return Response.json({ error: "Campo 'file' ausente ou inválido" }, { status: 400 });
  }
  if (typeof clientId !== "string" || !clientId) {
    return Response.json({ error: "Campo 'clientId' ausente" }, { status: 400 });
  }
  if (typeof kind !== "string" || !KINDS.includes(kind)) {
    return Response.json({ error: `Campo 'kind' precisa ser um de: ${KINDS.join(", ")}` }, { status: 400 });
  }
  if (file.type !== "application/pdf") {
    return Response.json({ error: "Só PDF é aceito" }, { status: 400 });
  }

  const client = await db.client.findUnique({ where: { id: clientId } });
  if (!client) {
    return Response.json({ error: "Cliente não encontrado" }, { status: 404 });
  }

  const consent = await db.consent.findFirst({
    where: { clientId: client.id, status: "GRANTED", revokedAt: null },
    orderBy: { grantedAt: "desc" },
  });
  if (!consent) {
    return Response.json({ error: "Cliente sem consentimento ativo — não é possível agendar envio" }, { status: 422 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const storageKey = `${client.tenantId}/${sha256}-${file.name}`;

  let dueDate: Date | null = null;
  if (typeof dueDateRaw === "string" && dueDateRaw) {
    const parsed = new Date(dueDateRaw);
    if (Number.isNaN(parsed.getTime())) {
      return Response.json({ error: "dueDate inválida" }, { status: 400 });
    }
    dueDate = parsed;
  }

  await putObject(storageKey, buffer, file.type);

  let document;
  try {
    document = await db.document.create({
      data: {
        tenantId: client.tenantId,
        clientId: client.id,
        filename: file.name,
        mimeType: file.type,
        sizeBytes: buffer.byteLength,
        sha256,
        storageKey,
        kind,
        competencia: typeof competencia === "string" && competencia ? competencia : null,
        dueDate,
        uploadedBy: "etapa2-ui",
      },
    });
  } catch (err) {
    // @@unique([tenantId, sha256]) — o próprio arquivo já foi enviado antes
    // pra este tenant. Não é bug, é a trava fazendo o trabalho dela.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return Response.json({ error: "Este arquivo já foi enviado antes (mesmo conteúdo)" }, { status: 409 });
    }
    throw err;
  }

  const delivery = await db.delivery.create({
    data: {
      tenantId: client.tenantId,
      documentId: document.id,
      clientId: client.id,
      scheduledAt: new Date(),
      status: "SCHEDULED",
      idempotencyKey: randomUUID(),
    },
  });

  return Response.json(
    {
      documentId: document.id,
      deliveryId: delivery.id,
      status: delivery.status,
      message: "Agendado. O worker pega isso no próximo tick (até 60s).",
    },
    { status: 201 },
  );
}

export async function GET() {
  const deliveries = await db.delivery.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { client: true, document: true },
  });
  return Response.json(
    deliveries.map((d) => ({
      id: d.id,
      client: d.client.name,
      document: d.document.filename,
      status: d.status,
      waMessageId: d.waMessageId,
      lastError: d.lastError,
      sentAt: d.sentAt,
      deliveredAt: d.deliveredAt,
      readAt: d.readAt,
    })),
  );
}
