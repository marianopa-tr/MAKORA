/**
 * Calculate days to expiration from expiration date string
 */
export function getDTE(expirationDate: string): number {
  const expiry = new Date(expirationDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffTime = expiry.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Get expiration dates within a DTE range
 */
export function filterExpirationsByDTE(expirations: string[], minDTE: number, maxDTE: number): string[] {
  return expirations.filter((exp) => {
    const dte = getDTE(exp);
    return dte >= minDTE && dte <= maxDTE;
  });
}
