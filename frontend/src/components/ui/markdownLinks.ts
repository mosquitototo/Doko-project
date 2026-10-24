import { activeEditor$, addImportVisitor$, currentSelection$, editorRootElementRef$, getNodeRectangle, linkDialogState$, openLinkEditDialog$, realmPlugin } from "@mdxeditor/editor";
import { $getNearestNodeFromDOMNode, $getSelection, getNearestEditorFromDOMNode } from "lexical";
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";

export type MarkdownLinkAction = { index: number; url: string; action: "edit" | "remove" };

export const textLinksPlugin = realmPlugin({
  init(realm) {
    realm.pub(addImportVisitor$, {
      testNode: "link",
      priority: 100,
      visitNode({ mdastNode, lexicalParent, actions }) {
        if (mdastNode.type === "link") actions.visitChildren(mdastNode, lexicalParent);
      },
    });
  },
});

export type MarkdownLinkController = {
  preview: (anchor: HTMLAnchorElement) => void;
  close: () => void;
  containsPopup: (target: Node) => boolean;
  apply: (request: MarkdownLinkAction, root: HTMLElement) => void;
};

export const markdownLinkActionsPlugin = realmPlugin<{
  onReady: (controller: MarkdownLinkController) => void;
}>({
  init(realm, params) {
    let previewFrame = 0;
    let restorePreview: (() => void) | null = null;
    realm.sub(linkDialogState$, state => {
      if (state.type === "inactive" && restorePreview) queueMicrotask(() => restorePreview?.());
    });
    params?.onReady({
      containsPopup(target) {
        return !!realm.getValue(editorRootElementRef$)?.current?.contains(target);
      },
      preview(anchor) {
        const editor = getNearestEditorFromDOMNode(anchor);
        if (!editor) return;
        const preview = editor.read(() => {
          let node = $getNearestNodeFromDOMNode(anchor);
          while (node && !$isLinkNode(node)) node = node.getParent();
          if (!$isLinkNode(node)) return null;
          return {
            type: "preview" as const, url: node.getURL(), href: node.sanitizeUrl(node.getURL()),
            linkNodeKey: node.getKey(), title: node.getTitle() ?? "",
          };
        });
        if (!preview) return;
        restorePreview = () => {
          const rectangle = getNodeRectangle(editor, preview.linkNodeKey);
          if (anchor.isConnected && rectangle) realm.pub(linkDialogState$, { ...preview, rectangle });
          else restorePreview = null;
        };
        cancelAnimationFrame(previewFrame);
        previewFrame = requestAnimationFrame(() => {
          restorePreview?.();
        });
      },
      close() {
        restorePreview = null;
        cancelAnimationFrame(previewFrame);
        realm.pub(linkDialogState$, { type: "inactive" });
      },
      apply(request, root) {
        const anchor = root.querySelectorAll<HTMLAnchorElement>("[contenteditable] a[href]")[request.index];
        if (!anchor || anchor.getAttribute("href") !== request.url) return;
        const editor = getNearestEditorFromDOMNode(anchor);
        if (!editor || !editor.isEditable()) return;
        editor.update(() => {
          let node = $getNearestNodeFromDOMNode(anchor);
          while (node && !$isLinkNode(node)) node = node.getParent();
          if (!$isLinkNode(node)) return;
          node.selectStart();
          realm.pub(activeEditor$, editor);
          realm.pub(currentSelection$, $getSelection());
          if (request.action === "remove") editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
          else realm.pub(openLinkEditDialog$);
        });
      },
    });
  },
});
