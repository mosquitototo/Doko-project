import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import type { ReactNode } from "react";
import Card from "../../components/ui/Card";
import { getDocumentationPage } from "../../api/documentation";
import { LeftButton } from "../../components/ui/IconButton";

function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[`*_~()[\]{}:;'",.?!/\\]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function sanitizeHref(href: string): string | null {
  const value = href.trim();

  if (!value) return null;
  if (/[\u0000-\u001F\u007F]/.test(value)) return null;
  if (value.startsWith("#")) return value;
  if (value.startsWith("http://")) return value;
  if (value.startsWith("https://")) return value;
  if (value.startsWith("mailto:")) return value;

  return null;
}

type MarkdownTableAlign = "left" | "center" | "right";

type MarkdownTableState = {
  headers: string[];
  rows: string[][];
  aligns: MarkdownTableAlign[];
};

function parseMarkdownTableRow(line: string): string[] | null {
  const trimmed = line.trim();

  if (!trimmed.includes("|")) return null;

  const withoutEdges = trimmed.replace(/^\|/, "").replace(/\|$/, "");

  if (!withoutEdges.includes("|")) return null;

  return withoutEdges.split("|").map((cell) => cell.trim());
}

function getMarkdownTableAlignments(cells: string[]): MarkdownTableAlign[] | null {
  const aligns: MarkdownTableAlign[] = [];

  for (const cell of cells) {
    const value = cell.replace(/\s+/g, "");

    if (!/^:?-{3,}:?$/.test(value)) {
      return null;
    }

    if (value.startsWith(":") && value.endsWith(":")) {
      aligns.push("center");
    } else if (value.endsWith(":")) {
      aligns.push("right");
    } else {
      aligns.push("left");
    }
  }

  return aligns;
}

function normalizeTableRow(row: string[], size: number): string[] {
  return Array.from({ length: size }, (_, index) => row[index] ?? "");
}

function normalizeTableAligns(aligns: MarkdownTableAlign[], size: number): MarkdownTableAlign[] {
  return Array.from({ length: size }, (_, index) => aligns[index] ?? "left");
}

function tableAlignClass(align: MarkdownTableAlign): string {
  if (align === "center") return "text-center";
  if (align === "right") return "text-right";
  return "text-left";
}

function renderInline(text: string, keyPrefix: string) {
  const tokenRegex = /(`[^`]+`)|(\[[^\]]+\]\([^)]+\))/g;
  const parts = text.split(tokenRegex).filter(Boolean);

  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={`${keyPrefix}-${index}`}
          className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      const [, label, rawHref] = linkMatch;
      const safeHref = sanitizeHref(rawHref);

      if (!safeHref) {
        return <span key={`${keyPrefix}-${index}`}>{label}</span>;
      }

      const isAnchor = safeHref.startsWith("#");
      const isExternal = safeHref.startsWith("http://") || safeHref.startsWith("https://");

      return (
        <a
          key={`${keyPrefix}-${index}`}
          href={safeHref}
          className="text-foreground underline underline-offset-4 transition hover:text-muted-foreground"
          {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          {...(isAnchor
            ? {
                onClick: (e) => {
                  e.preventDefault();
                  const id = safeHref.slice(1);
                  const el = document.getElementById(id);
                  if (el) {
                    el.scrollIntoView({ behavior: "smooth", block: "start" });
                    history.replaceState(null, "", safeHref);
                  }
                },
              }
            : {})}
        >
          {label}
        </a>
      );
    }

    return <span key={`${keyPrefix}-${index}`}>{part}</span>;
  });
}

