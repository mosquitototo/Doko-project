function escapeHtmlTags(value: string) {
  return String(value || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function stripSupportedHtmlTags(value: string) {
  return String(value || "").replace(/<\/?(h[1-6]|p|blockquote|strong|b|em|i|u|s|strike|del|sup|sub|ul|ol|li|br|hr)\b[^>]*>/gi, "");
}

function normalizeSupportedHtmlToMarkdown(value: string) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<hr\s*\/?>/gi, "\n\n---\n\n")
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level, content) => {
      const depth = Math.min(6, Math.max(1, Number(level) || 3));
      const text = stripSupportedHtmlTags(content).trim();
      return text ? `\n${"#".repeat(depth)} ${text}\n` : "";
    })
    .replace(/<p\b[^>]*>\s*<\/p>/gi, "\n")
    .replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_match, content) => {
      const text = String(content || "").trim();
      return text ? `\n${text}\n` : "";
    })
    .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_match, content) => {
      const text = String(content || "").trim();
      if (!text) return "";
      return `\n${text
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")}\n`;
    })
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag, content) => {
      const text = String(content || "").trim();
      return text ? `**${text}**` : "";
    })
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag, content) => {
      const text = String(content || "").trim();
      return text ? `*${text}*` : "";
    })
    .replace(/<(s|strike|del)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag, content) => {
      const text = String(content || "").trim();
      return text ? `~~${text}~~` : "";
    })
    .replace(/<u\b[^>]*>([\s\S]*?)<\/u>/gi, (_match, content) => {
      const text = String(content || "").trim();
      return text ? `<u>${escapeHtmlTags(text)}</u>` : "";
    })
    .replace(/<sup\b[^>]*>([\s\S]*?)<\/sup>/gi, (_match, content) => {
      const text = String(content || "").trim();
      return text ? `<sup>${escapeHtmlTags(text)}</sup>` : "";
    })
    .replace(/<sub\b[^>]*>([\s\S]*?)<\/sub>/gi, (_match, content) => {
      const text = String(content || "").trim();
      return text ? `<sub>${escapeHtmlTags(text)}</sub>` : "";
    })
    .replace(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi, (_match, content) => {
      return `\n${String(content || "")
        .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_liMatch, liContent) => {
          const text = stripSupportedHtmlTags(liContent).trim();
          return text ? `- ${text}\n` : "";
        })
        .trim()}\n`;
    })
    .replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_match, content) => {
      let index = 0;
      return `\n${String(content || "")
        .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_liMatch, liContent) => {
          const text = stripSupportedHtmlTags(liContent).trim();
          if (!text) return "";
          index += 1;
          return `${index}. ${text}\n`;
        })
        .trim()}\n`;
    });
}

function escapeUnsupportedHtmlInline(value: string) {
  return String(value || "")
    .split(/(`+[^`]*`+)/g)
    .map((part) => {
      if (part.startsWith("`") && part.endsWith("`")) {
        return part;
      }

      const normalized = normalizeSupportedHtmlToMarkdown(part);

      return normalized
        .replace(/<!--[\s\S]*?-->/g, escapeHtmlTags)
        .replace(/<![A-Za-z][^>]*>/g, escapeHtmlTags)
        .replace(/<\/?(?!u\b|sup\b|sub\b)[A-Za-z][A-Za-z0-9:-]*(?:\s[^<>]*)?>/g, escapeHtmlTags)
        .replace(/<(?![^<>\n]*>)/g, "\\<")
        .replace(/(?<!\\)[{}]/g, (character) => `\\${character}`);
    })
    .join("");
}

export function markdownForMdxEditor(value: string) {
  const lines = String(value || "").split("\n");
  let inFence = false;
  let fenceMarker = "";

  return lines
    .map((line) => {
      const trimmed = line.trimStart();

      if (!inFence && (trimmed.startsWith("```") || trimmed.startsWith("~~~"))) {
        inFence = true;
        fenceMarker = trimmed.startsWith("```") ? "```" : "~~~";
        return line;
      }

      if (inFence) {
        if (trimmed.startsWith(fenceMarker)) {
          inFence = false;
          fenceMarker = "";
        }

        return line;
      }

      return escapeUnsupportedHtmlInline(line);
    })
    .join("\n");
}
