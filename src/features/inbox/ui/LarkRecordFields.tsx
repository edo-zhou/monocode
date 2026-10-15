import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { LarkRecordField } from "../model/lark";
import type { InboxItem } from "../model/githubTasks";
import { LarkAttachments } from "./LarkAttachments";
import {
  larkDate,
  larkFieldValue,
  larkObject,
  larkText,
  safeLarkLink,
} from "../model/larkFields";

function FieldValue({
  field,
  item,
}: {
  field: LarkRecordField;
  item: InboxItem;
}) {
  const [error, setError] = useState("");
  const { kind, value } = larkFieldValue(field);
  if (value == null || value === "" || (Array.isArray(value) && !value.length))
    return <span className="text-content/35">—</span>;
  const values = Array.isArray(value) ? value : [value];
  if (kind === 17)
    return <LarkAttachments item={item} fieldId={field.id} values={values} />;
  if ([5, 1001, 1002].includes(kind)) {
    const includeTime =
      kind !== 5 || !field.dateFormat || /[Hhms]/.test(field.dateFormat);
    return (
      <div className="space-y-1">
        {values.map((entry, index) => {
          const date = larkDate(entry, includeTime);
          return (
            <time
              key={index}
              className="block tabular-nums"
              dateTime={date.iso}
              title={date.iso}
            >
              {date.text}
            </time>
          );
        })}
      </div>
    );
  }
  if ([3, 4, 11, 23, 1003, 1004].includes(kind))
    return (
      <div className="flex flex-wrap gap-1.5">
        {values.map((entry, index) => (
          <span
            key={index}
            className="rounded bg-content/5 px-2 py-0.5 text-[12px]"
          >
            {larkText(entry)}
          </span>
        ))}
      </div>
    );
  if (kind === 7)
    return (
      <span>
        {values
          .map((entry) =>
            entry === true ? "Yes" : entry === false ? "No" : larkText(entry),
          )
          .join(", ")}
      </span>
    );
  if (kind === 1 || kind === 15)
    return (
      <>
        {values.map((entry, index) => {
          const link = safeLarkLink(larkObject(entry).link);
          const text = larkText(entry);
          return link ? (
            <a
              key={index}
              href={link}
              className="text-accent underline underline-offset-2"
              onClick={(event) => {
                event.preventDefault();
                void openUrl(link).catch((error: unknown) =>
                  setError(String(error)),
                );
              }}
            >
              {text || link}
            </a>
          ) : (
            <span key={index}>{text}</span>
          );
        })}
        {error ? (
          <p role="alert" className="text-red-400">
            {error}
          </p>
        ) : null}
      </>
    );
  return <span>{larkText(value)}</span>;
}

export function LarkRecordFields({
  fields,
  item,
}: {
  fields: LarkRecordField[];
  item: InboxItem;
}) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <section className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-content/45">
        <span>{fields.length} fields · Read-only</span>
        <span>Times shown in {timezone}</span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-stroke">
        <table
          aria-label="Record fields"
          className="w-full min-w-[360px] table-fixed border-collapse text-left text-[13px]"
        >
          <thead className="bg-content/5 text-[11px] text-content/50">
            <tr>
              <th scope="col" className="w-1/3 px-3 py-2 font-medium">
                Field
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => (
              <tr key={field.id} className="border-t border-stroke align-top">
                <th
                  scope="row"
                  className="break-words bg-content/[0.02] px-3 py-3 font-medium text-content/60"
                >
                  {field.name}
                </th>
                <td className="whitespace-pre-wrap break-words px-3 py-3 leading-6 text-content/85">
                  <FieldValue field={field} item={item} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