function renderMarkdown(content: string) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const headingIds = new Map<string, number>();

  const getUniqueHeadingId = (title: string) => {
    const base = slugifyHeading(title) || "section";
    const count = headingIds.get(base) ?? 0;
    headingIds.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  };

  const elements: ReactNode[] = [];
  let paragraphBuffer: string[] = [];
  let bulletBuffer: string[] = [];
  let numberBuffer: string[] = [];
  let codeBuffer: string[] = [];
  let tableBuffer: MarkdownTableState | null = null;
  let inCodeBlock = false;

  const flushParagraph = () => {
    if (!paragraphBuffer.length) return;

    const text = paragraphBuffer.join(" ");
    elements.push(
      <p key={`p-${elements.length}`} className="text-sm leading-7 text-foreground">
        {renderInline(text, `inline-p-${elements.length}`)}
      </p>
    );
    paragraphBuffer = [];
  };

  const flushBullets = () => {
    if (!bulletBuffer.length) return;

    elements.push(
      <ul key={`ul-${elements.length}`} className="list-disc space-y-2 pl-5 text-sm leading-7">
        {bulletBuffer.map((item, index) => (
          <li key={index}>{renderInline(item, `inline-ul-${elements.length}-${index}`)}</li>
        ))}
      </ul>
    );
    bulletBuffer = [];
  };

  const flushNumbers = () => {
    if (!numberBuffer.length) return;

    elements.push(
      <ol key={`ol-${elements.length}`} className="list-decimal space-y-2 pl-5 text-sm leading-7">
        {numberBuffer.map((item, index) => (
          <li key={index}>{renderInline(item, `inline-ol-${elements.length}-${index}`)}</li>
        ))}
      </ol>
    );
    numberBuffer = [];
  };

  const flushCode = () => {
    if (!codeBuffer.length) return;

    elements.push(
      <pre
        key={`pre-${elements.length}`}
        className="overflow-x-auto rounded-xl border border-border bg-muted/50 p-4 text-xs leading-6"
      >
        <code>{codeBuffer.join("\n")}</code>
      </pre>
    );
    codeBuffer = [];
  };

  const flushTable = () => {
    if (!tableBuffer) return;

    const table = tableBuffer;

    elements.push(
      <div key={`table-${elements.length}`} className="overflow-hidden rounded-xl border border-border">
        <table className="w-full table-fixed border-collapse text-sm">
          <thead className="bg-muted/50">
            <tr>
              {table.headers.map((header, index) => (
                <th
                  key={index}
                  className={`border-b border-border px-3 py-2 align-top font-semibold text-foreground ${tableAlignClass(table.aligns[index])}`}
                >
                  <span className="break-words">
                    {renderInline(header, `inline-table-head-${elements.length}-${index}`)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b border-border last:border-b-0">
                {normalizeTableRow(row, table.headers.length).map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className={`px-3 py-2 align-top text-muted-foreground ${tableAlignClass(table.aligns[cellIndex])}`}
                  >
                    <span className="break-words">
                      {renderInline(cell, `inline-table-cell-${elements.length}-${rowIndex}-${cellIndex}`)}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

    tableBuffer = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (line.trim().startsWith("```")) {
      flushParagraph();
      flushBullets();
      flushNumbers();
      flushTable();

      if (inCodeBlock) {
        flushCode();
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushBullets();
      flushNumbers();
      flushTable();
      continue;
    }

    const tableRow = parseMarkdownTableRow(line);
    const nextTableRow = i + 1 < lines.length ? parseMarkdownTableRow(lines[i + 1]) : null;
    const nextAlignments = nextTableRow ? getMarkdownTableAlignments(nextTableRow) : null;

    if (tableRow && nextAlignments) {
      flushParagraph();
      flushBullets();
      flushNumbers();
      flushTable();

      tableBuffer = {
        headers: tableRow,
        rows: [],
        aligns: normalizeTableAligns(nextAlignments, tableRow.length),
      };

      i += 1;
      continue;
    }

    if (tableBuffer && tableRow) {
      tableBuffer.rows.push(normalizeTableRow(tableRow, tableBuffer.headers.length));
      continue;
    }

    flushTable();

    if (trimmed.startsWith("# ")) {
      flushParagraph();
      flushBullets();
      flushNumbers();

      const title = trimmed.slice(2);
      const id = getUniqueHeadingId(title);

      elements.push(
        <h1
          id={id}
          key={`h1-${elements.length}`}
          className="scroll-mt-24 text-2xl font-semibold tracking-tight"
        >
          {title}
        </h1>
      );
      continue;
    }

    if (trimmed.startsWith("## ")) {
      flushParagraph();
      flushBullets();
      flushNumbers();

      const title = trimmed.slice(3);
      const id = getUniqueHeadingId(title);

      elements.push(
        <h2
          id={id}
          key={`h2-${elements.length}`}
          className="scroll-mt-24 pt-2 text-xl font-semibold tracking-tight"
        >
          {title}
        </h2>
      );
      continue;
    }

    if (trimmed.startsWith("### ")) {
      flushParagraph();
      flushBullets();
      flushNumbers();

      const title = trimmed.slice(4);
      const id = getUniqueHeadingId(title);

      elements.push(
        <h3
          id={id}
          key={`h3-${elements.length}`}
          className="scroll-mt-24 pt-1 text-base font-semibold"
        >
          {title}
        </h3>
      );
      continue;
    }

    if (trimmed.startsWith("- ")) {
      flushParagraph();
      flushNumbers();
      bulletBuffer.push(trimmed.slice(2));
      continue;
    }

    if (/^\d+\.\s/.test(trimmed)) {
      flushParagraph();
      flushBullets();
      numberBuffer.push(trimmed.replace(/^\d+\.\s/, ""));
      continue;
    }

    paragraphBuffer.push(trimmed);
  }

  flushParagraph();
  flushBullets();
  flushNumbers();
  flushTable();
  flushCode();

  return <div className="space-y-4">{elements}</div>;
}

export default function DocumentationDetail() {
  const { slug } = useParams<{ slug: string }>();
  const page = slug ? getDocumentationPage(slug) : null;
  const navigate = useNavigate();

  if (!page) {
    return <Navigate to="/settings/documentation" replace />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Link to="/settings/documentation" className="transition hover:text-foreground">
          Documentation
        </Link>
        <span>/</span>
        <span>{page.title}</span>
      </div>

      <Card className="rounded-2xl border border-border bg-card p-6 md:p-8">
        <div className="mb-6 flex min-w-0 items-start gap-3">
          <LeftButton
            onClick={() => navigate("/settings/documentation")}
            title="Back"
            iconOnly
          />

          <div className="min-w-0 space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {page.category}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">{page.title}</h1>
            <p className="text-sm text-muted-foreground">{page.summary}</p>
          </div>
        </div>

        {renderMarkdown(page.content)}
      </Card>
    </div>
  );
}