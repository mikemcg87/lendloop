const encoder = new TextEncoder();

function importKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

// Hex HMAC-SHA256 of `message`.
export async function sign(secret: string, message: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await importKey(secret),
    encoder.encode(message),
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Constant-time check (crypto.subtle.verify) of a hex signature.
export async function verify(
  secret: string,
  message: string,
  signatureHex: string,
): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/i.test(signatureHex)) return false;
  const bytes = new Uint8Array(
    signatureHex.match(/../g)!.map((pair) => parseInt(pair, 16)),
  );
  return crypto.subtle.verify(
    "HMAC",
    await importKey(secret),
    bytes,
    encoder.encode(message),
  );
}
