/** Fixture: client duplicate-detection for gate F */
export function findDuplicateClient(phone: string, email: string) {
  const normalizedPhone = phone.replace(/\D/g, "");
  const normalizedEmail = email.trim().toLowerCase();
  return { phone: normalizedPhone, email: normalizedEmail, duplicate: false };
}
