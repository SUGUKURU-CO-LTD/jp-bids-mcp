export class TokenBucketRateLimiter {
  private nextAvailableAt = 0;

  constructor(private readonly intervalMs: number) {}

  async wait(): Promise<void> {
    const now = Date.now();
    const waitMs = Math.max(0, this.nextAvailableAt - now);
    this.nextAvailableAt = Math.max(now, this.nextAvailableAt) + this.intervalMs;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}
