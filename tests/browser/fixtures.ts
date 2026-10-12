import { test as base } from '@playwright/test';
export { expect, chromium, type Page } from '@playwright/test';

// Keep synthetic image references offline. Individual image tests can override this route.
export const test = base.extend({
  context: async ({ context }, use) => {
    await context.route('https://pbs.twimg.com/**', route => route.abort());
    await use(context);
  },
});
