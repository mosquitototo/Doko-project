import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  FORMAT_TEXT_COMMAND,
  PASTE_COMMAND,
  TextNode,
  type LexicalEditor,
  type TextFormatType,
} from "lexical";

const allowedFormats = new Set<TextFormatType>(["bold", "italic", "strikethrough", "code"]);
const excludedFormats: TextFormatType[] = [
  "underline", "superscript", "subscript", "highlight", "lowercase", "uppercase", "capitalize",
];

export function registerMarkdownEditorPolicy(editor: LexicalEditor) {
  const unregisterCodePaste = editor.registerCommand(PASTE_COMMAND, event => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || !selection.hasFormat("code")) return false;
    if (!event || !("clipboardData" in event) || !event.clipboardData) return false;
    const text = event.clipboardData.getData("text/plain");
    if (!text) return false;
    event.preventDefault();
    selection.insertText(text);
    return true;
  }, COMMAND_PRIORITY_HIGH);
  const unregisterCommand = editor.registerCommand(
    FORMAT_TEXT_COMMAND,
    format => !allowedFormats.has(format),
    COMMAND_PRIORITY_HIGH,
  );
  const unregisterTransform = editor.registerNodeTransform(TextNode, node => {
    for (const format of excludedFormats) {
      if (node.hasFormat(format)) node.toggleFormat(format);
    }
    if (node.getStyle()) node.setStyle("");
  });
  return () => {
    unregisterCodePaste();
    unregisterCommand();
    unregisterTransform();
  };
}
