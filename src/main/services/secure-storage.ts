import { safeStorage, app } from 'electron';

let logged = false;
function checkAvailability(): boolean {
  const available = safeStorage.isEncryptionAvailable();
  if (!logged) {
    logged = true;
    console.log(`[secure-storage] Encryption available: ${available}`);
  }
  return available;
}

export function encrypt(value: string): string {
  if (!checkAvailability()) {
    throw new Error('Encryption not available. On Linux, run with --password-store=gnome-libsecret and ensure gnome-keyring is installed.');
  }
  return safeStorage.encryptString(value).toString('base64');
}

export function decrypt(stored: string): string {
  if (!checkAvailability()) {
    throw new Error('Decryption not available. On Linux, run with --password-store=gnome-libsecret and ensure gnome-keyring is installed.');
  }
  return safeStorage.decryptString(Buffer.from(stored, 'base64'));
}
