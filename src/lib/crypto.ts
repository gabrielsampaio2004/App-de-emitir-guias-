import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * Criptografa/descriptografa o accessToken da Meta antes de guardá-lo no banco.
 *
 * Formato do texto cifrado: iv:authTag:ciphertext, tudo em hex. IV de 12 bytes
 * (recomendado para GCM) e authTag de 16 bytes viajam junto — sem eles não dá
 * para descriptografar, então guardá-los ao lado do ciphertext é seguro.
 */

const ALGORITHM = "aes-256-gcm";

function loadKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) {
    throw new Error("ENCRYPTION_KEY não definida no ambiente");
  }
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY deve ter 32 bytes em hex (64 caracteres); recebeu ${key.length}`,
    );
  }
  return key;
}

export function encrypt(plain: string): string {
  const key = loadKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [iv.toString("hex"), authTag.toString("hex"), ciphertext.toString("hex")].join(":");
}

export function decrypt(encrypted: string): string {
  const key = loadKey();
  const parts = encrypted.split(":");
  const [ivHex, authTagHex, ciphertextHex] = parts;
  if (parts.length !== 3 || !ivHex || !authTagHex || !ciphertextHex) {
    throw new Error("Formato de texto cifrado inválido");
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));

  // Se o authTag não bater (chave errada ou dado adulterado), final() lança —
  // nunca retorna dado parcial ou corrompido.
  const plain = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, "hex")),
    decipher.final(),
  ]);

  return plain.toString("utf8");
}
