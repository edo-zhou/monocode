import { expect, test } from "@playwright/test";

test.use({ locale: "en-GB", timezoneId: "Asia/Dubai" });

let pageErrors: string[];
test.beforeEach(({ page }) => {
  pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
});
test.afterEach(() => expect(pageErrors).toEqual([]));

test("keeps the record list and shows all typed fields in a readable detail table", async ({
  page,
}) => {
  await page.goto("/tests/browser/lark-inbox.html?records=1");
  await expect(
    page.getByRole("button", { name: /: Checkout bug$/ }),
  ).toBeVisible();
  const table = page.getByRole("table", { name: "Record fields" });
  await expect(table).toBeVisible();
  await expect(
    table.getByRole("row").filter({ hasText: "Due date" }),
  ).toContainText("15/10/2026");
  await expect(
    table.getByRole("row").filter({ hasText: "Created" }),
  ).toContainText("15/10/2026, 12:00");
  await expect(
    table.getByRole("row").filter({ hasText: "Calculated date" }),
  ).toContainText("15/10/2026");
  await expect(table).not.toContainText("1792051200000");
  await expect(
    table.getByRole("row").filter({ hasText: "Owner" }),
  ).toContainText("Kai");
  await expect(
    table.getByRole("row").filter({ hasText: "Owner" }),
  ).toContainText("Alex");
  await expect(
    table.getByRole("row").filter({ hasText: "Labels" }),
  ).toContainText("Regression");
  await expect(
    table.getByRole("row").filter({ hasText: "Verified" }),
  ).toContainText("No");
  await expect(
    table.getByRole("row").filter({ hasText: "Count" }),
  ).toContainText("0");
  await expect(
    table.getByRole("row").filter({ hasText: "Empty field" }),
  ).toContainText("—");
  await expect(
    table.getByRole("link", { name: "Specification" }),
  ).toHaveAttribute("href", "https://example.com/spec");
  await expect(page.getByText("Times shown in Asia/Dubai")).toBeVisible();
});

test("preserves edge-case values and uses Lark fallbacks for unsupported media", async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 800 });
  await page.goto("/tests/browser/lark-inbox.html?records=1");
  const table = page.getByRole("table", { name: "Record fields" });
  await table
    .getByRole("row")
    .filter({ hasText: "Unsafe link" })
    .scrollIntoViewIfNeeded();
  await expect(
    table.getByRole("row").filter({ hasText: "Unsafe link" }),
  ).toContainText("Untrusted reference");
  await expect(
    table.getByRole("link", { name: "Untrusted reference" }),
  ).toHaveCount(0);
  await expect(
    table.getByRole("row").filter({ hasText: "Invalid date" }),
  ).toContainText("not-a-date");
  await expect(
    table.getByRole("row").filter({ hasText: "Exact number" }),
  ).toContainText("9007199254740993123");
  const files = table.getByRole("row").filter({ hasText: "Other files" });
  await files.scrollIntoViewIfNeeded();
  await expect(files).toContainText("large.png");
  await expect(files).toContainText("9 MB");
  await expect(files).toContainText("diagram.svg");
  await expect(
    files.getByRole("button", { name: "Preview large.png" }),
  ).toHaveCount(0);
  await expect(
    files.getByRole("button", { name: "Open record in Lark" }),
  ).toHaveCount(2);
  await expect
    .poll(() =>
      table
        .locator("..")
        .evaluate((element) => element.scrollWidth > element.clientWidth),
    )
    .toBe(true);
});

test("previews screenshots without losing the record, and retries media permission failures", async ({
  page,
}) => {
  await page.goto("/tests/browser/lark-inbox.html?records=1&image-error=1");
  const table = page.getByRole("table", { name: "Record fields" });
  await expect(table.getByText("checkout.png", { exact: true })).toBeVisible();
  await expect(table.getByText("debug.log", { exact: true })).toBeVisible();
  await expect(table.getByText("2 KB", { exact: false })).toBeVisible();
  await expect(table.getByRole("alert")).toContainText(
    "Attachment access denied",
  );
  await table.getByRole("button", { name: "Retry checkout.png" }).click();
  const thumbnail = table.getByRole("img", {
    name: "checkout.png",
    exact: true,
  });
  await expect(thumbnail).toBeVisible();
  await expect
    .poll(() =>
      thumbnail.evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  await table
    .getByRole("button", { name: "Preview checkout.png", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Image preview: checkout.png" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Image preview: checkout.png" }),
  ).toHaveCount(0);
  await expect(table).toBeVisible();
  await expect(page.getByText("Inbox closed", { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("lark-field-table.png"),
  });
});
