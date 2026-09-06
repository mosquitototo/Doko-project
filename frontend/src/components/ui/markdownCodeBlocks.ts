import { syntaxHighlighting } from "@codemirror/language";
import { classHighlighter } from "@lezer/highlight";

export const markdownCodeBlockExtensions = [syntaxHighlighting(classHighlighter)];
