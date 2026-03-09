/** Fetch with one automatic retry after a short delay. Hides transient
 *  failures (e.g. LIFF WebView network not yet ready) from the user. */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  try {
    const res = await fetch(input, init);
    if (res.ok) return res;
    // Non-OK but got a response — don't retry (server-side error)
    return res;
  } catch {
    // Network error — retry once after 1s
    await new Promise((r) => setTimeout(r, 1000));
    return fetch(input, init);
  }
}
