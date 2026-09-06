import {
  addSyntaxExtension$,
  createActiveEditorSubscription$,
  GenericHTMLNode,
  insertMarkdown$,
  realmPlugin,
} from "@mdxeditor/editor";
import { $createParagraphNode, $createTextNode, $isRootOrShadowRoot, COMMAND_PRIORITY_HIGH, PASTE_COMMAND } from "lexical";
import { markdownForMdxEditor, markdownSyntaxPolicy } from "./markdownForEditor";
import { registerMarkdownEditorPolicy } from "./markdownEditorPolicy";

export const strictMarkdownPlugin = realmPlugin({
  init(realm) {
    realm.pub(addSyntaxExtension$, markdownSyntaxPolicy);
    realm.pub(createActiveEditorSubscription$, editor => {
      const unregisterPolicy = registerMarkdownEditorPolicy(editor);
      const unregisterHtml = editor.hasNodes([GenericHTMLNode])
        ? editor.registerNodeTransform(GenericHTMLNode, node => {
          const text = $createTextNode(`<${node.getTag()}>${node.getTextContent()}</${node.getTag()}>`);
          node.replace($isRootOrShadowRoot(node.getParent()) ? $createParagraphNode().append(text) : text);
        })
        : () => {};
      const unregisterPaste = editor.registerCommand(PASTE_COMMAND, event => {
        if (!event || !("clipboardData" in event) || !event.clipboardData) return false;
        if (event.clipboardData.getData("application/x-lexical-editor")) return false;
        const text = event.clipboardData.getData("text/plain") || event.clipboardData.getData("text/html");
        if (!text) return false;
        event.preventDefault();
        realm.pub(insertMarkdown$, markdownForMdxEditor(text));
        return true;
      }, COMMAND_PRIORITY_HIGH);
      return () => {
        unregisterPaste();
        unregisterHtml();
        unregisterPolicy();
      };
    });
  },
});
