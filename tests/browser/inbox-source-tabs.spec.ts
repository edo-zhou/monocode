import { expect, test, type Locator } from "@playwright/test";

let pageErrors: string[];
test.beforeEach(({ page }) => {
  pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
});
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

async function fullyVisible(tab: Locator, strip: Locator) {
  const tabBounds = await tab.boundingBox();
  const stripBounds = await strip.boundingBox();
  return (
    !!tabBounds &&
    !!stripBounds &&
    tabBounds.x >= stripBounds.x - 1 &&
    tabBounds.x + tabBounds.width <= stripBounds.x + stripBounds.width + 1
  );
}

test("keeps source labels inside their tabs in a narrow Inbox", async ({
  page,
}) => {
  await page.setViewportSize({ width: 480, height: 800 });
  await page.goto("/tests/browser/inbox-source-tabs.html");
  const strip = page.getByRole("tablist", {
    name: "Inbox source",
    exact: true,
  });
  await expect(strip.getByRole("tab")).toHaveCount(4);
  const clippedLabels = await strip.getByRole("tab").evaluateAll((tabs) =>
    tabs.flatMap((tab) => {
      const bounds = tab.getBoundingClientRect();
      const walker = document.createTreeWalker(tab, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(walker.currentNode);
        const text = range.getBoundingClientRect();
        if (text.left < bounds.left - 1 || text.right > bounds.right + 1)
          return [tab.textContent];
      }
      return [];
    }),
  );
  expect(clippedLabels).toEqual([]);
  await expect(
    page.getByRole("button", { name: "Connect an inbox source" }),
  ).toBeVisible();
  await strip.locator("..").screenshot({
    path: test.info().outputPath("inbox-source-tabs.png"),
  });
});

test("scrolls sources with buttons and both wheel directions while keeping Add fixed", async ({
  page,
}) => {
  await page.setViewportSize({ width: 480, height: 800 });
  await page.goto("/tests/browser/inbox-source-tabs.html");
  const strip = page.getByRole("tablist", {
    name: "Inbox source",
    exact: true,
  });
  const lark = strip.getByRole("tab", { name: "Lark", exact: true });
  await expect(lark).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => fullyVisible(lark, strip)).toBe(true);
  const add = page.getByRole("button", { name: "Connect an inbox source" });
  const addPosition = await add.boundingBox();
  const left = page.getByRole("button", { name: "Scroll inbox sources left" });
  const right = page.getByRole("button", {
    name: "Scroll inbox sources right",
  });
  await expect(left).toBeEnabled();
  for (let index = 0; index < 3 && (await left.isEnabled()); index++) {
    const target = await strip.evaluate((element) =>
      Math.max(
        0,
        element.scrollLeft - Math.max(element.clientWidth * 0.75, 112),
      ),
    );
    await left.click();
    await expect
      .poll(() =>
        strip.evaluate(
          (element, target) => Math.abs(element.scrollLeft - target),
          target,
        ),
      )
      .toBeLessThan(1);
  }
  await expect(left).toBeDisabled();
  await strip.hover();
  await page.mouse.wheel(0, 200);
  await expect
    .poll(() => strip.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(50);
  await page.mouse.wheel(-500, 0);
  await expect(left).toBeDisabled();
  await right.click();
  await expect
    .poll(() => strip.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(50);
  expect(await add.boundingBox()).toEqual(addPosition);
  await add.click();
  await expect(
    page.getByRole("menuitem", { name: "Connect Jira" }),
  ).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("narrow-inbox.png") });
});

