/** Fetch with one automatic retry after a short delay. Hides transient
 *  failures (e.g. LIFF WebView network not yet ready) from the user. */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    // Network error — retry once after a short delay
    await new Promise((r) => setTimeout(r, 200));
    return fetch(input, init);
  }
}
