import { expect, test } from "@playwright/test";

test("validates multiple sources, separates documents and sends the correct context", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/browser/lark-inbox.html");
  await expect(
    page.getByText("No Lark CLI required.", { exact: false }),
  ).toBeVisible();
  await page
    .getByLabel("Lark source links")
    .fill(
      [
        "https://team.larksuite.com/base/BaseA?table=TableA",
        "https://team.larksuite.com/base/Private?table=TableA",
        "https://team.larksuite.com/base/BaseB?table=TableA",
        "https://team.larksuite.com/docx/DocA",
      ].join("\n"),
    );
  await page
    .getByRole("button", { name: "Validate links", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Access denied");
  await expect(
    page.getByRole("button", { name: "Confirm 3 sources" }),
  ).toBeVisible();
  await expect(page.getByLabel("Enable Frontend bugs")).toHaveCount(0);
  await page.getByRole("button", { name: "Confirm 3 sources" }).click();
  await expect(page.getByLabel("Enable Frontend bugs")).toBeChecked();
  await expect(page.getByLabel("Enable Backend bugs")).toBeChecked();
  await page.screenshot({
    path: test.info().outputPath("lark-settings.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "View Inbox", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Table records", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /: Checkout bug$/ }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /: Auth bug$/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /: Checkout PRD$/ }),
  ).toHaveCount(0);
  await page.getByLabel("Lark source", { exact: true }).selectOption("BaseB");
  await expect(
    page.getByRole("button", { name: /: Checkout bug$/ }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Reproduction steps for BaseB", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Send to agent", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Context sent: Auth bug / Reproduction steps for BaseB",
  );
  await page.getByLabel("Lark source", { exact: true }).selectOption("");
  await page
    .getByRole("button", { name: "Revoke access", exact: true })
    .click();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Backend bugs: access denied",
  );
  await expect(page.getByRole("button", { name: /: Auth bug$/ })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: /: Checkout bug$/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Restore access", exact: true })
    .click();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("button", { name: /: Auth bug$/ })).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("lark-records.png"),
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Documents", exact: true }).click();
  await expect(page.getByRole("button", { name: /: Auth bug$/ })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: /: Checkout PRD$/ }),
  ).toBeVisible();
  await expect(
    page.getByText("Document acceptance requirements", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Use as context", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Context sent: Checkout PRD / Document acceptance requirements",
  );
  await page.screenshot({
    path: test.info().outputPath("lark-documents.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Manage Lark", exact: true }).click();
  await page.getByLabel("Enable Backend bugs").uncheck();
  await page.getByRole("button", { name: "View Inbox", exact: true }).click();
  await expect(page.getByRole("button", { name: /: Auth bug$/ })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: /: Checkout bug$/ }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