test("dragging an inactive source reorders it without switching providers and survives reload", async ({
  page,
}) => {
  await page.goto("/tests/browser/inbox-source-tabs.html");
  const strip = page.getByRole("tablist", {
    name: "Inbox source",
    exact: true,
  });
  await expect(strip.getByRole("tab")).toHaveCount(4);
  const handle = await page.getByLabel("Resize inbox list").boundingBox();
  expect(handle).not.toBeNull();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + 100);
  await page.mouse.down();
  await page.mouse.move(handle!.x + 180, handle!.y + 100, { steps: 10 });
  await page.mouse.up();
  await expect(
    page.getByRole("button", { name: "Scroll inbox sources right" }),
  ).toHaveCount(0);
  const github = await strip
    .getByRole("tab", { name: "GitHub", exact: true })
    .boundingBox();
  const gitlab = await strip
    .getByRole("tab", { name: "GitLab", exact: true })
    .boundingBox();
  expect(github).not.toBeNull();
  expect(gitlab).not.toBeNull();
  await page.mouse.move(
    github!.x + github!.width / 2,
    github!.y + github!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    gitlab!.x + gitlab!.width / 2,
    gitlab!.y + gitlab!.height / 2,
    { steps: 20 },
  );
  await page.mouse.up();
  await expect(strip.getByRole("tab")).toHaveText([
    "Linear",
    "GitLab",
    "GitHub",
    "Lark",
  ]);
  await expect(
    strip.getByRole("tab", { name: "Lark", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await strip.getByRole("tab", { name: "Linear", exact: true }).click();
  await expect(
    strip.getByRole("tab", { name: "Linear", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.reload();
  await expect(strip.getByRole("tab")).toHaveText([
    "Linear",
    "GitLab",
    "GitHub",
    "Lark",
  ]);
  await expect(
    strip.getByRole("tab", { name: "Linear", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});

test("dragging at either edge scrolls to offscreen sources", async ({
  page,
}) => {
  await page.setViewportSize({ width: 480, height: 800 });
  await page.goto("/tests/browser/inbox-source-tabs.html?all=1&source=github");
  const strip = page.getByRole("tablist", {
    name: "Inbox source",
    exact: true,
  });
  await expect(strip.getByRole("tab")).toHaveCount(6);
  const bounds = await strip.boundingBox();
  expect(bounds).not.toBeNull();
  for (const direction of [1, -1]) {
    const github = await strip
      .getByRole("tab", { name: "GitHub", exact: true })
      .boundingBox();
    expect(github).not.toBeNull();
    await page.mouse.move(
      github!.x + github!.width / 2,
      github!.y + github!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      direction === 1 ? bounds!.x + bounds!.width - 3 : bounds!.x + 3,
      bounds!.y + bounds!.height / 2,
      { steps: 10 },
    );
    await expect
      .poll(() =>
        strip.evaluate(
          (element, direction) =>
            direction === 1
              ? element.scrollWidth - element.clientWidth - element.scrollLeft
              : element.scrollLeft,
          direction,
        ),
      )
      .toBeLessThan(2);
    await page.mouse.up();
    await expect(strip.getByRole("tab")).toHaveText(
      direction === 1
        ? ["Linear", "Jira", "GitLab", "ADO", "Lark", "GitHub"]
        : ["GitHub", "Linear", "Jira", "GitLab", "ADO", "Lark"],
    );
  }
});

test("supports keyboard ordering and remembers disconnected source positions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 480, height: 800 });
  await page.goto("/tests/browser/inbox-source-tabs.html");
  const strip = page.getByRole("tablist", {
    name: "Inbox source",
    exact: true,
  });
  const lark = strip.getByRole("tab", { name: "Lark", exact: true });
  await lark.focus();
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(strip.getByRole("tab")).toHaveText([
    "GitHub",
    "Linear",
    "Lark",
    "GitLab",
  ]);
  await expect(lark).toBeFocused();
  await expect(lark).toHaveAttribute("aria-selected", "true");
  await page
    .getByRole("button", { name: "Disconnect Linear", exact: true })
    .click();
  await expect(strip.getByRole("tab")).toHaveText(["GitHub", "Lark", "GitLab"]);
  await lark.focus();
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(strip.getByRole("tab")).toHaveText(["Lark", "GitHub", "GitLab"]);
  await page
    .getByRole("button", { name: "Connect Linear", exact: true })
    .click();
  await expect(strip.getByRole("tab")).toHaveText([
    "Lark",
    "Linear",
    "GitHub",
    "GitLab",
  ]);
  await page.reload();
  await expect(strip.getByRole("tab")).toHaveText([
    "Lark",
    "Linear",
    "GitHub",
    "GitLab",
  ]);
  await lark.focus();
  await page.keyboard.press("End");
  const gitlab = strip.getByRole("tab", { name: "GitLab", exact: true });
  await expect(gitlab).toBeFocused();
  await expect(gitlab).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => fullyVisible(gitlab, strip)).toBe(true);
  await page.keyboard.press("Home");
  await expect(lark).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(
    strip.getByRole("tab", { name: "Linear", exact: true }),
  ).toBeFocused();
  await expect(
    strip.getByRole("tab", { name: "Linear", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});

test("Escape cancels a drag instead of closing Inbox or saving a new order", async ({
  page,
}) => {
  await page.goto("/tests/browser/inbox-source-tabs.html?source=github");
  const strip = page.getByRole("tablist", {
    name: "Inbox source",
    exact: true,
  });
  const github = strip.getByRole("tab", { name: "GitHub", exact: true });
  await expect(github).toHaveAttribute("aria-selected", "true");
  const from = await github.boundingBox();
  const to = await strip
    .getByRole("tab", { name: "Linear", exact: true })
    .boundingBox();
  expect(from).not.toBeNull();
  expect(to).not.toBeNull();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, {
    steps: 10,
  });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(strip.getByRole("tab")).toHaveText([
    "GitHub",
    "Linear",
    "GitLab",
    "Lark",
  ]);
  await expect(github).not.toHaveAttribute("data-dragging");
  await page.reload();
  await expect(strip.getByRole("tab")).toHaveText([
    "GitHub",
    "Linear",
    "GitLab",
    "Lark",
  ]);
});

for (const [name, stored, expected] of [
  ["invalid JSON", "not json", ["GitHub", "Linear", "GitLab", "Lark"]],
  [
    "duplicate and unknown providers",
    '["lark","unknown","lark","gitlab"]',
    ["Lark", "GitLab", "GitHub", "Linear"],
  ],
] as const) {
  test(`recovers source preferences containing ${name}`, async ({ page }) => {
    await page.addInitScript(
      (value) => localStorage.setItem("monocode.inboxSourceOrder", value),
      stored,
    );
    await page.goto("/tests/browser/inbox-source-tabs.html");
    const strip = page.getByRole("tablist", {
      name: "Inbox source",
      exact: true,
    });
    await expect(strip.getByRole("tab")).toHaveText([...expected]);
  });
}
