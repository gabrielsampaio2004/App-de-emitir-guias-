import { requireOwner } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { createUser } from "./actions";

export const dynamic = "force-dynamic";

/** OWNER-only: única tela que cria usuário depois do bootstrap do seed. */
export default async function UsuariosPage() {
  const session = await requireOwner();

  const users = await db.user.findMany({
    where: { tenantId: session.user.tenantId },
    orderBy: { createdAt: "asc" },
  });

  return (
    <main style={{ fontFamily: "sans-serif", maxWidth: 700, margin: "2rem auto" }}>
      <h1>Usuários</h1>

      <table style={{ borderCollapse: "collapse", width: "100%", marginBottom: "2rem" }}>
        <thead>
          <tr>
            <th align="left">Nome</th>
            <th align="left">E-mail</th>
            <th align="left">Papel</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td>{u.email}</td>
              <td>{u.role}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Novo usuário</h2>
      <form action={createUser} style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: 320 }}>
        <label>
          Nome
          <input type="text" name="name" required style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          E-mail
          <input type="email" name="email" required style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          Senha
          <input type="password" name="password" required minLength={8} style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          Papel
          <select name="role" defaultValue="OPERATOR" style={{ display: "block", width: "100%" }}>
            <option value="OWNER">Dono</option>
            <option value="OPERATOR">Operador</option>
            <option value="VIEWER">Visualizador</option>
          </select>
        </label>
        <button type="submit">Criar</button>
      </form>
    </main>
  );
}
