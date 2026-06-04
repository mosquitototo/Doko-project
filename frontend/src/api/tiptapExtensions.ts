import {
  ReactNodeViewRenderer,
} from "@tiptap/react";

import { Extension } from "@tiptap/core";
import { Plugin } from "prosemirror-state";

import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Highlight from "@tiptap/extension-highlight";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";

import { createLowlight } from "lowlight";
import javascript from "highlight.js/lib/languages/javascript";
import python from "highlight.js/lib/languages/python";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import yaml from "highlight.js/lib/languages/yaml";
import sql from "highlight.js/lib/languages/sql";
import xml from "highlight.js/lib/languages/xml";
import powershell from "highlight.js/lib/languages/powershell";
import ini from "highlight.js/lib/languages/ini";
import plaintext from "highlight.js/lib/languages/plaintext";
import type { LanguageFn } from "highlight.js";

import TiptapCodeBlock from "../components/ui/TiptapCodeBlock";



function asLanguageFn(lang: unknown): LanguageFn {
  return lang as LanguageFn;
}

export const tiptapLowlight = createLowlight({
  plaintext: asLanguageFn(plaintext),
  bash: asLanguageFn(bash),
  powershell: asLanguageFn(powershell),
  json: asLanguageFn(json),
  yaml: asLanguageFn(yaml),
  sql: asLanguageFn(sql),
  javascript: asLanguageFn(javascript),
  python: asLanguageFn(python),
  xml: asLanguageFn(xml),
  ini: asLanguageFn(ini),
});

export const SecurePaste = Extension.create({
  name: "securePaste",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handlePaste(view, event) {
            const text = event.clipboardData?.getData("text/plain");
            if (!text) return false;

            event.preventDefault();

            view.dispatch(
              view.state.tr.replaceSelectionWith(view.state.schema.text(text))
            );

            return true;
          },
        },
      }),
    ];
  },
});

export function buildTiptapExtensions(options?: { placeholder?: string; securePaste?: boolean }) {
  const extensions = [
    StarterKit.configure({
    codeBlock: false,
    }),
    CodeBlockLowlight.configure({
    lowlight: tiptapLowlight,
    defaultLanguage: "plaintext",
    languageClassPrefix: "language-",
    enableTabIndentation: true,
    tabSize: 2,
    }).extend({
    addNodeView() {
        return ReactNodeViewRenderer(TiptapCodeBlock);
    },
    }),
    Highlight,
    TextStyle,
    Color,
    Placeholder.configure({
      placeholder: options?.placeholder ?? "",
    }),
  ];

  if (options?.securePaste !== false) {
    extensions.push(SecurePaste);
  }

  return extensions;
}