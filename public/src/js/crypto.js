const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

export async function hashToBase64(data) {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return arrayBufferToBase64(digest);
}

export async function deriveKey(passphrase, saltBase64, opslimit) {
  const iterations = Math.max(150000, Number(opslimit || 0) * 150000);
  const passphraseKey = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  const salt = base64ToArrayBuffer(saltBase64);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256"
    },
    passphraseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function deriveRoomId(passphrase) {
  const data = textEncoder.encode(`${passphrase}:room`);
  return hashToBase64(data);
}

export async function encryptMessage(message, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = textEncoder.encode(message);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  return {
    iv: arrayBufferToBase64(iv.buffer),
    ciphertext: arrayBufferToBase64(encrypted)
  };
}

export async function encryptBinary(buffer, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, buffer);
  return {
    iv: arrayBufferToBase64(iv.buffer),
    ciphertext: arrayBufferToBase64(encrypted)
  };
}

export async function decryptMessage(ciphertext, iv, key) {
  try {
    if (!iv) return "[Unsupported message]";
    const buffer = base64ToArrayBuffer(ciphertext);
    const ivBuffer = base64ToArrayBuffer(iv);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(ivBuffer) },
      key,
      buffer
    );
    return textDecoder.decode(decrypted);
  } catch (err) {
    return "[Unable to decrypt]";
  }
}

export async function decryptBinary(ciphertext, iv, key) {
  try {
    if (!iv) return null;
    const buffer = base64ToArrayBuffer(ciphertext);
    const ivBuffer = base64ToArrayBuffer(iv);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(ivBuffer) },
      key,
      buffer
    );
    return decrypted;
  } catch (err) {
    return null;
  }
}
