export async function command<T>(type: string, extra = {}): Promise<T> {
  const response = await chrome.runtime.sendMessage({ type, ...extra });
  if (!response?.ok) throw new Error(response?.error ?? '拡張との通信に失敗しました');
  return response.value as T;
}
