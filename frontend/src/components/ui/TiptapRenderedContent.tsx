import { useEffect } from "react";
import {
  EditorContent,
  useEditor,
} from "@tiptap/react";

import { buildTiptapExtensions } from "../../api/tiptapExtensions";

type Props = {
  html: string;
  className?: string;
};

export default function TiptapRenderedContent(props: Props) {
  const editor = useEditor({
    editable: false,
    immediatelyRender: false,
    extensions: buildTiptapExtensions({
      placeholder: "",
      securePaste: false,
    }),
    content: props.html || "",
    editorProps: {
      attributes: {
        class: "tiptap-editor min-h-0 px-0 py-0 text-sm text-foreground",
      },
    },
  });

  useEffect(() => {
    if (!editor) return;

    const currentHtml = editor.getHTML();
    const nextHtml = props.html || "";

    if (nextHtml !== currentHtml) {
      editor.commands.setContent(nextHtml, { emitUpdate: false });
    }

    editor.setEditable(false);
  }, [editor, props.html]);

  if (!editor) {
    return null;
  }

  return (
    <div
      className={[
        "tiptap-rendered-content min-h-0 min-w-0 break-words text-sm text-foreground",
        props.className || "",
      ].join(" ")}
    >
      <EditorContent editor={editor} />
    </div>
  );
}